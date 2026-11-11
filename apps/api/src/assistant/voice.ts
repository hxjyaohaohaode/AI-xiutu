import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import WebSocket, { WebSocketServer, type RawData } from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { FastifyInstance } from 'fastify';
import {
  transaction,
  releaseHold,
  settleHold,
  markUnknownHold,
  assertAssistantGrant,
  type Database,
} from '@ai-xiutu/db';
import {
  assistantPublicSearchSchema,
  voiceClientEventSchema,
  type AssistantContext,
  type VoiceClientEvent,
  type VoiceServerEvent,
} from '@ai-xiutu/contracts';
import {
  voiceEndpoint,
  voiceStartEvent,
  voiceAudioEvent,
  voiceTextEvents,
  voiceResultEvents,
  liveContextAppend,
  normalizeVoiceEvent,
  voiceModel,
  runEditorAgent,
  VoiceTranscriptBuffer,
} from '@ai-xiutu/assistant';
import type { AppConfig } from '../config.js';
import { hash } from '../core.js';
import {
  assistantAccess,
  lockedAssistantAccess,
  mergeAssistantScopes,
  validateScope,
} from './context.js';
import type { AssistantService, VoiceRow } from './service.js';
import { registerTeamVoice } from './team-voice.js';
import { executeAutomaticCandidate } from './apply.js';

type PublicSearch = Extract<VoiceClientEvent, { type: 'search' }>['search'];
function spokenPublicSearch(text: string): PublicSearch | undefined {
  // Only a literal spoken query may leave the workspace, never the conversation or a model guess.
  const command =
    /^(?:公开搜索(图片|资料)?[：:，, \t]*|public search( images)?[: ,]+)([^\r\n]*)$/iu.exec(
      text.trim(),
    );
  if (!command) return;
  const search = assistantPublicSearchSchema.safeParse({
    query: command[3],
    kind: command[1] === '图片' || command[2] ? 'images' : 'text',
  });
  if (search.success) return search.data;
}

interface VoicePort {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: 'message', listener: (data: RawData) => void): unknown;
  on(event: 'close' | 'error', listener: () => void): unknown;
}

class RoomVoicePort extends EventEmitter implements VoicePort {
  readyState: number = WebSocket.OPEN;
  readonly bufferedAmount = 0;
  constructor(private readonly deliver: (event: VoiceServerEvent) => void) {
    super();
  }
  send(data: string) {
    this.deliver(JSON.parse(data) as VoiceServerEvent);
  }
  input(event: import('@ai-xiutu/contracts').VoiceClientEvent) {
    if (this.readyState === WebSocket.OPEN)
      this.emit('message', Buffer.from(JSON.stringify(event)));
  }
  close() {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
  terminate() {
    this.close();
  }
}

export function attachVoiceBridge(
  app: FastifyInstance,
  db: Database,
  config: AppConfig,
  service: AssistantService,
) {
  const server = new WebSocketServer({
    noServer: true,
    maxPayload: 1_600_000,
    perMessageDeflate: false,
    handleProtocols: (protocols) => (protocols.has('xiutu-voice') ? 'xiutu-voice' : false),
  });
  const snapshots = new Map<string, { context?: AssistantContext; expiresAt: number }>();
  const connections = new Map<string, { stop(): void; done: Promise<void> }>();
  const upgrading = new Set<Promise<void>>();
  let accepting = true;
  const cleanup = setInterval(() => {
    for (const [id, value] of snapshots) if (value.expiresAt < Date.now()) snapshots.delete(id);
    void service.recoverStale().catch(() => undefined);
  }, 20_000);
  cleanup.unref();
  // Drain upgraded sockets before closing HTTP/DB. An already sent backend call
  // remains payable even if its browser disappears. Its bounded receipt drains.
  app.addHook('preClose', async () => {
    accepting = false;
    clearInterval(cleanup);
    snapshots.clear();
    await Promise.allSettled([...upgrading]);
    const active = [...connections.values()];
    for (const connection of active) connection.stop();
    await Promise.allSettled(active.map((connection) => connection.done));
    for (const client of server.clients) client.terminate();
  });
  app.addHook('onClose', async () => {
    server.close();
  });
  const send = (ws: VoicePort, event: VoiceServerEvent) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 1_000_000) {
      ws.close(1008, 'slow consumer');
      return;
    }
    ws.send(JSON.stringify(event));
  };
  function connect(row: VoiceRow, client: VoicePort, authHash: string) {
    const live = voiceModel(row.model_id).protocol === 'live';
    let context = snapshots.get(row.id)?.context;
    let contextEpoch = row.context_epoch;
    const searched = new Set<string>();
    let lastCommittedInput = '';
    let speechCutUntil = 0;
    let delegationLimitAnnounced = false;
    snapshots.delete(row.id);
    let active = false,
      activating = false,
      ended = false,
      closing = false,
      muted = false,
      finalUsage = false;
    let providerSessionId = '',
      delegationCount = 0,
      responseCount = 0,
      dispatchSequence = 0;
    let windowStart = Date.now(),
      windowBytes = 0,
      lastContextAt = 0,
      lastTextAt = 0,
      controlBusy = false;
    let lastPing = Date.now(),
      accessBusy = false,
      stopReason = '';
    const usageTimes: string[] = [];
    const usage: unknown[] = [],
      knownCalls = new Set<string>(),
      transcript = new VoiceTranscriptBuffer();
    const startedAt = Date.now();
    let endTimer: NodeJS.Timeout | undefined, durationTimer: NodeJS.Timeout | undefined;
    let responsePending = false,
      queuedResponse = false,
      unconfirmedAudio = false,
      receiptMissing = false;
    let sentInputAudio = false,
      responseReceipts = 0,
      transportClosedConfirmed = false;
    const itemAudioMs = new Map<string, number>(),
      responses = new Set<string>();
    const pendingLiveContext = new Set<string>();
    const waitingLiveCalls = new Map<string, NodeJS.Timeout>();
    const visualDeletes = new Set<string>();
    let providerVisualItem: string | null = null;
    let delegationChain = Promise.resolve();
    const searchLimit = Math.min(
      3,
      Math.max(1, Math.floor(row.config.voiceModel.maxDelegations / 2)),
    );
    function invalidateContext(notifyProvider = true) {
      const hadContext = !!context;
      context = undefined;
      if (providerVisualItem) {
        const event_id = `evt_${randomUUID()}`;
        visualDeletes.add(event_id);
        if (visualDeletes.size > 12) visualDeletes.delete(visualDeletes.values().next().value!);
        upstreamSend({ type: 'conversation.item.delete', event_id, item_id: providerVisualItem });
        providerVisualItem = null;
      } else if (live && hadContext && notifyProvider) {
        upstreamSend(
          liveContextAppend(
            'thinking',
            '此前共享的画面已失效。涉及当前图片时，等新的共享画面或由后端确认。',
          ),
        );
      }
      const epoch = ++contextEpoch;
      const persisted = db.query(
        "UPDATE voice_sessions SET context_epoch=GREATEST(context_epoch,$2) WHERE id=$1 AND state='active'",
        [row.id, epoch],
      );
      void persisted.catch(() => stop('CONTEXT_PERSISTENCE_FAILED'));
      return { epoch, persisted };
    }
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const proxyRaw = service.env.ASSISTANT_EGRESS_PROXY;
    let proxy: HttpsProxyAgent<string> | undefined;
    if (proxyRaw) {
      const url = new URL(proxyRaw);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.hash ||
        (url.pathname && url.pathname !== '/')
      )
        throw new Error('VOICE_PROXY_CONFIG_INVALID');
      proxy = new HttpsProxyAgent(proxyRaw);
    }
    const upstream = (
      service.dependencies.connectVoice ?? ((url, options) => new WebSocket(url, options))
    )(voiceEndpoint(row.model_id), {
      headers: {
        Authorization: `Bearer ${service.key}`,
        'OpenAI-Safety-Identifier': hash(row.actor_id),
      },
      maxPayload: 2_000_000,
      perMessageDeflate: false,
      handshakeTimeout: 15_000,
      ...(proxy ? { agent: proxy } : {}),
    });
    const upstreamSend = (event: unknown) => {
      if (upstream.readyState !== WebSocket.OPEN || upstream.bufferedAmount > 1_000_000)
        throw new Error('VOICE_UPSTREAM_BACKPRESSURE');
      const packet = event as { type?: string; event_id?: string };
      if (
        live &&
        packet.event_id &&
        /^session\.(thinking|commentary|instructions)\.append$/.test(packet.type ?? '')
      ) {
        pendingLiveContext.add(packet.event_id);
        if (pendingLiveContext.size > 32)
          pendingLiveContext.delete(pendingLiveContext.values().next().value!);
      }
      upstream.send(JSON.stringify(event));
    };
    function publishContext() {
      if (live) {
        if (context)
          upstreamSend(
            liveContextAppend(
              'thinking',
              context.imageDataUrl
                ? '编辑器已有新的授权画面与配方。涉及图片细节或编辑时，请使用后端当前画面。'
                : '编辑器共享了当前配方，未共享画面。可以查看参数，不能描述照片细节。',
            ),
          );
        return;
      }
      if (!context?.imageDataUrl) return;
      const id = `item_xiutu_${randomUUID().replaceAll('-', '')}`;
      upstreamSend({
        type: 'conversation.item.create',
        item: {
          id,
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: '这是我共享的最新编辑预览。' },
            { type: 'input_image', image_url: context.imageDataUrl },
          ],
        },
      });
      providerVisualItem = id;
    }
    const assertAccess = async () => {
      const auth = await db.query(
        "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND u.status='active'",
        [authHash, row.actor_id],
      );
      if (!auth.rowCount) throw new Error('VOICE_AUTH_EXPIRED');
      await assistantAccess(db, row.actor_id, row.project_id);
      if (row.scope.executionGrantId)
        await assertAssistantGrant(db, row.scope.executionGrantId, row.actor_id, row.project_id);
      await validateScope(db, row.actor_id, row.scope);
      await service.model(db, row.model_id, 'realtime-voice');
      await service.model(db, row.backend_model_id, 'assistant-turn');
    };
    const finish = async (
      requestedState: 'closed' | 'unknown' | 'failed',
      requestedReason: string,
    ) => {
      if (ended) return done;
      ended = true;
      closing = true;
      clearInterval(accessTimer);
      clearTimeout(startTimer);
      clearTimeout(endTimer);
      clearTimeout(durationTimer);
      for (const timer of waitingLiveCalls.values()) clearTimeout(timer);
      waitingLiveCalls.clear();
      upstream.terminate();
      let state = requestedState,
        reason = requestedReason;
      try {
        await delegationChain.catch(() => undefined);
        if (
          state === 'closed' &&
          (
            await db.query(
              'SELECT 1 FROM assistant_dispatches WHERE voice_id=$1 AND completed_at IS NULL LIMIT 1',
              [row.id],
            )
          ).rowCount
        ) {
          state = 'unknown';
          reason = 'BACKEND_RESULT_UNCONFIRMED';
        }
        const persisted = await transaction(db, async (tx) => {
          const current = (
            await tx.query('SELECT state,error_code FROM voice_sessions WHERE id=$1 FOR UPDATE', [
              row.id,
            ])
          ).rows[0];
          if (!current || !['connecting', 'active'].includes(current.state)) {
            return {
              state: ['closed', 'failed'].includes(current?.state)
                ? (current.state as 'closed' | 'failed')
                : ('unknown' as const),
              reason: current?.error_code ?? 'PERSISTED_STATE_CHANGED',
            };
          }
          if (state === 'closed') await settleHold(tx, row.hold_id);
          else if (state === 'failed') await releaseHold(tx, row.hold_id);
          else await markUnknownHold(tx, row.hold_id);
          const seconds = Math.max(0, Math.ceil((Date.now() - startedAt) / 1000));
          await tx.query(
            'UPDATE voice_sessions SET state=$2,elapsed_seconds=$3,usage=$4,error_code=$5,updated_at=clock_timestamp() WHERE id=$1',
            [
              row.id,
              state,
              seconds,
              JSON.stringify({
                events: usage,
                eventTimes: usageTimes,
                vendorFinalUsageConfirmed: finalUsage,
                transportClosedConfirmed,
                responseReceiptsComplete:
                  !responsePending && !responses.size && !unconfirmedAudio && !receiptMissing,
                responseReceipts,
                billingBasis: 'configured_session_unit',
                voiceChannel: row.config.teamArtworkId ? 'team' : 'individual',
                providerSessionId,
              }),
              reason,
            ],
          );
          return { state, reason };
        });
        state = persisted.state;
        reason = persisted.reason;
      } catch {
        state = 'unknown';
        reason = 'SETTLEMENT_UNCONFIRMED';
      } finally {
        try {
          send(client, { type: 'closed', state, reason });
          client.close(1000, 'session ended');
        } catch {
          client.terminate();
        } finally {
          transcript.clear();
          context = undefined;
          connections.delete(row.id);
          resolveDone();
        }
      }
    };
    const stop = (reason: string) => {
      if (ended || closing) return;
      closing = true;
      stopReason = reason;
      queuedResponse = false;
      try {
        if (live && active && upstream.readyState === WebSocket.OPEN) {
          upstreamSend({ type: 'session.close' });
          endTimer = setTimeout(() => void finish('unknown', 'FINAL_USAGE_UNCONFIRMED'), 8000);
        } else if (active && upstream.readyState === WebSocket.OPEN) {
          upstream.close(1000);
          endTimer = setTimeout(() => void finish('unknown', 'CLOSE_UNCONFIRMED'), 3000);
        } else void finish('unknown', reason);
      } catch {
        void finish('unknown', 'VOICE_STOP_UNCONFIRMED');
      }
    };
    connections.set(row.id, { stop: () => stop('SERVER_SHUTDOWN'), done });
    const startTimer = setTimeout(() => void finish('unknown', 'VOICE_START_TIMEOUT'), 20_000);
    const accessTimer = setInterval(() => {
      if (accessBusy || ended || closing) return;
      accessBusy = true;
      void assertAccess()
        .then(async () => {
          if (Date.now() - lastPing > 35_000) {
            stop('CLIENT_HEARTBEAT_LOST');
            return;
          }
          const result = await db.query(
            "UPDATE voice_sessions SET updated_at=clock_timestamp() WHERE id=$1 AND state IN ('connecting','active') RETURNING id",
            [row.id],
          );
          if (!result.rowCount) stop('SESSION_STATE_CHANGED');
        })
        .catch(() => stop('ACCESS_REVOKED'))
        .finally(() => {
          accessBusy = false;
        });
    }, 5000);
    accessTimer.unref();
    const requestResponse = () => {
      if (ended || closing || live) return;
      if (responsePending || responses.size) {
        queuedResponse = true;
        return;
      }
      if (responseCount >= row.config.voiceModel.maxDelegations * 4) {
        stop('RESPONSE_BUDGET');
        return;
      }
      responseCount++;
      responsePending = true;
      queuedResponse = false;
      upstreamSend({ type: 'response.create' });
    };
    const sendEvents = (events: Record<string, unknown>[]) => {
      for (const event of events) {
        if (event.type === 'response.create') requestResponse();
        else upstreamSend(event);
      }
    };
    const delegate = (
      callId: string,
      request: string,
      explicitSearch?: PublicSearch,
      throughMs?: number,
    ) => {
      if (!callId || callId.length > 128 || knownCalls.has(callId) || ended || closing) return;
      const manualSearch = Boolean(explicitSearch);
      const maxDelegations = row.config.voiceModel.maxDelegations;
      if (delegationCount >= maxDelegations) {
        const message = '本次通话的后台协作额度已用完，仍可继续语音交流。';
        if (manualSearch || !delegationLimitAnnounced) {
          delegationLimitAnnounced = true;
          send(client, { type: 'error', code: 'VOICE_DELEGATION_LIMIT', message });
        }
        // Resolve a bounded number of vendor tool calls without dispatching Responses.
        if (!manualSearch && knownCalls.size < maxDelegations + 8) {
          knownCalls.add(callId);
          sendEvents(voiceResultEvents(row.model_id, callId, message));
        }
        return;
      }
      const latestSpeech = transcript.latestUser(throughMs, !live ? lastCommittedInput : undefined);
      const search =
        explicitSearch ??
        (!callId.startsWith('typed_') &&
        latestSpeech &&
        (live || (lastCommittedInput && latestSpeech.itemId === lastCommittedInput))
          ? spokenPublicSearch(latestSpeech.text)
          : undefined) ??
        row.scope.publicSearch;
      const canSearch =
        searched.size < searchLimit &&
        Boolean(row.scope.allowWebSearch && row.config.backendModel.webSearch) &&
        Boolean(
          search &&
          !searched.has(`${search.kind}:${search.query.trim().toLowerCase()}`) &&
          (search.kind !== 'images' || row.config.backendModel.webImageSearch),
        );
      if (manualSearch && !canSearch) {
        send(client, {
          type: 'error',
          code: 'VOICE_PUBLIC_SEARCH_UNAVAILABLE',
          message: '请核对联网授权、模型能力和本次通话的公开检索额度。',
        });
        return;
      }
      knownCalls.add(callId);
      delegationCount++;
      if (canSearch && search) {
        searched.add(`${search.kind}:${search.query.trim().toLowerCase()}`);
        send(client, { type: 'search-started' });
      }
      const speakResult = (text: string, applied = false) => {
        if (!manualSearch || live)
          sendEvents(voiceResultEvents(row.model_id, callId, text, applied));
      };
      const frozenContext = context ? structuredClone(context) : undefined;
      const frozenEpoch = contextEpoch;
      const voiceHistory = transcript.history(throughMs, live && !callId.startsWith('typed_'));
      const startSequence = dispatchSequence;
      dispatchSequence += 4;
      delegationChain = delegationChain
        .then(async () => {
          await assertAccess();
          if (ended || closing) return;
          send(client, { type: 'tool', name: 'consult_editor', state: 'running' });
          try {
            if (frozenEpoch !== contextEpoch) throw new Error('VOICE_CONTEXT_CHANGED');
            const agentContext = await service.contextFor(
              row,
              frozenContext,
              request.slice(-4000),
              (name, state) => send(client, { type: 'tool', name, state }),
              startSequence,
              mergeAssistantScopes(row.scope, []),
              authHash,
              row.config.backendModel,
            );
            if (voiceHistory.length) {
              await service.moderate(JSON.stringify(voiceHistory));
              agentContext.history = voiceHistory;
            }
            agentContext.onSearch = async (evidence) => {
              if (evidence.kind === 'cloud')
                agentContext.accessScope.referenceAssetIds = [
                  ...new Set([
                    ...agentContext.accessScope.referenceAssetIds,
                    ...evidence.resources.map((item) => item.id),
                  ]),
                ].sort();
            };
            agentContext.publicSearch = canSearch ? search : undefined;
            const check = agentContext.assertAccess;
            agentContext.assertAccess = async () => {
              if (ended || closing) throw new Error('VOICE_ENDED');
              if (frozenEpoch !== contextEpoch) throw new Error('VOICE_CONTEXT_CHANGED');
              await assertAccess();
              await check();
              if (ended || closing) throw new Error('VOICE_ENDED');
              if (frozenEpoch !== contextEpoch) throw new Error('VOICE_CONTEXT_CHANGED');
            };
            const dispatch = agentContext.beforeDispatch;
            agentContext.beforeDispatch = async (index, bodyHash, meta) => {
              if (ended || closing) throw new Error('VOICE_ENDED');
              if (frozenEpoch !== contextEpoch) throw new Error('VOICE_CONTEXT_CHANGED');
              await dispatch?.(index, bodyHash, meta);
              if (ended || closing) throw new Error('VOICE_ENDED');
              if (frozenEpoch !== contextEpoch) throw new Error('VOICE_CONTEXT_CHANGED');
            };
            const result = await runEditorAgent(
              service.key,
              row.backend_model_id,
              row.config.backendModel,
              agentContext,
              service.dependencies.fetcher,
            );
            if (ended || closing) return;
            const { candidates, execution } = await transaction(db, async (tx) => {
              await lockedAssistantAccess(
                tx,
                row.actor_id,
                row.project_id,
                agentContext.accessScope,
              );
              const current = (
                await tx.query(
                  'SELECT state,context_epoch,config FROM voice_sessions WHERE id=$1 FOR UPDATE',
                  [row.id],
                )
              ).rows[0];
              if (
                current?.state !== 'active' ||
                current.context_epoch !== frozenEpoch ||
                ended ||
                closing ||
                frozenEpoch !== contextEpoch
              )
                throw new Error('VOICE_CONTEXT_CHANGED');
              await agentContext.checkSnapshot(tx, true);
              const historyScope = mergeAssistantScopes(
                agentContext.accessScope,
                current.config.historyScope ? [current.config.historyScope] : [],
              );
              await tx.query(
                "UPDATE voice_sessions SET config=jsonb_set(config,'{historyScope}',$2::jsonb) WHERE id=$1",
                [row.id, JSON.stringify(historyScope)],
              );
              const saved = await service.saveCandidates(
                tx,
                row,
                result,
                frozenContext,
                frozenEpoch,
              );
              if (ended || closing || frozenEpoch !== contextEpoch)
                throw new Error('VOICE_CONTEXT_CHANGED');
              const execution = await executeAutomaticCandidate(tx, {
                actorId: row.actor_id,
                grantId: row.scope.executionGrantId,
                authHash,
                candidates: saved,
                selectedIndex: result.selectedCandidateIndex,
                completed: result.termination === 'completed',
                imageShared: !!frozenContext?.imageDataUrl,
              });
              if (ended || closing || frozenEpoch !== contextEpoch)
                throw new Error('VOICE_CONTEXT_CHANGED');
              return { candidates: saved, execution };
            });
            if (ended || closing || frozenEpoch !== contextEpoch) return;
            send(client, {
              type: 'assistant-result',
              workspace: result.workspace,
              memorySuggestions: result.memorySuggestions,
              text: result.text,
              citations: result.citations,
              search: result.search,
              candidates,
              execution,
            });
            speakResult(
              execution?.state === 'applied' ? `已保存为新版本。\n${result.text}` : result.text,
              execution?.state === 'applied',
            );
            send(client, { type: 'tool', name: 'consult_editor', state: 'completed' });
          } catch {
            send(client, { type: 'tool', name: 'consult_editor', state: 'failed' });
            if (!ended && !closing) {
              const message = '本轮后端任务未能完成，请查看会话状态。';
              if (manualSearch)
                send(client, { type: 'error', code: 'VOICE_PUBLIC_SEARCH_FAILED', message });
              speakResult(message);
            }
          }
        })
        .catch(() => stop('ACCESS_OR_TOOL_FAILED'));
    };
    upstream.on('open', () => {
      try {
        if (!ended && !closing)
          upstreamSend(
            voiceStartEvent(
              row.model_id,
              row.config.voice,
              row.config.voiceModel.maxOutputTokens,
              Boolean(row.config.teamArtworkId),
              row.config.voiceModel.voiceReasoningEffort,
            ),
          );
      } catch {
        void finish('unknown', 'VOICE_START_FAILED');
      }
    });
    upstream.on('message', (data) => {
      if (ended) return;
      try {
        const event = JSON.parse(data.toString());
        if (!event || typeof event !== 'object' || typeof event.type !== 'string')
          throw new Error('event');
        if (
          (!live && event.type === 'session.updated') ||
          (live && event.type === 'session.started')
        ) {
          if (active || activating || closing) return;
          activating = true;
          providerSessionId =
            typeof event.session?.id === 'string' ? event.session.id.slice(0, 160) : '';
          void db
            .query(
              "UPDATE voice_sessions SET state='active',provider_session_id=$2,updated_at=clock_timestamp() WHERE id=$1 AND state='connecting' RETURNING id",
              [row.id, providerSessionId],
            )
            .then((result) => {
              if (!result.rowCount || ended || closing) {
                stop('SESSION_STATE_CHANGED');
                return;
              }
              active = true;
              clearTimeout(startTimer);
              send(client, {
                type: 'ready',
                sessionId: row.id,
                modelId: row.model_id,
                maxSeconds: row.config.voiceModel.maxSeconds,
                maxPublicSearches: searchLimit,
              });
              publishContext();
              durationTimer = setTimeout(
                () => stop('DURATION_BUDGET'),
                row.config.voiceModel.maxSeconds * 1000,
              );
            })
            .catch(() => stop('SESSION_PERSISTENCE_FAILED'));
          return;
        }
        if (event.type === 'error' && event.error?.code === 'response_cancel_not_active') return;
        if (event.type === 'conversation.item.deleted') {
          if (event.item_id === providerVisualItem) providerVisualItem = null;
          return;
        }
        if (live && /^session\.(thinking|commentary|instructions)\.appended$/.test(event.type)) {
          pendingLiveContext.delete(event.client_event_id);
          return;
        }
        if (event.type === 'error') {
          const deleteId = event.error?.event_id;
          if (
            visualDeletes.delete(deleteId) &&
            ['item_not_found', 'conversation_item_not_found'].includes(event.error?.code)
          )
            return;
          if (live && pendingLiveContext.delete(event.error?.client_event_id)) {
            // A missing speech-context acknowledgment has no authority over
            // the application task, playback or the final usage receipt.
            if (!closing)
              send(client, {
                type: 'error',
                code: 'VOICE_CONTEXT_UPDATE_UNCONFIRMED',
                message: '语音服务未确认这次播报更新，界面结果可继续查看。',
              });
            return;
          }
          send(client, {
            type: 'error',
            code: 'VOICE_PROVIDER_ERROR',
            message: '语音服务拒绝了当前配置或请求，请结束后检查运营配置。',
          });
          stop('VOICE_PROVIDER_ERROR');
          return;
        }
        if (!live && event.type === 'response.created') {
          const id = event.response?.id;
          if (typeof id !== 'string') throw new Error('response id');
          if (!responsePending && !responses.has(id)) responseCount++;
          if (responseCount > row.config.voiceModel.maxDelegations * 4) {
            stop('RESPONSE_BUDGET');
            return;
          }
          responsePending = false;
          responses.add(id);
        }
        const normalized = normalizeVoiceEvent(event);
        if (normalized) {
          if (!live && normalized.type === 'interrupted' && normalized.bySpeech)
            speechCutUntil = Date.now() + 1800;
          if (normalized.type === 'transcript') transcript.push(normalized);
          if (normalized.type === 'audio') {
            if (!live) unconfirmedAudio = true;
            if (normalized.itemId) {
              itemAudioMs.set(
                normalized.itemId,
                (itemAudioMs.get(normalized.itemId) ?? 0) +
                  Buffer.from(normalized.pcm, 'base64').length / 48,
              );
              if (itemAudioMs.size > 100) itemAudioMs.delete(itemAudioMs.keys().next().value!);
            }
          }
          send(client, normalized);
        }
        if (!live && event.type === 'input_audio_buffer.committed') {
          lastCommittedInput = typeof event.item_id === 'string' ? event.item_id : '';
          requestResponse();
        }
        if (!live && event.type === 'response.done') {
          const receipt = event.response?.usage;
          if (!receipt || !Number.isFinite(receipt.total_tokens) || receipt.total_tokens < 0)
            receiptMissing = true;
          else responseReceipts++;
          if (usage.length < 100) {
            usage.push(receipt ?? null);
            usageTimes.push(new Date().toISOString());
          } else receiptMissing = true;
          if (typeof event.response?.id === 'string') responses.delete(event.response.id);
          else receiptMissing = true;
          responsePending = false;
          unconfirmedAudio = responses.size > 0;
          if (queuedResponse && !responses.size) requestResponse();
        }
        if (live && event.type === 'session.closed') {
          const seconds = event.usage?.seconds;
          finalUsage = Number.isFinite(seconds) && seconds >= 0;
          if (usage.length < 100) {
            usage.push(event.usage ?? null);
            usageTimes.push(new Date().toISOString());
          }
          void finish(
            finalUsage ? 'closed' : 'unknown',
            finalUsage ? stopReason || 'SESSION_CLOSED' : 'FINAL_USAGE_UNCONFIRMED',
          );
        }
        if (live && event.type === 'session.usage.updated') {
          const last = usage.findIndex((item: any) => item?.kind === 'live-duration');
          if (last >= 0) usage[last] = { kind: 'live-duration', value: event.usage };
          else if (usage.length < 100) {
            usage.push({ kind: 'live-duration', value: event.usage });
            usageTimes.push(new Date().toISOString());
          }
        }
        if (
          live &&
          event.type === 'session.delegation.created' &&
          event.delegation?.target === 'client' &&
          typeof event.delegation.id === 'string'
        ) {
          const id = event.delegation.id;
          const throughMs =
            Number.isFinite(event.offset_ms) && event.offset_ms >= 0
              ? (event.offset_ms as number)
              : undefined;
          const epoch = contextEpoch;
          if (!id || id.length > 128 || waitingLiveCalls.has(id) || knownCalls.has(id)) return;
          const begin = () => {
            waitingLiveCalls.delete(id);
            if (ended || closing) return;
            if (epoch !== contextEpoch) {
              sendEvents(
                voiceResultEvents(row.model_id, id, '当前画面已变化，请根据新的共享状态继续。'),
              );
              return;
            }
            const heard = transcript.latestUser(throughMs);
            const text =
              throughMs !== undefined &&
              heard?.endMs !== undefined &&
              throughMs - heard.endMs > 20_000
                ? undefined
                : heard?.text.trim();
            if (text) delegate(id, text, undefined, throughMs);
            else if (knownCalls.size < row.config.voiceModel.maxDelegations + 8) {
              knownCalls.add(id);
              sendEvents(
                voiceResultEvents(row.model_id, id, '没听清本次需要做什么，请向用户简短确认。'),
              );
            }
          };
          if (
            throughMs !== undefined &&
            (transcript.latestUser(throughMs)?.endMs ?? -Infinity) < throughMs
          ) {
            if (waitingLiveCalls.size < row.config.voiceModel.maxDelegations)
              waitingLiveCalls.set(id, setTimeout(begin, 170));
          } else begin();
        }
        if (
          !live &&
          event.type === 'response.output_item.done' &&
          event.item?.type === 'function_call'
        ) {
          const call = event.item;
          if (
            call.name !== 'consult_editor' ||
            typeof call.call_id !== 'string' ||
            typeof call.arguments !== 'string' ||
            call.arguments.length > 8000
          )
            throw new Error('tool');
          const args = JSON.parse(call.arguments);
          if (
            typeof args.request !== 'string' ||
            args.request.length > 4000 ||
            Object.keys(args).some((key) => key !== 'request')
          )
            throw new Error('tool args');
          delegate(call.call_id, args.request);
        }
      } catch {
        stop('VOICE_INVALID_EVENT');
      }
    });
    upstream.on('error', () => {
      void finish('unknown', 'VOICE_NETWORK_UNCONFIRMED');
    });
    upstream.on('close', (code) => {
      if (ended) return;
      transportClosedConfirmed = code === 1000;
      const confirmed =
        !live &&
        active &&
        closing &&
        transportClosedConfirmed &&
        !responsePending &&
        !responses.size &&
        !unconfirmedAudio &&
        !receiptMissing &&
        (!sentInputAudio || responseReceipts > 0);
      // Realtime has per-response receipts, not GPT-Live's final session usage.
      // A normal WebSocket close must never be labelled a vendor usage receipt.
      void finish(confirmed ? 'closed' : 'unknown', stopReason || 'VOICE_TRANSPORT_CLOSED');
    });
    client.on('close', () => {
      stop('CLIENT_DISCONNECTED');
    });
    client.on('error', () => {
      stop('CLIENT_NETWORK_FAILED');
    });
    client.on('message', (bytes) => {
      if (ended || closing) return;
      let event;
      try {
        event = voiceClientEventSchema.parse(JSON.parse(bytes.toString()));
      } catch {
        stop('CLIENT_EVENT_INVALID');
        return;
      }
      if (event.type === 'ping') {
        lastPing = Date.now();
        send(client, { type: 'pong' });
        return;
      }
      if (event.type === 'end') {
        stop('USER_ENDED');
        return;
      }
      if (!active) return;
      try {
        if (event.type === 'context.invalidate') {
          invalidateContext();
          return;
        }
        if (event.type === 'audio') {
          if (muted) return;
          if (Date.now() - windowStart >= 2000) {
            windowStart = Date.now();
            windowBytes = 0;
          }
          windowBytes += event.pcm.length * 0.75;
          if (windowBytes > 144_000) {
            stop('AUDIO_RATE_LIMIT');
            return;
          }
          upstreamSend(voiceAudioEvent(row.model_id, event.pcm));
          sentInputAudio = true;
          return;
        }
        if (event.type === 'mute') {
          muted = event.muted;
          if (live)
            upstreamSend({
              type: muted ? 'session.input_audio.mute' : 'session.input_audio.unmute',
            });
          else if (muted) upstreamSend({ type: 'input_audio_buffer.clear' });
          return;
        }
        if (event.type === 'playback-cut') {
          if (!live && event.itemId && Date.now() <= speechCutUntil) {
            speechCutUntil = 0;
            const duration = itemAudioMs.get(event.itemId);
            if (duration !== undefined) {
              transcript.discardAssistant(event.itemId);
              upstreamSend({
                type: 'conversation.item.truncate',
                item_id: event.itemId,
                content_index: 0,
                audio_end_ms: Math.min(event.playedMs, Math.floor(duration)),
              });
            }
          }
          return;
        }
        if (event.type === 'interrupt') {
          queuedResponse = false;
          speechCutUntil = 0;
          if (!live) {
            if (responsePending || responses.size) upstreamSend({ type: 'response.cancel' });
            if (event.itemId && event.playedMs !== undefined && itemAudioMs.has(event.itemId)) {
              transcript.discardAssistant(event.itemId);
              upstreamSend({
                type: 'conversation.item.truncate',
                item_id: event.itemId,
                content_index: 0,
                audio_end_ms: Math.min(event.playedMs, Math.floor(itemAudioMs.get(event.itemId)!)),
              });
            }
          } else
            upstreamSend(
              liveContextAppend(
                'instructions',
                '用户点击了停止播报。停止当前发言，继续聆听，等用户下一次提问再回应。',
              ),
            );
          send(client, { type: 'interrupted' });
          return;
        }
        if (controlBusy) {
          send(client, {
            type: 'error',
            code: 'CONTROL_BUSY',
            message: '正在处理上一条上下文，请稍候。',
          });
          return;
        }
        if (
          event.type === 'text' &&
          ((!live && (responsePending || responses.size)) || Date.now() - lastTextAt < 700)
        ) {
          send(client, {
            type: 'error',
            code: 'RESPONSE_BUSY',
            message: '正在回应，请稍候；也可以先停止播报。',
          });
          return;
        }
        controlBusy = true;
        void (async () => {
          await assertAccess();
          if (ended || closing) return;
          if (event.type === 'context') {
            if (Date.now() - lastContextAt < 2500) throw new Error('CONTEXT_RATE');
            lastContextAt = Date.now();
            const { epoch, persisted } = invalidateContext(false);
            const checked = await service.currentContext(
              row.actor_id,
              row.project_id,
              event.context,
            );
            await persisted;
            if (ended || closing || epoch !== contextEpoch) return;
            context = checked;
            publishContext();
            send(client, {
              type: 'context',
              accepted: true,
              imageShared: Boolean(context?.imageDataUrl),
              contextTag: event.contextTag,
            });
          } else if (event.type === 'search') {
            delegate(
              `typed_${randomUUID()}`,
              '用户明确要求查找公开来源。用检索证据回答，保留可核查的来源，不生成编辑候选。',
              event.search,
            );
          } else if (event.type === 'text') {
            lastTextAt = Date.now();
            await service.moderate(event.text);
            await assertAccess();
            if (ended || closing) return;
            transcript.push({ type: 'transcript', role: 'user', text: event.text, delta: false });
            sendEvents(voiceTextEvents(row.model_id, event.text));
            if (live) delegate(`typed_${randomUUID()}`, event.text);
          }
        })()
          .catch(() =>
            send(client, {
              type: 'error',
              code: 'CONTEXT_OR_ACCESS_REJECTED',
              message: '审核、上下文或权限检查未通过，请检查后再试。',
            }),
          )
          .finally(() => {
            controlBusy = false;
          });
      } catch {
        stop('VOICE_SEND_FAILED');
      }
    });
  }
  function retain(id: string, context?: AssistantContext) {
    if (snapshots.size >= 128) {
      const oldest = snapshots.keys().next().value;
      if (oldest) snapshots.delete(oldest);
    }
    snapshots.set(id, { context, expiresAt: Date.now() + 65_000 });
  }

  async function claimConnection(sessionId: string, actorId: string, ticket: string) {
    const ticketHash = hash(ticket);
    const hint = (
      await db.query(
        "SELECT project_id,scope FROM voice_sessions WHERE id=$1 AND actor_id=$2 AND connection_hash=$3 AND state='prepared' AND connect_expires_at>clock_timestamp()",
        [sessionId, actorId, ticketHash],
      )
    ).rows[0];
    if (!hint) throw new Error('session');
    await service.assertJournal();
    return transaction(db, async (tx) => {
      await lockedAssistantAccess(tx, actorId, hint.project_id, hint.scope);
      const found = (
        await tx.query(
          "SELECT * FROM voice_sessions WHERE id=$1 AND actor_id=$2 AND connection_hash=$3 AND state='prepared' AND connect_expires_at>clock_timestamp() FOR UPDATE",
          [sessionId, actorId, ticketHash],
        )
      ).rows[0] as VoiceRow | undefined;
      if (!found) throw new Error('session');
      if (found.context?.imageShared && !snapshots.has(found.id))
        throw new Error('snapshot lost; recreate session');
      for (const modelId of [...new Set([found.model_id, found.backend_model_id])].sort())
        await tx.query('SELECT id FROM assistant_model_configs WHERE id=$1 FOR SHARE', [modelId]);
      await service.model(tx, found.model_id, 'realtime-voice');
      await service.model(tx, found.backend_model_id, 'assistant-turn');
      await tx.query(
        "UPDATE voice_sessions SET state='connecting',updated_at=clock_timestamp() WHERE id=$1",
        [found.id],
      );
      return found;
    });
  }

  const teamVoice = registerTeamVoice(app, db, config, {
    ready: () => accepting && service.voiceReady,
    async start(input) {
      if (!accepting || !input.stillWanted() || connections.size + upgrading.size >= 32)
        throw new Error('team voice capacity');
      const work = (async () => {
        const prepared = await service.prepareVoice(
          input.actorId,
          input.projectId,
          input.request,
          input.artworkId,
        );
        let claimed = false;
        try {
          if (!accepting || !input.stillWanted()) throw new Error('team voice ended');
          retain(prepared.row.id, prepared.context);
          const row = await claimConnection(prepared.row.id, input.actorId, prepared.ticket);
          claimed = true;
          await service.beforeVoiceConnection(row);
          if (!accepting || !input.stillWanted()) throw new Error('team voice ended');
          const port = new RoomVoicePort(input.event);
          connect(row, port, input.authHash);
          return {
            audio: (pcm: string) => port.input({ type: 'audio', pcm }),
            ping: () => port.input({ type: 'ping' }),
            invalidate: () => port.input({ type: 'context.invalidate' }),
            update: (context: AssistantContext, contextTag: string) => {
              port.input({ type: 'context.invalidate' });
              port.input({ type: 'context', context, contextTag });
            },
            end: () => port.input({ type: 'end' }),
          };
        } catch (error) {
          snapshots.delete(prepared.row.id);
          if (claimed) {
            await service.failVoiceConnection(prepared.row.id);
            input.event({ type: 'closed', state: 'unknown', reason: 'CONNECTION_UNCONFIRMED' });
          } else await service.cancelPreparedVoice(prepared.row.id);
          throw error;
        }
      })();
      const tracked = work.then(
        () => undefined,
        () => undefined,
      );
      upgrading.add(tracked);
      try {
        return await work;
      } finally {
        upgrading.delete(tracked);
      }
    },
  });

  app.server.on('upgrade', (request, socket, head) => {
    let path: string;
    try {
      path = new URL(request.url ?? '/', 'http://local').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (teamVoice.upgrade(path, request, socket, head)) return;
    const match = /^\/v1\/voice-sessions\/([0-9a-f-]{36})\/stream$/.exec(path);
    if (!match) {
      socket.destroy();
      return;
    }
    let upgraded = false;
    const work = (async () => {
      if (
        !accepting ||
        !service.voiceReady ||
        !config.origins.includes(request.headers.origin ?? '') ||
        connections.size + upgrading.size >= 32
      )
        throw new Error('voice unavailable');
      // Reject malformed HTTP upgrades before consuming a ticket or recording a
      // paid connection attempt. ws can abort without invoking its callback.
      const key = request.headers['sec-websocket-key'];
      if (
        request.method !== 'GET' ||
        request.headers.upgrade?.toLowerCase() !== 'websocket' ||
        !String(request.headers.connection ?? '')
          .toLowerCase()
          .split(',')
          .some((value) => value.trim() === 'upgrade') ||
        request.headers['sec-websocket-version'] !== '13' ||
        typeof key !== 'string' ||
        !/^[+/0-9A-Za-z]{22}==$/.test(key) ||
        Buffer.from(key, 'base64').length !== 16
      )
        throw new Error('invalid handshake');
      const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((value) => value.trim());
      if (
        protocols.length !== 2 ||
        protocols[0] !== 'xiutu-voice' ||
        !/^[A-Za-z0-9_-]{43}$/.test(protocols[1]!)
      )
        throw new Error('protocol');
      const auth = /(?:^|;\s*)xiutu_session=([A-Za-z0-9_-]{40,64})(?:;|$)/.exec(
        request.headers.cookie ?? '',
      )?.[1];
      if (!auth) throw new Error('auth');
      const authHash = hash(auth);
      const user = (
        await db.query(
          "SELECT u.id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp() AND u.status='active'",
          [authHash],
        )
      ).rows[0];
      if (!user) throw new Error('auth');
      const row = await claimConnection(match[1]!, user.id, protocols[1]!);
      try {
        if (!accepting || socket.destroyed) throw new Error('socket closed');
        await service.beforeVoiceConnection(row);
        if (!accepting || socket.destroyed) throw new Error('socket closed');
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const settle = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            socket.off('close', onClose);
            socket.off('error', onError);
            if (error) reject(error);
            else resolve();
          };
          const onClose = () => settle(new Error('handshake socket closed'));
          const onError = () => settle(new Error('handshake socket error'));
          const timeout = setTimeout(() => settle(new Error('handshake timeout')), 5000);
          socket.once('close', onClose);
          socket.once('error', onError);
          if (socket.destroyed) {
            onClose();
            return;
          }
          try {
            server.handleUpgrade(request, socket, head, (ws) => {
              upgraded = true;
              if (settled || !accepting || socket.destroyed) {
                ws.terminate();
                settle(new Error('handshake ended'));
                return;
              }
              try {
                connect(row, ws, authHash);
                settle();
              } catch {
                ws.close(1011, 'initialization failed');
                settle(new Error('initialization failed'));
              }
            });
          } catch {
            settle(new Error('invalid handshake'));
          }
        });
      } catch {
        await service.failVoiceConnection(row.id);
        throw new Error('connection could not start');
      }
    })().catch(() => {
      if (!socket.destroyed) {
        if (!upgraded && !socket.writableEnded)
          socket.end(
            'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
            () => socket.destroy(),
          );
        else socket.destroy();
      }
    });
    upgrading.add(work);
    void work.finally(() => upgrading.delete(work));
  });
  return { retain };
}
