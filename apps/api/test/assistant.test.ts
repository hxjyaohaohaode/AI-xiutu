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
import sharp from 'sharp';
import { inspectCandidatePixels } from '../src/assistant/preview.js';
import { createRecipeV4, createAdjustmentRegionV3 } from '@ai-xiutu/editor';
import { createArtworkBranch } from '../src/revision-commands.js';

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
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}
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
  'confirmed memory scopes, corrections, expiry and removal remain authoritative',
  { skip: !databaseUrl },
  async () => {
    const f = await fixture();
    try {
      const path = `/v1/projects/${f.projectId}/assistant-memory`;
      const make = (
        scope: string,
        title: string,
        extra = {},
        actor: 'owner' | 'editor' = 'owner',
      ) =>
        f.call(
          'POST',
          path,
          { scope, category: 'constraint', title, content: '保留自然肤质与当前构图', ...extra },
          actor,
        );
      const personal = await make('user', '私人习惯');
      assert.equal(personal.statusCode, 200, personal.body);
      const project = await make('project', '项目规则');
      assert.equal(project.statusCode, 200, project.body);
      assert.equal((await make('team', '越权团队规则', {}, 'editor')).statusCode, 403);
      assert.equal(
        (await make('artwork', '错误作品', { artworkId: randomUUID() })).statusCode,
        404,
      );
      assert.equal(
        (await make('project', '错误来源', { sourceTurnId: randomUUID() })).statusCode,
        404,
      );
      const peer = (await f.call('GET', path, undefined, 'editor')).json().memories;
      assert.ok(peer.some((item: any) => item.id === project.json().memory.id));
      assert.ok(!peer.some((item: any) => item.id === personal.json().memory.id));
      const other = (
        await f.call('GET', `/v1/projects/${f.privateProjectId}/assistant-memory`)
      ).json().memories;
      assert.ok(other.some((item: any) => item.id === personal.json().memory.id));
      assert.ok(!other.some((item: any) => item.id === project.json().memory.id));
      const mid = project.json().memory.id;
      const changed = await f.call('PUT', `${path}/${mid}`, {
        expectedVersion: 1,
        title: '已纠正',
        content: '允许调整构图，仍保留自然肤质',
        category: 'correction',
      });
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(changed.json().memory.version, 2);
      const versions = await f.call('GET', `${path}/${mid}/history`);
      assert.deepEqual(
        versions.json().versions.map((item: any) => item.version),
        [2, 1],
      );
      assert.equal(versions.json().versions[1].content, '保留自然肤质与当前构图');
      assert.equal(
        (await f.call('GET', `${path}/${personal.json().memory.id}/history`, undefined, 'editor'))
          .statusCode,
        404,
      );
      assert.equal(
        (await f.call('DELETE', `${path}/${mid}`, { expectedVersion: 1 })).statusCode,
        409,
      );
      assert.equal(
        (await f.call('DELETE', `${path}/${mid}`, { expectedVersion: 2 })).statusCode,
        200,
      );
      assert.ok(!(await f.call('GET', path)).json().memories.some((item: any) => item.id === mid));
      assert.equal(
        (
          await f.db.query(
            'SELECT version FROM assistant_memory_versions WHERE memory_id=$1 ORDER BY version',
            [mid],
          )
        ).rowCount,
        3,
      );
      const expired = await make('project', '已过期', {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      assert.ok(
        !(await f.call('GET', path))
          .json()
          .memories.some((item: any) => item.id === expired.json().memory.id),
      );
      const managed = (await f.call('GET', `${path}?includeExpired=true`)).json();
      assert.ok(managed.memories.some((item: any) => item.id === expired.json().memory.id));
      assert.equal((await f.call('GET', path, undefined, 'operator')).statusCode, 404);
    } finally {
      await f.close();
    }
  },
);

test(
  'operator assistant queue paginates with scoped cursors and never exposes private prompts',
  { skip: !databaseUrl },
  async () => {
    const f = await fixture({
      fetcher: async () => {
        throw new Error('local ambiguous protocol failure');
      },
    });
    try {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const started = await f.call(
          'POST',
          `/v1/projects/${f.projectId}/assistant-turns`,
          f.turn('PRIVATE_PROMPT_FOR_QUEUE_TEST'),
        );
        const done = await until(
          () => f.readTurn(started.json().id),
          (row) => row.state !== 'running',
        );
        assert.equal(done.state, 'unknown');
        ids.push(done.id);
      }
      const path = `/v1/ops/assistant-reconciliation?kind=turn&actorId=${f.actors.owner.id}&limit=1`;
      assert.equal((await f.call('GET', path)).statusCode, 403);
      const first = await f.call('GET', path, undefined, 'operator');
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().turns.length, 1);
      assert.equal(first.body.includes('PRIVATE_PROMPT_FOR_QUEUE_TEST'), false);
      const second = await f.call(
        'GET',
        `${path}&cursor=${first.json().nextCursor}`,
        undefined,
        'operator',
      );
      assert.equal(second.statusCode, 200, second.body);
      assert.deepEqual([first.json().turns[0].id, second.json().turns[0].id], ids);
      assert.equal(second.json().nextCursor, null);
      const altered = await f.call(
        'GET',
        `/v1/ops/assistant-reconciliation?kind=voice&cursor=${first.json().nextCursor}`,
        undefined,
        'operator',
      );
      assert.equal(altered.statusCode, 400);
    } finally {
      await f.close();
    }
  },
);

test(
  'persisted run events replay without new model calls and retain context provenance',
  { skip: !databaseUrl },
  async () => {
    let sends = 0;
    const f = await fixture({
      fetcher: async () => {
        sends++;
        return new Response(
          `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: '先保留原图。' })}\n\n` +
            `data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output: [outputText('先保留原图。')], usage: { output_tokens: 7 } } })}\n\n`,
          {
            headers: {
              'content-type': 'text/event-stream',
              'x-request-id': 'fixture-stream-receipt',
            },
          },
        );
      },
    });
    try {
      const started = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, f.turn());
      assert.ok([200, 202].includes(started.statusCode), started.body);
      const done = await until(
        () => f.readTurn(started.json().id),
        (row) => row.state !== 'running',
      );
      assert.equal(done.state, 'completed', JSON.stringify(done));
      const events = await f.call('GET', `/v1/assistant-turns/${done.id}/events`);
      assert.equal(events.statusCode, 200);
      assert.match(events.headers['content-type'] ?? '', /text\/event-stream/);
      assert.match(events.body, /text.delta/);
      assert.match(events.body, /run.completed/);
      const first = events.body.match(/id: (\d+)/)![1]!;
      const replay = await f.call('GET', `/v1/assistant-turns/${done.id}/events?after=${first}`);
      assert.ok(!replay.body.includes(`id: ${first}\n`));
      assert.equal(sends, 1);
      assert.equal(
        (await f.call('GET', `/v1/assistant-turns/${done.id}/events`, undefined, 'editor'))
          .statusCode,
        404,
      );
      const evidence = (await f.call('GET', `/v1/assistant-turns/${done.id}/context`)).json()
        .manifest;
      assert.equal(evidence.preservesAllUserInstructions, true);
      assert.equal(evidence.tokenizer, 'o200k_base');
    } finally {
      await f.close();
    }
  },
);

test(
  'assistant interruption serializes stop, receipts, login revocation and candidate publication',
  { skip: !databaseUrl },
  async (t) => {
    for (const scenario of [
      'before-dispatch',
      'valid-receipt',
      'unknown-receipt',
      'logout',
      'memory-changed',
    ] as const) {
      await t.test(scenario, async () => {
        const reached = deferred<void>();
        const resume = deferred<void>();
        let sends = 0;
        const f = await fixture({
          ...(scenario === 'before-dispatch'
            ? {
                textModerator: {
                  configured: true,
                  async check(text: string) {
                    reached.resolve();
                    await resume.promise;
                    return textModerator.check(text);
                  },
                },
              }
            : {}),
          fetcher: async () => {
            sends++;
            reached.resolve();
            await resume.promise;
            if (scenario === 'unknown-receipt') throw new Error('fixture connection lost');
            return response([editCall(), outputText('待核准的编辑。')]);
          },
        });
        try {
          const request = f.turn('谨慎降低曝光，保护主体');
          const memoryPath = `/v1/projects/${f.projectId}/assistant-memory`;
          let memoryId: string | undefined;
          if (scenario === 'memory-changed') {
            const newMemory = await f.call('POST', memoryPath, {
              scope: 'project',
              category: 'constraint',
              title: '保护高光',
              content: '不得裁剪高光。',
            });
            assert.equal(newMemory.statusCode, 200, newMemory.body);
            memoryId = newMemory.json().memory.id;
            request.scope.usePersonalMemory = true;
          }
          const started = await f.call(
            'POST',
            `/v1/projects/${f.projectId}/assistant-turns`,
            request,
          );
          assert.ok([200, 202].includes(started.statusCode), started.body);
          const id = started.json().id;
          await reached.promise;
          if (scenario === 'logout') {
            await f.db.query('DELETE FROM sessions WHERE token_hash=$1', [
              f.actors.owner.tokenHash,
            ]);
          } else if (scenario === 'memory-changed') {
            const edited = await f.call('PUT', `${memoryPath}/${memoryId}`, {
              expectedVersion: 1,
              category: 'correction',
              title: '保护高光',
              content: '曝光不变，优先修改中间调。',
            });
            assert.equal(edited.statusCode, 200, edited.body);
          } else {
            const path = `/v1/assistant-turns/${id}/stop`;
            assert.equal((await f.call('POST', path, {}, 'editor')).statusCode, 404);
            const stopped = await f.call('POST', path, {});
            assert.equal(stopped.statusCode, 200, stopped.body);
            const state = scenario === 'before-dispatch' ? 'stopped' : 'running';
            assert.equal(stopped.json().state, state);
            assert.deepEqual((await f.call('POST', path, {})).json(), stopped.json());
          }
          resume.resolve();
          const record = await until(
            async () =>
              (
                await f.db.query(
                  'SELECT t.state,t.error_code,h.state AS hold_state FROM assistant_turns t JOIN quota_holds h ON h.id=t.hold_id WHERE t.id=$1',
                  [id],
                )
              ).rows[0]!,
            (item) => item.state !== 'running',
          );
          assert.equal(
            record.state,
            scenario === 'unknown-receipt'
              ? 'unknown'
              : scenario === 'logout' || scenario === 'memory-changed'
                ? 'failed'
                : 'stopped',
          );
          assert.equal(
            record.hold_state,
            scenario === 'before-dispatch'
              ? 'released'
              : scenario === 'unknown-receipt'
                ? 'unknown'
                : 'settled',
          );
          if (scenario === 'logout') assert.equal(record.error_code, 'ASSISTANT_SESSION_ENDED');
          if (scenario === 'memory-changed')
            assert.equal(record.error_code, 'ASSISTANT_MEMORY_CHANGED');
          assert.equal(
            (await f.db.query('SELECT id FROM assistant_candidates WHERE turn_id=$1', [id]))
              .rowCount,
            0,
          );
          assert.equal(sends, scenario === 'before-dispatch' ? 0 : 1);
          const events = (
            await f.db.query(
              'SELECT type FROM assistant_run_events WHERE turn_id=$1 ORDER BY seq',
              [id],
            )
          ).rows;
          assert.equal(events.filter((event) => event.type === `run.${record.state}`).length, 1);
          assert.ok(!events.some((event) => event.type === 'action.applied'));
        } finally {
          resume.resolve();
          await f.close();
        }
      });
    }
  },
);

test(
  'cloud and public search publish checked evidence without sending private editor data to public search',
  { skip: !databaseUrl },
  async () => {
    const wire: any[] = [];
    const f = await fixture({
      fetcher: async (_url, init) => {
        wire.push(JSON.parse(String(init?.body)));
        if (wire.length === 1)
          return response([
            {
              type: 'web_search_call',
              status: 'completed',
              results: [
                {
                  type: 'image_result',
                  image_url: 'https://images.example.com/water.jpg',
                  source_website_url: 'https://example.com/water',
                  caption: '公开水面参考',
                },
                {
                  type: 'image_result',
                  image_url: 'https://127.0.0.1/private.png',
                  source_website_url: 'https://example.com/water',
                },
              ],
            },
            outputText('公开资料是日落水面。'),
          ]);
        if (wire.length === 2)
          return response([
            {
              type: 'function_call',
              name: 'search_resources',
              call_id: 'cloud',
              arguments: JSON.stringify({ query: '湖面 参考', limit: 6 }),
            },
          ]);
        return response([outputText('公开水面可参考光线；团队素材提供现有构图。')]);
      },
    });
    try {
      await f.db.query('UPDATE assistant_model_configs SET config=$2 WHERE id=$1', [
        f.modelId,
        JSON.stringify({ ...f.settings, webImageSearch: true }),
      ]);
      await f.db.query('UPDATE assets SET annotations=\'{"title":"湖面 参考"}\' WHERE id=$1', [
        f.assetId,
      ]);
      const searchPath = `/v1/projects/${f.projectId}/assistant-resources/search`;
      const lookup = await f.call('POST', searchPath, {
        spaceIds: [f.teamId],
        query: '湖面 参考',
        limit: 6,
      });
      assert.equal(lookup.statusCode, 200, lookup.body);
      assert.deepEqual(
        lookup.json().resources.map((item: any) => item.id),
        [f.assetId],
      );
      assert.equal(
        (
          await f.call(
            'POST',
            searchPath,
            { spaceIds: [f.actors.owner.spaceId], query: '湖面', limit: 6 },
            'editor',
          )
        ).statusCode,
        403,
      );
      const started = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
        ...f.turn('私密项目意图，只把明确写出的词发往公开检索。'),
        scope: {
          ...f.scope,
          allowWebSearch: true,
          publicSearch: { query: 'lake at dusk', kind: 'images' },
        },
      });
      assert.ok([200, 202].includes(started.statusCode), started.body);
      const id = started.json().id;
      const done = await until(
        () => f.readTurn(id),
        (item) => item.state !== 'running',
      );
      assert.equal(done.state, 'completed', JSON.stringify(done));
      assert.equal(wire.length, 3);
      assert.equal(wire[0].input, 'lake at dusk');
      assert.deepEqual(wire[0].tools[0].search_content_types, ['image', 'text']);
      assert.ok(!JSON.stringify(wire[0]).includes('私密项目意图'));
      assert.ok(!wire[1].tools.some((tool: any) => tool.type === 'web_search'));
      assert.match(JSON.stringify(wire[2].input), /湖面 参考/);
      assert.deepEqual(
        done.output.search.map((item: any) => item.kind),
        ['web', 'cloud'],
      );
      assert.equal(done.output.search[0].images.length, 1);
      assert.equal(done.output.search[0].requested, 'images');
      assert.equal(done.output.search[1].resources[0].id, f.assetId);
      const events = await f.call('GET', `/v1/assistant-turns/${id}/events`);
      assert.equal((events.body.match(/"type":"search.results"/g) ?? []).length, 2);
      assert.ok(!events.body.includes('127.0.0.1/private.png'));
      const persisted = (await f.db.query('SELECT config FROM assistant_turns WHERE id=$1', [id]))
        .rows[0]!.config;
      assert.ok(persisted.historyScope.referenceAssetIds.includes(f.assetId));
    } finally {
      await f.close();
    }
  },
);

test(
  'AI delegation is scoped, atomic under concurrent admission, revocable and replay-safe',
  { skip: !databaseUrl },
  async () => {
    const f = await fixture();
    try {
      const grantBody = {
        mode: 'confirm',
        unitLimit: 5,
        stepLimit: 5,
        minutes: 30,
        allowedActions: ['assistant-turn', 'edit', 'generate-image'],
        modelIds: [f.modelId],
      };
      const create = () =>
        f.call('POST', `/v1/projects/${f.projectId}/assistant-grants`, grantBody);
      assert.equal(
        (await f.call('POST', `/v1/projects/${f.projectId}/assistant-grants`, grantBody, 'viewer'))
          .statusCode,
        403,
      );
      const created = await create();
      assert.equal(created.statusCode, 200, created.body);
      const grant = created.json().grant;
      const body = () => ({ ...f.turn(), scope: { ...f.scope, executionGrantId: grant.id } });
      const submissions = [body(), body()];
      const results = await Promise.all(
        submissions.map((input) =>
          f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, input),
        ),
      );
      const acceptedIndex = results.findIndex((result) => [200, 202].includes(result.statusCode));
      assert.ok(acceptedIndex >= 0);
      assert.equal(results.filter((result) => [200, 202].includes(result.statusCode)).length, 1);
      assert.ok(
        ['ASSISTANT_BUSY', 'ASSISTANT_BUDGET_EXHAUSTED'].includes(
          results[1 - acceptedIndex]!.json().error.code,
        ),
      );
      const done = await until(
        () => f.readTurn(results[acceptedIndex]!.json().id),
        (row) => row.state !== 'running',
      );
      assert.equal(done.state, 'completed');
      const exhausted = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, body());
      assert.equal(exhausted.json().error.code, 'ASSISTANT_BUDGET_EXHAUSTED');
      const replay = await f.call(
        'POST',
        `/v1/projects/${f.projectId}/assistant-turns`,
        submissions[acceptedIndex],
      );
      assert.equal(replay.json().id, done.id);
      const usage = (await f.call('GET', `/v1/assistant-grants/${grant.id}`)).json().grant;
      assert.equal(usage.usedUnits, 5);
      assert.equal(usage.usedSteps, 1);
      assert.equal(
        (await f.call('GET', `/v1/assistant-grants/${grant.id}`, undefined, 'editor')).statusCode,
        404,
      );
      const fresh = (await create()).json().grant;
      assert.equal((await f.call('DELETE', `/v1/assistant-grants/${fresh.id}`)).statusCode, 200);
      const revoked = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
        ...f.turn(),
        scope: { ...f.scope, executionGrantId: fresh.id },
      });
      assert.equal(revoked.json().error.code, 'ASSISTANT_GRANT_EXPIRED');
      assert.equal(
        (await f.call('GET', `/v1/assistant-grants/${fresh.id}`)).json().grant.usedUnits,
        0,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'AI execution modes enforce suggestions, explicit previews and immutable automatic revisions',
  { skip: !databaseUrl },
  async () => {
    let requests = 0;
    const f = await fixture({
      fetcher: async () =>
        ++requests % 2 ? response([editCall()]) : response([outputText('候选完成')]),
    });
    try {
      for (const mode of ['suggest', 'confirm', 'auto']) {
        const created = await f.call('POST', `/v1/projects/${f.projectId}/assistant-grants`, {
          mode,
          unitLimit: 20,
          stepLimit: 5,
          minutes: 30,
          allowedActions: ['assistant-turn', 'edit'],
          modelIds: [f.modelId],
        });
        assert.equal(created.statusCode, 200, created.body);
        const grantId = created.json().grant.id;
        const started = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
          ...f.turn(),
          scope: { ...f.scope, executionGrantId: grantId },
        });
        assert.ok([200, 202].includes(started.statusCode), started.body);
        const done = await until(
          () => f.readTurn(started.json().id),
          (row) => row.state !== 'running',
        );
        assert.equal(done.state, 'completed', JSON.stringify(done));
        const candidate = done.output.candidates[0];
        assert.equal(candidate.executionGrantId, grantId);
        if (mode === 'auto') {
          assert.equal(done.output.execution.state, 'applied');
          assert.ok(
            candidate.appliedRevisionId,
            'server committed without a browser apply request',
          );
          assert.equal(
            (
              await f.db.query('SELECT head_version FROM artworks WHERE id=$1', [
                f.context.artworkId,
              ])
            ).rows[0]!.head_version,
            2,
          );
        }
        const decision = { recipe: f.recipe, expectedVersion: f.context.expectedVersion };
        const applied = await f.call(
          'POST',
          `/v1/assistant-candidates/${candidate.id}/apply`,
          decision,
        );
        if (mode !== 'auto') {
          assert.equal(applied.json().error.code, 'ASSISTANT_ACTION_FORBIDDEN');
          const preview = await f.call(
            'POST',
            `/v1/assistant-candidates/${candidate.id}/decision`,
            { ...decision, decision: 'previewed' },
          );
          assert.equal(preview.statusCode, mode === 'suggest' ? 403 : 200, preview.body);
          assert.equal(
            (
              await f.db.query('SELECT head_version FROM artworks WHERE id=$1', [
                f.context.artworkId,
              ])
            ).rows[0]!.head_version,
            f.context.expectedVersion,
          );
        } else {
          assert.equal(applied.statusCode, 200, applied.body);
          const twice = await f.call(
            'POST',
            `/v1/assistant-candidates/${candidate.id}/apply`,
            decision,
          );
          assert.equal(twice.json().revisionId, applied.json().revisionId);
          assert.equal(twice.json().replayed, true);
          const revisions = (
            await f.db.query(
              'SELECT version,recipe FROM revisions WHERE artwork_id=$1 ORDER BY version',
              [f.context.artworkId],
            )
          ).rows;
          assert.equal(revisions.length, 2);
          assert.equal(revisions[0]!.recipe.adjustments.exposure, 0);
          assert.equal(revisions[1]!.recipe.adjustments.exposure, -1.5);
          const usage = (await f.call('GET', `/v1/assistant-grants/${grantId}`)).json().grant;
          assert.equal(usage.usedSteps, 2);
          assert.equal(usage.usedUnits, 5);
        }
      }
    } finally {
      await f.close();
    }
  },
);

test(
  'server automatic execution preserves paid receipts and candidates when drafts, collaboration, alternatives or step budget block saving',
  { skip: !databaseUrl },
  async (t) => {
    for (const scenario of ['draft', 'lease', 'alternatives', 'budget'] as const)
      await t.test(scenario, async () => {
        let requests = 0;
        const f = await fixture({
          fetcher: async () => {
            requests++;
            if (requests > 1) return response([outputText('已生成候选')]);
            const calls = [editCall()];
            if (scenario === 'alternatives')
              calls.push({
                ...editCall(),
                call_id: 'second-option',
                arguments: JSON.stringify({
                  summary: '另一种方案',
                  target: 'global',
                  targetId: null,
                  changes: [{ path: 'adjustments.exposure', value: -0.5 }],
                }),
              });
            return response(calls);
          },
        });
        try {
          const grant = (
            await f.call('POST', `/v1/projects/${f.projectId}/assistant-grants`, {
              mode: 'auto',
              unitLimit: 20,
              stepLimit: scenario === 'budget' ? 1 : 5,
              minutes: 30,
              allowedActions: ['assistant-turn', 'edit'],
              modelIds: [f.modelId],
            })
          ).json().grant;
          if (scenario === 'lease') {
            const path = `/v1/artworks/${f.context.artworkId}/collaboration`;
            const session = (
              await f.call('POST', `${path}/sessions`, { clientId: randomUUID() }, 'editor')
            ).json().session;
            const lease = await f.call(
              'POST',
              `${path}/leases`,
              { sessionId: session.id, target: { kind: 'document' } },
              'editor',
            );
            assert.equal(lease.statusCode, 201, lease.body);
          }
          const context = structuredClone(f.context);
          if (scenario === 'draft') context.recipe.adjustments.brightness = 15;
          const started = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
            ...f.turn(),
            context,
            scope: { ...f.scope, executionGrantId: grant.id },
          });
          assert.equal(started.statusCode, 202, started.body);
          // Poll storage, not a browser endpoint. Execution must finish independently.
          const row = await until(
            async () =>
              (
                await f.db.query('SELECT state,output,hold_id FROM assistant_turns WHERE id=$1', [
                  started.json().id,
                ])
              ).rows[0]!,
            (row) => row.state !== 'running',
          );
          assert.equal(row.state, 'completed', JSON.stringify(row));
          assert.equal(
            row.output.execution.state,
            scenario === 'alternatives' ? 'review_required' : 'blocked',
          );
          assert.ok(
            row.output.candidates.every(
              (c: any) => c.decision === 'pending' && c.executionManagedBy === 'server',
            ),
          );
          assert.equal(
            (
              await f.db.query('SELECT head_version FROM artworks WHERE id=$1', [
                f.context.artworkId,
              ])
            ).rows[0]!.head_version,
            1,
          );
          const usage = (await f.call('GET', `/v1/assistant-grants/${grant.id}`)).json().grant;
          assert.equal(usage.usedSteps, 1, 'rolled-back local edit consumes no step');
          assert.equal(
            usage.usedUnits,
            5,
            'completed provider work still costs its admitted amount',
          );
          assert.equal(requests, 2, 'no model retry on edit conflict');
          const events = (
            await f.db.query(
              'SELECT type FROM assistant_run_events WHERE turn_id=$1 ORDER BY seq',
              [started.json().id],
            )
          ).rows.map((r) => r.type);
          assert.ok(events.includes('action.blocked'));
          assert.equal(events.at(-1), 'run.completed');
        } finally {
          await f.close();
        }
      });
  },
);

test(
  'candidate observation renders authorized source pixels, moderates the actual transmitted preview and refuses revoked sharing',
  { skip: !databaseUrl },
  async () => {
    const f = await fixture();
    try {
      const bytes = await sharp({
        create: { width: 64, height: 48, channels: 4, background: '#559988' },
      })
        .png()
        .toBuffer();
      const context = {
        ...f.context,
        imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      };
      const recipe = structuredClone(f.recipe);
      recipe.adjustments.exposure = -1;
      let reviewed: Uint8Array | undefined;
      const result = await inspectCandidatePixels(
        f.db,
        f.storage,
        {
          configured: true,
          async check(bytes) {
            reviewed = bytes;
            return imageModerator.check(bytes);
          },
        },
        f.actors.owner.id,
        f.projectId,
        context,
        recipe,
      );
      assert.equal(result.observation.changedPixels, 64 * 48);
      assert.ok(
        (result.observation as any).after.meanLuma < (result.observation as any).before.meanLuma,
      );
      assert.equal(
        result.observation.imageSha256,
        sha(Buffer.from(result.imageDataUrl.split(',')[1]!, 'base64')),
      );
      assert.equal(sha(reviewed!), result.observation.imageSha256);
      assert.equal(
        (await sharp(Buffer.from(result.imageDataUrl.split(',')[1]!, 'base64')).metadata()).width,
        64,
      );
      await assert.rejects(
        inspectCandidatePixels(
          f.db,
          f.storage,
          imageModerator,
          f.actors.owner.id,
          f.projectId,
          f.context,
          recipe,
        ),
        /共享/,
      );
      await assert.rejects(
        inspectCandidatePixels(
          f.db,
          f.storage,
          {
            configured: true,
            async check(bytes) {
              return { decision: 'blocked', inputHash: sha(bytes), requestId: 'blocked' };
            },
          },
          f.actors.owner.id,
          f.projectId,
          context,
          recipe,
        ),
        /审核/,
      );
      await f.db.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
        f.teamId,
        f.actors.editor.id,
      ]);
      await assert.rejects(
        inspectCandidatePixels(
          f.db,
          f.storage,
          imageModerator,
          f.actors.editor.id,
          f.projectId,
          context,
          recipe,
        ),
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'local spatial candidates use original-resolution rendering and cannot bypass pixel admission before automatic save',
  { skip: !databaseUrl },
  async (t) => {
    for (const scenario of ['native-retouch', 'oversized-healing', 'unshared-retouch'])
      await t.test(scenario, async () => {
        let requests = 0;
        const call = (name: string, args: unknown) => ({
          type: 'function_call',
          name,
          call_id: name,
          arguments: JSON.stringify(args),
        });
        const failedRender = scenario === 'oversized-healing',
          shared = scenario !== 'unshared-retouch';
        const selection = { collection: 'regionEdits', id: 'selected' };
        const proposal = {
          summary: '保留原尺寸和选区边界',
          name: '局部候选',
          operationId: null,
          selection,
          protectedSelection: null,
          opacity: 1,
          ...(failedRender
            ? {
                method: 'diffusion',
                searchRadius: 0.5,
                iterations: 32,
                texture: 0,
                patchRadius: null,
              }
            : {
                radius: 0.006,
                smoothing: 60,
                texture: 0,
                uniformity: 20,
                shine: 0,
                speckle: 0,
                fineLines: 0,
              }),
        };
        const f = await fixture({
          fetcher: async (_url, init) => {
            requests++;
            if (requests === 1)
              return response([
                call(failedRender ? 'propose_healing' : 'propose_retouch', proposal),
                ...(shared ? [call('inspect_candidate', { candidateIndex: 0 })] : []),
              ]);
            if (requests === 2) {
              const body = JSON.parse(String(init?.body));
              const images = body.input
                .flatMap((item: any) => item.content ?? [])
                .filter((item: any) => item.type === 'input_image');
              assert.equal(images.length, shared ? (failedRender ? 1 : 2) : 0);
              return response([
                call('select_candidate', {
                  candidateIndex: 0,
                  reason: '依据当前检查结果提出最终候选',
                }),
              ]);
            }
            return response([outputText('候选检查结束，以应用的校验结果为准。')]);
          },
        });
        try {
          const width = 1024,
            height = 768,
            data = Buffer.alloc(width * height * 3);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              const at = (y * width + x) * 3;
              data[at] = 120 + ((x * 11 + y * 3) % 40);
              data[at + 1] = 90 + ((x * 7 + y * 9) % 30);
              data[at + 2] = 70 + (y % 15);
            }
          const png = await sharp(data, { raw: { width, height, channels: 3 } })
            .png()
            .toBuffer();
          const stored = await f.storage.storeGenerated(png),
            assetId = randomUUID();
          const recipe = createRecipeV4({
            regionEdits: [
              createAdjustmentRegionV3({
                id: 'selected',
                name: '手工原图选区',
                mask: {
                  type: 'radial',
                  centerX: 0.5,
                  centerY: 0.5,
                  radiusX: failedRender ? 0.5 : 0.25,
                  radiusY: failedRender ? 0.5 : 0.25,
                  feather: 0.2,
                  invert: false,
                },
              }),
            ],
          });
          const artwork = await transaction(f.db, async (tx) => {
            await tx.query(
              `INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,provenance,created_by)
              VALUES($1,$2,'native-pixels.png',$3,$4,$5,$6,$7,$8,$9,$10)`,
              [
                assetId,
                f.projectId,
                stored.key,
                stored.mime,
                stored.width,
                stored.height,
                stored.bytes,
                stored.hash,
                JSON.stringify({ kind: 'uploaded', declaredSource: 'upload' }),
                f.actors.owner.id,
              ],
            );
            return createArtworkBranch(tx, {
              projectId: f.projectId,
              actorId: f.actors.owner.id,
              assetId,
              recipe,
              title: 'Native pixel fixture',
              label: 'original',
            });
          });
          const grant = (
            await f.call('POST', `/v1/projects/${f.projectId}/assistant-grants`, {
              mode: 'auto',
              unitLimit: 20,
              stepLimit: 5,
              minutes: 30,
              allowedActions: ['assistant-turn', 'edit'],
              modelIds: [f.modelId],
            })
          ).json().grant;
          const context = {
            artworkId: artwork.artwork.id,
            assetId,
            expectedVersion: 1,
            recipe,
            ...(shared
              ? {
                  imageDataUrl: `data:image/png;base64,${await sharp(png)
                    .resize(512, 512, { fit: 'inside' })
                    .png()
                    .toBuffer()
                    .then((bytes) => bytes.toString('base64'))}`,
                }
              : {}),
          };
          const started = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
            ...f.turn(),
            context,
            scope: { ...f.scope, executionGrantId: grant.id },
          });
          assert.equal(started.statusCode, 202, started.body);
          const completed = await until(
            () => f.readTurn(started.json().id),
            (row) => row.state !== 'running',
            45000,
          );
          assert.equal(completed.state, 'completed', JSON.stringify(completed));
          const candidate = completed.output.candidates[0];
          assert.ok(
            candidate,
            'a failed render retains a reviewable proposal, not a saved revision',
          );
          if (scenario === 'native-retouch') {
            assert.equal(completed.output.execution.state, 'applied');
            assert.equal(candidate.observation.fullResolutionChecked, true);
            assert.equal(candidate.observation.after.width, width);
            assert.equal(candidate.observation.after.height, height);
            assert.ok(candidate.observation.changedPixels > 0);
          } else {
            assert.equal(candidate.appliedRevisionId, null);
            assert.equal(
              completed.output.execution.code,
              shared ? 'CANDIDATE_REVIEW_REQUIRED' : 'NATIVE_PIXEL_CHECK_REQUIRED',
            );
          }
          const head = (
            await f.db.query('SELECT head_version FROM artworks WHERE id=$1', [context.artworkId])
          ).rows[0]!.head_version;
          assert.equal(head, scenario === 'native-retouch' ? 2 : 1);
          assert.equal(
            (await f.call('GET', `/v1/assistant-grants/${grant.id}`)).json().grant.usedSteps,
            scenario === 'native-retouch' ? 2 : 1,
          );
          assert.equal(requests, 3);
        } finally {
          await f.close();
        }
      });
  },
);

test(
  'server auto mode chooses an observed alternative and never saves an unreviewed shared-image proposal',
  { skip: !databaseUrl },
  async (t) => {
    for (const review of [false, true])
      await t.test(`observed=${review}`, async () => {
        let requests = 0;
        const f = await fixture({
          fetcher: async (_url, options) => {
            requests++;
            const body = JSON.parse(String(options?.body));
            const call = (name: string, args: unknown, id: string) => ({
              type: 'function_call',
              name,
              call_id: id,
              arguments: JSON.stringify(args),
            });
            if (requests === 1)
              return response([
                editCall(),
                ...(review
                  ? [
                      call(
                        'propose_edit',
                        {
                          summary: '保留明暗层次',
                          target: 'global',
                          targetId: null,
                          changes: [{ path: 'adjustments.exposure', value: -0.25 }],
                        },
                        'alternative',
                      ),
                      call('inspect_candidate', { candidateIndex: 0 }, 'inspect-zero'),
                      call('inspect_candidate', { candidateIndex: 1 }, 'inspect-one'),
                    ]
                  : []),
              ]);
            if (review && requests === 2) {
              const images = body.input
                .flatMap((i: any) => i.content ?? [])
                .filter((c: any) => c.type === 'input_image');
              assert.equal(images.length, 3, 'frozen preview plus two real editor results');
              const first = await sharp(
                Buffer.from(images[1].image_url.split(',')[1], 'base64'),
              ).stats();
              const second = await sharp(
                Buffer.from(images[2].image_url.split(',')[1], 'base64'),
              ).stats();
              assert.ok(
                second.channels[0]!.mean > first.channels[0]!.mean,
                'actual decoded candidate pixels differ as proposed',
              );
              return response([
                call(
                  'select_candidate',
                  { candidateIndex: 1, reason: '第二个实际画面保留更多亮度层次' },
                  'select',
                ),
              ]);
            }
            return response([outputText('候选已检查。')]);
          },
        });
        try {
          const grant = (
            await f.call('POST', `/v1/projects/${f.projectId}/assistant-grants`, {
              mode: 'auto',
              unitLimit: 20,
              stepLimit: 5,
              minutes: 30,
              allowedActions: ['assistant-turn', 'edit'],
              modelIds: [f.modelId],
            })
          ).json().grant;
          const snapshot = await sharp({
            create: { width: 64, height: 48, channels: 4, background: '#559988' },
          })
            .png()
            .toBuffer();
          const started = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
            ...f.turn(),
            context: {
              ...f.context,
              imageDataUrl: `data:image/png;base64,${snapshot.toString('base64')}`,
            },
            scope: { ...f.scope, executionGrantId: grant.id },
          });
          assert.equal(started.statusCode, 202, started.body);
          const row = await until(
            async () =>
              (
                await f.db.query(
                  'SELECT state,output,error_code FROM assistant_turns WHERE id=$1',
                  [started.json().id],
                )
              ).rows[0],
            (row) => row.state !== 'running',
            25000,
          );
          assert.equal(row.state, 'completed', JSON.stringify(row));
          assert.equal(row.output.execution.state, review ? 'applied' : 'review_required');
          const head = (
            await f.db.query('SELECT head_version FROM artworks WHERE id=$1', [f.context.artworkId])
          ).rows[0]!.head_version;
          assert.equal(head, review ? 2 : 1);
          if (review) {
            assert.equal(row.output.selectedCandidateId, row.output.candidates[1].id);
            assert.equal(row.output.execution.candidateId, row.output.candidates[1].id);
            assert.equal(row.output.candidates[1].recipe.adjustments.exposure, -0.25);
            assert.ok(
              row.output.candidates.every((c: any) => c.observation.changedPixels === 3072),
            );
          } else assert.equal(row.output.execution.code, 'CANDIDATE_REVIEW_REQUIRED');
          assert.equal(requests, review ? 3 : 2);
        } finally {
          await f.close();
        }
      });
  },
);

test(
  'retained history and candidates stop at revoked resource access instead of dropping requirements',
  { skip: !databaseUrl },
  async () => {
    let requests = 0;
    const f = await fixture({
      fetcher: async () => {
        requests++;
        return response(requests % 2 ? [editCall()] : [outputText('私人素材中的要求仍需保留')]);
      },
    });
    try {
      const started = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
        ...f.turn('保留这条不能遗忘的要求'),
        scope: {
          ...f.scope,
          spaceIds: [f.teamId, f.actors.owner.spaceId],
          referenceAssetIds: [f.privateAssetId],
        },
      });
      assert.equal(started.statusCode, 202, started.body);
      const done = await until(
        () => f.readTurn(started.json().id),
        (row) => row.state !== 'running',
      );
      assert.equal(done.state, 'completed', JSON.stringify(done));
      assert.equal(done.prompt, '保留这条不能遗忘的要求');
      await f.db.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
        f.actors.owner.spaceId,
        f.actors.owner.id,
      ]);
      const count = requests;
      const followup = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
        ...f.turn('继续'),
        parentTurnId: done.id,
      });
      assert.equal(followup.statusCode, 409, followup.body);
      assert.equal(followup.json().error.code, 'CONTEXT_SCOPE_REVOKED');
      assert.equal(requests, count, 'no paid dispatch and no silent loss of earlier requirements');
      for (const suffix of ['', '/context', '/events']) {
        const hidden = await f.call('GET', `/v1/assistant-turns/${done.id}${suffix}`);
        assert.equal(hidden.statusCode, 403, hidden.body);
      }
      const history = (await f.call('GET', `/v1/projects/${f.projectId}/assistant-turns`)).json();
      assert.equal(history.turns[0].output, null);
      assert.equal(history.turns[0].state, 'unavailable');
      assert.equal(
        (await f.call('GET', `/v1/projects/${f.projectId}/assistant-candidates`)).json().candidates
          .length,
        0,
      );
      const decision = await f.call(
        'POST',
        `/v1/assistant-candidates/${done.output.candidates[0].id}/decision`,
        { decision: 'previewed', recipe: f.recipe, expectedVersion: f.context.expectedVersion },
      );
      assert.equal(decision.statusCode, 403, decision.body);
    } finally {
      await f.close();
    }
  },
);

test(
  'assistant retains several authorized conversation turns and carries creative direction as data',
  { skip: !databaseUrl },
  async () => {
    const sent: any[] = [];
    const f = await fixture({
      fetcher: async (_url, init) => {
        sent.push(JSON.parse(String(init?.body)));
        return response([outputText(`response-${sent.length}`)]);
      },
    });
    try {
      let parentTurnId: string | undefined;
      let conversationId: string | undefined;
      for (const prompt of [
        '第一轮：午后的安静感',
        '第二轮：保持自然肤质',
        '第三轮：颜色再克制一点',
      ]) {
        const started = await f.call('POST', `/v1/projects/${f.projectId}/assistant-turns`, {
          ...f.turn(prompt),
          ...(parentTurnId ? { parentTurnId } : {}),
          scope: {
            ...f.scope,
            creativeBrief: { feeling: '温暖而安静', preserve: '本人五官与自然肤质' },
          },
        });
        assert.ok([200, 202].includes(started.statusCode), started.body);
        const done = await until(
          () => f.readTurn(started.json().id),
          (row) => row.state !== 'running',
        );
        assert.equal(done.state, 'completed', JSON.stringify(done));
        if (conversationId) assert.equal(done.conversationId, conversationId);
        conversationId = done.conversationId;
        parentTurnId = done.id;
      }
      const last = JSON.stringify(sent.at(-1));
      for (const expected of [
        '第一轮：午后的安静感',
        '第二轮：保持自然肤质',
        'response-1',
        'response-2',
        '温暖而安静',
        '本人五官与自然肤质',
      ])
        assert.ok(last.includes(expected), expected);
      const separate = await f.call(
        'POST',
        `/v1/projects/${f.projectId}/assistant-turns`,
        f.turn('新的独立会话'),
      );
      const newDone = await until(
        () => f.readTurn(separate.json().id),
        (row) => row.state !== 'running',
      );
      assert.notEqual(newDone.conversationId, conversationId);
      const selected = (
        await f.call(
          'GET',
          `/v1/projects/${f.projectId}/assistant-turns?conversationId=${conversationId}`,
        )
      ).json().turns;
      assert.equal(selected.length, 3);
      assert.ok(selected.every((item: any) => item.conversationId === conversationId));
      assert.equal(
        (await f.call('GET', `/v1/projects/${f.projectId}/assistant-conversations`)).json()
          .conversations.length,
        2,
      );
    } finally {
      await f.close();
    }
  },
);

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
      voiceSearchFixture = false,
      deferredFetch: Promise<Response> | undefined;
    const voiceSearchBodies: any[] = [];
    vendor.on('connection', (ws) => {
      vendorSockets.push(ws);
      ws.on('message', (data) => {
        const event = JSON.parse(String(data));
        received.push(event);
        if (event.type === 'session.start' && autoReady)
          ws.send(JSON.stringify({ type: 'session.started', session: { id: 'local-live' } }));
        if (event.type === 'session.update' && autoReady)
          ws.send(JSON.stringify({ type: 'session.updated', session: { id: 'local-realtime' } }));
        if (event.type === 'session.instructions.append') {
          assert.match(event.event_id, /^evt_[a-f0-9-]{36}$/);
          ws.send(
            JSON.stringify({
              type: 'error',
              error: { code: 'context_injection_incomplete', client_event_id: event.event_id },
            }),
          );
        }
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
      fetcher: async (_url, init) => {
        requests++;
        const body = JSON.parse(String(init?.body));
        const input = body.input;
        if (voiceSearchFixture) {
          if (typeof input === 'string') {
            voiceSearchBodies.push(body);
            return response([
              { type: 'web_search_call', status: 'completed' },
              {
                type: 'message',
                role: 'assistant',
                content: [
                  {
                    type: 'output_text',
                    text: '资料说明逆光时应考虑补光。',
                    annotations: [
                      {
                        type: 'url_citation',
                        url: 'https://example.com/lighting',
                        title: '补光资料',
                        start_index: 0,
                        end_index: 4,
                      },
                    ],
                  },
                ],
              },
            ]);
          }
          return response([outputText('我找到了补光参考。')]);
        }
        const continuation =
          Array.isArray(input) && input.some((item) => item.type === 'function_call_output');
        return (
          deferredFetch ??
          (continuation
            ? response([outputText('曝光建议已经准备，请在界面确认。')])
            : response([editCall()]))
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
          vendorSockets.at(-1)!.send(
            JSON.stringify({
              type: 'session.input_transcript.delta',
              delta: '降低照片的曝光',
              start_ms: 0,
              end_ms: 500,
            }),
          );
          vendorSockets.at(-1)!.send(
            JSON.stringify({
              type: 'session.delegation.created',
              delegation: { id: 'local-delegation', target: 'client' },
            }),
          );
          const result = await stream.wait('assistant-result');
          assert.equal(result.candidates[0].recipe.adjustments.exposure, -1.5);
          ws.send(JSON.stringify({ type: 'interrupt' }));
          await stream.wait('interrupted');
          assert.equal((await stream.wait('error')).code, 'VOICE_CONTEXT_UPDATE_UNCONFIRMED');
          ws.send(JSON.stringify({ type: 'ping' }));
          await stream.wait('pong');
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
        'voice candidates bind the updated artwork source, not the opening session snapshot',
        async () => {
          const alternativeId = randomUUID();
          const alternative = await transaction(f.db, async (tx) => {
            await tx.query(
              `INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,provenance,created_by)
            SELECT $1,project_id,'second source',storage_key,mime,width,height,bytes,content_hash,provenance,created_by FROM assets WHERE id=$2`,
              [alternativeId, f.assetId],
            );
            return createArtworkBranch(tx, {
              projectId: f.projectId,
              actorId: f.actors.owner.id,
              assetId: alternativeId,
              recipe: f.recipe,
              title: 'Second voice artwork',
              label: 'original',
            });
          });
          const grantResponse = await f.call(
            'POST',
            `/v1/projects/${f.projectId}/assistant-grants`,
            {
              mode: 'auto',
              unitLimit: 20,
              stepLimit: 5,
              minutes: 30,
              allowedActions: ['realtime-voice', 'edit'],
              modelIds: ['gpt-live-1', f.modelId],
            },
          );
          assert.equal(grantResponse.statusCode, 200, grantResponse.body);
          const grant = grantResponse.json().grant;
          Object.assign(f.scope, { executionGrantId: grant.id });
          const stream = await openVoice();
          try {
            const updated = {
              ...f.context,
              artworkId: alternative.artwork.id,
              assetId: alternativeId,
            };
            stream.ws.send(JSON.stringify({ type: 'context', context: updated }));
            assert.equal((await stream.wait('context')).accepted, true);
            stream.ws.send(JSON.stringify({ type: 'text', text: '降低新作品的曝光' }));
            const result = await stream.wait('assistant-result');
            const candidate = result.candidates[0];
            assert.equal(candidate.artworkId, alternative.artwork.id);
            assert.equal(candidate.baseVersion, 1);
            const payload = { recipe: f.recipe, expectedVersion: 1 };
            const applied = await f.call(
              'POST',
              `/v1/assistant-candidates/${candidate.id}/apply`,
              payload,
            );
            assert.equal(applied.statusCode, 200, applied.body);
            assert.equal(applied.json().artworkId, alternative.artwork.id);
            const replay = await f.call(
              'POST',
              `/v1/assistant-candidates/${candidate.id}/apply`,
              payload,
            );
            assert.equal(replay.json().revisionId, applied.json().revisionId);
            assert.equal(replay.json().replayed, true);
            const opening = (
              await f.db.query('SELECT context FROM voice_sessions WHERE id=$1', [stream.data.id])
            ).rows[0]!.context;
            assert.equal(
              opening.assetId,
              f.assetId,
              'immutable opening audit context stays intact',
            );
            assert.equal(
              (
                await f.db.query('SELECT head_version FROM artworks WHERE id=$1', [
                  f.context.artworkId,
                ])
              ).rows[0]!.head_version,
              1,
            );
            assert.equal(
              (
                await f.db.query('SELECT head_version FROM artworks WHERE id=$1', [
                  alternative.artwork.id,
                ])
              ).rows[0]!.head_version,
              2,
            );
            assert.equal(
              (await f.call('GET', `/v1/assistant-grants/${grant.id}`)).json().grant.usedSteps,
              2,
            );
          } finally {
            delete (f.scope as any).executionGrantId;
            stream.ws.send(JSON.stringify({ type: 'end' }));
            await stream.wait('closed');
          }
        },
      );
      await t.test(
        'Realtime uses its own protocol and streams audio without recording upload',
        async () => {
          const stream = await openVoice('gpt-realtime-2.1');
          const beforeSearch = requests;
          stream.ws.send(
            JSON.stringify({ type: 'search', search: { kind: 'text', query: '未授权查找' } }),
          );
          assert.equal((await stream.wait('error')).code, 'VOICE_PUBLIC_SEARCH_UNAVAILABLE');
          assert.equal(requests, beforeSearch);
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
          vendorSockets.at(-1)!.send(
            JSON.stringify({
              type: 'response.output_audio.delta',
              delta: Buffer.alloc(960).toString('base64'),
              item_id: 'item-fixture',
            }),
          );
          assert.equal((await stream.wait('audio')).itemId, 'item-fixture');
          vendorSockets.at(-1)!.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }));
          assert.equal((await stream.wait('interrupted')).bySpeech, true);
          const cutStart = received.length;
          stream.ws.send(
            JSON.stringify({ type: 'playback-cut', itemId: 'wrong-item', playedMs: 10 }),
          );
          stream.ws.send(
            JSON.stringify({ type: 'playback-cut', itemId: 'item-fixture', playedMs: 10000 }),
          );
          await until(
            async () => received.find((event) => event.type === 'conversation.item.truncate'),
            Boolean,
          );
          assert.equal(
            received.find((event) => event.type === 'conversation.item.truncate').audio_end_ms,
            20,
          );
          assert.equal(
            received.slice(cutStart).filter((event) => event.type === 'conversation.item.truncate')
              .length,
            1,
          );
          assert.ok(!received.slice(cutStart).some((event) => event.type === 'response.cancel'));
          vendorSockets.at(-1)!.send(
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
        'live typed and explicit spoken public search isolate the query and use one allowance',
        async () => {
          f.scope.allowWebSearch = true;
          voiceSearchFixture = true;
          try {
            const typed = await openVoice('gpt-live-1', 'editor');
            typed.ws.send(
              JSON.stringify({
                type: 'search',
                search: { kind: 'text', query: '公开人物补光参考' },
              }),
            );
            await typed.wait('search-started');
            assert.equal(
              (await typed.wait('assistant-result')).search[0].sources[0].url,
              'https://example.com/lighting',
            );
            typed.ws.send(
              JSON.stringify({ type: 'search', search: { kind: 'text', query: '第二次不可派发' } }),
            );
            assert.equal((await typed.wait('error')).code, 'VOICE_PUBLIC_SEARCH_UNAVAILABLE');
            typed.ws.send(JSON.stringify({ type: 'end' }));
            assert.equal((await typed.wait('closed')).state, 'closed');
            const spoken = await openVoice('gpt-live-1', 'editor');
            vendorSockets.at(-1)!.send(
              JSON.stringify({
                type: 'session.input_transcript.delta',
                delta: '内部的画布配方',
                start_ms: 30,
                end_ms: 490,
              }),
            );
            vendorSockets.at(-1)!.send(
              JSON.stringify({
                type: 'session.input_transcript.delta',
                delta: '公开搜索：逆光补光资料',
                start_ms: 2400,
                end_ms: 4800,
              }),
            );
            vendorSockets.at(-1)!.send(
              JSON.stringify({
                type: 'session.delegation.created',
                delegation: { id: 'public-literal', target: 'client' },
              }),
            );
            await spoken.wait('search-started');
            assert.equal((await spoken.wait('assistant-result')).search[0].query, '逆光补光资料');
            for (const id of ['allowed-second', 'allowed-third', 'over-limit'])
              vendorSockets
                .at(-1)!
                .send(
                  JSON.stringify({
                    type: 'session.delegation.created',
                    delegation: { id, target: 'client' },
                  }),
                );
            assert.equal((await spoken.wait('error')).code, 'VOICE_DELEGATION_LIMIT');
            await until(
              async () =>
                spoken.messages.filter((event) => event.type === 'assistant-result').length,
              (count) => count === 3,
            );
            spoken.ws.send(JSON.stringify({ type: 'ping' }));
            await spoken.wait('pong');
            assert.ok(!spoken.messages.some((event) => event.type === 'closed'));
            spoken.ws.send(JSON.stringify({ type: 'end' }));
            assert.equal((await spoken.wait('closed')).state, 'closed');
            assert.deepEqual(
              voiceSearchBodies.map((body) => body.input),
              ['公开人物补光参考', '逆光补光资料'],
            );
            assert.ok(
              voiceSearchBodies.every(
                (body) =>
                  body.tools.length === 1 &&
                  body.tools[0].type === 'web_search' &&
                  !JSON.stringify(body).includes('内部的画布配方') &&
                  !JSON.stringify(body).includes(f.assetId),
              ),
            );
          } finally {
            f.scope.allowWebSearch = false;
            voiceSearchFixture = false;
          }
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
        'a new canvas invalidates already published voice candidates and in-flight delegates',
        async () => {
          await f.db.query(
            "INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'editor') ON CONFLICT DO NOTHING",
            [f.teamId, f.actors.editor.id],
          );
          const stream = await openVoice('gpt-live-1', 'editor');
          const waiting = deferred<Response>();
          try {
            stream.ws.send(JSON.stringify({ type: 'text', text: '为现在的画面准备低曝光版本' }));
            const result = await stream.wait('assistant-result');
            const candidate = result.candidates[0];
            assert.ok(candidate?.id);
            const contextTag = randomUUID();
            stream.ws.send(JSON.stringify({ type: 'context.invalidate' }));
            stream.ws.send(JSON.stringify({ type: 'context', context: f.context, contextTag }));
            const accepted = await stream.wait('context');
            assert.equal(accepted.contextTag, contextTag);
            for (const operation of ['decision', 'apply']) {
              const refused = await f.call(
                'POST',
                `/v1/assistant-candidates/${candidate.id}/${operation}`,
                {
                  expectedVersion: candidate.baseVersion,
                  recipe: f.recipe,
                  ...(operation === 'decision' ? { decision: 'previewed' } : {}),
                },
                'editor',
              );
              assert.equal(refused.statusCode, 409, refused.body);
              assert.equal(refused.json().error.code, 'VOICE_CONTEXT_CHANGED');
            }
            deferredFetch = waiting.promise;
            const count = requests;
            vendorSockets.at(-1)!.send(
              JSON.stringify({
                type: 'session.delegation.created',
                delegation: { id: 'old-canvas-delegation', target: 'client' },
              }),
            );
            await until(
              async () => requests,
              (value) => value > count,
            );
            stream.ws.send(JSON.stringify({ type: 'context.invalidate' }));
            const state = async () =>
              (
                await f.db.query('SELECT context_epoch FROM voice_sessions WHERE id=$1', [
                  stream.data.id,
                ])
              ).rows[0]!;
            await until(state, (row) => row.context_epoch === 3);
            waiting.resolve(response([editCall()]));
            await until(
              async () =>
                (
                  await f.db.query(
                    'SELECT count(*)::int AS n FROM assistant_dispatches WHERE voice_id=$1 AND completed_at IS NOT NULL',
                    [stream.data.id],
                  )
                ).rows[0]!.n,
              (n) => n === 3,
            );
            assert.equal(
              requests,
              count + 1,
              'stale delegate does not continue to a new provider request',
            );
            assert.equal(
              (
                await f.db.query('SELECT id FROM assistant_candidates WHERE voice_id=$1', [
                  stream.data.id,
                ])
              ).rowCount,
              1,
            );
          } finally {
            waiting.resolve(response([outputText('已结束')]));
            deferredFetch = undefined;
            stream.ws.send(JSON.stringify({ type: 'end' }));
            await stream.wait('closed');
          }
        },
      );
      await t.test(
        'graceful shutdown drains an already dispatched delegation before database settlement',
        async () => {
          let resolveFetch!: (response: Response) => void;
          deferredFetch = new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          });
          const stream = await openVoice();
          const count = requests;
          vendorSockets.at(-1)!.send(
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
