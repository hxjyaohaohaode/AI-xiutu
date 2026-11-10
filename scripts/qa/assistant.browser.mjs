/** Isolated HTTP/PostgreSQL/browser acceptance with an injected Responses SSE fixture.
 * No external AI calls: this verifies product behavior, not model/image quality. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { transaction, adjustUnits, reserveUnits, markUnknownHold } from '@ai-xiutu/db';
import { assistantModelConfigSchema } from '@ai-xiutu/assistant';
import { migrateRecipeToV4 } from '@ai-xiutu/editor';

if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production')
  throw new Error('Run only in isolated non-production CI.');
const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !decodeURIComponent(new URL(databaseUrl).pathname).includes('test'))
  throw new Error('Use a disposable TEST_DATABASE_URL with test in its database name.');
for (const key of [
  'OPENAI_API_KEY',
  'OPENAI_REALTIME_API_KEY',
  'GEMINI_API_KEY',
  'DASHSCOPE_API_KEY',
  'ARK_API_KEY',
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
])
  process.env[key] = '';
for (const flag of [
  'AI_PLAN_ENABLED',
  'AI_TEXT_ENABLED',
  'AI_IMAGE_ENABLED',
  'AI_SPEECH_ENABLED',
  'AI_ASSISTANT_ENABLED',
  'AI_VOICE_ENABLED',
])
  process.env[flag] = 'false';
process.env.NODE_ENV = 'test';
const { collaborationFixture } = await import('../../apps/api/test/collaboration-fixture.ts');
const { createServer } = await import('vite');
const root = fileURLToPath(new URL('../..', import.meta.url));
const artifacts = resolve(root, process.env.BROWSER_ARTIFACT_DIR ?? 'artifacts/browser-assistant');
await mkdir(artifacts, { recursive: true });
const port = Number(process.env.BROWSER_WEB_PORT ?? 4179);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
const origin = `http://127.0.0.1:${port}`;
const sha = (value) => createHash('sha256').update(value).digest('hex');
const modelId = `local-browser-${randomUUID()}`;
const workspace = {
  title: '本次创作工作台',
  sections: [
    {
      type: 'clarification',
      title: '确定方向',
      question: '你希望哪一种氛围？',
      choices: ['更温暖自然，保留皮肤纹理', '更清冷克制，保留皮肤纹理'],
    },
    { type: 'candidates', title: '编辑建议', candidateIndices: [0] },
    { type: 'parameters', title: '参数对比', candidateIndex: 0 },
    { type: 'budget', title: '本次授权用量' },
  ],
};
let dispatches = 0,
  holdCompletion = false,
  firstDelta = false;
let spatialFixture = false;
const bodies = [];
const sentence = '已保留人物特征，准备降低曝光并保持自然肤质。';
const outputText = {
  type: 'message',
  role: 'assistant',
  content: [{ type: 'output_text', text: sentence }],
};
const report = {
  startedAt: new Date().toISOString(),
  provider: 'injected local SSE protocol fixture; zero paid calls',
  cases: [],
  pageErrors: [],
  manualVisualReview: false,
};
let fixture, vite, browser, page;
async function until(read, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  do {
    const value = await read();
    if (value) return value;
    await delay(80);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`);
}
async function testCase(name, run) {
  const start = Date.now();
  try {
    const detail = await run();
    report.cases.push({ name, state: 'passed', ms: Date.now() - start, ...detail });
    console.log(`Passed: ${name}`);
  } catch (error) {
    report.cases.push({ name, state: 'failed', message: String(error) });
    throw error;
  }
}
async function openProject(target, selectModel = true) {
  await target.goto(origin);
  await target.getByRole('button', { name: '打开空间与项目', exact: true }).click();
  await target
    .locator('.sidebar')
    .getByRole('button', { name: /^V4 team/ })
    .click();
  await target.getByRole('button', { name: '打开空间与项目', exact: true }).click();
  await target
    .getByRole('navigation', { name: '项目', exact: true })
    .getByRole('button', { name: 'V4 project', exact: true })
    .click();
  await target
    .locator('.library-version-links')
    .getByRole('button', { name: /Collaborative portrait/ })
    .click();
  await target.locator('.collaboration-status[data-state="ready"]').waitFor();
  await target.getByRole('button', { name: 'AI共创', exact: true }).click();
  await target.getByRole('button', { name: '实时协作', exact: true }).click();
  await target.getByRole('button', { name: '文字协作', exact: true }).click();
  if (selectModel) await target.getByLabel('思考与工具模型').selectOption(modelId);
}
async function details(prefix, open = true) {
  const summary = page.locator('.live-assistant summary').filter({ hasText: prefix }).first();
  if ((await summary.evaluate((node) => node.parentElement.open)) !== open) await summary.click();
  return summary.locator('..');
}
async function submit(prompt) {
  await page.getByLabel('向智能体描述修改需求').fill(prompt);
  await page.getByRole('button', { name: '发送协作请求', exact: true }).click();
}
async function head() {
  const response = await fixture.call('GET', `/v1/artworks/${fixture.artwork.artwork.id}`);
  assert.equal(response.statusCode, 200);
  return response.json();
}
async function finished() {
  await until(
    async () =>
      !(await page.getByLabel('思考与工具模型').isEnabled()) &&
      (await page.locator('.assistant-workspace').count()) === 1 &&
      !(await page.locator('.assistant-tool-status').innerText()).includes('正在读取'),
    'run completion',
  );
  assert.equal(
    await page.locator('.live-assistant .assistant-error').count(),
    0,
    await page.locator('.live-assistant').innerText(),
  );
}
try {
  fixture = await collaborationFixture(databaseUrl, {
    origin,
    assistant: {
      env: {
        AI_ASSISTANT_ENABLED: 'true',
        AI_VOICE_ENABLED: 'false',
        OPENAI_API_KEY: 'local-fixture-not-a-key',
      },
      textModerator: {
        configured: true,
        async check(text) {
          return { decision: 'passed', inputHash: sha(text), requestId: 'fixture-text' };
        },
      },
      imageModerator: {
        configured: true,
        async check(bytes) {
          return { decision: 'passed', inputHash: sha(bytes), requestId: 'fixture-image' };
        },
      },
      fetcher: async (_url, init) => {
        dispatches++;
        const body = JSON.parse(init.body);
        bodies.push(body);
        if (typeof body.input === 'string')
          return Response.json(
            {
              status: 'completed',
              output: [
                {
                  type: 'web_search_call',
                  status: 'completed',
                  results: [
                    {
                      type: 'image_result',
                      image_url: 'https://images.example.com/lake.jpg',
                      source_website_url: 'https://example.com/lake',
                      caption: '公开湖面布光',
                    },
                  ],
                },
                outputText,
              ],
              usage: { input_tokens: 50, output_tokens: 20 },
            },
            { headers: { 'x-request-id': `fixture-search-${dispatches}` } },
          );
        const calls = body.input.filter((item) => item.type === 'function_call');
        const roundDone = calls.some((item) => item.call_id === 'fixture-edit');
        const output = roundDone
          ? [outputText]
          : [
              {
                type: 'function_call',
                name: spatialFixture ? 'propose_retouch' : 'propose_edit',
                call_id: 'fixture-edit',
                arguments: JSON.stringify(
                  spatialFixture
                    ? {
                        summary: '在左侧已有选区内调整局部质感',
                        name: '左侧质感',
                        operationId: null,
                        selection: { collection: 'regionEdits', id: 'left' },
                        protectedSelection: null,
                        opacity: 0.8,
                        radius: 0.02,
                        smoothing: 40,
                        texture: 10,
                        uniformity: 20,
                        shine: 10,
                        speckle: 0,
                        fineLines: 0,
                      }
                    : {
                        summary: '降低曝光并保留原有主体',
                        target: 'global',
                        targetId: null,
                        changes: [{ path: 'adjustments.exposure', value: -1.5 }],
                      },
                ),
              },
              {
                type: 'function_call',
                name: 'compose_workspace',
                call_id: 'fixture-ui',
                arguments: JSON.stringify(workspace),
              },
            ];
        if (!roundDone && JSON.stringify(body.input).includes('这个项目每次都保留主体五官'))
          output.push({
            type: 'function_call',
            name: 'suggest_memory',
            call_id: 'fixture-memory',
            arguments: JSON.stringify({
              scope: 'project',
              category: 'constraint',
              title: '主体保护',
              content: '本项目保留主体五官',
              evidence: '这个项目每次都保留主体五官',
            }),
          });
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            async start(controller) {
              const send = (event) =>
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              try {
                if (roundDone) {
                  send({ type: 'response.output_text.delta', delta: sentence });
                  firstDelta = true;
                  while (holdCompletion) await delay(50);
                }
                send({
                  type: 'response.completed',
                  response: {
                    id: `local-${dispatches}`,
                    status: 'completed',
                    output,
                    usage: { input_tokens: 100, output_tokens: 50 },
                  },
                });
                controller.close();
              } catch (error) {
                controller.error(error);
              }
            },
          }),
          {
            headers: {
              'content-type': 'text/event-stream',
              'x-request-id': `fixture-${dispatches}`,
            },
          },
        );
      },
    },
  });
  const migrated = await fixture.call(
    'POST',
    `/v1/artworks/${fixture.artwork.artwork.id}/revisions`,
    {
      expectedVersion: fixture.artwork.artwork.headVersion,
      recipe: migrateRecipeToV4(fixture.recipe),
      label: 'Isolated v4 browser baseline',
    },
  );
  assert.equal(migrated.statusCode, 201, migrated.body);
  await fixture.db.query('INSERT INTO assistant_model_configs(id,config) VALUES($1,$2)', [
    modelId,
    JSON.stringify(
      assistantModelConfigSchema.parse({
        label: '本地协议验收（无费用）',
        enabled: true,
        provider: 'openai',
        operations: ['assistant-turn'],
        unitCost: 5,
        imageInput: true,
        webSearch: true,
        webImageSearch: true,
      }),
    ),
  ]);
  await transaction(fixture.db, (tx) =>
    adjustUnits(tx, {
      spaceId: fixture.teamId,
      actorId: fixture.actors.operator.id,
      units: 1000,
      reason: 'isolated browser fixture',
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
    }),
  );
  await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(fixture.app.server.address().port);
  vite = await createServer({
    configFile: resolve(root, 'apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port, strictPort: true },
  });
  await vite.listen();
  const channel = process.env.BROWSER_CHANNEL;
  assert.ok(!channel || ['chrome', 'msedge'].includes(channel));
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  report.browser = browser.version();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
  await context.addCookies([
    { name: 'xiutu_session', value: fixture.actors.owner.cookie.split('=')[1], url: origin },
  ]);
  page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(String(error)));
  page.on('response', async (response) => {
    if (response.url().includes('/assistant-turns') && response.request().method() === 'POST') {
      const body = response.request().postDataJSON();
      const result = await response.json().catch(() => ({}));
      console.log(
        JSON.stringify({
          admission: response.status(),
          expectedVersion: body.context?.expectedVersion,
          error: result.error,
          turnState: result.state,
        }),
      );
    }
  });
  await openProject(page);
  const original = await head();

  await testCase('memory-confirm-correct-forget-and-source-opt-in', async () => {
    const panel = await details('可复用的偏好与要求');
    await panel.getByLabel('名称', { exact: true }).fill('人像保护');
    await panel.getByLabel('准确内容').fill('始终保留雀斑与真实肤质');
    await panel.getByRole('button', { name: '确认记住', exact: true }).click();
    await panel.locator('article').filter({ hasText: '人像保护' }).waitFor();
    await panel.getByRole('button', { name: '更正', exact: true }).click();
    await panel.getByLabel('准确内容').fill('保留雀斑，局部减淡阴影');
    await panel.getByRole('button', { name: '保存更正', exact: true }).click();
    await until(
      async () => (await panel.locator('article').innerText()).includes('v2'),
      'memory correction version',
    );
    const share = await details('共享范围');
    await share.getByLabel('使用已确认的偏好、项目要求与素材标注').check();
    await details('共享范围', false);
    await details('可复用的偏好与要求', false);
    await submit('自然一点，保留人物特征。');
    await finished();
    assert.ok(JSON.stringify(bodies.at(-1)).includes('保留雀斑，局部减淡阴影'));
    assert.ok(!JSON.stringify(bodies.at(-1)).includes('始终保留雀斑与真实肤质'));
    await details('可复用的偏好与要求');
    await panel.getByRole('button', { name: '忘记', exact: true }).click();
    await until(async () => (await panel.locator('article').count()) === 0, 'forget memory');
    await details('可复用的偏好与要求', false);
    return { versionedCorrection: true, oldMemoryNotSent: true };
  });
  await testCase('default-confirm-genui-uses-real-preview-and-undo', async () => {
    const controls = await details('执行方式');
    assert.equal(await controls.getByLabel('AI 可以做到哪一步').inputValue(), 'confirm');
    assert.equal((await head()).artwork.headVersion, original.artwork.headVersion);
    await details('执行方式', false);
    assert.equal(
      await page.locator('.assistant-candidates').count(),
      0,
      'candidate controls are not duplicated',
    );
    await page.getByRole('button', { name: '更温暖自然，保留皮肤纹理', exact: true }).click();
    assert.equal(
      await page.getByLabel('向智能体描述修改需求').inputValue(),
      '更温暖自然，保留皮肤纹理',
    );
    await page.getByRole('button', { name: '在画布预览', exact: true }).click();
    await page.getByRole('button', { name: '已放入画布预览', exact: true }).waitFor();
    assert.equal(
      (await head()).artwork.headVersion,
      original.artwork.headVersion,
      'preview has no persisted write',
    );
    await page.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
    return { persistedWrite: false, undoAvailable: true };
  });
  await testCase(
    'local-spatial-candidate-previews-in-existing-canvas-and-undoes-without-writing',
    async () => {
      spatialFixture = true;
      try {
        await page
          .getByRole('button', { name: '开始新会话，保留已保存的历史', exact: true })
          .click();
        await submit('在左侧已有选区内调整局部质感。');
        await finished();
        await page.getByText('在左侧已有选区内调整局部质感', { exact: true }).waitFor();
        await page.getByRole('button', { name: '在画布预览', exact: true }).click();
        await page.getByRole('button', { name: '已放入画布预览', exact: true }).waitFor();
        assert.equal((await head()).artwork.headVersion, original.artwork.headVersion);
        await page.screenshot({
          path: resolve(artifacts, 'local-spatial-preview.png'),
          fullPage: true,
        });
        await page.getByRole('button', { name: '撤销本次编辑', exact: true }).click();
        return { selectedSourceRegion: 'left', persistedWrite: false, undoAvailable: true };
      } finally {
        spatialFixture = false;
      }
    },
  );
  await testCase('suggest-mode-immutable-and-no-forgotten-memory', async () => {
    const panel = await details('执行方式');
    await panel.getByRole('button', { name: '停止授权', exact: true }).click();
    await panel.getByLabel('AI 可以做到哪一步').selectOption('suggest');
    await details('执行方式', false);
    await page.getByRole('button', { name: '开始新会话，保留已保存的历史', exact: true }).click();
    await submit('仅提供建议，不修改图片。');
    await finished();
    assert.ok(await page.getByRole('button', { name: '在画布预览', exact: true }).isDisabled());
    assert.equal((await head()).artwork.headVersion, original.artwork.headVersion);
    assert.ok(!JSON.stringify(bodies.at(-1)).includes('保留雀斑，局部减淡阴影'));
    return { cannotExecute: true, forgottenMemoryNotSent: true };
  });
  await testCase('auto-explicit-grant-versioned-write-and-budget', async () => {
    const controls = await details('执行方式');
    await controls.getByRole('button', { name: '停止授权', exact: true }).click();
    await controls.getByLabel('AI 可以做到哪一步').selectOption('auto');
    await page.getByRole('button', { name: '开始新会话，保留已保存的历史', exact: true }).click();
    const before = dispatches;
    await submit('降低曝光。');
    await page.getByRole('alert').filter({ hasText: '请先明确授权' }).waitFor();
    assert.equal(dispatches, before);
    await controls.getByLabel('最多操作次数').fill('2');
    await controls
      .getByRole('button', { name: '授权当前项目，30 分钟内有效', exact: true })
      .click();
    await controls.getByRole('button', { name: '停止授权', exact: true }).waitFor();
    await details('执行方式', false);
    await submit('降低曝光。');
    await until(
      async () => (await head()).artwork.headVersion === original.artwork.headVersion + 1,
      'automatic immutable revision',
    );
    await page.getByRole('button', { name: '已保存新版本', exact: true }).waitFor();
    const grant = (
      await fixture.db.query(
        'SELECT * FROM assistant_grants WHERE actor_id=$1 AND mode=$2 ORDER BY created_at DESC LIMIT 1',
        [fixture.actors.owner.id, 'auto'],
      )
    ).rows[0];
    assert.equal(grant.used_steps, 2);
    assert.equal(grant.used_units, 5);
    const dispatched = dispatches;
    await submit('再处理一遍。');
    await until(
      async () => (await page.locator('.assistant-error').innerText()).includes('上限'),
      'exhausted grant error',
    );
    assert.equal(dispatches, dispatched);
    assert.equal((await head()).artwork.headVersion, original.artwork.headVersion + 1);
    return {
      exactRevisionWrites: 1,
      exhaustedBeforeProvider: true,
      usedSteps: grant.used_steps,
      usedUnits: grant.used_units,
    };
  });
  await testCase('stream-refresh-replays-without-resubmitting', async () => {
    const controls = await details('执行方式');
    await controls.getByRole('button', { name: '停止授权', exact: true }).click();
    await controls.getByLabel('AI 可以做到哪一步').selectOption('confirm');
    await details('执行方式', false);
    await page.getByRole('button', { name: '开始新会话，保留已保存的历史', exact: true }).click();
    firstDelta = false;
    holdCompletion = true;
    const before = dispatches;
    await submit('刷新页面也不要重复调用。');
    await until(() => firstDelta, 'streamed first delta');
    await until(
      async () => (await page.locator('.assistant-messages').innerText()).includes(sentence),
      'visible incremental text',
    );
    await openProject(page, false);
    assert.equal(dispatches, before + 2);
    holdCompletion = false;
    await until(
      async () =>
        (await page.locator('.assistant-workspace').count()) === 1 &&
        !(await page.locator('.assistant-tool-status').innerText()).includes('正在读取') &&
        (await page.locator('.assistant-messages').innerText()).includes('刷新页面也不要重复调用'),
      'recovered final workspace',
    );
    assert.equal(dispatches, before + 2);
    return { modelRequests: dispatches - before, browserRefreshAddedRequests: 0 };
  });
  await testCase('conversation-switch-isolates-history-and-candidates', async () => {
    const select = page.getByLabel('会话记录', { exact: true });
    const active = await select.inputValue(),
      before = dispatches;
    const other = await select
      .locator('option')
      .evaluateAll(
        (nodes, activeId) => nodes.find((node) => node.value && node.value !== activeId)?.value,
        active,
      );
    assert.ok(other);
    await select.selectOption(other);
    await until(
      async () => (await page.locator('.assistant-messages').innerText()).length > 0,
      'selected history',
    );
    assert.ok(
      !(await page.locator('.assistant-messages').innerText()).includes('刷新页面也不要重复调用'),
    );
    await select.selectOption(active);
    await until(
      async () =>
        (await page.locator('.assistant-messages').innerText()).includes('刷新页面也不要重复调用'),
      'restored conversation',
    );
    assert.equal(dispatches, before);
    return { historyIsolation: true, readOnlySwitch: true };
  });
  await testCase('suggested-memory-requires-review-expiry-and-version-history', async () => {
    await page.getByRole('button', { name: '开始新会话，保留已保存的历史', exact: true }).click();
    const before = (
      await fixture.db.query(
        'SELECT count(*)::int AS n FROM assistant_memories WHERE owner_id=$1',
        [fixture.actors.owner.id],
      )
    ).rows[0].n;
    await submit('请记住：这个项目每次都保留主体五官。');
    await finished();
    const panel = await details('可复用的偏好与要求');
    await panel.getByRole('button', { name: '检查内容与范围', exact: true }).click();
    assert.equal(await panel.getByLabel('生效范围').inputValue(), 'project');
    assert.equal(
      (
        await fixture.db.query(
          'SELECT count(*)::int AS n FROM assistant_memories WHERE owner_id=$1',
          [fixture.actors.owner.id],
        )
      ).rows[0].n,
      before,
      'model suggestions cannot persist memory',
    );
    await panel.getByRole('button', { name: '确认记住', exact: true }).click();
    await until(
      async () => (await panel.locator('.assistant-memory-list article').count()) === 1,
      'confirmed suggested memory',
    );
    await panel.getByRole('button', { name: '更正', exact: true }).click();
    await panel.getByLabel('有效至（留空则长期有效）').fill('2020-01-01T00:00');
    await panel.getByRole('button', { name: '保存更正', exact: true }).click();
    await until(
      async () => (await panel.locator('.assistant-memory-list article').count()) === 0,
      'expired excluded',
    );
    await panel.getByLabel('显示已到期的要求').check();
    await until(
      async () => (await panel.locator('.assistant-memory-list').innerText()).includes('已到期'),
      'expired memory management',
    );
    await panel.getByRole('button', { name: '版本记录', exact: true }).click();
    await panel.getByRole('region', { name: '记忆版本记录', exact: true }).waitFor();
    const history = await panel.locator('.memory-version-history').innerText();
    assert.ok(history.includes('v1') && history.includes('v2'));
    await panel.getByRole('button', { name: '忘记', exact: true }).click();
    await until(
      async () => (await panel.locator('.assistant-memory-list article').count()) === 0,
      'forget expired record',
    );
    await details('可复用的偏好与要求', false);
    return {
      suggestedNotSavedAutomatically: true,
      expiryExcludesRecall: true,
      versionHistory: [1, 2],
    };
  });
  await testCase('cloud-thumbnail-and-public-image-search-use-separate-scopes', async () => {
    await fixture.db.query(
      "UPDATE assets SET annotations=jsonb_build_object('title','湖面参考素材') WHERE id=$1",
      [fixture.assetId],
    );
    const scope = await details('共享范围');
    await scope.getByRole('checkbox', { name: /V4 team/ }).check();
    await scope.getByLabel('搜索授权素材').fill('湖面参考');
    const result = scope.getByRole('button', { name: '查看 湖面参考素材', exact: true });
    await result.waitFor();
    await result.click();
    const dialog = page.getByRole('dialog', { name: '湖面参考素材' });
    await dialog.waitFor();
    await until(
      async () => dialog.locator('img').evaluate((node) => node.naturalWidth > 0),
      'actual cloud thumbnail',
    );
    await dialog.getByRole('button', { name: '选为参考', exact: true }).click();
    assert.equal(
      await scope
        .getByRole('button', { name: '移出参考', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    );
    await scope.getByLabel('允许公开网络检索，保留来源链接').check();
    await scope.getByLabel('公开检索查询词').fill('lake backlight');
    await scope.getByLabel('同时查找公开图片').check();
    const research = await details('本轮分工');
    await research.getByLabel('在已授权空间检索素材').fill('湖面参考');
    await submit('这是私有项目描述，请根据公开图片提供参考。');
    const evidence = page.locator('.assistant-search-evidence').filter({
      has: page.getByRole('link', { name: '来源网页', exact: true }),
    }).last();
    await evidence.getByRole('link', { name: '来源网页', exact: true }).waitFor();
    await finished();
    const search = bodies.findLast((body) => typeof body.input === 'string');
    assert.equal(search.input, 'lake backlight');
    assert.ok(!JSON.stringify(search).includes('私有项目描述'));
    assert.ok(!JSON.stringify(search).includes('湖面参考'));
    assert.equal(
      await evidence.getByRole('link', { name: '查看图片', exact: true }).getAttribute('href'),
      'https://images.example.com/lake.jpg',
    );
    const graph = await details('研究分工');
    await graph.getByText('公开来源', { exact: true }).waitFor();
    await graph.getByText('授权素材', { exact: true }).waitFor();
    await graph.getByText(/2 个分支汇合/).waitFor();
    await page.screenshot({ path: resolve(artifacts, 'cloud-public-search.png') });
    await research.getByLabel('在已授权空间检索素材').clear();
    await scope.getByRole('button', { name: '移出参考', exact: true }).click();
    await scope.getByLabel('允许公开网络检索，保留来源链接').uncheck();
    await details('共享范围', false);
    return { protectedThumbnail: true, explicitPublicQuery: true, publicSourceLink: true, mergedBranches: 2 };
  });
  await testCase('stop-in-flight-hides-partial-result-and-survives-refresh', async () => {
    await page.getByRole('button', { name: '开始新会话，保留已保存的历史', exact: true }).click();
    firstDelta = false;
    holdCompletion = true;
    const original = await head();
    const before = dispatches;
    await submit('停止后不要应用这项编辑。');
    await until(() => firstDelta, 'request in flight');
    await page.getByRole('button', { name: '停止本轮执行', exact: true }).click();
    await page.getByRole('button', { name: '正在核对停止结果', exact: true }).waitFor();
    holdCompletion = false;
    await until(
      async () => (await page.locator('.assistant-messages').innerText()).includes('本轮已停止'),
      'durable stop status',
    );
    await openProject(page, false);
    await until(
      async () => (await page.locator('.assistant-messages').innerText()).includes('本轮已停止'),
      'restored stop status',
    );
    assert.equal(dispatches, before + 2);
    assert.equal((await head()).artwork.headVersion, original.artwork.headVersion);
    assert.ok(!(await page.locator('.assistant-messages').innerText()).includes(sentence));
    return { stoppedDuringProviderRound: true, noExtraDispatch: true, savedVersionUnchanged: true };
  });
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
    { width: 844, height: 390 },
  ]) {
    await testCase(`assistant-controls-${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      const notice = page.getByRole('button', { name: '关闭提示', exact: true });
      if (await notice.count()) await notice.click();
      await page.getByLabel('向智能体描述修改需求').scrollIntoViewIfNeeded();
      const geometry = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector)?.getBoundingClientRect();
          return r
            ? { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }
            : null;
        };
        return {
          width: innerWidth,
          overflow: document.documentElement.scrollWidth,
          composer: box('.assistant-composer'),
          panel: box('.ai-workbench'),
          canvas: box('.canvas-photo-frame'),
        };
      });
      assert.ok(geometry.overflow <= viewport.width + 1, 'no page horizontal overflow');
      assert.ok(
        geometry.composer &&
          geometry.composer.x >= 0 &&
          geometry.composer.right <= viewport.width + 1,
      );
      await page.screenshot({
        path: resolve(artifacts, `assistant-${viewport.width}x${viewport.height}.png`),
      });
      return geometry;
    });
  }
  await testCase('operator-paginates-all-unknown-jobs-without-private-content', async () => {
    await transaction(fixture.db, async (tx) => {
      for (let index = 0; index < 60; index++) {
        const hold = await reserveUnits(tx, {
          spaceId: fixture.teamId,
          userId: fixture.actors.owner.id,
          units: 1,
          requestHash: sha(`ops-${index}`),
          idempotencyKey: randomUUID(),
        });
        await markUnknownHold(tx, hold.id);
        await tx.query(
          "INSERT INTO ai_jobs(project_id,actor_id,model_id,input_hash,state,hold_id,operation,provider_request_id,input) VALUES($1,$2,$3,$4,'unknown',$5,'generate-image',$6,$7)",
          [
            fixture.projectId,
            fixture.actors.owner.id,
            modelId,
            sha(`ops-${index}`),
            hold.id,
            `local-receipt-${index}`,
            JSON.stringify({ prompt: 'PRIVATE_PROTOCOL_FIXTURE_MUST_NOT_LEAK' }),
          ],
        );
      }
    });
    const operator = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: 'reduce',
    });
    await operator.addCookies([
      { name: 'xiutu_session', value: fixture.actors.operator.cookie.split('=')[1], url: origin },
    ]);
    page = await operator.newPage();
    page.on('pageerror', (error) => report.pageErrors.push(String(error)));
    await page.goto(origin);
    await page.getByRole('button', { name: '打开空间与项目', exact: true }).click();
    await page.getByRole('button', { name: '运营管理', exact: true }).click();
    await page.getByRole('button', { name: '生成任务核验', exact: true }).click();
    await page.getByLabel('账号编号', { exact: true }).fill(fixture.actors.owner.id);
    await page.getByRole('button', { name: '查询任务', exact: true }).click();
    await until(
      async () => (await page.locator('.unknown-jobs tbody tr').count()) === 50,
      'first 50 unknown tasks',
    );
    assert.ok(
      !(await page.locator('body').innerText()).includes('PRIVATE_PROTOCOL_FIXTURE_MUST_NOT_LEAK'),
    );
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await until(
      async () => (await page.locator('.unknown-jobs tbody tr').count()) === 10,
      'remaining unknown tasks',
    );
    assert.ok(
      await page.getByRole('button', { name: '核验此任务', exact: true }).first().isDisabled(),
      'no configured resolver cannot pretend to settle',
    );
    for (const viewport of [
      { width: 1440, height: 960 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({
        path: resolve(artifacts, `operator-${viewport.width}x${viewport.height}.png`),
      });
    }
    return { pages: [50, 10], privateInputExposed: false, unavailableResolverDisabled: true };
  });
  assert.deepEqual(report.pageErrors, []);
} catch (error) {
  report.error = String(error.stack ?? error);
  if (page) await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
  console.error(error);
  process.exitCode = 1;
} finally {
  holdCompletion = false;
  report.finishedAt = new Date().toISOString();
  report.dispatches = dispatches;
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await vite?.close();
  await fixture?.close();
}
