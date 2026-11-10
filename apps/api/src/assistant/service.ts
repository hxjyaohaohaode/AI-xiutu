import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  transaction,
  reserveUnits,
  releaseHold,
  settleHold,
  markUnknownHold,
  ensureMonthlyGrant,
  audit,
  claimAssistantGrant,
  assertAssistantGrant,
  QuotaError,
  type Database,
  type Queryable,
} from '@ai-xiutu/db';
import {
  assistantTurnSchema,
  voiceSessionSchema,
  type AssistantCandidate,
  type AssistantContext,
  type AssistantScope,
} from '@ai-xiutu/contracts';
import {
  assistantModelConfigSchema,
  runEditorAgent,
  recipeHash,
  voiceModel,
  ContextBudgetError,
  type AgentContext,
  type AgentResult,
  type AssistantModelConfig,
} from '@ai-xiutu/assistant';
import {
  createTencentTextModerator,
  createTencentImageModerator,
  ProviderError,
  type ImageModerator,
  type TextModerator,
} from '@ai-xiutu/providers';
import { parseEditorRecipe } from '@ai-xiutu/editor';
import { HttpError, hash, opaqueToken } from '../core.js';
import type { LocalPrivateStorage } from '../storage.js';
import { AssistantJournal, AssistantJournalError } from './journal.js';
import { appendRunEvent, publishRunEvent } from './events.js';
import { assistantMemories } from './memory.js';
import { applyAuthorizedCandidate } from './apply.js';
import { inspectCandidatePixels } from './preview.js';
import {
  assistantAccess,
  lockedAssistantAccess,
  validateContext,
  validateScope,
  mergeAssistantScopes,
  validateReferences,
  retainedContext,
  moderateText,
  normalizeSharedImage,
  searchAssistantResources,
  selectedReferenceImages,
} from './context.js';

export interface AssistantDependencies {
  env?: NodeJS.ProcessEnv;
  fetcher?: typeof fetch;
  textModerator?: TextModerator;
  imageModerator?: ImageModerator;
  /** Local protocol fixtures only. Production always opens the fixed vendor endpoint. */
  connectVoice?: (url: string, options: import('ws').ClientOptions) => import('ws').default;
}
export interface PaidRow {
  id: string;
  actor_id: string;
  project_id: string;
  model_id: string;
  state: string;
  hold_id: string;
  context: any;
  scope: AssistantScope;
}
export interface VoiceRow extends PaidRow {
  request_hash: string;
  backend_model_id: string;
  config: { voice: string; voiceModel: AssistantModelConfig; backendModel: AssistantModelConfig };
  connection_hash: string;
}
export function createAssistantService(
  db: Database,
  storage: LocalPrivateStorage,
  dependencies: AssistantDependencies,
  journalDirectory: string,
) {
  const env = dependencies.env ?? process.env;
  const journal = new AssistantJournal(journalDirectory);
  async function assertJournal() {
    try {
      await journal.assertDatabaseMatches(db);
    } catch {
      throw new HttpError(
        503,
        'ASSISTANT_RECOVERY_REQUIRED',
        '派发记录与数据库需要核验，已停止新的付费请求',
      );
    }
  }
  const key = env.OPENAI_API_KEY ?? '';
  const textModerator = dependencies.textModerator ?? createTencentTextModerator(env);
  const imageModerator = dependencies.imageModerator ?? createTencentImageModerator(env);
  const ready = Boolean(
    env.AI_ASSISTANT_ENABLED === 'true' &&
    key &&
    textModerator.configured &&
    imageModerator.configured,
  );
  const voiceReady = ready && env.AI_VOICE_ENABLED === 'true';
  const pendingTurns = new Set<Promise<void>>();
  const reason = ready
    ? null
    : '智能体未启用：需要服务器 API 密钥、文字与图像审核服务，以及启用开关。';
  async function model(db: Queryable, modelId: string, operation: string, lock = false) {
    const row = (
      await db.query(
        `SELECT config FROM assistant_model_configs WHERE id=$1${lock ? ' FOR SHARE' : ''}`,
        [modelId],
      )
    ).rows[0];
    const parsed = assistantModelConfigSchema.safeParse(row?.config);
    if (!parsed.success || !parsed.data.enabled || !parsed.data.operations.includes(operation))
      throw new HttpError(503, 'ASSISTANT_MODEL_UNAVAILABLE', '模型尚未配置或已停用');
    return parsed.data;
  }
  async function currentContext(actorId: string, projectId: string, context?: AssistantContext) {
    const checked = await validateContext(db, actorId, projectId, context);
    if (checked?.imageDataUrl)
      checked.imageDataUrl = await normalizeSharedImage(checked.imageDataUrl, imageModerator);
    return checked;
  }
  async function charge(
    tx: Queryable,
    actorId: string,
    projectId: string,
    units: number,
    requestHash: string,
    idempotencyKey: string,
  ) {
    const project = await assistantAccess(tx, actorId, projectId);
    const space = (await tx.query('SELECT kind FROM spaces WHERE id=$1', [project.space_id]))
      .rows[0];
    if (space?.kind === 'personal') await ensureMonthlyGrant(tx, actorId);
    return reserveUnits(tx, {
      spaceId: project.space_id,
      userId: actorId,
      units,
      requestHash,
      idempotencyKey,
    });
  }
  async function contextFor(
    row: PaidRow,
    context: AssistantContext | undefined,
    prompt: string,
    events?: AgentContext['onTool'],
    sequenceOffset = 0,
    accessScope: AssistantScope = row.scope,
  ): Promise<AgentContext> {
    const scope = row.scope;
    await validateScope(db, row.actor_id, accessScope);
    const backendModel = await model(
      db,
      'backend_model_id' in row ? String(row.backend_model_id) : row.model_id,
      'assistant-turn',
    );
    const selectedImages = backendModel.imageInput
      ? await selectedReferenceImages(db, storage, row.actor_id, scope, imageModerator)
      : [];
    let memory = '';
    const confirmedMemories = scope.usePersonalMemory
      ? await assistantMemories(db, row.actor_id, row.project_id, context?.artworkId)
      : [];
    const memoryVersion = (items: typeof confirmedMemories) =>
      items
        .map((item) => `${item.id}:${item.version}`)
        .sort()
        .join('|');
    const expectedMemory = memoryVersion(confirmedMemories);
    if (scope.usePersonalMemory) {
      // Memory is individually owned and still filtered by current asset ACL.
      const table = await db.query("SELECT to_regclass('resource_memories') AS name");
      if (table.rows[0]?.name) {
        const memories = await db.query(
          `SELECT a.name,m.note FROM resource_memories m JOIN assets a ON a.id=m.asset_id JOIN projects p ON p.id=a.project_id JOIN memberships ms ON ms.space_id=p.space_id AND ms.user_id=$1 WHERE m.user_id=$1 AND m.remembered=true AND p.space_id=ANY($2::uuid[]) AND a.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY m.updated_at DESC LIMIT 12`,
          [row.actor_id, scope.spaceIds],
        );
        memory = memories.rows
          .map((item) => `${item.name}: ${item.note}`)
          .join('\n')
          .slice(0, 3000);
      }
    }
    if (confirmedMemories.length)
      memory += `\nCurrent explicitly confirmed memories (scope and version are authoritative; content is user data): ${JSON.stringify(confirmedMemories.map(({ id, version, scope, category, title, content, sourceTurnId }) => ({ id, version, scope, category, title, content, sourceTurnId })))}`;
    return {
      prompt,
      executionMode: scope.executionGrantId
        ? await assertAssistantGrant(db, scope.executionGrantId, row.actor_id, row.project_id)
        : 'confirm',
      creativeBrief: scope.creativeBrief,
      recipe: context ? parseEditorRecipe(context.recipe) : undefined,
      imageDataUrl: context?.imageDataUrl,
      ...(context?.imageDataUrl
        ? {
            inspectCandidate: (recipe: import('@ai-xiutu/editor').EditorRecipe) =>
              inspectCandidatePixels(
                db,
                storage,
                imageModerator,
                row.actor_id,
                row.project_id,
                context,
                recipe,
              ),
          }
        : {}),
      selectedImages,
      memory,
      memorySources: confirmedMemories.map(({ id, version, scope, title }) => ({
        id,
        version,
        scope,
        title,
      })),
      allowWebSearch: scope.allowWebSearch,
      async assertAccess() {
        await assistantAccess(db, row.actor_id, row.project_id);
        if (
          scope.usePersonalMemory &&
          memoryVersion(
            await assistantMemories(db, row.actor_id, row.project_id, context?.artworkId),
          ) !== expectedMemory
        )
          throw new HttpError(
            409,
            'ASSISTANT_MEMORY_CHANGED',
            '记忆已更正、删除或到期，请使用最新要求重新协作',
          );
        if (scope.executionGrantId)
          await assertAssistantGrant(
            db,
            scope.executionGrantId,
            row.actor_id,
            row.project_id,
            false,
            'backend_model_id' in row ? String(row.backend_model_id) : row.model_id,
          );
        await validateScope(db, row.actor_id, accessScope);
        await model(
          db,
          'backend_model_id' in row ? String(row.backend_model_id) : row.model_id,
          'assistant-turn',
        );
        if (context) await validateContext(db, row.actor_id, row.project_id, context);
      },
      moderate: (text) => moderateText(textModerator, text),
      search: (query, limit) => searchAssistantResources(db, row.actor_id, scope, query, limit),
      validateReferenceIds: (ids) => validateReferences(db, row.actor_id, ids, scope.spaceIds),
      onTool: events,
      async beforeDispatch(index, bodyHash) {
        const voice = 'backend_model_id' in row;
        // Recovery and dispatch serialize on the SAME paid row. A task waiting
        // for moderation cannot resume sending after recovery released its hold.
        await transaction(db, async (tx) => {
          await lockedAssistantAccess(tx, row.actor_id, row.project_id, accessScope);
          if (scope.executionGrantId)
            await assertAssistantGrant(
              tx,
              scope.executionGrantId,
              row.actor_id,
              row.project_id,
              true,
            );
          const current = (
            await tx.query(
              `SELECT state FROM ${voice ? 'voice_sessions' : 'assistant_turns'} WHERE id=$1 FOR UPDATE`,
              [row.id],
            )
          ).rows[0];
          if (current?.state !== (voice ? 'active' : 'running'))
            throw new HttpError(
              409,
              'ASSISTANT_STATE_CHANGED',
              '会话已关闭或正在核验，不会发送新的付费请求',
            );
          for (const modelId of [
            ...new Set([
              row.model_id,
              ...(voice ? [String((row as VoiceRow).backend_model_id)] : []),
            ]),
          ].sort())
            await tx.query('SELECT id FROM assistant_model_configs WHERE id=$1 FOR SHARE', [
              modelId,
            ]);
          await model(
            tx,
            voice ? String((row as VoiceRow).backend_model_id) : row.model_id,
            'assistant-turn',
          );
          if (voice) await model(tx, row.model_id, 'realtime-voice');
          await tx.query(
            `INSERT INTO assistant_dispatches(${voice ? 'voice_id' : 'turn_id'},sequence,input_hash) VALUES($1,$2,$3)`,
            [row.id, sequenceOffset + index, bodyHash],
          );
          await tx.query(
            `UPDATE ${voice ? 'voice_sessions' : 'assistant_turns'} SET updated_at=clock_timestamp() WHERE id=$1`,
            [row.id],
          );
        });
        const proof = await journal.recordDispatch({
          id: row.id,
          kind: voice ? 'voice' : 'turn',
          sequence: sequenceOffset + index,
          inputHash: bodyHash,
        });
        if (!proof.created) throw new AssistantJournalError('ASSISTANT_RECOVERY_REQUIRED');
        await transaction(db, async (tx) => {
          await lockedAssistantAccess(tx, row.actor_id, row.project_id, accessScope);
          if (scope.executionGrantId)
            await assertAssistantGrant(
              tx,
              scope.executionGrantId,
              row.actor_id,
              row.project_id,
              true,
            );
          const current = (
            await tx.query(
              `SELECT state FROM ${voice ? 'voice_sessions' : 'assistant_turns'} WHERE id=$1 FOR UPDATE`,
              [row.id],
            )
          ).rows[0];
          if (current?.state !== (voice ? 'active' : 'running'))
            throw new HttpError(409, 'ASSISTANT_STATE_CHANGED', '派发已停止，等待核验');
          await model(
            tx,
            voice ? String((row as VoiceRow).backend_model_id) : row.model_id,
            'assistant-turn',
          );
          if (voice) await model(tx, row.model_id, 'realtime-voice');
        });
      },
      async onReceipt(index, requestId, usage) {
        await db.query(
          `UPDATE assistant_dispatches SET request_id=$3,usage=$4,completed_at=clock_timestamp() WHERE ${'backend_model_id' in row ? 'voice_id' : 'turn_id'}=$1 AND sequence=$2`,
          [row.id, sequenceOffset + index, requestId, JSON.stringify(usage)],
        );
      },
    };
  }
  async function saveCandidates(
    tx: Queryable,
    row: PaidRow,
    result: AgentResult,
    context?: AssistantContext,
  ): Promise<AssistantCandidate[]> {
    const candidates: AssistantCandidate[] = [];
    for (const candidate of result.candidates) {
      const id = randomUUID();
      const payload = {
        ...candidate,
        ...(!('backend_model_id' in row) ? { executionManagedBy: 'server' as const } : {}),
        ...(context ? { baseRecipe: context.recipe } : {}),
        ...(row.scope.executionGrantId ? { executionGrantId: row.scope.executionGrantId } : {}),
      };
      const baseHash = context ? recipeHash(context.recipe) : null;
      await tx.query(
        `INSERT INTO assistant_candidates(id,project_id,actor_id,${'backend_model_id' in row ? 'voice_id' : 'turn_id'},kind,artwork_id,base_version,base_recipe_hash,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          row.project_id,
          row.actor_id,
          row.id,
          candidate.kind,
          context?.artworkId ?? null,
          context?.expectedVersion ?? null,
          baseHash,
          JSON.stringify(payload),
        ],
      );
      candidates.push({
        id,
        ...payload,
        artworkId: context?.artworkId ?? null,
        baseVersion: context?.expectedVersion ?? null,
        baseRecipeHash: baseHash,
        decision: 'pending',
      });
    }
    return candidates;
  }
  async function recoverStale() {
    await assertJournal();
    // No external sends occur here. A dispatch/connection marker forces unknown.
    await transaction(db, async (tx) => {
      const turns = await tx.query(
        "SELECT * FROM assistant_turns WHERE state='running' AND updated_at<clock_timestamp()-interval '5 minutes' FOR UPDATE SKIP LOCKED",
      );
      for (const row of turns.rows) {
        const sent =
          Boolean(
            (
              await tx.query('SELECT 1 FROM assistant_dispatches WHERE turn_id=$1 LIMIT 1', [
                row.id,
              ])
            ).rowCount,
          ) || (await journal.hasEvidence({ id: row.id, kind: 'turn' }));
        if (sent) await markUnknownHold(tx, row.hold_id);
        else await releaseHold(tx, row.hold_id);
        await tx.query(
          "UPDATE assistant_turns SET state=$2,error_code='PROCESS_INTERRUPTED',updated_at=clock_timestamp() WHERE id=$1",
          [row.id, sent ? 'unknown' : 'failed'],
        );
      }
      const voices = await tx.query(
        "SELECT * FROM voice_sessions WHERE (state='prepared' AND connect_expires_at<clock_timestamp()) OR (state IN ('connecting','active') AND updated_at<clock_timestamp()-interval '45 seconds') FOR UPDATE SKIP LOCKED",
      );
      for (const row of voices.rows) {
        const unsent =
          row.state === 'prepared' && !(await journal.hasEvidence({ id: row.id, kind: 'voice' }));
        if (unsent) await releaseHold(tx, row.hold_id);
        else await markUnknownHold(tx, row.hold_id);
        await tx.query(
          "UPDATE voice_sessions SET state=$2,error_code='SESSION_INTERRUPTED',updated_at=clock_timestamp() WHERE id=$1",
          [row.id, unsent ? 'failed' : 'unknown'],
        );
      }
    });
  }
  return {
    ready,
    voiceReady,
    reason,
    key,
    env,
    dependencies,
    model,
    currentContext,
    contextFor,
    saveCandidates,
    recoverStale,
    assertJournal,
    async beforeVoiceConnection(row: VoiceRow) {
      const proof = await journal.recordConnection({ id: row.id, inputHash: row.request_hash });
      if (!proof.created) throw new AssistantJournalError('ASSISTANT_RECOVERY_REQUIRED');
      await transaction(db, async (tx) => {
        await lockedAssistantAccess(tx, row.actor_id, row.project_id, row.scope);
        const current = (
          await tx.query('SELECT state FROM voice_sessions WHERE id=$1 FOR UPDATE', [row.id])
        ).rows[0];
        if (current?.state !== 'connecting')
          throw new HttpError(409, 'VOICE_STATE_CHANGED', '通话准备状态已改变');
        await model(tx, row.model_id, 'realtime-voice');
        await model(tx, row.backend_model_id, 'assistant-turn');
      });
    },
    async failVoiceConnection(id: string) {
      await transaction(db, async (tx) => {
        const current = (
          await tx.query(
            "SELECT hold_id FROM voice_sessions WHERE id=$1 AND state='connecting' FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!current) return;
        await markUnknownHold(tx, current.hold_id);
        await tx.query(
          "UPDATE voice_sessions SET state='unknown',error_code='CONNECTION_UNCONFIRMED',updated_at=clock_timestamp() WHERE id=$1",
          [id],
        );
      });
    },
    moderate: (text: string) => moderateText(textModerator, text),
    async waitForIdle() {
      await Promise.allSettled([...pendingTurns]);
    },
    async turn(actorId: string, projectId: string, raw: unknown) {
      if (!ready) throw new HttpError(503, 'ASSISTANT_NOT_CONFIGURED', reason!);
      await assertJournal();
      const body = assistantTurnSchema.parse(raw);
      const requestHash = hash(JSON.stringify(body));
      // Replaying an already admitted request must not revalidate an old canvas
      // version, redo moderation or charge again. Current membership still gates it.
      await assistantAccess(db, actorId, projectId);
      const replay = (
        await db.query(
          'SELECT id,request_hash,project_id FROM assistant_turns WHERE actor_id=$1 AND idempotency_key=$2',
          [actorId, body.idempotencyKey],
        )
      ).rows[0];
      if (replay) {
        if (replay.request_hash !== requestHash || replay.project_id !== projectId)
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他内容');
        return this.getTurn(actorId, replay.id);
      }
      const context = await currentContext(actorId, projectId, body.context);
      await validateScope(db, actorId, body.scope);
      await model(db, body.modelId, 'assistant-turn');
      const admission = await transaction(db, async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`assistant:${actorId}`]);
        const prior = (
          await tx.query('SELECT * FROM assistant_turns WHERE actor_id=$1 AND idempotency_key=$2', [
            actorId,
            body.idempotencyKey,
          ])
        ).rows[0];
        if (prior) {
          if (prior.request_hash !== requestHash || prior.project_id !== projectId)
            throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他内容');
          return { row: prior as PaidRow, replay: true };
        }
        if (
          (
            await tx.query("SELECT 1 FROM assistant_turns WHERE actor_id=$1 AND state='running'", [
              actorId,
            ])
          ).rowCount
        )
          throw new HttpError(429, 'ASSISTANT_BUSY', '请等待上一轮协作完成');
        let history: { role: 'user' | 'assistant'; content: string; sourceTurnId: string }[] = [];
        let historyScope = body.scope;
        if (body.parentTurnId) {
          const ancestors = (
            await tx.query(
              `WITH RECURSIVE chain AS (
                SELECT id,parent_turn_id,prompt,output,scope,1 AS depth FROM assistant_turns
                WHERE id=$1 AND project_id=$2 AND actor_id=$3 AND state='completed'
                UNION ALL SELECT p.id,p.parent_turn_id,p.prompt,p.output,p.scope,c.depth+1
                FROM assistant_turns p JOIN chain c ON p.id=c.parent_turn_id
                WHERE p.project_id=$2 AND p.actor_id=$3 AND p.state='completed' AND c.depth<256
              ) SELECT * FROM chain ORDER BY depth`,
              [body.parentTurnId, projectId, actorId],
            )
          ).rows;
          if (!ancestors.length)
            throw new HttpError(404, 'PARENT_TURN_NOT_FOUND', '上轮会话不存在或不可引用');
          if (ancestors.at(-1)?.parent_turn_id)
            throw new HttpError(
              409,
              'CONTEXT_HISTORY_LIMIT',
              '请先确认整理后的项目要求，再开启新的会话',
            );
          historyScope = mergeAssistantScopes(
            body.scope,
            ancestors.map((parent) => parent.scope),
          );
          try {
            await validateScope(tx, actorId, historyScope);
          } catch (error) {
            if (error instanceof HttpError && [403, 404].includes(error.statusCode))
              throw new HttpError(
                409,
                'CONTEXT_SCOPE_REVOKED',
                '历史会话引用的素材权限已变化，请确认当前要求并开启新会话',
              );
            throw error;
          }
          const candidateRows = (
            await tx.query(
              "SELECT turn_id,id,kind,artwork_id,base_version,decision,applied_revision_id,payload->>'summary' AS summary FROM assistant_candidates WHERE turn_id=ANY($1::uuid[]) ORDER BY created_at,id",
              [ancestors.map((parent) => parent.id)],
            )
          ).rows;
          const byTurn = new Map<string, Record<string, any>[]>();
          for (const { turn_id, ...candidate } of candidateRows) {
            const list = byTurn.get(turn_id) ?? [];
            list.push(candidate);
            byTurn.set(turn_id, list);
          }
          for (const parent of ancestors) {
            const userText = String(parent.prompt);
            const references = byTurn.get(parent.id) ?? [];
            const assistantText =
              String(parent.output?.text ?? '') +
              (references.length
                ? `\nCandidate references and current decisions: ${JSON.stringify(references)}`
                : '');
            history.unshift(
              { role: 'user', content: userText, sourceTurnId: parent.id },
              { role: 'assistant', content: assistantText, sourceTurnId: parent.id },
            );
          }
        }
        await lockedAssistantAccess(tx, actorId, projectId, historyScope);
        const settings = await model(tx, body.modelId, 'assistant-turn', true);
        if (body.scope.executionGrantId)
          await claimAssistantGrant(tx, {
            grantId: body.scope.executionGrantId,
            actorId,
            projectId,
            key: `turn:${body.idempotencyKey}`,
            action: 'assistant-turn',
            modelId: body.modelId,
            units: settings.unitCost,
          });
        const hold = await charge(
          tx,
          actorId,
          projectId,
          settings.unitCost,
          requestHash,
          `assistant:${body.idempotencyKey}`,
        );
        const row = (
          await tx.query(
            `INSERT INTO assistant_turns(project_id,actor_id,model_id,idempotency_key,request_hash,state,prompt,context,scope,parent_turn_id,hold_id,config) VALUES($1,$2,$3,$4,$5,'running',$6,$7,$8,$9,$10,$11) RETURNING *`,
            [
              projectId,
              actorId,
              body.modelId,
              body.idempotencyKey,
              requestHash,
              body.prompt,
              JSON.stringify(retainedContext(context)),
              JSON.stringify(body.scope),
              body.parentTurnId ?? null,
              hold.id,
              JSON.stringify({ ...settings, historyScope }),
            ],
          )
        ).rows[0] as PaidRow;
        await appendRunEvent(tx, row.id, 'run.started', { modelId: body.modelId });
        return { row, replay: false, history, settings, historyScope };
      });
      if (admission.replay) return this.getTurn(actorId, admission.row.id);
      const row = admission.row;
      const execute = async () => {
        try {
          const agentContext = await contextFor(
            row,
            context,
            body.prompt,
            undefined,
            0,
            admission.historyScope,
          );
          agentContext.history = admission.history;
          agentContext.onTool = (name, state) =>
            publishRunEvent(db, row.id, `tool.${state}`, { name });
          agentContext.onText = (delta) => publishRunEvent(db, row.id, 'text.delta', { delta });
          agentContext.onContext = async (manifest) => {
            await db.query(
              'INSERT INTO assistant_context_snapshots(turn_id,manifest) VALUES($1,$2) ON CONFLICT(turn_id) DO NOTHING',
              [row.id, JSON.stringify(manifest)],
            );
            await publishRunEvent(db, row.id, 'context.prepared', manifest);
          };
          agentContext.readHistory = async (sourceId, offset, limit) => {
            if (!admission.history?.some((item) => item.sourceTurnId === sourceId))
              throw new HttpError(403, 'HISTORY_OUT_OF_SCOPE', '原文不在本次会话范围');
            await assistantAccess(db, actorId, projectId);
            const source = (
              await db.query(
                'SELECT prompt,output,scope FROM assistant_turns WHERE id=$1 AND actor_id=$2 AND project_id=$3',
                [sourceId, actorId, projectId],
              )
            ).rows[0];
            if (!source) throw new HttpError(404, 'HISTORY_NOT_FOUND', '原文不可用');
            await validateScope(db, actorId, source.scope);
            const content = JSON.stringify({
              user: source.prompt,
              assistant: source.output?.text,
              candidates: (source.output?.candidates ?? []).map((item: any) => ({
                id: item.id,
                kind: item.kind,
                summary: item.summary,
              })),
            });
            return {
              sourceTurnId: sourceId,
              offset,
              total: content.length,
              content: content.slice(offset, offset + limit),
            };
          };
          agentContext.storeToolResult = async (callId, content) => {
            const result = await db.query(
              'INSERT INTO assistant_tool_artifacts(turn_id,call_id,content,content_hash) VALUES($1,$2,$3,$4) RETURNING id',
              [row.id, callId, content, hash(content)],
            );
            return result.rows[0]!.id;
          };
          agentContext.readToolResult = async (artifactId, offset, limit) => {
            const artifact = (
              await db.query(
                'SELECT content,content_hash FROM assistant_tool_artifacts WHERE id=$1 AND turn_id=$2',
                [artifactId, row.id],
              )
            ).rows[0];
            if (!artifact) throw new HttpError(404, 'TOOL_ARTIFACT_NOT_FOUND', '工具结果不可用');
            return {
              artifactId,
              hash: artifact.content_hash,
              offset,
              total: artifact.content.length,
              content: artifact.content.slice(offset, offset + limit),
            };
          };
          const result = await runEditorAgent(
            key,
            body.modelId,
            admission.settings!,
            agentContext,
            dependencies.fetcher,
          );
          await transaction(db, async (tx) => {
            await lockedAssistantAccess(tx, actorId, projectId, admission.historyScope);
            const current = (
              await tx.query('SELECT state FROM assistant_turns WHERE id=$1 FOR UPDATE', [row.id])
            ).rows[0];
            if (current?.state !== 'running')
              throw new HttpError(409, 'ASSISTANT_STATE_CHANGED', '会话状态已变化');
            const candidates = await saveCandidates(tx, row, result, context);
            let execution: Record<string, unknown> | undefined;
            if (row.scope.executionGrantId) {
              const grant = (
                await tx.query('SELECT mode FROM assistant_grants WHERE id=$1 AND actor_id=$2', [
                  row.scope.executionGrantId,
                  actorId,
                ])
              ).rows[0];
              if (grant?.mode === 'auto') {
                const selected =
                  result.selectedCandidateIndex === undefined
                    ? undefined
                    : candidates[result.selectedCandidateIndex];
                const edits =
                  selected?.kind === 'edit'
                    ? [selected]
                    : candidates.filter((item) => item.kind === 'edit');
                if (edits.length && context?.imageDataUrl && !selected) {
                  execution = { state: 'review_required', code: 'CANDIDATE_REVIEW_REQUIRED' };
                  await appendRunEvent(tx, row.id, 'action.blocked', execution);
                } else if (edits.length === 1) {
                  // Candidate publication, revision, step claim and result commit
                  // together. Closing the browser cannot strand an approved action.
                  // A conflict rolls back only the local action, not a real paid receipt.
                  await tx.query('SAVEPOINT automatic_edit');
                  try {
                    const saved = await applyAuthorizedCandidate(tx, {
                      candidateId: edits[0]!.id,
                      actorId,
                      requireSavedBase: true,
                    });
                    edits[0]!.decision = 'previewed';
                    edits[0]!.appliedRevisionId = saved.revisionId;
                    execution = { state: 'applied', candidateId: edits[0]!.id, ...saved };
                    await tx.query('RELEASE SAVEPOINT automatic_edit');
                    await appendRunEvent(tx, row.id, 'action.applied', execution);
                  } catch (error) {
                    await tx.query('ROLLBACK TO SAVEPOINT automatic_edit');
                    await tx.query('RELEASE SAVEPOINT automatic_edit');
                    const message = error instanceof Error ? error.message : '';
                    const code =
                      error instanceof HttpError || error instanceof QuotaError
                        ? error.code
                        : message.includes('COLLABORATION_')
                          ? 'COLLABORATION_LOCKED'
                          : 'AUTOMATIC_EDIT_BLOCKED';
                    execution = { state: 'blocked', candidateId: edits[0]!.id, code };
                    await appendRunEvent(tx, row.id, 'action.blocked', execution);
                  }
                } else if (edits.length > 1) {
                  execution = { state: 'review_required', code: 'ALTERNATIVE_CANDIDATES' };
                  await appendRunEvent(tx, row.id, 'action.blocked', execution);
                }
              }
            }
            await settleHold(tx, row.hold_id);
            await tx.query(
              "UPDATE assistant_turns SET state='completed',output=$2,usage=$3,updated_at=clock_timestamp() WHERE id=$1",
              [
                row.id,
                JSON.stringify({
                  text: result.text,
                  citations: result.citations,
                  candidates,
                  workspace: result.workspace,
                  memorySuggestions: result.memorySuggestions,
                  ...(result.selectedCandidateIndex !== undefined
                    ? { selectedCandidateId: candidates[result.selectedCandidateIndex]?.id }
                    : {}),
                  ...(execution ? { execution } : {}),
                }),
                JSON.stringify(result.usage),
              ],
            );
            await appendRunEvent(tx, row.id, 'run.completed', {
              candidateIds: candidates.map((item) => item.id),
            });
          });
        } catch (error) {
          await transaction(db, async (tx) => {
            const current = (
              await tx.query('SELECT state FROM assistant_turns WHERE id=$1 FOR UPDATE', [row.id])
            ).rows[0];
            if (current?.state !== 'running') return;
            const dispatched = (
              await tx.query('SELECT 1 FROM assistant_dispatches WHERE turn_id=$1 LIMIT 1', [
                row.id,
              ])
            ).rowCount;
            const completed = (
              await tx.query(
                'SELECT 1 FROM assistant_dispatches WHERE turn_id=$1 AND completed_at IS NOT NULL LIMIT 1',
                [row.id],
              )
            ).rowCount;
            const uncertain =
              Boolean(completed) ||
              (Boolean(dispatched) &&
                !(error instanceof ProviderError && error.outcome === 'rejected'));
            if (uncertain) await markUnknownHold(tx, row.hold_id);
            else await releaseHold(tx, row.hold_id);
            const code =
              error instanceof HttpError ||
              error instanceof ProviderError ||
              error instanceof ContextBudgetError ||
              error instanceof QuotaError
                ? error.code
                : 'ASSISTANT_PROCESSING_FAILED';
            await tx.query(
              'UPDATE assistant_turns SET state=$2,error_code=$3,updated_at=clock_timestamp() WHERE id=$1',
              [row.id, uncertain ? 'unknown' : 'failed', code],
            );
            await appendRunEvent(tx, row.id, uncertain ? 'run.unknown' : 'run.failed', { code });
          });
        }
      };
      const work = execute().catch(() => {
        process.stderr.write('{"event":"assistant_turn_reconciliation_required"}\n');
      });
      pendingTurns.add(work);
      void work.finally(() => pendingTurns.delete(work));
      return this.getTurn(actorId, row.id);
    },
    async getTurn(actorId: string, turnId: string) {
      const row = (
        await db.query('SELECT * FROM assistant_turns WHERE id=$1 AND actor_id=$2', [
          turnId,
          actorId,
        ])
      ).rows[0];
      if (!row) throw new HttpError(404, 'TURN_NOT_FOUND', '会话不存在');
      await assistantAccess(db, actorId, row.project_id);
      await validateScope(db, actorId, row.config?.historyScope ?? row.scope);
      let output = row.output;
      if (output?.candidates?.length) {
        const decisions = (
          await db.query(
            'SELECT id,decision,applied_revision_id FROM assistant_candidates WHERE turn_id=$1 AND actor_id=$2',
            [turnId, actorId],
          )
        ).rows;
        const current = new Map(decisions.map((candidate) => [candidate.id, candidate]));
        output = {
          ...output,
          candidates: output.candidates.map((candidate: AssistantCandidate) => ({
            ...candidate,
            decision: current.get(candidate.id)?.decision ?? 'rejected',
            appliedRevisionId: current.get(candidate.id)?.applied_revision_id ?? null,
          })),
        };
      }
      return {
        id: row.id,
        state: row.state,
        modelId: row.model_id,
        conversationId: row.conversation_id,
        prompt: row.prompt,
        output,
        errorCode: row.error_code,
        createdAt: row.created_at,
      };
    },
    async prepareVoice(actorId: string, projectId: string, raw: unknown) {
      if (!voiceReady)
        throw new HttpError(503, 'VOICE_NOT_CONFIGURED', reason ?? '实时语音开关尚未启用');
      await assertJournal();
      const body = voiceSessionSchema.parse(raw);
      let profile: ReturnType<typeof voiceModel>;
      try {
        profile = voiceModel(body.modelId);
      } catch {
        throw new HttpError(400, 'VOICE_PROFILE_UNKNOWN', '此语音模型尚无经过核验的协议适配器');
      }
      if (!(profile.voices as readonly string[]).includes(body.voice))
        throw new HttpError(400, 'VOICE_NOT_ALLOWED', '此音色不适用于选中的语音模型');
      const requestHash = hash(JSON.stringify(body));
      const context = await currentContext(actorId, projectId, body.context);
      await validateScope(db, actorId, body.scope);
      await model(db, body.modelId, 'realtime-voice');
      await model(db, body.backendModelId, 'assistant-turn');
      const ticket = opaqueToken();
      const result = await transaction(db, async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`assistant:${actorId}`]);
        await lockedAssistantAccess(tx, actorId, projectId, body.scope);
        const prior = (
          await tx.query('SELECT * FROM voice_sessions WHERE actor_id=$1 AND idempotency_key=$2', [
            actorId,
            body.idempotencyKey,
          ])
        ).rows[0];
        if (prior)
          throw new HttpError(
            409,
            prior.request_hash === requestHash ? 'VOICE_ALREADY_PREPARED' : 'IDEMPOTENCY_CONFLICT',
            '通话已建立或准备过，不会自动重拨或重复预占',
          );
        if (
          (
            await tx.query(
              "SELECT 1 FROM voice_sessions WHERE actor_id=$1 AND state IN ('prepared','connecting','active')",
              [actorId],
            )
          ).rowCount
        )
          throw new HttpError(409, 'VOICE_ALREADY_ACTIVE', '请先结束现有通话');
        // Sorted model locks avoid a backend/voice configuration cycle.
        for (const modelId of [...new Set([body.modelId, body.backendModelId])].sort())
          await tx.query('SELECT id FROM assistant_model_configs WHERE id=$1 FOR SHARE', [modelId]);
        const voiceConfig = await model(tx, body.modelId, 'realtime-voice');
        const backendConfig = await model(tx, body.backendModelId, 'assistant-turn');
        if (body.scope.executionGrantId)
          await assertAssistantGrant(
            tx,
            body.scope.executionGrantId,
            actorId,
            projectId,
            true,
            body.backendModelId,
          );
        if (body.scope.executionGrantId)
          await claimAssistantGrant(tx, {
            grantId: body.scope.executionGrantId,
            actorId,
            projectId,
            key: `voice:${body.idempotencyKey}`,
            action: 'realtime-voice',
            modelId: body.modelId,
            units: voiceConfig.unitCost,
          });
        const hold = await charge(
          tx,
          actorId,
          projectId,
          voiceConfig.unitCost,
          requestHash,
          `voice:${body.idempotencyKey}`,
        );
        const settings = {
          voice: body.voice,
          voiceModel: voiceConfig,
          backendModel: backendConfig,
        };
        const row = (
          await tx.query(
            `INSERT INTO voice_sessions(project_id,actor_id,model_id,backend_model_id,idempotency_key,request_hash,hold_id,state,config,scope,context,connection_hash,connect_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,'prepared',$8,$9,$10,$11,clock_timestamp()+interval '60 seconds') RETURNING *`,
            [
              projectId,
              actorId,
              body.modelId,
              body.backendModelId,
              body.idempotencyKey,
              requestHash,
              hold.id,
              JSON.stringify(settings),
              JSON.stringify(body.scope),
              JSON.stringify(retainedContext(context)),
              hash(ticket),
            ],
          )
        ).rows[0] as VoiceRow;
        return row;
      });
      return { row: result, context, ticket };
    },
    async resolve(actorId: string, kind: 'voice' | 'turn', recordId: string, raw: unknown) {
      const body = z
        .object({
          resolution: z.enum(['release', 'settle']),
          reason: z.string().trim().min(10).max(1000),
          evidenceRef: z.string().trim().min(3).max(200),
        })
        .strict()
        .parse(raw);
      return transaction(db, async (tx) => {
        const table = kind === 'voice' ? 'voice_sessions' : 'assistant_turns';
        const row = (await tx.query(`SELECT * FROM ${table} WHERE id=$1 FOR UPDATE`, [recordId]))
          .rows[0];
        if (!row || row.state !== 'unknown')
          throw new HttpError(409, 'RECONCILIATION_STATE', '仅可核验未知会话');
        if (body.resolution === 'release') await releaseHold(tx, row.hold_id);
        else await settleHold(tx, row.hold_id);
        await tx.query(
          `UPDATE ${table} SET state='failed',error_code=$2,updated_at=clock_timestamp() WHERE id=$1`,
          [recordId, body.resolution === 'release' ? 'MANUAL_RELEASED' : 'MANUAL_SETTLED'],
        );
        await audit(tx, actorId, 'assistant.reconciled', kind, recordId, body);
        return { ok: true };
      });
    },
  };
}
export type AssistantService = ReturnType<typeof createAssistantService>;
