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
import { runUsagePresentationChecks } from './usage-presentation.browser.mjs';

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
let turnAdmissions = 0;
let spatialFixture = false;
let fixtureExposure = -1.5;
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
async function selectProject(target) {
  const studioUrl = `${origin}/#/studio`;
  // Reopening the fixture is a document reset. Navigating to the same hash
  // can retain the current editor, which is not the refresh these cases test.
  const navigation =
    target.url() === studioUrl ? await target.reload() : await target.goto(studioUrl);
  assert.ok(navigation?.ok(), 'Project setup must load a fresh studio document');
  await target.getByRole('button', { name: '打开空间与项目', exact: true }).click();
  await target
    .locator('dialog.sidebar-navigation-modal')
    .getByRole('button', { name: /^V4 team/ })
    .click();
  await target.getByRole('button', { name: '打开空间与项目', exact: true }).click();
  await target
    .getByRole('navigation', { name: '项目', exact: true })
    .getByRole('button', { name: 'V4 project', exact: true })
    .click();
}
async function openProject(target, selectModel = true) {
  await selectProject(target);
  await target
    .locator('.library-version-links')
    .getByRole('button', { name: /Collaborative portrait/ })
    .click();
  await target.locator('.collaboration-status[data-state="ready"]').waitFor();
  await target
    .locator('.floating-tool-dock')
    .getByRole('button', { name: 'AI 助手', exact: true })
    .click();
  await target.getByLabel('向智能体描述修改需求').waitFor();
  if (selectModel) {
    const settings = await openSettings(target);
    await choose(settings, '助手模型', '本地协议验收（无费用）');
    await closeSettings(target);
  }
}
async function openSettings(target = page) {
  const settings = target.getByRole('region', { name: '助手设置', exact: true });
  if (!(await settings.isVisible()))
    await target
      .locator('.live-assistant')
      .getByRole('button', { name: '助手设置', exact: true })
      .click();
  await settings.waitFor();
  assert.equal(
    await target.getByRole('dialog', { name: '助手设置', exact: true }).count(),
    0,
    'model settings stay inside the existing AI panel instead of opening a dialog',
  );
  return settings;
}
async function closeSettings(target = page) {
  const settings = target.getByRole('region', { name: '助手设置', exact: true });
  if (await settings.isVisible()) {
    await settings.getByRole('button', { name: '返回对话', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
  }
}
async function choose(scope, label, option) {
  const control = scope.getByRole('combobox', { name: label, exact: true });
  if ((await control.getAttribute('aria-expanded')) !== 'true') await control.click();
  const options = scope.getByRole('listbox', { name: label, exact: true });
  await options.getByText(option, { exact: true }).click();
  await options.waitFor({ state: 'hidden' });
}
async function newConversation() {
  await closeSettings();
  await page
    .locator('.live-assistant > .ai-workbench-header')
    .getByRole('button', { name: '新会话', exact: true })
    .click();
}
async function closeAIPanel(target = page) {
  await closeSettings(target);
  const mobile = target
    .locator('.live-assistant')
    .getByRole('button', { name: '收起 AI 面板', exact: true });
  if (await mobile.isVisible()) await mobile.click();
  else
    await target
      .locator('[data-panel-id="ai"]')
      .getByRole('button', { name: '收起AI 助手，可从工具栏重新打开', exact: true })
      .click();
}
async function changeView(id, label) {
  const compact = page.getByRole('button', { name: '切换工作视图', exact: true });
  if (await compact.isVisible()) {
    await compact.click();
    const dialog = page.getByRole('dialog', { name: '工作视图', exact: true });
    await dialog.locator(`button[data-view="${id}"]`).click();
    await dialog.waitFor({ state: 'hidden' });
  } else {
    await page
      .getByRole('navigation', { name: '工作视图', exact: true })
      .getByRole('button', { name: label, exact: true })
      .click();
  }
}
async function details(prefix, open = true) {
  const settings = await openSettings();
  const summary = settings
    .locator('.assistant-context > summary')
    .filter({ hasText: prefix })
    .first();
  if (((await summary.getAttribute('aria-expanded')) === 'true') !== open) await summary.click();
  const panel = summary.locator('..');
  if (!open) await closeSettings();
  return panel;
}
async function submit(prompt) {
  await closeSettings();
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
      (await page
        .locator('.live-assistant > .ai-workbench-header')
        .getByRole('button', { name: '新会话', exact: true })
        .isEnabled()) &&
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
              usage: { input_tokens: 50, output_tokens: 20, total_tokens: 70 },
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
                        changes: [{ path: 'adjustments.exposure', value: fixtureExposure }],
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
                    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
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
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/assistant-turns'))
      turnAdmissions++;
  });
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

  await testCase(
    'composer-composition-and-settings-preserve-unsent-drafts-without-admission',
    async () => {
      const input = page.getByLabel('向智能体描述修改需求');
      const prompt = '这条要求先保留，不发送。';
      await input.fill(prompt);
      await until(
        () => page.getByRole('button', { name: '发送协作请求', exact: true }).isEnabled(),
        'ready text composer',
      );
      const before = { admissions: turnAdmissions, dispatches };
      // Browser composition events exercise the IME guard; this is not a real-device keyboard claim.
      await input.dispatchEvent('compositionstart', { data: '中' });
      await input.dispatchEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        isComposing: true,
        keyCode: 229,
      });
      await input.dispatchEvent('compositionend', { data: '中' });
      await input.press('Enter');
      assert.equal(await input.inputValue(), prompt + '\n');
      const memory = await details('偏好与要求');
      await memory.getByLabel('名称', { exact: true }).fill('尚未确认的偏好草稿');
      await memory.getByLabel('准确内容').fill('这条草稿只用于检查关闭设置后保留输入。');
      await closeSettings();
      assert.equal(await input.inputValue(), prompt + '\n');
      await details('偏好与要求');
      assert.equal(
        await memory.getByLabel('名称', { exact: true }).inputValue(),
        '尚未确认的偏好草稿',
      );
      assert.equal(
        await memory.getByLabel('准确内容').inputValue(),
        '这条草稿只用于检查关闭设置后保留输入。',
      );
      assert.equal(turnAdmissions, before.admissions);
      assert.equal(dispatches, before.dispatches);
      await memory.getByLabel('名称', { exact: true }).fill('');
      await memory.getByLabel('准确内容').fill('');
      await details('偏好与要求', false);
      await input.fill('');
      return {
        simulatedCompositionEvents: true,
        enterAddsNewline: true,
        settingsDraftPreserved: true,
        addedAdmissions: 0,
        addedDispatches: 0,
      };
    },
  );

  await testCase('same-image-context-tabs-retain-unsent-assistant-and-keyboard-focus', async () => {
    await closeSettings();
    const input = page.getByLabel('向智能体描述修改需求');
    const draft = '切换面板时保留这条未发送要求，不触发生成。';
    await input.fill(draft);
    const inputOwner = await input.elementHandle();
    const canvasOwner = await page.locator('.image-frame canvas').elementHandle();
    assert.ok(inputOwner && canvasOwner);
    const before = {
      admissions: turnAdmissions,
      dispatches,
      version: (await head()).artwork.headVersion,
    };
    const tabs = () =>
      page
        .locator('.free-panel[aria-hidden="false"]')
        .getByRole('navigation', { name: '当前作品面板', exact: true });
    const focusedSection = (id, label) =>
      until(
        () =>
          page.evaluate(
            ({ id, label }) => {
              const active = document.activeElement;
              return (
                active?.getAttribute('aria-pressed') === 'true' &&
                active.textContent.trim() === label &&
                active.closest('.free-panel')?.getAttribute('data-panel-id') === id &&
                !active.closest('[hidden],[inert]')
              );
            },
            { id, label },
          ),
        `keyboard focus reaches the visible ${label} context`,
      );
    try {
      // A native model menu may close independently; Escape must not dismiss the
      // retained settings page as well or erase the current composer draft.
      const settings = await openSettings();
      const model = settings.getByRole('combobox', { name: '助手模型', exact: true });
      await model.click();
      await settings.getByRole('listbox', { name: '助手模型', exact: true }).waitFor();
      await model.press('Escape');
      await settings
        .getByRole('listbox', { name: '助手模型', exact: true })
        .waitFor({ state: 'hidden' });
      assert.equal(await settings.isVisible(), true);
      await closeSettings();
      assert.equal(await input.inputValue(), draft);

      const assistantTab = tabs().getByRole('button', { name: 'AI 助手', exact: true });
      await assistantTab.focus();
      await assistantTab.press('ArrowRight');
      await focusedSection('collaboration', '协作');
      await page
        .locator('.free-panel[data-panel-id="collaboration"][aria-hidden="false"]')
        .waitFor();
      assert.equal(
        await canvasOwner.evaluate(
          (node) => node.isConnected && node === document.querySelector('.image-frame canvas'),
        ),
        true,
      );
      await tabs().getByRole('button', { name: '协作', exact: true }).press('ArrowRight');
      await focusedSection('inspector', '记录');
      await page.locator('.detailed-history-list').waitFor();
      await tabs().getByRole('button', { name: '记录', exact: true }).press('Home');
      await focusedSection('inspector', '调整');
      await tabs().getByRole('button', { name: '调整', exact: true }).press('ArrowRight');
      await focusedSection('ai', 'AI 助手');
      await input.waitFor();
      assert.equal(await input.inputValue(), draft);
      assert.equal(
        await input.evaluate((node, original) => node === original, inputOwner),
        true,
        'the same textarea owns the unsent prompt after every context switch',
      );
      assert.equal(await page.locator('.live-assistant').count(), 1);
      assert.equal(
        await canvasOwner.evaluate(
          (node) => node.isConnected && node === document.querySelector('.image-frame canvas'),
        ),
        true,
      );
      assert.equal(turnAdmissions, before.admissions);
      assert.equal(dispatches, before.dispatches);
      assert.equal((await head()).artwork.headVersion, before.version);
      await page.screenshot({ path: resolve(artifacts, 'same-image-context-navigation.png') });
      await input.fill('');
      return {
        sameCanvas: true,
        retainedComposerOwner: true,
        keyboardFocusTransferred: true,
        settingsRegion: true,
        modelEscapeContained: true,
        admissions: 0,
        dispatches: 0,
      };
    } finally {
      await inputOwner.dispose();
      await canvasOwner.dispose();
    }
  });
  await testCase('assistant-task-round-trip-preserves-input-and-preference-owners', async () => {
    const input = page.getByLabel('向智能体描述修改需求');
    const assistantDraft = '保留助手的未发送要求。';
    const taskDraft = '保留生图的另一条未发送要求。';
    await input.fill(assistantDraft);
    const inputOwner = await input.elementHandle();
    const memory = await details('偏好与要求');
    const memoryName = memory.getByLabel('名称', { exact: true });
    const memoryContent = memory.getByLabel('准确内容');
    await memoryName.fill('切换任务也保留的偏好草稿');
    await memoryContent.fill('还没有确认保存，不要自动写入记忆。');
    const memoryOwner = await memoryName.elementHandle();
    assert.ok(inputOwner && memoryOwner);
    await closeSettings();
    const before = {
      admissions: turnAdmissions,
      dispatches,
      version: (await head()).artwork.headVersion,
    };
    const submissions = [];
    const watchSubmission = (request) => {
      if (
        request.method() === 'POST' &&
        /\/(jobs|assistant-turns|assistant-grants|memories)(?:\/|$)/.test(
          new URL(request.url()).pathname,
        )
      )
        submissions.push(new URL(request.url()).pathname);
    };
    page.on('request', watchSubmission);
    const selectTask = async (name) => {
      await page
        .locator('.free-panel[aria-hidden="false"]')
        .getByRole('button', { name: '切换 AI 任务', exact: true })
        .click();
      const picker = page.getByRole('dialog', { name: '选择 AI 任务', exact: true });
      await picker.getByRole('button', { name: new RegExp('^' + name) }).click();
      await picker.waitFor({ state: 'hidden' });
    };
    try {
      await selectTask('生图');
      const retained = page.locator('.live-assistant');
      assert.equal(await retained.count(), 1);
      assert.equal(await retained.getAttribute('hidden'), '');
      assert.equal(await retained.getAttribute('inert'), '');
      assert.equal(await inputOwner.evaluate((node) => node.isConnected), true);
      const taskInput = page.getByLabel('本轮创作要求', { exact: true });
      await taskInput.fill(taskDraft);
      await page.getByRole('button', { name: '任务设置', exact: true }).click();
      const settings = page.getByRole('region', { name: '任务设置', exact: true });
      await settings.waitFor();
      await settings.getByRole('combobox', { name: '生图模型', exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog', { name: '任务设置', exact: true }).count(), 0);
      await settings.getByRole('button', { name: '返回对话', exact: true }).click();
      await settings.waitFor({ state: 'hidden' });
      assert.equal(await taskInput.inputValue(), taskDraft);
      await selectTask('AI 助手');
      await input.waitFor();
      assert.equal(await input.inputValue(), assistantDraft);
      assert.equal(await input.evaluate((node, original) => node === original, inputOwner), true);
      await details('偏好与要求');
      assert.equal(await memoryName.inputValue(), '切换任务也保留的偏好草稿');
      assert.equal(await memoryContent.inputValue(), '还没有确认保存，不要自动写入记忆。');
      assert.equal(
        await memoryName.evaluate((node, original) => node === original, memoryOwner),
        true,
        'unconfirmed preference fields keep their original owner, not only the text-draft cache',
      );
      await memoryName.fill('');
      await memoryContent.fill('');
      await closeSettings();
      await selectTask('生图');
      assert.equal(await taskInput.inputValue(), taskDraft);
      await taskInput.fill('');
      await selectTask('AI 助手');
      await input.fill('');
      assert.equal(turnAdmissions, before.admissions);
      assert.equal(dispatches, before.dispatches);
      assert.equal((await head()).artwork.headVersion, before.version);
      assert.deepEqual(
        submissions,
        [],
        'changing tasks/settings cannot submit work or confirm a memory',
      );
      await page.screenshot({ path: resolve(artifacts, 'assistant-task-retained-drafts.png') });
      return {
        assistantPrompt: true,
        generationPrompt: true,
        sameComposer: true,
        samePreferenceForm: true,
        taskSettingsRegion: true,
        modelLabel: '生图模型',
        mutationSubmissions: 0,
      };
    } finally {
      page.off('request', watchSubmission);
      await inputOwner.dispose();
      await memoryOwner.dispose();
    }
  });
  await testCase('memory-confirm-correct-forget-and-source-opt-in', async () => {
    const panel = await details('偏好与要求');
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
    await details('偏好与要求', false);
    await submit('自然一点，保留人物特征。');
    await finished();
    assert.ok(JSON.stringify(bodies.at(-1)).includes('保留雀斑，局部减淡阴影'));
    assert.ok(!JSON.stringify(bodies.at(-1)).includes('始终保留雀斑与真实肤质'));
    await details('偏好与要求');
    await panel.getByRole('button', { name: '忘记', exact: true }).click();
    await until(async () => (await panel.locator('article').count()) === 0, 'forget memory');
    await details('偏好与要求', false);
    return { versionedCorrection: true, oldMemoryNotSent: true };
  });
  await testCase('default-confirm-genui-uses-real-preview-and-undo', async () => {
    const controls = await details('执行方式');
    assert.equal(
      (
        await controls.getByRole('combobox', { name: 'AI 可以做到哪一步', exact: true }).innerText()
      ).trim(),
      '预览确认',
    );
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
        await newConversation();
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
    await choose(panel, 'AI 可以做到哪一步', '只建议');
    await details('执行方式', false);
    await newConversation();
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
    await choose(controls, 'AI 可以做到哪一步', '预算内自动执行');
    await newConversation();
    const before = dispatches;
    await submit('降低曝光。');
    await page.getByRole('alert').filter({ hasText: '请先明确授权' }).waitFor();
    assert.equal(dispatches, before);
    await details('执行方式');
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
    await choose(controls, 'AI 可以做到哪一步', '预览确认');
    await details('执行方式', false);
    await newConversation();
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
    const navigationType = await page.evaluate(
      () => performance.getEntriesByType('navigation')[0]?.type,
    );
    assert.equal(navigationType, 'reload', 'Recovery must follow an actual document reload');
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
    return { navigationType, modelRequests: dispatches - before, browserRefreshAddedRequests: 0 };
  });
  await testCase('conversation-switch-isolates-history-and-candidates', async () => {
    await closeSettings();
    const history = page.getByRole('dialog', { name: '会话记录', exact: true });
    await page
      .locator('.live-assistant > .ai-workbench-header')
      .getByRole('button', { name: '会话记录', exact: true })
      .click();
    const select = history.getByRole('combobox', { name: '会话记录', exact: true });
    const before = dispatches;
    await select.click();
    const options = history.getByRole('listbox', { name: '会话记录', exact: true });
    // Mounting the popover and loading saved conversations are separate async steps.
    await options.waitFor({ state: 'visible' });
    const { active, other } = await until(
      () =>
        options.getByRole('option').evaluateAll((nodes) => {
          // The first option starts a new conversation. Existing records load on opening.
          const saved = nodes.slice(1);
          const label = (node) => node?.querySelector('.choice-option-label')?.textContent?.trim();
          const active = label(saved.find((node) => node.getAttribute('aria-selected') === 'true'));
          const other = label(saved.find((node) => node.getAttribute('aria-selected') !== 'true'));
          return active && other ? { active, other } : null;
        }),
      'active and alternate conversations are loaded in history',
    );
    await choose(history, '会话记录', other);
    await history.waitFor({ state: 'hidden' });
    await until(
      async () => (await page.locator('.assistant-messages').innerText()).length > 0,
      'selected history',
    );
    assert.ok(
      !(await page.locator('.assistant-messages').innerText()).includes('刷新页面也不要重复调用'),
    );
    await page
      .locator('.live-assistant > .ai-workbench-header')
      .getByRole('button', { name: '会话记录', exact: true })
      .click();
    await choose(history, '会话记录', active);
    await history.waitFor({ state: 'hidden' });
    await until(
      async () =>
        (await page.locator('.assistant-messages').innerText()).includes('刷新页面也不要重复调用'),
      'restored conversation',
    );
    assert.equal(dispatches, before);
    return { historyIsolation: true, readOnlySwitch: true };
  });
  await testCase(
    'active-text-request-survives-panel-hide-and-return-without-a-new-admission',
    async () => {
      await newConversation();
      firstDelta = false;
      holdCompletion = true;
      const before = {
        admissions: turnAdmissions,
        dispatches,
        version: (await head()).artwork.headVersion,
      };
      try {
        const input = page.getByLabel('向智能体描述修改需求');
        await input.fill('收起面板时继续这轮请求。');
        const admitted = page.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            new URL(response.url()).pathname.endsWith('/assistant-turns'),
        );
        await input.press('Control+Enter');
        const admission = await admitted;
        assert.equal(admission.status(), 202);
        const turn = await admission.json();
        assert.equal(typeof turn.id, 'string');
        await until(() => firstDelta, 'keyboard-submitted response in flight');
        assert.equal(
          await page
            .locator('.live-assistant')
            .getByRole('button', { name: '切换 AI 任务', exact: true })
            .isDisabled(),
          true,
          'retaining an assistant owner does not allow changing tasks during an admitted request',
        );
        // The provider enqueue precedes durable SSE delivery. Establish content
        // in the actual conversation before testing that hiding retains it.
        const incrementalReply = page
          .locator('.assistant-messages .assistant-message.assistant')
          .getByText(sentence, { exact: true });
        const partialVisible = async () =>
          (await incrementalReply.isVisible()) &&
          (await page.locator('.assistant-messages').innerText()).includes(sentence);
        await until(
          partialVisible,
          'the complete incremental assistant reply is visible before hiding',
        );
        const inFlight = await fixture.call('GET', `/v1/assistant-turns/${turn.id}`);
        assert.equal(inFlight.statusCode, 200);
        assert.equal(inFlight.json().state, 'running');
        const stop = page.getByRole('button', { name: '停止本轮执行', exact: true });
        assert.equal(await stop.isEnabled(), true);
        assert.equal(await page.locator('.live-assistant .ai-pending-strip').count(), 0);
        assert.equal(await input.isEditable(), false, 'the original request still locks sending');
        assert.equal(
          await page.getByRole('button', { name: '发送协作请求', exact: true }).isEnabled(),
          false,
        );
        const retainedOwner = await page.locator('.live-assistant').elementHandle();
        assert.ok(retainedOwner);
        await closeAIPanel();
        const banner = page.locator('.ai-activity-banner');
        await banner.getByText('AI 正在处理请求', { exact: true }).waitFor();
        assert.equal(
          await page.locator('.live-assistant').count(),
          1,
          'request owner stays mounted',
        );
        // The activity banner renders before presence commits its hidden phase,
        // including reduced motion. Wait for that same retained subtree to exit.
        const hiddenPanel = await until(async () => {
          const state = await retainedOwner.evaluate((element) => {
            const panel = element.closest('[data-panel-id="ai"]');
            const content = element.closest('.panel-content');
            return {
              ownerConnected: element.isConnected,
              panelInert: panel instanceof HTMLElement && panel.inert,
              panelAriaHidden: panel?.getAttribute('aria-hidden'),
              panelMotionPhase: panel?.getAttribute('data-motion-state'),
              contentInert: content instanceof HTMLElement && content.inert,
              contentAriaHidden: content?.getAttribute('aria-hidden'),
              contentHidden: content instanceof HTMLElement && content.hidden,
            };
          });
          return state.ownerConnected &&
            state.panelInert &&
            state.panelAriaHidden === 'true' &&
            state.panelMotionPhase === 'hidden' &&
            state.contentInert &&
            state.contentAriaHidden === 'true' &&
            state.contentHidden &&
            !(await page.locator('.live-assistant').isVisible())
            ? state
            : false;
        }, 'the retained AI panel finishes exiting and becomes hidden and inert');
        assert.equal(await page.locator('.live-assistant').count(), 1);
        assert.equal(await page.locator('.live-assistant').isVisible(), false);
        const returnButton = banner.getByRole('button', { name: '返回 AI 助手', exact: true });
        const activityGeometry = await returnButton.evaluate((button) => {
          const activity = button.closest('.ai-activity-banner');
          if (!activity) throw new Error('The return button has no activity banner');
          const rect = (element) => {
            const { x, y, width, height, top, right, bottom, left } =
              element.getBoundingClientRect();
            return { x, y, width, height, top, right, bottom, left };
          };
          const buttonRect = rect(button);
          const bannerRect = rect(activity);
          const center = {
            x: buttonRect.left + buttonRect.width / 2,
            y: buttonRect.top + buttonRect.height / 2,
          };
          const hit = document.elementFromPoint(center.x, center.y);
          const toasts = [...document.querySelectorAll('.toast')]
            .filter((toast) =>
              toast.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
            )
            .map(rect)
            .filter((toast) => toast.width > 0 && toast.height > 0);
          return {
            buttonRect,
            bannerRect,
            center,
            returnButtonHit: hit === button || button.contains(hit),
            toastPresent: toasts.length > 0,
            toastRects: toasts,
            visibleToastsDoNotOverlap: toasts.every(
              (toast) =>
                toast.top >= bannerRect.bottom ||
                toast.bottom <= bannerRect.top ||
                toast.left >= bannerRect.right ||
                toast.right <= bannerRect.left,
            ),
          };
        });
        assert.ok(activityGeometry.returnButtonHit, 'the activity return button is not covered');
        if (activityGeometry.toastPresent)
          assert.ok(
            activityGeometry.visibleToastsDoNotOverlap,
            'actual visible notifications do not overlap the activity banner',
          );
        await returnButton.click();
        await stop.waitFor();
        await until(
          partialVisible,
          'the retained incremental assistant reply is visible after returning',
        );
        assert.ok((await page.locator('.assistant-messages').innerText()).includes(sentence));
        assert.equal(
          await retainedOwner.evaluate((element) => element.isConnected),
          true,
          'returning preserves the original request-owner subtree',
        );
        await retainedOwner.dispose();
        assert.equal(await stop.isEnabled(), true);
        assert.equal(await page.locator('.live-assistant .ai-pending-strip').count(), 0);
        assert.equal(turnAdmissions, before.admissions + 1);
        assert.equal(dispatches, before.dispatches + 2);
        holdCompletion = false;
        await finished();
        assert.equal((await head()).artwork.headVersion, before.version);
        return {
          keyboardSubmit: true,
          visibleReplyBeforeHide: true,
          retainedReplyAfterReturn: true,
          knownRunningRequestWithoutDuplicateRecovery: true,
          retainedMountedOwner: true,
          hiddenPanel,
          activityGeometry,
          admissions: 1,
          fixtureDispatches: 2,
          persistedWrite: false,
        };
      } finally {
        holdCompletion = false;
      }
    },
  );
  await testCase('late-applied-receipt-preserves-an-unsaved-document-and-its-view', async () => {
    await newConversation();
    const controls = await details('执行方式');
    const revoke = controls.getByRole('button', { name: '停止授权', exact: true });
    const policy = controls.getByRole('combobox', { name: 'AI 可以做到哪一步', exact: true });
    await until(
      async () =>
        (await revoke.isVisible()) || ((await policy.isVisible()) && (await policy.isEnabled())),
      'execution settings open with the current grant state',
    );
    if (await revoke.isVisible()) {
      await revoke.click();
      await revoke.waitFor({ state: 'hidden' });
    }
    await choose(controls, 'AI 可以做到哪一步', '预算内自动执行');
    await controls.getByLabel('最多操作次数').fill('2');
    await controls
      .getByRole('button', { name: '授权当前项目，30 分钟内有效', exact: true })
      .click();
    await controls.getByRole('button', { name: '停止授权', exact: true }).waitFor();
    await details('执行方式', false);
    const before = {
      admissions: turnAdmissions,
      dispatches,
      version: (await head()).artwork.headVersion,
    };
    const title = 'AI 回执期间的文档草稿';
    const body = '先写下这段项目说明。\nAI 的版本回执不能带走这个页面，也不能覆盖未保存的文字。';
    fixtureExposure = -1.75;
    firstDelta = false;
    holdCompletion = true;
    try {
      const admitted = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith('/assistant-turns'),
      );
      await submit('在授权预算内调整曝光，我会在等待期间继续写项目文档。');
      const admission = await admitted;
      assert.equal(admission.status(), 202);
      const turn = await admission.json();
      assert.equal(typeof turn.id, 'string');
      await until(() => firstDelta, 'automatic result is held before its completion receipt');
      await changeView('docs', '文档');
      await page
        .locator('.document-list')
        .getByRole('button', { name: '新建文档', exact: true })
        .click();
      const documentTitle = page.getByLabel('文档标题', { exact: true });
      const documentBody = page.getByLabel('文档内容', { exact: true });
      await documentTitle.fill(title);
      await documentBody.fill(body);
      await page.locator('.document-save-state.is-dirty').waitFor();
      const banner = page.locator('.ai-activity-banner');
      await banner.getByText('AI 正在处理请求', { exact: true }).waitFor();
      assert.equal(await page.locator('.live-assistant').count(), 1);
      assert.equal(await page.locator('.live-assistant').isVisible(), false);
      assert.equal(turnAdmissions, before.admissions + 1);
      assert.equal(dispatches, before.dispatches + 2);
      holdCompletion = false;
      await until(
        async () => (await head()).artwork.headVersion === before.version + 1,
        'the real backend applies exactly one authorized revision',
      );
      await page
        .getByText('云端已采用AI结果，当前本地草稿继续保留，可稍后从作品中打开。', { exact: true })
        .waitFor();
      await banner.waitFor({ state: 'hidden' });
      assert.equal(await documentTitle.isVisible(), true, 'the receipt does not leave documents');
      assert.equal(await documentTitle.inputValue(), title);
      assert.equal(await documentBody.inputValue(), body);
      assert.equal(await page.locator('.document-save-state.is-dirty').count(), 1);
      assert.equal(await page.getByRole('dialog', { name: '确认操作', exact: true }).count(), 0);
      const settled = await fixture.call('GET', `/v1/assistant-turns/${turn.id}`);
      assert.equal(settled.statusCode, 200, settled.body);
      assert.equal(settled.json().state, 'completed');
      assert.equal(settled.json().output.execution.state, 'applied');
      assert.equal(settled.json().output.execution.artworkId, fixture.artwork.artwork.id);
      const documents = await fixture.call('GET', `/v1/projects/${fixture.projectId}/documents`);
      assert.equal(documents.statusCode, 200, documents.body);
      assert.ok(
        !documents.json().documents.some((item) => item.title === title),
        'the local draft is not silently saved',
      );
      assert.equal(turnAdmissions, before.admissions + 1);
      assert.equal(dispatches, before.dispatches + 2);
      await page.screenshot({ path: resolve(artifacts, 'late-ai-receipt-document-draft.png') });
      await page.getByRole('button', { name: '保存文档', exact: true }).click();
      await until(
        async () => (await page.locator('.document-save-state').innerText()) === '已保存',
        'explicit document save for clean test continuation',
      );
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      await openProject(page);
      return {
        protocol: 'real HTTP, SSE and PostgreSQL with the existing local provider fixture',
        backendExecution: 'applied',
        exactRevisionWrites: 1,
        explicitAdmissions: 1,
        fixtureDispatches: 2,
        stayedInDocuments: true,
        unsavedDraftPreserved: true,
        silentlySavedDocument: false,
      };
    } finally {
      holdCompletion = false;
      fixtureExposure = -1.5;
    }
  });
  await testCase('suggested-memory-requires-review-expiry-and-version-history', async () => {
    await newConversation();
    const before = (
      await fixture.db.query(
        'SELECT count(*)::int AS n FROM assistant_memories WHERE owner_id=$1',
        [fixture.actors.owner.id],
      )
    ).rows[0].n;
    await submit('请记住：这个项目每次都保留主体五官。');
    await finished();
    const panel = await details('偏好与要求');
    await panel.getByRole('button', { name: '检查内容与范围', exact: true }).click();
    assert.equal(
      (await panel.getByRole('combobox', { name: '生效范围', exact: true }).innerText()).trim(),
      '当前项目',
    );
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
    await details('偏好与要求', false);
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
    const admissionResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith('/assistant-turns'),
    );
    await submit('这是私有项目描述，请根据公开图片提供参考。');
    const admitted = await admissionResponse;
    assert.equal(admitted.status(), 202);
    const turn = await admitted.json();
    assert.deepEqual(admitted.request().postDataJSON().research, [
      { kind: 'cloud', query: '湖面参考', limit: 8 },
    ]);
    const evidence = page
      .locator('.assistant-search-evidence')
      .filter({
        has: page.getByRole('link', { name: '来源网页', exact: true }),
      })
      .last();
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
    await until(async () => {
      const result = await fixture.call('GET', `/v1/assistant-turns/${turn.id}`);
      assert.equal(result.statusCode, 200, result.body);
      return result.json().state === 'completed';
    }, 'research turn has settled');
    const graph = page.locator('.assistant-research-graph');
    const graphSummary = graph.locator(':scope > summary');
    await graphSummary.locator('small[data-state="completed"]').waitFor();
    assert.equal(await graphSummary.locator('small').innerText(), '完成');
    if ((await graphSummary.getAttribute('aria-expanded')) !== 'true') await graphSummary.click();
    await graph.getByText('公开来源', { exact: true }).waitFor();
    await graph.getByText('授权素材', { exact: true }).waitFor();
    await graph.getByText(/2 个分支汇合/).waitFor();
    const branches = await fixture.call('GET', `/v1/assistant-turns/${turn.id}/branches`);
    assert.equal(branches.statusCode, 200, branches.body);
    assert.equal(branches.json().turnId, turn.id);
    assert.equal(branches.json().state, 'completed');
    assert.equal(
      branches.json().branches.find((branch) => branch.kind === 'merge').state,
      'completed',
    );
    assert.deepEqual(
      branches
        .json()
        .branches.filter((branch) => ['web', 'cloud'].includes(branch.kind))
        .map((branch) => branch.kind)
        .sort(),
      ['cloud', 'web'],
    );
    await graph.screenshot({ path: resolve(artifacts, 'research-graph.png') });
    await evidence.screenshot({ path: resolve(artifacts, 'cloud-public-search.png') });
    await details('共享范围');
    await (await details('本轮分工')).getByLabel('在已授权空间检索素材').clear();
    await scope.getByRole('button', { name: '移出参考', exact: true }).click();
    await scope.getByLabel('允许公开网络检索，保留来源链接').uncheck();
    await details('共享范围', false);
    const billing = await page.context().newPage();
    let usagePresentation;
    billing.on('pageerror', (error) => report.pageErrors.push(String(error)));
    try {
      await selectProject(billing);
      const usageResponse = billing.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          response.request().method() === 'GET' &&
          url.pathname === '/v1/usage' &&
          url.searchParams.get('scope') === 'space' &&
          url.searchParams.get('spaceId') === fixture.teamId &&
          !url.searchParams.has('cursor')
        );
      });
      await billing
        .getByRole('navigation', { name: '工作视图', exact: true })
        .getByRole('button', { name: '用量', exact: true })
        .click();
      const usage = await usageResponse;
      assert.equal(usage.status(), 200);
      const ledger = await usage.json();
      assert.equal(ledger.scope, 'space');
      assert.ok(ledger.entries.every((row) => row.spaceId === fixture.teamId));
      const entry = ledger.entries.find((row) => row.jobId === turn.id);
      assert.ok(entry, 'the actual usage response links this research turn to a ledger record');
      assert.equal(entry.actorId, fixture.actors.owner.id);
      assert.equal(entry.spaceId, fixture.teamId);
      assert.equal(entry.operation, 'assistant-turn');
      const river = billing.getByRole('region', { name: '预占与结算变化', exact: true });
      await river.waitFor();
      assert.deepEqual(
        await river
          .locator('figure[data-kind]')
          .evaluateAll((figures) => figures.map((figure) => figure.dataset.kind)),
        ['held', 'consumed', 'released', 'expired'],
      );
      const lanes = river.getByRole('slider');
      assert.equal(await lanes.count(), 4);
      await lanes.first().press('Home');
      for (const lane of await lanes.all()) {
        assert.equal(await lane.getAttribute('aria-valuenow'), '1');
        assert.ok(await lane.getAttribute('aria-valuetext'));
      }
      await billing.getByRole('button', { name: `展开记录 ${entry.id}`, exact: true }).click();
      const ledgerDetail = billing.locator('.usage-detail-inner');
      await ledgerDetail.getByText(turn.id, { exact: true }).waitFor();
      const jobResponse = billing.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname === `/v1/usage/jobs/${turn.id}`,
      );
      await ledgerDetail.getByRole('button', { name: '查看任务调用与费用', exact: true }).click();
      const receipt = await jobResponse;
      assert.equal(receipt.status(), 200);
      const detail = await receipt.json();
      assert.equal(detail.jobId, turn.id);
      assert.equal(detail.actorId, fixture.actors.owner.id);
      assert.equal(detail.spaceId, fixture.teamId);
      assert.equal(detail.holdId, entry.holdId);
      assert.equal(detail.state, 'completed');
      const webStage = detail.stages.find((stage) => stage.purpose === 'web-search');
      assert.ok(webStage, 'the actual task receipt contains the public-search provider stage');
      assert.equal(webStage.status, 'received');
      assert.deepEqual(webStage.totals, { input: 50, output: 20, total: 70 });
      const webBranch = branches.json().branches.find((branch) => branch.kind === 'web');
      assert.equal(webStage.branchId, webBranch.id);
      const job = billing.getByRole('dialog', { name: '任务调用与费用', exact: true });
      const distribution = job.getByRole('region', {
        name: '研究分支的已记录 token 分布',
        exact: true,
      });
      await distribution.getByText(`分支 ${webBranch.id}`, { exact: true }).waitFor();
      const stage = job
        .getByRole('region', { name: '模型调用阶段', exact: true })
        .locator('.usage-stage')
        .filter({ has: billing.getByText('公开检索', { exact: true }) });
      const stageSummary = stage.locator(':scope > summary');
      await stageSummary.getByText('70 token', { exact: true }).waitFor();
      await stageSummary.getByText('已收到回执', { exact: true }).waitFor();
      if ((await stageSummary.getAttribute('aria-expanded')) !== 'true') await stageSummary.click();
      assert.deepEqual(await stage.locator('.usage-token-totals dd').allTextContents(), [
        '50',
        '20',
        '70',
      ]);
      await stage.getByRole('table', { name: '回执计量项', exact: true }).waitFor();
      await job.screenshot({ path: resolve(artifacts, 'task-model-ledger.png') });
      usagePresentation = await runUsagePresentationChecks({ page: billing, until, artifacts });
    } finally {
      await billing.close();
    }
    return {
      protectedThumbnail: true,
      explicitPublicQuery: true,
      publicSourceLink: true,
      mergedBranches: 2,
      meteredTaskFromLedger: true,
      usagePresentation,
    };
  });
  await testCase('stop-in-flight-hides-partial-result-and-survives-refresh', async () => {
    async function submitAdmittedTurn(prompt) {
      const response = page.waitForResponse(
        (result) =>
          result.request().method() === 'POST' &&
          new URL(result.url()).pathname.endsWith('/assistant-turns'),
      );
      await submit(prompt);
      const accepted = await response;
      assert.equal(accepted.status(), 202);
      const turn = await accepted.json();
      assert.equal(typeof turn.id, 'string');
      return turn;
    }
    await newConversation();
    firstDelta = false;
    holdCompletion = true;
    const original = await head();
    const before = dispatches;
    const stoppedTurn = await submitAdmittedTurn('停止后不要应用这项编辑。');
    await until(() => firstDelta, 'request in flight');
    const stopResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `/v1/assistant-turns/${stoppedTurn.id}/stop`,
    );
    await page.getByRole('button', { name: '停止本轮执行', exact: true }).click();
    await page.getByRole('button', { name: '正在核对停止结果', exact: true }).waitFor();
    const stopAccepted = await stopResponse;
    assert.equal(stopAccepted.status(), 200);
    const stopReceipt = await stopAccepted.json();
    assert.equal(stopReceipt.id, stoppedTurn.id);
    assert.equal(
      stopReceipt.stopRequested,
      true,
      'the stop is durable before completing the fixture',
    );
    holdCompletion = false;
    await until(
      async () => (await page.locator('.assistant-messages').innerText()).includes('本轮已停止'),
      'durable stop status',
    );
    const artworkId = fixture.artwork.artwork.id;
    const activeSessions = () =>
      fixture.db
        .query(
          'SELECT id,user_id FROM collaboration_sessions WHERE artwork_id=$1 AND expires_at>clock_timestamp()',
          [artworkId],
        )
        .then(({ rows }) => rows);
    const oldOwnerIds = new Set(
      (await activeSessions())
        .filter((row) => row.user_id === fixture.actors.owner.id)
        .map((row) => row.id),
    );
    assert.ok(oldOwnerIds.size > 0);
    const endpoint = `/v1/artworks/${artworkId}/collaboration/sessions`;
    const peer = await fixture.call('POST', endpoint, { clientId: randomUUID() }, 'editor');
    assert.equal(peer.statusCode, 201, peer.body);
    const peerId = peer.json().session.id;
    try {
      await openProject(page, false);
      await until(async () => {
        const sessions = await activeSessions();
        return (
          sessions.some((row) => row.id === peerId) &&
          sessions.filter((row) => row.user_id === fixture.actors.owner.id).length === 1 &&
          sessions.every((row) => !oldOwnerIds.has(row.id))
        );
      }, 'reloading releases the old owner session and preserves the independent editor');
    } finally {
      await fixture.call('DELETE', `${endpoint}/${peerId}`, undefined, 'editor');
    }
    await until(
      async () => (await page.locator('.assistant-messages').innerText()).includes('本轮已停止'),
      'restored stop status',
    );
    assert.equal(dispatches, before + 2);
    assert.equal((await head()).artwork.headVersion, original.artwork.headVersion);
    assert.ok(!(await page.locator('.assistant-messages').innerText()).includes(sentence));

    // Preserve the original stop/reload checks above. These two additional
    // explicitly admitted turns exercise a late real stop receipt in the same
    // mounted assistant, including the history-restored observer path.
    const isolationBefore = { dispatches, admissions: turnAdmissions };
    let releaseStopReply;
    const stopReplyGate = new Promise((resolve) => {
      releaseStopReply = resolve;
    });
    let routeFinished;
    const stopRouteDone = new Promise((resolve) => {
      routeFinished = resolve;
    });
    let routeStarted = false;
    let actualStopReceipt = null;
    let stopUrl;
    const holdStopReply = async (route) => {
      routeStarted = true;
      try {
        assert.equal(route.request().method(), 'POST');
        const response = await route.fetch();
        actualStopReceipt = { status: response.status(), body: await response.json() };
        await stopReplyGate;
        await route.fulfill({ response });
      } catch (error) {
        actualStopReceipt = { error };
        await route.abort().catch(() => {});
      } finally {
        routeFinished();
      }
    };
    let lateReplyIsolation;
    try {
      await newConversation();
      firstDelta = false;
      holdCompletion = true;
      const delayedTurn = await submitAdmittedTurn('这轮从会话恢复后停止，用于核对停止回执。');
      await until(() => firstDelta, 'the restored-stop fixture is in flight');
      await openProject(page, false);
      const partial = page.locator('.assistant-messages').getByText(sentence, { exact: true });
      await until(
        () => partial.isVisible(),
        'the running turn is restored from actual stream events',
      );
      const stop = page.getByRole('button', { name: '停止本轮执行', exact: true });
      assert.equal(await stop.isEnabled(), true);
      assert.equal(turnAdmissions, isolationBefore.admissions + 1);
      assert.equal(dispatches, isolationBefore.dispatches + 2);

      stopUrl = `${origin}/v1/assistant-turns/${delayedTurn.id}/stop`;
      await page.route(stopUrl, holdStopReply);
      await stop.click();
      await until(() => actualStopReceipt, 'the real matching stop POST has returned from the API');
      if (actualStopReceipt.error) throw actualStopReceipt.error;
      assert.equal(actualStopReceipt.status, 200);
      assert.equal(actualStopReceipt.body.id, delayedTurn.id);
      assert.equal(actualStopReceipt.body.stopRequested, true);
      // Only browser delivery of this successful API receipt is held. Provider
      // data is unchanged; the original fixture may finish after the durable stop.
      holdCompletion = false;
      await until(
        async () => (await page.locator('.assistant-messages').innerText()).includes('本轮已停止'),
        'the restored observer receives the stopped turn before its delayed HTTP receipt',
      );
      const stopped = await fixture.call('GET', `/v1/assistant-turns/${delayedTurn.id}`);
      assert.equal(stopped.statusCode, 200);
      assert.notEqual(stopped.json().state, 'running');
      assert.equal(stopped.json().stopRequested, true);

      await newConversation();
      firstDelta = false;
      holdCompletion = true;
      const nextTurn = await submitAdmittedTurn('继续新的预览协作，不要沿用上一轮的停止状态。');
      assert.notEqual(nextTurn.id, delayedTurn.id);
      await until(
        () => partial.isVisible(),
        'the next same-scope turn has actual incremental text',
      );
      const progress = await page.locator('.assistant-tool-status').innerText();
      assert.ok(!progress.includes('已停止') && !progress.includes('停止请求'));
      assert.equal(await stop.isEnabled(), true);
      const nextBeforeReply = await fixture.call('GET', `/v1/assistant-turns/${nextTurn.id}`);
      assert.equal(nextBeforeReply.statusCode, 200);
      assert.equal(nextBeforeReply.json().state, 'running');
      assert.equal(nextBeforeReply.json().stopRequested, false);

      const deliveredReply = page.waitForResponse(
        (response) => response.request().method() === 'POST' && response.url() === stopUrl,
      );
      releaseStopReply();
      const delivered = await deliveredReply;
      assert.equal(delivered.status(), 200);
      assert.deepEqual(await delivered.json(), actualStopReceipt.body);
      await delivered.finished();
      await stopRouteDone;
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      assert.equal(
        await page.locator('.assistant-tool-status').innerText(),
        progress,
        'the old successful stop receipt cannot overwrite the next turn progress',
      );
      assert.equal(await stop.isEnabled(), true, 'the next turn retains its own stop control');
      assert.equal(await partial.isVisible(), true);
      assert.equal(await page.locator('.live-assistant .assistant-error').count(), 0);
      const nextAfterReply = await fixture.call('GET', `/v1/assistant-turns/${nextTurn.id}`);
      assert.equal(nextAfterReply.statusCode, 200);
      assert.equal(nextAfterReply.json().state, 'running');
      assert.equal(nextAfterReply.json().stopRequested, false);
      await page.screenshot({ path: resolve(artifacts, 'late-stop-receipt-isolation.png') });
      holdCompletion = false;
      await finished();
      assert.equal(turnAdmissions, isolationBefore.admissions + 2);
      assert.equal(dispatches, isolationBefore.dispatches + 4);
      assert.equal((await head()).artwork.headVersion, original.artwork.headVersion);
      lateReplyIsolation = {
        restoredRunningObserverStopped: true,
        realStopReceiptDeferred: true,
        nextRunningTurnUnaffected: true,
        explicitAdmissions: 2,
        fixtureDispatches: 4,
      };
    } finally {
      holdCompletion = false;
      releaseStopReply();
      if (stopUrl) await page.unroute(stopUrl, holdStopReply);
      if (routeStarted) await stopRouteDone;
    }
    return {
      stoppedDuringProviderRound: true,
      noExtraDispatch: true,
      savedVersionUnchanged: true,
      reloadReleasedOldSessionAndKeptPeer: true,
      lateReplyIsolation,
    };
  });
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
    { width: 320, height: 700 },
    { width: 320, height: 568 },
    { width: 728, height: 900 },
    { width: 844, height: 390 },
  ]) {
    await testCase(`assistant-controls-${viewport.width}x${viewport.height}`, async () => {
      await page.setViewportSize(viewport);
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
      const notice = page.getByRole('button', { name: '关闭提示', exact: true });
      if (await notice.count()) await notice.click();
      await closeSettings();
      await page.getByLabel('向智能体描述修改需求').waitFor();
      const readableReply = page
        .locator('.live-assistant:not([hidden]) .assistant-message.assistant')
        .last();
      await readableReply.scrollIntoViewIfNeeded();
      const geometry = await page.evaluate(() => {
        const box = (selector) => {
          const node = document.querySelector(selector);
          const r = node?.getBoundingClientRect();
          const hit = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r
            ? {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                bottom: r.bottom,
                right: r.right,
                centerExposed: !!hit && node.contains(hit),
              }
            : null;
        };
        const conversationNode = document.querySelector(
          '.live-assistant:not([hidden]) > .ai-conversation-body',
        );
        const replyNode = [
          ...document.querySelectorAll(
            '.live-assistant:not([hidden]) .assistant-message.assistant',
          ),
        ].at(-1);
        const conversationBox = conversationNode?.getBoundingClientRect();
        const replyBox = replyNode?.getBoundingClientRect();
        return {
          width: innerWidth,
          overflow: document.documentElement.scrollWidth,
          composer: box('.assistant-composer'),
          input: box('.assistant-composer textarea'),
          send: box('.assistant-composer .ai-send-button'),
          toolbar: box('.assistant-composer .ai-composer-toolbar'),
          close: box('.ai-workbench-header .ai-panel-close'),
          panel: box('.ai-workbench'),
          conversation: box('.live-assistant:not([hidden]) > .ai-conversation-body'),
          reply:
            replyBox && conversationBox
              ? {
                  text: replyNode.textContent.trim(),
                  height: replyBox.height,
                  visibleHeight: Math.max(
                    0,
                    Math.min(replyBox.bottom, conversationBox.bottom) -
                      Math.max(replyBox.top, conversationBox.top),
                  ),
                }
              : null,
          canvas: box('.canvas-photo-frame'),
          inputFontSize: parseFloat(
            getComputedStyle(document.querySelector('.assistant-composer textarea')).fontSize,
          ),
        };
      });
      (report.measurements ??= []).push(geometry);
      console.log(JSON.stringify({ assistantGeometry: geometry }));
      assert.ok(geometry.overflow <= viewport.width + 1, 'no page horizontal overflow');
      assert.ok(
        geometry.conversation?.height >= 64 && geometry.conversation.centerExposed,
        'the conversation keeps at least 64px of exposed reading space',
      );
      assert.ok(
        geometry.reply?.text &&
          geometry.reply.visibleHeight >= Math.min(64, geometry.reply.height) - 1,
        'a submitted reply is readable inside that space, including a whole shorter reply',
      );
      assert.ok(
        geometry.composer &&
          geometry.composer.x >= 0 &&
          geometry.composer.right <= viewport.width + 1,
      );
      assert.ok(
        geometry.panel &&
          geometry.composer.bottom <= geometry.panel.bottom + 1 &&
          geometry.composer.bottom <= viewport.height + 1,
        'composer remains inside the visible panel without scrolling its ancestors',
      );
      for (const name of ['input', 'send']) {
        const control = geometry[name];
        assert.ok(
          control &&
            control.centerExposed &&
            control.x >= geometry.panel.x &&
            control.right <= geometry.panel.right + 1 &&
            control.y >= geometry.panel.y &&
            control.bottom <= geometry.panel.bottom + 1,
          `${name} is exposed inside the panel`,
        );
      }
      assert.ok(
        geometry.send.height >= (viewport.width < 700 ? 40 : 36),
        'send keeps its touch target',
      );
      if (viewport.width < 760) {
        assert.ok(geometry.inputFontSize >= 16, 'phone input avoids focus zoom');
        assert.ok(
          geometry.close?.centerExposed && geometry.close.height >= 32,
          'the condensed phone header retains its visible close action',
        );
      }
      await page.screenshot({
        path: resolve(artifacts, `assistant-${viewport.width}x${viewport.height}.png`),
      });
      if ((viewport.width === 320 && viewport.height === 568) || viewport.width === 844) {
        const before = { admissions: turnAdmissions, dispatches };
        const input = page.getByLabel('向智能体描述修改需求');
        const originalValue = await input.inputValue();
        const owner = await input.elementHandle();
        const draft = '展开后保留这条未发送的要求。\n保留当前照片，不要提交。';
        await input.fill(draft);
        await page.getByRole('button', { name: '展开编写', exact: true }).click();
        assert.equal(await input.inputValue(), draft);
        assert.equal(await input.evaluate((node, original) => node === original, owner), true);
        const expanded = await input.boundingBox();
        assert.ok(
          expanded && expanded.height > geometry.input.height,
          'expanded writing gives the same input more room',
        );
        await page.screenshot({
          path: resolve(
            artifacts,
            `assistant-compose-expanded-${viewport.width}x${viewport.height}.png`,
          ),
        });
        await page.getByRole('button', { name: '返回对话', exact: true }).click();
        assert.equal(await input.inputValue(), draft);
        assert.equal(await input.evaluate((node, original) => node === original, owner), true);
        const conversation = await page
          .locator('.live-assistant:not([hidden]) > .ai-conversation-body')
          .boundingBox();
        assert.ok(
          conversation && conversation.height >= 64,
          'returning from writing restores the readable conversation',
        );
        assert.equal(turnAdmissions, before.admissions);
        assert.equal(dispatches, before.dispatches);
        await input.fill(originalValue);
        await owner.dispose();
      }
      if (viewport.width === 390) {
        const before = { admissions: turnAdmissions, dispatches };
        const settings = await openSettings();
        const model = settings.getByRole('combobox', { name: '助手模型', exact: true });
        assert.equal(
          await model.isDisabled(),
          true,
          'the existing execution authorization keeps its model frozen',
        );
        await page.screenshot({
          path: resolve(artifacts, 'assistant-settings-locked-390x844.png'),
        });
        const execution = await details('执行方式');
        const revoke = execution.getByRole('button', { name: '停止授权', exact: true });
        await revoke.waitFor();
        const revoked = page.waitForResponse(
          (response) =>
            response.request().method() === 'DELETE' &&
            /^\/v1\/assistant-grants\/[^/]+$/.test(new URL(response.url()).pathname),
        );
        await revoke.click();
        const revokeResponse = await revoked;
        assert.equal(revokeResponse.status(), 200);
        assert.deepEqual(await revokeResponse.json(), { ok: true });
        await until(() => model.isEnabled(), 'revoking the authorization unlocks its model');
        await model.click();
        const models = settings.getByRole('listbox', { name: '助手模型', exact: true });
        await models.waitFor();
        await until(
          async () => (await models.getAttribute('data-motion-state')) === 'idle',
          'the model menu finishes its actual entry motion',
        );
        const menuGeometry = await models.evaluate((menu) => {
          const selected = menu.querySelector('[role="option"][aria-selected="true"]');
          const box = menu.getBoundingClientRect();
          const row = selected?.getBoundingClientRect();
          const hit =
            row && document.elementFromPoint(row.x + row.width / 2, row.y + row.height / 2);
          return {
            menu: { x: box.x, y: box.y, right: box.right, bottom: box.bottom },
            selected: row
              ? {
                  width: row.width,
                  height: row.height,
                  text: selected.textContent.trim(),
                  centerExposed: !!hit && selected.contains(hit),
                }
              : null,
            popoverOpen: menu.matches(':popover-open'),
          };
        });
        assert.ok(menuGeometry.popoverOpen && menuGeometry.selected?.centerExposed);
        assert.ok(menuGeometry.selected.height >= 40 && menuGeometry.selected.text);
        assert.ok(
          menuGeometry.menu.x >= 0 &&
            menuGeometry.menu.right <= viewport.width + 1 &&
            menuGeometry.menu.y >= 0 &&
            menuGeometry.menu.bottom <= viewport.height + 1,
          'the settled model menu and selected row are exposed inside the viewport',
        );
        await page.screenshot({ path: resolve(artifacts, 'assistant-settings-390x844.png') });
        await page.keyboard.press('Escape');
        await closeSettings();
        assert.equal(turnAdmissions, before.admissions);
        assert.equal(dispatches, before.dispatches);
        geometry.modelSettings = {
          lockedWhileAuthorized: true,
          unlockedAfterExplicitRevocation: true,
          expectedRevocations: 1,
          addedAdmissions: 0,
          addedDispatches: 0,
          menuGeometry,
        };
      }
      if (viewport.width === 320 && viewport.height === 568) {
        const before = { admissions: turnAdmissions, dispatches };
        const selectTask = async (name) => {
          await page
            .locator('.free-panel[aria-hidden="false"]')
            .getByRole('button', { name: '切换 AI 任务', exact: true })
            .click();
          const picker = page.getByRole('dialog', { name: '选择 AI 任务', exact: true });
          await picker.getByRole('button', { name: new RegExp('^' + name) }).click();
          await picker.waitFor({ state: 'hidden' });
        };
        await selectTask('生图');
        await page.getByRole('button', { name: '任务设置', exact: true }).click();
        const settings = page.getByRole('region', { name: '任务设置', exact: true });
        const model = settings.getByRole('combobox', { name: '生图模型', exact: true });
        await model.waitFor();
        assert.equal(
          await model.isDisabled(),
          true,
          'the actual empty model catalog stays disabled',
        );
        await settings.getByRole('button', { name: '展开面板', exact: true }).click();
        await settings.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: '任务设置', exact: true }).click();
        await settings.waitFor();
        await settings.locator('.ai-model-empty').scrollIntoViewIfNeeded();
        const taskSettingsGeometry = await settings.evaluate((region) => {
          const elements = {
            model: region.querySelector('[role="combobox"]'),
            empty: region.querySelector('.ai-model-empty'),
            back: region.querySelector('.ai-settings-page-header button'),
          };
          return Object.fromEntries(
            Object.entries(elements).map(([name, node]) => {
              const box = node?.getBoundingClientRect();
              const hit =
                box && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
              return [
                name,
                box
                  ? {
                      x: box.x,
                      y: box.y,
                      right: box.right,
                      bottom: box.bottom,
                      text: node.textContent.trim(),
                      centerExposed: !!hit && node.contains(hit),
                    }
                  : null,
              ];
            }),
          );
        });
        for (const [name, control] of Object.entries(taskSettingsGeometry)) {
          assert.ok(
            control?.centerExposed &&
              control.text &&
              control.x >= 0 &&
              control.right <= viewport.width + 1 &&
              control.y >= 0 &&
              control.bottom <= viewport.height + 1,
            `${name} is readable in the expanded task settings`,
          );
        }
        await page.screenshot({ path: resolve(artifacts, 'task-settings-320x568.png') });
        await settings.getByRole('button', { name: '恢复面板', exact: true }).click();
        await settings.waitFor({ state: 'hidden' });
        await selectTask('AI 助手');
        assert.equal(turnAdmissions, before.admissions);
        assert.equal(dispatches, before.dispatches);
        geometry.taskSettings = {
          expandedThroughUI: true,
          emptyCatalog: true,
          ...taskSettingsGeometry,
        };
      }
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
    await page.goto(`${origin}/#/studio`);
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
  report.turnAdmissions = turnAdmissions;
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await vite?.close();
  await fixture?.close();
}
