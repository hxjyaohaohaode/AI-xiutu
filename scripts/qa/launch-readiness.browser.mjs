
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { preview } from 'vite';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.ts';

if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production')
  throw new Error('Isolated QA only.');
process.env.NODE_ENV = 'test';
const database = process.env.TEST_DATABASE_URL;
assert.match(new URL(database).pathname, /test/);
const port = Number(process.env.LAUNCH_BROWSER_PORT ?? 4188);
const origin = 'http://127.0.0.1:' + port;
const out = resolve(process.env.BROWSER_ARTIFACT_DIR ?? 'artifacts/launch-browser');
await mkdir(out, { recursive: true });
const hash = (value) => createHash('sha256').update(value).digest('hex');
const moderator = {
  configured: true, async check(value) { return { decision: 'passed', inputHash: hash(value), requestId: 'test' }; },
};
const sample = { name: 'smile-headshot.png', mimeType: 'image/png',
  buffer: await sharp(resolve('scripts/qa/fixtures/portrait/smile-headshot.jpg')).resize({ width: 960 }).png().toBuffer() };
const requests = [];
const result = { cases: [], errors: [], browser: '' };
const fixture = await collaborationFixture(database, {
  origin,
  assistant: {
    env: { NODE_ENV: 'test', OPENAI_API_KEY: 'test-fixture-only', AI_ASSISTANT_ENABLED: 'true' },
    textModerator: moderator, imageModerator: moderator,
    fetcher: async (_url, opts) => {
      requests.push(JSON.parse(String(opts.body)));
      return new Response(JSON.stringify({ status: 'completed', service_tier: 'flex',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"answer":"浏览器验收完成"}' }] }],
        usage: { input_tokens: 32, output_tokens: 12, total_tokens: 44 },
      }), { headers: { 'content-type': 'application/json' } });
    },
  },
});
let browser, server;
async function pageFor(actor, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2,
    hasTouch: viewport.width <= 900, locale: 'zh-CN', reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'xiutu_session', value: fixture.actors[actor].cookie.split('=')[1], url: origin }]);
  const page = await context.newPage();
  page.on('pageerror', (error) => result.errors.push(String(error)));
  await page.goto(origin + '/#/studio');
  await page.getByRole('button', { name: '打开空间与项目', exact: true }).waitFor();
  return page;
}
async function take(page, filename) { await page.screenshot({ path: resolve(out, filename + '.png') }); }
async function works(page) {
  const desktop = page.locator('button[data-view="works"]:visible');
  if (await desktop.count()) await desktop.first().click();
  else {
    await page.locator('.mobile-view-trigger:visible').click();
    await page.locator('button[data-view="works"]:visible').first().click();
  }
  await page.locator('.workspace-library-view:visible').waitFor();
}
async function selectView(page, id) {
  const direct = page.locator('button[data-view="' + id + '"]:visible');
  if (await direct.count()) await direct.first().click();
  else {
    const menu = page.locator('.mobile-view-trigger:visible, .workspace-view-menu-trigger:visible').first();
    await menu.click();
    await page.locator('button[data-view="' + id + '"]:visible').first().click();
  }
}
async function toast(page, text, auto = true) {
  const notice = page.locator('.toast:not([aria-hidden="true"])', { hasText: text });
  await notice.waitFor({ timeout: 3000 });
  const bar = notice.locator('.toast-countdown');
  await bar.waitFor();
  if (auto) {
    const from = await bar.evaluate((node) => getComputedStyle(node).transform);
    await page.waitForTimeout(400);
    assert.notEqual(await bar.evaluate((node) => getComputedStyle(node).transform), from);
    await notice.waitFor({ state: 'hidden', timeout: 4500 });
  } else {
    await notice.getByRole('button', { name: '关闭提示' }).click();
    await notice.waitFor({ state: 'hidden', timeout: 1500 });
  }
}
try {
  await fixture.db.query("UPDATE app_config SET free_units=1000 WHERE id=true");
  const id = 'gpt-5.4-mini';
  for (const modelId of [id, 'gpt-5-mini'])
    await fixture.db.query('INSERT INTO assistant_model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config',
      [modelId, JSON.stringify({ label: modelId, enabled: true, provider: 'openai', operations: ['assistant-turn'],
        unitCost: 5, imageInput: true, reasoningEffort: modelId === id ? 'none' : 'low', responseTierUnits: modelId === id ? { flex: 7 } : undefined })]);
  await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(fixture.app.server.address().port);
  server = await preview({ configFile: resolve('apps/web/vite.config.ts'), preview: { host: '127.0.0.1', port, strictPort: true } });
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  result.browser = browser.version();
  const desktop = await pageFor('owner', { width: 1440, height: 960 });
  await desktop.locator('[data-dock-tool="ai"]:visible').click();
  await desktop.getByLabel('向智能体描述修改需求').waitFor();
  const secondDevice = await pageFor('owner', { width: 390, height: 844 });
  await secondDevice.locator('[data-dock-tool="ai"]:visible').click();
  const secondEntry = secondDevice.getByLabel('向智能体描述修改需求');
  await secondEntry.fill('另一设备正在输入的草稿');
  await desktop.getByRole('button', { name: '选择助手模型与执行方式', exact: true }).click();
  const composerModels = desktop.getByRole('listbox', { name: '选择模型', exact: true });
  assert.equal(await composerModels.getByRole('option', { name: /gpt-5-mini/ }).count(), 0);
  await composerModels.getByRole('option', { name: /gpt-5\.4-mini/ }).click();
  await desktop.getByRole('region', { name: '本轮模型参数', exact: true }).waitFor();
  await desktop.getByLabel('最多输出 Token').fill('512');
  await desktop.getByLabel('采样温度（0–2）').fill('0.25');
  await desktop.getByLabel('OpenAI 服务档位').selectOption('flex');
  await desktop.getByLabel('输出格式').selectOption('json_object');
  await desktop.getByText('文字 7 点 / 轮', { exact: true }).waitFor();
  await take(desktop, 'desktop-assistant-options');
  await desktop.getByRole('button', { name: '完成参数设置' }).click();
  console.log('Assistant composer and quote ready');
  await desktop.getByLabel('向智能体描述修改需求').fill('没有手动建项目，直接对话。');
  const submit = desktop.waitForResponse((response) => response.request().method() === 'POST' &&
    new URL(response.url()).pathname.endsWith('/assistant-turns'));
  await desktop.getByRole('button', { name: '发送协作请求', exact: true }).click();
  const accepted = await submit;
  const receipt = await accepted.json();
  assert.equal(accepted.status(), 202, JSON.stringify(receipt));
  for (let step = 0; step < 40; step++) {
    const response = await desktop.request.get(origin + '/v1/assistant-turns/' + receipt.id);
    const turn = await response.json();
    if (turn.state !== 'running') {
      assert.equal(turn.state, 'completed', JSON.stringify(turn));
      break;
    }
    await desktop.waitForTimeout(100);
  }
  await desktop.getByText('浏览器验收完成', { exact: false }).first().waitFor({ timeout: 7000 });
  await secondDevice.getByText('浏览器验收完成', { exact: false }).first().waitFor({ timeout: 12000 });
  assert.equal(await secondEntry.inputValue(), '另一设备正在输入的草稿');
  await secondDevice.getByRole('button', { name: '选择助手模型与执行方式', exact: true }).click();
  await secondDevice.getByRole('listbox', { name: '选择模型', exact: true }).getByRole('option', { name: /gpt-5\.4-mini/ }).click();
  await secondDevice.getByRole('region', { name: '本轮模型参数', exact: true }).waitFor();
  assert.equal(await secondDevice.evaluate(() => document.documentElement.scrollWidth), 390);
  await take(secondDevice, 'phone-assistant-options');
  assert.equal(requests.at(-1).max_output_tokens, 512);
  assert.equal(requests.at(-1).temperature, 0.25);
  assert.equal(requests.at(-1).service_tier, 'flex');
  result.cases.push('select model to reveal parameters inline; server quote; live conversation sync without replacing the other draft');
  const accountPreferences = secondDevice.request;
  const current = await accountPreferences.get(origin + '/v1/me/assistant-preferences');
  assert.equal(current.status(), 200);
  const { actorId } = await current.json();
  const update = await desktop.request.patch(origin + '/v1/me/assistant-preferences', {
    headers: { origin }, data: { actorId, patch: { mode: 'suggest' } },
  });
  assert.equal(update.status(), 200, await update.text());
  await secondDevice.locator('.ai-execution-summary').filter({ hasText: '只建议' }).waitFor({ timeout: 10000 });
  result.cases.push('account preferences refresh across independent sessions');

  const phone = await pageFor('owner', { width: 390, height: 844 });
  await phone.locator('input[type=file]').first().setInputFiles(sample);
  const shown = phone.locator('.canvas-stage.has-image .image-frame canvas').first();
  await shown.waitFor();
  const top = phone.locator('.floating-topbar:visible');
  assert.equal(await top.locator('.studio-account').isVisible(), false);
  await phone.getByRole('button', { name: '展开顶部工具', exact: true }).click();
  await top.locator('.studio-account').waitFor();
  await phone.getByRole('button', { name: '收起顶部工具', exact: true }).click();
  for (const family of ['light', 'color', 'curves', 'beauty', 'crop']) {
    if (family === 'color' || family === 'curves') {
      const button = phone.locator('.inspector-family-tabs:visible button[data-tool-family="' + family + '"], .inspector-family-tabs:visible button[data-tool="' + family + '"]');
      if (await button.count()) await button.first().click();
      else await phone.locator('.inspector-family-tabs:visible').getByRole('button', {
        name: family === 'color' ? '色彩' : '曲线', exact: true }).click();
    } else await phone.locator('[data-dock-tool="' + family + '"]:visible').click();
    const panel = phone.locator('.free-panel[data-fixed-inspector="true"]:visible');
    await panel.locator('[data-tool-family="' + family + '"]:visible').waitFor();
    await phone.waitForTimeout(180);
    const measured = await panel.locator('.inspector-scroll').evaluate((node) => ({
      client: node.clientHeight, scroll: node.scrollHeight,
      viewportWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
      canvasFilter: getComputedStyle(document.querySelector('.image-frame canvas')).filter,
    }));
    assert.ok(measured.scroll <= measured.client + 1, JSON.stringify({ family, ...measured }));
    assert.equal(measured.canvasFilter, 'none');
    assert.equal(measured.scrollWidth, measured.viewportWidth);
    result.cases.push({ family, ...measured });
    await take(phone, 'phone-' + family);
  }
  await phone.locator('[data-dock-tool="beauty"]:visible').click();
  await phone.locator('.portrait-person-select').waitFor({ state: 'attached', timeout: 60000 });
  await phone.locator('.parameter-shelf:visible').waitFor();
  const portraitOverflow = await phone.locator('.free-panel[data-fixed-inspector="true"]:visible .inspector-scroll')
    .evaluate((node) => node.scrollHeight - node.clientHeight);
  assert.ok(portraitOverflow <= 1, 'recognized portrait controls fit in the visible inspector');
  result.cases.push('local portrait analysis ran without a manual click');
  await take(phone, 'phone-portrait-ready');
  await works(desktop);
  await desktop.locator('.library-work-search').waitFor();
  await phone.getByRole('button', { name: '保存', exact: true }).click();
  await toast(phone, '已保存到', false);
  const saved = desktop.locator('.saved-work-open').filter({ hasText: 'smile-headshot' });
  await saved.waitFor({ timeout: 30000 });
  await take(desktop, 'desktop-cross-session-saved-work');
  await saved.click();
  await desktop.locator('[data-action="trash-photo"]:visible').waitFor();
  await desktop.locator('[data-action="trash-photo"]:visible').click();
  await desktop.getByRole('dialog').getByRole('button', { name: '移入回收站', exact: true }).click();
  await desktop.locator('.workspace-library-view:visible').waitFor();
  await saved.waitFor({ state: 'hidden' });
  await toast(desktop, '已移入回收站');
  await desktop.getByRole('button', { name: '回收站', exact: true }).click();
  const trash = desktop.getByRole('dialog', { name: '回收站' });
  await trash.locator('.asset-thumbnail[data-state="ready"]').first().waitFor();
  await take(desktop, 'desktop-trash-image-cards');
  await trash.getByRole('button', { name: '恢复', exact: true }).click();
  await trash.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await saved.waitFor();
  await desktop.getByRole('button', { name: '删除作品 · smile-headshot', exact: true }).click();
  await desktop.getByRole('dialog').getByRole('button', { name: '移入回收站', exact: true }).click();
  await desktop.getByRole('button', { name: '回收站', exact: true }).click();
  await trash.getByRole('button', { name: '永久删除 · smile-headshot', exact: true }).click();
  await desktop.getByRole('dialog', { name: '永久删除', exact: true }).getByRole('button', { name: '永久删除', exact: true }).click();
  await trash.getByText('回收站为空', { exact: true }).waitFor();
  result.cases.push('same account across contexts; save, cross-session visibility, active canvas exit, trash thumbnail, restore and purge');

  const operator = await pageFor('operator', { width: 820, height: 980 });
  await operator.getByRole('button', { name: '打开空间与项目', exact: true }).click();
  await operator.getByRole('button', { name: '运营管理', exact: true }).click();
  await operator.getByRole('button', { name: '赞赏与兑换', exact: true }).click();
  await operator.getByLabel('选择赞赏码图片').setInputFiles({
    name: 'test-code.jpg', mimeType: 'image/jpeg',
    buffer: await (await import('sharp')).default({ create: { width: 100, height: 100, channels: 3, background: '#aaa' } }).jpeg().toBuffer(),
  });
  await operator.getByRole('button', { name: '上传并更新赞赏码', exact: true }).click();
  await operator.getByText('赞赏码已更新', { exact: true }).waitFor();
  await operator.getByLabel('服务点 1', { exact: true }).fill('51');
  await operator.getByRole('button', { name: '保存赞赏设置', exact: true }).click();
  await operator.getByText('赞赏与兑换设置已保存', { exact: true }).waitFor();
  await take(operator, 'tablet-operator-support');
  await phone.goto(origin + '/#/account/support');
  await phone.getByRole('button', { name: /1.99.*51/ }).waitFor();
  await take(phone, 'phone-support');
  const narrow = await pageFor('owner', { width: 320, height: 700 });
  await narrow.locator('input[type=file]').first().setInputFiles(sample);
  await narrow.locator('.canvas-stage.has-image .image-frame canvas').first().waitFor();
  await narrow.locator('[data-dock-tool="light"]:visible').click();
  await narrow.locator('.free-panel[data-fixed-inspector="true"]:visible').waitFor();
  await take(narrow, 'narrow-phone-editor');
  await works(narrow);
  await narrow.getByRole('button', { name: '跨空间查找', exact: true }).click();
  await narrow.locator('[data-library-scope="all"]:visible .library-search').waitFor();
  const gallery = narrow.locator('[data-library-scope="all"]:visible');
  await gallery.locator('.library-reference-masonry img:visible').first().waitFor();
  assert.equal(await gallery.locator('.library-folder-disclosure').getAttribute('open'), null);
  assert.equal(await narrow.evaluate(() => document.documentElement.scrollWidth), 320);
  await take(narrow, 'narrow-phone-library');
  result.cases.push('operator replaces code and updates the visible exchange on another context');
  await narrow.getByRole('button', { name: '打开空间与项目', exact: true }).click();
  await narrow.locator('.project-list:visible').first().getByRole('button', { name: 'V4 project', exact: true }).click();
  await selectView(narrow, 'collaborate');
  await narrow.locator('.collaboration-view:visible').first().waitFor();
  assert.equal(await narrow.evaluate(() => document.documentElement.scrollWidth), 320);
  await take(narrow, 'narrow-phone-collaboration');
  const landscape = await pageFor('owner', { width: 844, height: 390 });
  await landscape.locator('input[type=file]').first().setInputFiles(sample);
  await landscape.locator('.canvas-stage.has-image .image-frame canvas').first().waitFor();
  await landscape.locator('[data-dock-tool="light"]:visible').click();
  await landscape.locator('.free-panel[data-fixed-inspector="true"]:visible').waitFor();
  await take(landscape, 'landscape-editor');
  result.cases.push('320 px library and collaboration; landscape editor visible');
  assert.deepEqual(result.errors, []);
} catch (error) {
  console.error(error);
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) {
    console.error((await page.locator('body').innerText().catch(() => '')).slice(-2800));
    await take(page, 'failure-' + result.cases.length + '-' + (await page.viewportSize())?.width).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2));
  await browser?.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
  await fixture.close();
}
