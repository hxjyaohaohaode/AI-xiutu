/** Real editor, HTTP API, PostgreSQL, queue, ledger and private PNG storage.
 * The two model endpoints return local protocol fixtures and make no paid calls. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { preview } from 'vite';
import { createAiService, DispatchJournal } from '@ai-xiutu/ai';
import { assistantModelConfigSchema } from '@ai-xiutu/assistant';
import { adjustUnits, transaction } from '@ai-xiutu/db';
import { migrateRecipeToV4 } from '@ai-xiutu/editor';
import { createOpenAIImageProvider } from '@ai-xiutu/multimodal';
import { LocalPrivateStorage } from '@ai-xiutu/storage';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.ts';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production' ||
    !databaseUrl || !decodeURIComponent(new URL(databaseUrl).pathname).includes('test'))
  throw new Error('Use CI=true and a disposable TEST_DATABASE_URL containing test.');
const artifacts = resolve(process.env.BROWSER_ARTIFACT_DIR || 'artifacts/browser-agent-image');
const port = Number(process.env.BROWSER_WEB_PORT || 4193);
const origin = 'http://127.0.0.1:' + port;
const imageModel = 'gpt-image-2.5-sunburst';
const assistantModel = 'image-browser-' + randomUUID();
const prompt = '生成一张 864×1536 像素的竖版陶瓷花瓶插画。';
const report = { assistantRounds: 0, imageCalls: 0, projectJobs: 0, viewports: [], pageErrors: [] };
const moderator = {
  configured: true,
  async check(value) {
    return { decision: 'passed', inputHash: createHash('sha256').update(value).digest('hex'), requestId: 'fixture-moderation' };
  },
};
async function respondToAssistant(_url, init) {
  report.assistantRounds++;
  const { input } = JSON.parse(init.body);
  const final = input.some((item) => item.type === 'function_call_output');
  const fn = (name, args) => ({
    type: 'function_call', name, call_id: 'fixture-' + name, arguments: JSON.stringify(args),
  });
  const sentence = '陶瓷花瓶插画已准备好。';
  const output = final
    ? [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: sentence }] }]
    : [fn('draft_generation', { summary: '陶瓷花瓶插画', prompt, referenceAssetIds: [] }),
       fn('compose_workspace', { title: '图片创作', sections: [{ type: 'candidates', title: '生图草案', candidateIndices: [0] }] })];
  const events = final ? [{ type: 'response.output_text.delta', delta: sentence }] : [];
  events.push({ type: 'response.completed', response: { id: 'fixture-' + report.assistantRounds, status: 'completed', output,
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } } });
  return new Response(events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join(''),
    { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'fixture-' + report.assistantRounds } });
}
function createJobService(db, config) {
  const provider = createOpenAIImageProvider({
    OPENAI_IMAGE_MODELS: imageModel, OPENAI_API_KEY: 'local-fixture', OPENAI_IMAGE_ENABLED: 'true',
  }, async (url, init) => {
    assert.equal(new URL(url).pathname, '/v1/images/generations');
    const body = JSON.parse(init.body);
    assert.equal(body.model, imageModel);
    assert.equal(body.prompt, prompt);
    assert.equal(body.size, '864x1536');
    report.imageCalls++;
    const png = await sharp({ create: { width: 864, height: 1536, channels: 3, background: '#768aac' } }).png().toBuffer();
    return Response.json({ data: [{ b64_json: png.toString('base64') }] }, { headers: { 'x-request-id': 'fixture-image' } });
  });
  return createAiService(db, { AI_IMAGE_ENABLED: 'true', AI_MODERATION_PROVIDER: 'openai' }, {
    openAIImageProvider: provider, moderator, imageModerator: moderator,
    storage: new LocalPrivateStorage(config), journal: new DispatchJournal(resolve(config.storageDir, 'journal')),
  });
}
let fixture, vite, browser;
try {
  await mkdir(artifacts, { recursive: true });
  fixture = await collaborationFixture(databaseUrl, {
    origin, createJobService, assistant: {
      env: { NODE_ENV: 'test', OPENAI_API_KEY: 'local-fixture', AI_ASSISTANT_ENABLED: 'true' },
      fetcher: respondToAssistant, textModerator: moderator, imageModerator: moderator,
    },
  });
  const migrated = await fixture.call('POST', '/v1/artworks/' + fixture.artwork.artwork.id + '/revisions', {
    expectedVersion: fixture.artwork.artwork.headVersion, recipe: migrateRecipeToV4(fixture.recipe), label: 'Browser baseline',
  });
  assert.equal(migrated.statusCode, 201);
  await fixture.db.query('INSERT INTO assistant_model_configs(id,config) VALUES($1,$2)', [assistantModel, JSON.stringify(
    assistantModelConfigSchema.parse({ label: '本地助理验收', enabled: true, provider: 'openai',
      operations: ['assistant-turn'], unitCost: 5, imageInput: true }))]);
  await fixture.db.query('INSERT INTO model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config',
    [imageModel, JSON.stringify({ label: '图像协议验收', enabled: true, provider: 'openai', operations: ['generate-image'],
      unitCost: 3, minWidth: 64, minHeight: 64, maxWidth: 3840, maxHeight: 3840 })]);
  await transaction(fixture.db, (tx) => adjustUnits(tx, { spaceId: fixture.teamId, actorId: fixture.actors.operator.id,
    units: 100, reason: 'isolated browser test', idempotencyKey: randomUUID(), requestHash: randomUUID() }));
  await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(fixture.app.server.address().port);
  vite = await preview({ configFile: resolve('apps/web/vite.config.ts'), preview: { host: '127.0.0.1', port, strictPort: true } });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'xiutu_session', value: fixture.actors.owner.cookie.split('=')[1], url: origin }]);
  const page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(String(error)));
  const nav = page.getByRole('button', { name: '打开空间与项目', exact: true });
  await page.goto(origin + '/#/studio');
  await nav.click();
  await page.locator('dialog.sidebar-navigation-modal').getByRole('button', { name: /^V4 team/ }).click();
  await nav.click();
  await page.getByRole('navigation', { name: '项目', exact: true }).getByRole('button', { name: 'V4 project', exact: true }).click();
  await page.locator('.saved-work-open').filter({ hasText: 'Collaborative portrait' }).click();
  await page.locator('.collaboration-status[data-state="ready"]').waitFor();
  await page.locator('[data-dock-tool="ai"]:visible').click();
  await page.locator('.live-assistant').getByRole('button', { name: '助手设置', exact: true }).click();
  const settings = page.getByRole('region', { name: '助手设置', exact: true });
  await settings.getByRole('combobox', { name: '助手模型', exact: true }).click();
  await settings.getByRole('listbox', { name: '助手模型', exact: true }).getByText('本地助理验收', { exact: true }).click();
  await settings.getByRole('button', { name: '返回对话', exact: true }).click();
  await page.getByLabel('向智能体描述修改需求').fill(prompt);
  await page.getByRole('button', { name: '发送协作请求', exact: true }).click();
  const generate = page.getByRole('button', { name: '生成 · 图像协议验收 · 864×1536 · 3 点', exact: true });
  await generate.waitFor();
  assert.equal(await generate.isEnabled(), true);
  assert.equal(report.imageCalls, 0);
  for (const viewport of [{ width: 1440, height: 960 }, { width: 820, height: 1180 },
    { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await generate.scrollIntoViewIfNeeded();
    const box = await generate.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width + 2);
    await page.screenshot({ path: resolve(artifacts, 'offer-' + viewport.width + '.png') });
    report.viewports.push(viewport);
  }
  const [admitted] = await Promise.all([page.waitForResponse((r) =>
    r.request().method() === 'POST' && r.url().endsWith('/ai-jobs')), generate.click()]);
  assert.equal(admitted.status(), 202);
  const { job } = await admitted.json();
  assert.ok(await fixture.jobService.runOnce());
  const { rows: [row] } = await fixture.db.query(
    'SELECT j.state,j.output,h.state AS hold,h.units FROM ai_jobs j JOIN quota_holds h ON h.id=j.hold_id WHERE j.id=$1', [job.id]);
  assert.equal(row.state, 'completed');
  assert.equal(row.hold, 'settled');
  assert.equal(row.units, 3);
  await page.locator('.ai-generated-image').waitFor();
  const file = await fixture.call('GET', '/v1/assets/' + row.output.images[0].assetId + '/file');
  assert.equal(file.statusCode, 200);
  const meta = await sharp(file.rawPayload).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 864, 1536]);
  report.projectJobs = (await fixture.db.query('SELECT COUNT(*)::int AS n FROM ai_jobs WHERE project_id=$1', [fixture.projectId])).rows[0].n;
  assert.deepEqual([report.projectJobs, report.imageCalls, report.assistantRounds], [1, 1, 2]);
  await page.getByRole('button', { name: '打开并编辑', exact: true }).click();
  await page.locator('canvas[aria-label="照片编辑预览"]').waitFor();
  await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出图片', exact: true });
  await dialog.getByRole('combobox', { name: '输出尺寸', exact: true }).click();
  await dialog.getByRole('option', { name: '608 × 1080', exact: true }).click();
  report.downloads = [];
  for (const format of ['PNG', 'JPEG', 'WebP']) {
    await dialog.getByRole('button', { name: new RegExp('^' + format) }).click();
    const [download] = await Promise.all([page.waitForEvent('download'),
      dialog.getByRole('button', { name: '下载 ' + format.toUpperCase(), exact: true }).click()]);
    const stream = await download.createReadStream();
    const parts = [];
    for await (const chunk of stream) parts.push(chunk);
    const metadata = await sharp(Buffer.concat(parts)).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], [format.toLowerCase(), 608, 1080]);
    report.downloads.push({ format: metadata.format, width: metadata.width, height: metadata.height });
  }
  assert.deepEqual(report.pageErrors, []);
  report.result = { dimensions: [meta.width, meta.height], billedUnits: row.units, settlement: row.hold };
  console.log('Passed: one agent candidate produced one settled image job in the editor.');
} catch (error) {
  report.error = String(error.stack || error);
  throw error;
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  if (vite) await new Promise((done) => vite.httpServer.close(done));
  await fixture?.close();
}
