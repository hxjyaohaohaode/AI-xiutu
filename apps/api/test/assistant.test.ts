import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { transaction, adjustUnits } from '@ai-xiutu/db';
import { assistantModelConfigSchema } from '@ai-xiutu/assistant';
import { collaborationFixture } from './collaboration-fixture.js';
import type { AssistantDependencies } from '../src/assistant/index.js';
import { createAssistantService } from '../src/assistant/service.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const env = {
  AI_ASSISTANT_ENABLED: 'true',
  AI_VOICE_ENABLED: 'true',
  OPENAI_API_KEY: 'local-protocol-fixture-not-a-real-key',
};
const textModerator = {
  configured: true,
  async check(text: string) {
    return {
      decision: text.includes('审核拦截测试') ? ('blocked' as const) : ('passed' as const),
      inputHash: sha(text),
      requestId: 'local-text-review',
    };
  },
};
const imageModerator = {
  configured: true,
  async check(bytes: Uint8Array) {
    return { decision: 'passed' as const, inputHash: sha(bytes), requestId: 'local-image-review' };
  },
};
const outputText = (text: string) => ({
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text }],
});
const response = (output: unknown[]) =>
  new Response(
    JSON.stringify({ status: 'completed', output, usage: { input_tokens: 50, output_tokens: 20 } }),
    { headers: { 'content-type': 'application/json', 'x-request-id': 'local-response-receipt' } },
  );
const editCall = () => ({
  type: 'function_call',
  name: 'propose_edit',
  call_id: 'local-edit',
  arguments: JSON.stringify({
    summary: '降低曝光，保留修改前版本',
    target: 'global',
    targetId: null,
    changes: [{ path: 'adjustments.exposure', value: -1.5 }],
  }),
});
async function until<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  timeout = 8000,
): Promise<T> {
  const started = Date.now();
  let value: T;
  do {
    value = await read();
    if (accept(value)) return value;
    await delay(20);
  } while (Date.now() - started < timeout);
  throw new Error(`Condition did not become true in ${timeout} ms: ${JSON.stringify(value!)}`);
}
async function fixture(extra: Partial<AssistantDependencies> = {}) {
  const f = await collaborationFixture(databaseUrl!, {
    assistant: {
      env,
      textModerator,
      imageModerator,
      fetcher: async () => response([outputText('已准备建议，等待你确认。')]),
      ...extra,
    },
  });
  const modelId = `fixture-response-${randomUUID()}`;
  const settings = assistantModelConfigSchema.parse({
    enabled: true,
    provider: 'openai',
    operations: ['assistant-turn'],
    unitCost: 5,
    imageInput: true,
    webSearch: true,
  });
  await f.db.query('INSERT INTO assistant_model_configs(id,config) VALUES($1,$2)', [
    modelId,
    JSON.stringify(settings),
  ]);
  for (const id of ['gpt-live-1', 'gpt-realtime-2.1'])
    await f.db.query(
      'INSERT INTO assistant_model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config',
      [
        id,
        JSON.stringify({
          ...settings,
          operations: ['realtime-voice'],
          unitCost: 7,
          maxSeconds: 60,
          maxDelegations: 3,
        }),
      ],
    );
  await transaction(f.db, async (tx) =>
    adjustUnits(tx, {
      spaceId: f.teamId,
      actorId: f.actors.operator.id,
      units: 1000,
      reason: 'isolated integration fixture',
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    }),
  );
  const context = {
    artworkId: f.artwork.artwork.id,
    assetId: f.assetId,
    expectedVersion: f.artwork.artwork.headVersion,
    recipe: f.recipe,
  };
  const scope = {
    spaceIds: [f.teamId],
    referenceAssetIds: [],
    allowWebSearch: false,
    usePersonalMemory: false,
  };
  const turn = (prompt = '降低这张照片的曝光') => ({
    idempotencyKey: randomUUID(),
    modelId,
    prompt,
    context,
    scope,
  });
  const prepare = (model = 'gpt-live-1', actor: 'owner' | 'editor' = 'owner') =>
    f.call(
      'POST',
      `/v1/projects/${f.projectId}/voice-sessions`,
      {
        idempotencyKey: randomUUID(),
        modelId: model,
        backendModelId: modelId,
        voice: 'marin',
        context,
        scope,
      },
      actor,
    );
  const readTurn = async (id: string) => (await f.call('GET', `/v1/assistant-turns/${id}`)).json();
  return { ...f, modelId, settings, context, scope, turn, prepare, readTurn };
}

test(
  'assistant HTTP: real database holds, idempotency, private context, current candidate decisions and model CAS',
  { skip: !databaseUrl },
  async (t) => {
    let fetchCount = 0;
    const sent: any[] = [];
    const f = await fixture({
      fetcher: async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return ++fetchCount % 2
          ? response([editCall()])
          : response([outputText('候选已经准备，确认后才能保存。')]);
      },
    });
    try {
      await t.test(
        'operators configure a capability without replacing same-ID image/text configuration',
        async () => {
          const original = { enabled: false, operations: ['generate-text'], unitCost: 20 };
          await f.db.query('INSERT INTO model_configs(id,config) VALUES($1,$2)', [
            f.modelId,
            JSON.stringify(original),
          ]);
          const catalog = (
            await f.call('GET', '/v1/ops/assistant-models', undefined, 'operator')
          ).json();
          const config = catalog.models.find((entry: any) => entry.id === f.modelId);
          assert.equal(
            (
              await f.call(
                'PUT',
                `/v1/ops/assistant-models/${f.modelId}`,
                { config: f.settings, expectedHash: config.hash },
                'owner',
              )
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await f.call(
                'PUT',
                `/v1/ops/assistant-models/${f.modelId}`,
                { config: { ...f.settings, label: '协作模型' }, expectedHash: config.hash },
                'operator',
              )
            ).statusCode,
            200,
          );
          assert.equal(
            (
              await f.call(
                'PUT',
                `/v1/ops/assistant-models/${f.modelId}`,
                { config: f.settings, expectedHash: config.hash },
                'operator',
              )
            ).statusCode,
            409,
          );
          assert.deepEqual(
            (await f.db.query('SELECT config FROM model_configs WHERE id=$1', [f.modelId])).rows[0]!
              .config,
            original,
          );
        },
      );
      await t.test('foreign scope and viewers are rejected before any paid dispatch', async () => {
        const body = f.turn();
        assert.equal(
          (await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, body, 'viewer'))
            .statusCode,
          403,
        );
        assert.equal(
          (
            await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
              ...body,
              scope: { ...f.scope, spaceIds: [f.actors.outsider.spaceId] },
            })
          ).statusCode,
          403,
        );
        assert.equal(fetchCount, 0);
      });
      await t.test(
        'request replay settles once and candidate preview never writes artwork pixels',
        async () => {
          const body = f.turn();
          const first = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, body);
          assert.ok([200, 202].includes(first.statusCode), first.body);
          const id = first.json().id;
          const done = await until(
            () => f.readTurn(id),
            (row) => row.state !== 'running',
          );
          assert.equal(done.state, 'completed');
          assert.equal(fetchCount, 2);
          assert.ok(!JSON.stringify(sent).includes('input_image'));
          const again = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, body);
          assert.equal(again.json().id, id);
          assert.equal(fetchCount, 2);
          assert.equal(
            (
              await f.db.query(
                'SELECT state FROM quota_holds WHERE id=(SELECT hold_id FROM assistant_turns WHERE id=$1)',
                [id],
              )
            ).rows[0]!.state,
            'settled',
          );
          const candidate = done.output.candidates[0];
          assert.equal(candidate.recipe.adjustments.exposure, -1.5);
          assert.equal(
            (
              await f.call('POST', `/v1/assistant-candidates/${candidate.id}/decision`, {
                decision: 'previewed',
                recipe: f.recipe,
                expectedVersion: f.context.expectedVersion,
              })
            ).statusCode,
            200,
          );
          assert.equal(
            (
              await f.db.query('SELECT head_version FROM artworks WHERE id=$1', [
                f.artwork.artwork.id,
              ])
            ).rows[0]!.head_version,
            f.context.expectedVersion,
          );
          assert.equal(
            (
              await f.call('POST', `/v1/assistant-candidates/${candidate.id}/decision`, {
                decision: 'rejected',
              })
            ).statusCode,
            200,
          );
          assert.equal((await f.readTurn(id)).output.candidates[0].decision, 'rejected');
          assert.equal(
            (await f.call('GET', `/v1/projects/${f.projectId}/assistant-turns`)).json().turns[0]
              .output.candidates[0].decision,
            'rejected',
          );
          const history = (
            await f.call('GET', `/v1/projects/${f.projectId}/assistant-candidates`)
          ).json().candidates;
          assert.equal(history.find((item: any) => item.id === candidate.id).decision, 'rejected');
          assert.equal(
            (
              await f.call(
                'GET',
                `/v1/projects/${f.projectId}/assistant-candidates`,
                undefined,
                'editor',
              )
            ).json().candidates.length,
            0,
          );
          assert.equal(
            (await f.call('GET', `/v1/assistant-turns/${id}`, undefined, 'editor')).statusCode,
            404,
          );
          assert.equal(
            (
              await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
                ...body,
                prompt: '改变原请求内容',
              })
            ).statusCode,
            409,
          );
          await f.db.query('UPDATE artworks SET head_version=head_version+1 WHERE id=$1', [
            f.artwork.artwork.id,
          ]);
          assert.equal(
            (await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, body)).json().id,
            id,
            'replay must survive a later canvas revision',
          );
          await f.db.query('UPDATE artworks SET head_version=head_version-1 WHERE id=$1', [
            f.artwork.artwork.id,
          ]);
        },
      );
      await t.test(
        'input moderation failure releases the hold and does not call upstream',
        async () => {
          const result = await f.call(
            'POST',
            `/v1/projects/${f.projectId}/assistant-turns`,
            f.turn('审核拦截测试'),
          );
          const done = await until(
            () => f.readTurn(result.json().id),
            (row) => row.state !== 'running',
          );
          assert.equal(done.state, 'failed');
          assert.equal(fetchCount, 2);
          assert.equal(
            (
              await f.db.query(
                'SELECT state FROM quota_holds WHERE id=(SELECT hold_id FROM assistant_turns WHERE id=$1)',
                [done.id],
              )
            ).rows[0]!.state,
            'released',
          );
        },
      );
      await t.test(
        'voice selection validates the chosen model before quota admission',
        async () => {
          const request = {
            idempotencyKey: randomUUID(),
            modelId: 'gpt-realtime-2.1',
            backendModelId: f.modelId,
            voice: 'quartz',
            context: f.context,
            scope: f.scope,
          };
          const before = (
            await f.db.query('SELECT count(*)::int AS count FROM quota_holds WHERE user_id=$1', [
              f.actors.owner.id,
            ])
          ).rows[0]!.count;
          assert.equal(
            (await f.call('POST', `/v1/projects/${f.projectId}/voice-sessions`, request))
              .statusCode,
            400,
          );
          assert.equal(
            (
              await f.call('POST', `/v1/projects/${f.projectId}/voice-sessions`, {
                ...request,
                modelId: 'unregistered-voice',
                voice: 'marin',
              })
            ).statusCode,
            400,
          );
          assert.equal(
            (
              await f.db.query('SELECT count(*)::int AS count FROM quota_holds WHERE user_id=$1', [
                f.actors.owner.id,
              ])
            ).rows[0]!.count,
            before,
          );
          const accepted = await f.call('POST', `/v1/projects/${f.projectId}/voice-sessions`, {
            ...request,
            modelId: 'gpt-live-1',
          });
          assert.equal(accepted.statusCode, 200, accepted.body);
          assert.equal(
            (
              await f.db.query('SELECT config FROM voice_sessions WHERE id=$1', [
                accepted.json().id,
              ])
            ).rows[0]!.config.voice,
            'quartz',
          );
        },
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'ambiguous Responses result stays unknown until evidenced operator reconciliation; no automatic retry',
  { skip: !databaseUrl },
  async () => {
    let fetches = 0;
    const f = await fixture({
      fetcher: async () => {
        fetches++;
        throw new TypeError('fixture connection reset after request');
      },
    });
    try {
      const body = f.turn();
      const start = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, body);
      const done = await until(
        () => f.readTurn(start.json().id),
        (row) => row.state !== 'running',
      );
      assert.equal(done.state, 'unknown');
      await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, body);
      assert.equal(fetches, 1);
      const url = `/v1/ops/assistant-reconciliation/turn/${done.id}`;
      assert.equal(
        (
          await f.call('POST', url, {
            resolution: 'release',
            reason: '人工核对上游记录确认没有发生计费',
            evidenceRef: 'receipt-fixture',
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await f.call(
            'POST',
            url,
            {
              resolution: 'release',
              reason: '人工核对上游记录确认没有发生计费',
              evidenceRef: 'receipt-fixture',
            },
            'operator',
          )
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await f.db.query(
            'SELECT state FROM quota_holds WHERE id=(SELECT hold_id FROM assistant_turns WHERE id=$1)',
            [done.id],
          )
        ).rows[0]!.state,
        'released',
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'stale recovery and a delayed moderation result cannot release a hold and then dispatch',
  { skip: !databaseUrl },
  async () => {
    let resume!: () => void,
      entered!: () => void,
      fetches = 0;
    const waiting = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const reviewing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = await fixture({
      textModerator: {
        configured: true,
        async check(text) {
          entered();
          await waiting;
          return textModerator.check(text);
        },
      },
      fetcher: async () => {
        fetches++;
        return response([outputText('unreachable')]);
      },
    });
    const recovery = createAssistantService(
      f.db,
      f.storage,
      { env, textModerator, imageModerator },
      join(f.directory, 'assistant'),
    );
    try {
      const started = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, f.turn());
      await reviewing;
      const id = started.json().id;
      await f.db.query(
        "UPDATE assistant_turns SET updated_at=clock_timestamp()-interval '6 minutes' WHERE id=$1",
        [id],
      );
      await recovery.recoverStale();
      resume();
      await delay(150);
      const row = (
        await f.db.query(
          'SELECT t.state,h.state AS hold_state FROM assistant_turns t JOIN quota_holds h ON h.id=t.hold_id WHERE t.id=$1',
          [id],
        )
      ).rows[0]!;
      assert.equal(row.state, 'failed');
      assert.equal(row.hold_state, 'released');
      assert.equal(fetches, 0);
      assert.equal(
        (await f.db.query('SELECT 1 FROM assistant_dispatches WHERE turn_id=$1', [id])).rowCount,
        0,
      );
    } finally {
      resume();
      await f.close();
    }
  },
);

function collect(ws: WebSocket) {
  const messages: any[] = [];
  ws.on('message', (value) => {
    messages.push(JSON.parse(String(value)));
  });
  return {
    messages,
    wait: (type: string, timeout = 8000) =>
      until<any>(async () => messages.find((event) => event.type === type), Boolean, timeout),
  };
}
async function rejectedSocket(url: string, ticket: string, origin: string, cookie: string) {
  const ws = new WebSocket(url, ['xiutu-voice', ticket], { origin, headers: { cookie } });
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('403 timeout'));
    }, 3000);
    ws.on('error', () => undefined);
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      res.resume();
      ws.terminate();
      resolve(res.statusCode ?? 0);
    });
    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error('Unauthorized websocket opened'));
    });
  });
}

test(
  'actual local websocket bridge: origin/ticket/PCM/Live delegation/Realtime/revocation/uncertain close',
  { skip: !databaseUrl },
  async (t) => {
    const vendor = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => vendor.once('listening', resolve));
    const address = vendor.address();
    assert.equal(typeof address, 'object');
    const vendorUrl = `ws://127.0.0.1:${(address as any).port}`;
    const received: any[] = [],
      endpoints: string[] = [],
      vendorSockets: WebSocket[] = [];
    let autoReady = true,
      finalUsage = true,
      deferredFetch: Promise<Response> | undefined;
    vendor.on('connection', (ws) => {
      vendorSockets.push(ws);
      ws.on('message', (data) => {
        const event = JSON.parse(String(data));
        received.push(event);
        if (event.type === 'session.start' && autoReady)
          ws.send(JSON.stringify({ type: 'session.started', session: { id: 'local-live' } }));
        if (event.type === 'session.update' && autoReady)
          ws.send(JSON.stringify({ type: 'session.updated', session: { id: 'local-realtime' } }));
        if (event.type === 'session.close')
          ws.send(
            JSON.stringify({
              type: 'session.closed',
              ...(finalUsage ? { usage: { seconds: 1 } } : {}),
            }),
          );
      });
    });
    let requests = 0;
    const f = await fixture({
      connectVoice(url, options) {
        endpoints.push(url);
        assert.equal(options.headers?.Authorization, `Bearer ${env.OPENAI_API_KEY}`);
        return new WebSocket(vendorUrl);
      },
      fetcher: async () => {
        requests++;
        return (
          deferredFetch ??
          (requests % 2
            ? response([editCall()])
            : response([outputText('曝光建议已经准备，请在界面确认。')]))
        );
      },
    });
    const recovery = createAssistantService(
      f.db,
      f.storage,
      { env, textModerator, imageModerator },
      join(f.directory, 'assistant'),
    );
    const appOrigin = await f.app.listen({ port: 0, host: '127.0.0.1' });
    const wsBase = appOrigin.replace('http:', 'ws:');
    async function openVoice(model = 'gpt-live-1', actor: 'owner' | 'editor' = 'owner') {
      const prepared = await f.prepare(model, actor);
      assert.equal(prepared.statusCode, 200, prepared.body);
      const data = prepared.json();
      const ws = new WebSocket(`${wsBase}${data.websocketPath}`, ['xiutu-voice', data.ticket], {
        origin: f.origin,
        headers: { cookie: f.actors[actor].cookie },
      });
      const stream = collect(ws);
      await stream.wait('ready');
      return { data, ws, ...stream };
    }
    try {
      await t.test(
        'cross-origin and wrong ticket do not consume preparation; live ticket is single-use',
        async () => {
          const prepared = await f.prepare();
          assert.equal(prepared.statusCode, 200, prepared.body);
          const data = prepared.json(),
            url = `${wsBase}${data.websocketPath}`;
          assert.equal(
            await rejectedSocket(
              url,
              data.ticket,
              'https://foreign.invalid',
              f.actors.owner.cookie,
            ),
            403,
          );
          assert.equal(
            await rejectedSocket(url, 'a'.repeat(43), f.origin, f.actors.owner.cookie),
            403,
          );
          assert.equal(endpoints.length, 0);
          const ws = new WebSocket(url, ['xiutu-voice', data.ticket], {
            origin: f.origin,
            headers: { cookie: f.actors.owner.cookie },
          });
          const stream = collect(ws);
          await stream.wait('ready');
          assert.equal(
            await rejectedSocket(url, data.ticket, f.origin, f.actors.owner.cookie),
            403,
          );
          ws.send(JSON.stringify({ type: 'audio', pcm: Buffer.alloc(960).toString('base64') }));
          await until(
            async () => received.some((event) => event.type === 'session.input_audio.append'),
            Boolean,
          );
          assert.equal(endpoints[0], 'wss://api.openai.com/v1/live/sessions');
          vendorSockets
            .at(-1)!
            .send(
              JSON.stringify({
                type: 'session.input_transcript.delta',
                delta: '降低照片的曝光',
                start_ms: 0,
                end_ms: 500,
              }),
            );
          vendorSockets
            .at(-1)!
            .send(
              JSON.stringify({
                type: 'session.delegation.created',
                delegation: { id: 'local-delegation', target: 'client' },
              }),
            );
          const result = await stream.wait('assistant-result');
          assert.equal(result.candidates[0].recipe.adjustments.exposure, -1.5);
          assert.equal(
            (
              await f.db.query('SELECT head_version FROM artworks WHERE id=$1', [
                f.artwork.artwork.id,
              ])
            ).rows[0]!.head_version,
            f.context.expectedVersion,
          );
          ws.send(JSON.stringify({ type: 'end' }));
          assert.equal((await stream.wait('closed')).state, 'closed');
          const record = (
            await f.db.query(
              'SELECT s.*,h.state AS hold_state FROM voice_sessions s JOIN quota_holds h ON h.id=s.hold_id WHERE s.id=$1',
              [data.id],
            )
          ).rows[0]!;
          assert.equal(record.hold_state, 'settled');
          assert.ok(record.usage.vendorFinalUsageConfirmed);
          assert.ok(!JSON.stringify(record.context).includes('base64'));
        },
      );
      await t.test(
        'Realtime uses its own protocol and streams audio without recording upload',
        async () => {
          const stream = await openVoice('gpt-realtime-2.1');
          stream.ws.send(
            JSON.stringify({ type: 'audio', pcm: Buffer.alloc(960).toString('base64') }),
          );
          await until(
            async () => received.some((event) => event.type === 'input_audio_buffer.append'),
            Boolean,
          );
          assert.match(endpoints.at(-1)!, /\/realtime\?model=gpt-realtime-2.1$/);
          vendorSockets
            .at(-1)!
            .send(
              JSON.stringify({ type: 'response.created', response: { id: 'response-fixture' } }),
            );
          vendorSockets
            .at(-1)!
            .send(
              JSON.stringify({
                type: 'response.output_audio.delta',
                delta: Buffer.alloc(960).toString('base64'),
                item_id: 'item-fixture',
              }),
            );
          assert.equal((await stream.wait('audio')).itemId, 'item-fixture');
          stream.ws.send(
            JSON.stringify({ type: 'interrupt', itemId: 'item-fixture', playedMs: 10000 }),
          );
          await until(
            async () => received.find((event) => event.type === 'conversation.item.truncate'),
            Boolean,
          );
          assert.equal(
            received.find((event) => event.type === 'conversation.item.truncate').audio_end_ms,
            20,
          );
          vendorSockets
            .at(-1)!
            .send(
              JSON.stringify({
                type: 'response.done',
                response: {
                  id: 'response-fixture',
                  status: 'cancelled',
                  usage: { total_tokens: 5, input_tokens: 3, output_tokens: 2 },
                },
              }),
            );
          await delay(30);
          stream.ws.send(JSON.stringify({ type: 'end' }));
          assert.equal((await stream.wait('closed')).state, 'closed');
          const receipt = (
            await f.db.query('SELECT usage FROM voice_sessions WHERE id=$1', [stream.data.id])
          ).rows[0]!.usage;
          assert.equal(
            receipt.vendorFinalUsageConfirmed,
            false,
            'a normal Realtime close is not a vendor session-usage receipt',
          );
          assert.equal(receipt.transportClosedConfirmed, true);
          assert.equal(receipt.responseReceiptsComplete, true);
          assert.equal(receipt.responseReceipts, 1);
          assert.equal(receipt.billingBasis, 'configured_session_unit');
        },
      );
      await t.test(
        'malformed raw TCP handshakes leave the ticket usable and release upgrade slots',
        async () => {
          const prepared = await f.prepare();
          assert.equal(prepared.statusCode, 200, prepared.body);
          const data = prepared.json();
          const count = endpoints.length;
          for (let attempt = 0; attempt < 36; attempt++) {
            const url = new URL(appOrigin);
            const result = await new Promise<string>((resolve, reject) => {
              const socket = createConnection({ host: url.hostname, port: Number(url.port) });
              let received = '';
              const timer = setTimeout(() => {
                socket.destroy();
                reject(new Error('raw handshake timeout'));
              }, 2500);
              socket.on('error', reject);
              socket.on('data', (bytes) => {
                received += bytes.toString();
              });
              socket.on('close', () => {
                clearTimeout(timer);
                resolve(received);
              });
              socket.on('connect', () =>
                socket.write(
                  [
                    `GET ${data.websocketPath} HTTP/1.1`,
                    `Host: ${url.host}`,
                    'Upgrade: websocket',
                    'Connection: Upgrade',
                    'Sec-WebSocket-Version: 13',
                    'Sec-WebSocket-Key: invalid',
                    `Origin: ${f.origin}`,
                    `Cookie: ${f.actors.owner.cookie}`,
                    `Sec-WebSocket-Protocol: xiutu-voice, ${data.ticket}`,
                    '',
                    '',
                  ].join('\r\n'),
                ),
              );
            });
            assert.match(result, /^HTTP\/1\.1 403/);
          }
          assert.equal(endpoints.length, count);
          assert.equal(
            (await f.db.query('SELECT state FROM voice_sessions WHERE id=$1', [data.id])).rows[0]!
              .state,
            'prepared',
          );
          const ws = new WebSocket(`${wsBase}${data.websocketPath}`, ['xiutu-voice', data.ticket], {
            origin: f.origin,
            headers: { cookie: f.actors.owner.cookie },
          });
          const stream = collect(ws);
          await stream.wait('ready');
          ws.send(JSON.stringify({ type: 'end' }));
          await stream.wait('closed');
        },
      );
      await t.test(
        'disconnect during an actual database-blocked handshake never opens the vendor socket or hangs shutdown',
        async () => {
          const prepared = await f.prepare();
          assert.equal(prepared.statusCode, 200, prepared.body);
          const data = prepared.json();
          const count = endpoints.length,
            blocker = await f.db.connect();
          await blocker.query('BEGIN');
          await blocker.query('SELECT id FROM voice_sessions WHERE id=$1 FOR UPDATE', [data.id]);
          const ws = new WebSocket(`${wsBase}${data.websocketPath}`, ['xiutu-voice', data.ticket], {
            origin: f.origin,
            headers: { cookie: f.actors.owner.cookie },
          });
          ws.on('error', () => undefined);
          try {
            await until(
              async () =>
                (
                  await f.db.query(
                    "SELECT 1 FROM pg_stat_activity WHERE application_name='ai-xiutu' AND wait_event_type='Lock' AND query LIKE '%voice_sessions%FOR UPDATE%'",
                  )
                ).rowCount,
              Boolean,
            );
            ws.terminate();
            await new Promise<void>((resolve) => {
              if (ws.readyState === WebSocket.CLOSED) resolve();
              else ws.once('close', () => resolve());
            });
            await blocker.query('COMMIT');
            const row = await until(
              async () =>
                (await f.db.query('SELECT state FROM voice_sessions WHERE id=$1', [data.id]))
                  .rows[0],
              (value) => value?.state === 'unknown',
            );
            assert.equal(row.state, 'unknown');
            assert.equal(endpoints.length, count);
          } finally {
            await blocker.query('ROLLBACK').catch(() => undefined);
            blocker.release();
            ws.terminate();
          }
        },
      );
      await t.test(
        'disabled models between prepare and upgrade never open the paid upstream',
        async () => {
          const prepared = await f.prepare();
          assert.equal(prepared.statusCode, 200, prepared.body);
          const data = prepared.json();
          const count = endpoints.length;
          await f.db.query(
            "UPDATE assistant_model_configs SET config=jsonb_set(config,'{enabled}','false') WHERE id='gpt-live-1'",
          );
          assert.equal(
            await rejectedSocket(
              `${wsBase}${data.websocketPath}`,
              data.ticket,
              f.origin,
              f.actors.owner.cookie,
            ),
            403,
          );
          assert.equal(endpoints.length, count);
          await f.db.query(
            "UPDATE assistant_model_configs SET config=jsonb_set(config,'{enabled}','true') WHERE id='gpt-live-1'",
          );
          await f.db.query(
            "UPDATE voice_sessions SET connect_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [data.id],
          );
          await recovery.recoverStale();
        },
      );
      await t.test(
        'late session.started cannot resurrect a recovered connecting session or send ready',
        async () => {
          autoReady = false;
          const prepared = await f.prepare();
          assert.equal(prepared.statusCode, 200, prepared.body);
          const data = prepared.json();
          const count = received.length;
          const ws = new WebSocket(`${wsBase}${data.websocketPath}`, ['xiutu-voice', data.ticket], {
            origin: f.origin,
            headers: { cookie: f.actors.owner.cookie },
          });
          const stream = collect(ws);
          await until(
            async () => received.slice(count).some((event) => event.type === 'session.start'),
            Boolean,
          );
          await f.db.query(
            "UPDATE voice_sessions SET updated_at=clock_timestamp()-interval '60 seconds' WHERE id=$1",
            [data.id],
          );
          await recovery.recoverStale();
          vendorSockets
            .at(-1)!
            .send(JSON.stringify({ type: 'session.started', session: { id: 'too-late' } }));
          assert.equal((await stream.wait('closed')).state, 'unknown');
          assert.ok(!stream.messages.some((event) => event.type === 'ready'));
          autoReady = true;
        },
      );
      await t.test(
        'Live final event without usage remains unknown and reserves its hold for reconciliation',
        async () => {
          finalUsage = false;
          const stream = await openVoice();
          stream.ws.send(JSON.stringify({ type: 'end' }));
          assert.equal((await stream.wait('closed')).state, 'unknown');
          const row = (
            await f.db.query(
              'SELECT h.state FROM voice_sessions s JOIN quota_holds h ON h.id=s.hold_id WHERE s.id=$1',
              [stream.data.id],
            )
          ).rows[0]!;
          assert.equal(row.state, 'unknown');
          finalUsage = true;
        },
      );
      await t.test(
        'typed moderation and single in-flight responses stop unbounded Realtime request queues',
        async () => {
          const stream = await openVoice('gpt-realtime-2.1');
          const count = received.length;
          stream.ws.send(JSON.stringify({ type: 'text', text: '审核拦截测试' }));
          await stream.wait('error');
          assert.ok(
            !received.slice(count).some((event) => event.type === 'conversation.item.create'),
          );
          await delay(720);
          stream.ws.send(JSON.stringify({ type: 'text', text: '这张照片怎么改' }));
          await until(
            async () =>
              received.slice(count).filter((event) => event.type === 'response.create').length,
            (value) => value === 1,
          );
          stream.ws.send(JSON.stringify({ type: 'text', text: '连续发送不能重复创建回应' }));
          await delay(80);
          assert.equal(
            received.slice(count).filter((event) => event.type === 'response.create').length,
            1,
          );
          stream.ws.send(JSON.stringify({ type: 'end' }));
          assert.equal(
            (await stream.wait('closed')).state,
            'unknown',
            'a pending paid response must not be called settled',
          );
        },
      );
      await t.test('network loss cannot be reported as free or successfully settled', async () => {
        const stream = await openVoice();
        vendorSockets.at(-1)!.terminate();
        assert.equal((await stream.wait('closed')).state, 'unknown');
        const hold = (
          await f.db.query(
            'SELECT h.state FROM quota_holds h JOIN voice_sessions s ON s.hold_id=h.id WHERE s.id=$1',
            [stream.data.id],
          )
        ).rows[0]!;
        assert.equal(hold.state, 'unknown');
      });
      await t.test('removing a member terminates their active voice access', async () => {
        const stream = await openVoice('gpt-live-1', 'editor');
        await f.db.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
          f.teamId,
          f.actors.editor.id,
        ]);
        await stream.wait('closed', 8000);
        assert.notEqual(stream.ws.readyState, WebSocket.OPEN);
        assert.equal((await f.prepare('gpt-live-1', 'editor')).statusCode, 404);
      });
      await t.test('arbitrary upstream configuration events are not forwarded', async () => {
        const stream = await openVoice();
        const count = received.length;
        stream.ws.send(
          JSON.stringify({
            type: 'session.update',
            session: { model: 'attacker', tools: [{ type: 'shell' }] },
          }),
        );
        await stream.wait('closed');
        assert.ok(!received.slice(count).some((event) => event.session?.model === 'attacker'));
      });
      await t.test(
        'graceful shutdown drains an already dispatched delegation before database settlement',
        async () => {
          let resolveFetch!: (response: Response) => void;
          deferredFetch = new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          });
          const stream = await openVoice();
          const count = requests;
          vendorSockets
            .at(-1)!
            .send(
              JSON.stringify({
                type: 'session.delegation.created',
                delegation: { id: 'shutdown-delegation', target: 'client' },
              }),
            );
          await until(
            async () => requests,
            (value) => value > count,
          );
          let closed = false;
          const closing = f.app.close().then(() => {
            closed = true;
          });
          await delay(120);
          assert.equal(closed, false, 'DB cannot close while a paid HTTP receipt is pending');
          resolveFetch(response([outputText('通话结束，不再发布此建议。')]));
          await closing;
          const row = (
            await f.db.query(
              'SELECT s.state,h.state AS hold_state FROM voice_sessions s JOIN quota_holds h ON h.id=s.hold_id WHERE s.id=$1',
              [stream.data.id],
            )
          ).rows[0]!;
          assert.equal(row.state, 'closed');
          assert.equal(row.hold_state, 'settled');
          assert.equal(
            (
              await f.db.query('SELECT 1 FROM assistant_candidates WHERE voice_id=$1', [
                stream.data.id,
              ])
            ).rowCount,
            0,
          );
        },
      );
    } finally {
      await f.close();
      for (const socket of vendor.clients) socket.terminate();
      await new Promise<void>((resolve) => vendor.close(() => resolve()));
    }
  },
);
