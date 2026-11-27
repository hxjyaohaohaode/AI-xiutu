/** One production web build, native PostgreSQL and an isolated document provider. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { preview } from 'vite';
import { createAiService, DispatchJournal } from '@ai-xiutu/ai';
import { adjustUnits, transaction } from '@ai-xiutu/db';
import { LocalPrivateStorage } from '@ai-xiutu/storage';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.ts';
import { showEditorTopbar } from './studio-navigation.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production' ||
    !databaseUrl || !decodeURIComponent(new URL(databaseUrl).pathname).includes('test'))
  throw new Error('Use CI=true and a disposable TEST_DATABASE_URL containing test.');
const port = Number(process.env.BROWSER_WEB_PORT || 4196);
const origin = 'http://127.0.0.1:' + port;
const artifacts = resolve(process.env.BROWSER_ARTIFACT_DIR || 'artifacts/browser-project-files');
const title = '武汉项目进展 · 源数据';
const inputWorkbook = await readFile(resolve('scripts/qa/fixtures/project-data.xlsx'));
const sourceHash = createHash('sha256').update(inputWorkbook).digest('hex');
const body = ['> "武汉项目进展.xlsx" · "源数据"!A1:C3', '> SHA-256 ' + sourceHash, '', '```sheet-tsv',
  '"城市"\t"数量"\t"完成率"', '"武汉"\t12\t50%', '"恩施"\t-3\t37.625%', '```'].join('\n');
const prompt = '把源数据整理为可编辑图表';
const modelId = 'qwen-office-' + randomUUID();
const modelLabel = '数据文案验收 ' + modelId.slice(-8);
const report = { provider: 'local text fixture', providerCalls: 0, viewports: [], pageErrors: [], externalRequests: [] };
const moderator = {
  configured: true,
  async check(text) {
    return { decision: 'passed', inputHash: createHash('sha256').update(text).digest('hex'), requestId: 'fixture-review' };
  },
};
const provider = {
  configured: true,
  async complete(prepared) {
    report.providerCalls++;
    const { messages } = JSON.parse(prepared.body);
    const source = JSON.parse(messages[1].content);
    assert.equal(source.context, body);
    assert.equal(source.request, prompt);
    return { value: { title: '净变化', body: source.context, summary: '数据图表' }, requestId: 'fixture-source' };
  },
};
function createJobService(db, config) {
  return createAiService(db, { AI_TEXT_ENABLED: 'true' }, {
    provider, moderator, storage: new LocalPrivateStorage(config),
    journal: new DispatchJournal(resolve(config.storageDir, 'office-journal')),
  });
}

let fixture, vite, browser, page;
async function downloadFrom(menu, label, name, artifactName = name) {
  await menu.click();
  const option = page.getByRole('option').filter({ hasText: label });
  const box = await option.boundingBox();
  assert.ok(box && box.x >= -1 && box.x + box.width <= page.viewportSize().width + 2);
  const [download] = await Promise.all([page.waitForEvent('download'), option.click()]);
  assert.equal(download.suggestedFilename(), name);
  const path = resolve(artifacts, artifactName);
  await download.saveAs(path);
  return path;
}

try {
  await mkdir(artifacts, { recursive: true });
  fixture = await collaborationFixture(databaseUrl, { origin, createJobService });
  await fixture.db.query('INSERT INTO model_configs(id,config) VALUES($1,$2)', [modelId, JSON.stringify({
    enabled: true, label: modelLabel, provider: 'qwen', operations: ['generate-text'], unitCost: 2,
    minWidth: 64, maxWidth: 4096, minHeight: 64, maxHeight: 4096,
  })]);
  await transaction(fixture.db, (tx) => adjustUnits(tx, { spaceId: fixture.teamId, actorId: fixture.actors.operator.id,
    units: 30, reason: 'local office QA', idempotencyKey: randomUUID(), requestHash: randomUUID() }));
  await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(fixture.app.server.address().port);
  vite = await preview({ configFile: resolve('apps/web/vite.config.ts'), preview: { host: '127.0.0.1', port, strictPort: true } });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  await context.addCookies([{ name: 'xiutu_session', value: fixture.actors.owner.cookie.split('=')[1], url: origin }]);
  page = await context.newPage();
  page.on('pageerror', (error) => report.pageErrors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) report.externalRequests.push(url.origin);
  });
  await page.goto(origin + '/#/studio');
  const nav = page.getByRole('button', { name: '打开空间与项目', exact: true });
  await nav.click();
  await page.locator('dialog.sidebar-navigation-modal').getByRole('button', { name: /^V4 team/ }).click();
  await nav.click();
  await page.getByRole('navigation', { name: '项目', exact: true }).getByRole('button', { name: 'V4 project', exact: true }).click();
  await page.locator('.saved-work-open').filter({ hasText: 'Collaborative portrait' }).click();
  await page.locator('.collaboration-status[data-state="ready"]').waitFor();
  await showEditorTopbar(page);
  const compact = page.getByRole('button', { name: '切换工作视图', exact: true });
  await (await compact.isVisible() ? compact : page.getByRole('button', { name: '项目与用量', exact: true })).click();
  await page.getByRole('navigation', { name: '切换工作视图', exact: true }).locator('[data-view="docs"]').click();
  const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '导入表格', exact: true }).click()]);
  await fileChooser.setFiles({ name: '武汉项目进展.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: inputWorkbook });
  const importer = page.getByRole('dialog', { name: '导入表格' });
  const sheetChoice = importer.getByRole('combobox');
  await sheetChoice.selectOption({ label: '源数据' });
  assert.equal(await sheetChoice.getByRole('option', { name: '隐藏工作表' }).count(), 0);
  await importer.getByLabel('数据区域').fill('A1:C3');
  await importer.getByRole('table', { name: '表格预览' }).getByText('37.625%', { exact: true }).waitFor();
  const [saved] = await Promise.all([page.waitForResponse((resp) =>
    resp.request().method() === 'POST' && resp.url().endsWith('/documents')),
    importer.getByRole('button', { name: '导入为项目文档', exact: true }).click()]);
  await importer.waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('textbox', { name: '文档内容', exact: true }).inputValue(), body);
  assert.equal(saved.status(), 201);
  const source = (await saved.json()).document;
  assert.deepEqual([source.title, source.body, source.version], [title, body, 1]);
  report.imported = { file: 'project-data.xlsx', sheet: '源数据', range: 'A1:C3', sha256: sourceHash, inputFormat: 'xlsx' };
  const docsMenu = page.locator('.document-editor').getByRole('combobox', { name: '下载文件', exact: true });
  for (const [width, height, format] of [[1400,900,'docx'],[820,1100,'pptx'],[390,844,'xlsx'],[844,390,'svg']]) {
    await page.setViewportSize({ width, height });
    await downloadFrom(docsMenu, '.' + format, title + '.' + format);
    await page.screenshot({ path: resolve(artifacts, 'layout-' + width + '.png') });
    report.viewports.push({ width, height, format });
  }
  await page.setViewportSize({ width: 1400, height: 900 });
  const coverFile = await downloadFrom(docsMenu, 'PowerPoint · 含当前画面', title + '.pptx', 'cover.pptx');
  const coverParts = unzipSync(await readFile(coverFile));
  const photos = Object.keys(coverParts).filter((name) => /^ppt\/media\/.+\.jpe?g$/.test(name));
  assert.equal(photos.length, 1);
  const photo = await sharp(coverParts[photos[0]]).metadata();
  assert.deepEqual([photo.format, photo.width, photo.height], ['jpeg', 64, 48]);
  report.cover = { type: photo.format, width: photo.width, height: photo.height };

  await page.getByRole('button', { name: '用此文档与 AI 创作', exact: true }).click();
  const picker = page.getByRole('combobox', { name: '本轮上下文', exact: true });
  await picker.waitFor();
  assert.ok((await picker.innerText()).includes(title + ' · V1'));
  await page.getByRole('button', { name: '任务设置', exact: true }).click();
  const settings = page.getByRole('region', { name: '模型与参数', exact: true });
  await settings.getByRole('combobox', { name: '文案模型', exact: true }).click();
  await page.getByRole('listbox', { name: '文案模型', exact: true }).getByText(modelLabel, { exact: true }).click();
  await settings.locator('.ai-settings-page-header button').click();
  await page.getByRole('button', { name: prompt, exact: true }).click();
  assert.equal(await page.getByLabel('本轮创作要求', { exact: true }).inputValue(), prompt);
  const [admitted] = await Promise.all([page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().endsWith('/ai-jobs')),
    page.getByRole('button', { name: '生成文案', exact: true }).click()]);
  assert.equal(admitted.status(), 202);
  const request = admitted.request().postDataJSON();
  assert.deepEqual([request.contextDocumentId, request.expectedDocumentVersion, request.modelId], [source.id, 1, modelId]);
  const { job } = await admitted.json();
  assert.ok(await fixture.jobService.runOnce());
  const { rows: [row] } = await fixture.db.query(
    'SELECT j.state,h.state AS hold,h.units FROM ai_jobs j JOIN quota_holds h ON h.id=j.hold_id WHERE j.id=$1', [job.id]);
  assert.deepEqual([row.state, row.hold, row.units, report.providerCalls], ['completed', 'settled', 2, 1]);
  const result = page.locator('.ai-text-result').filter({ hasText: '净变化' });
  const generatedFile = await downloadFrom(result.getByRole('combobox', { name: '下载文件' }), '.xlsx', '净变化.xlsx');
  const book = unzipSync(await readFile(generatedFile));
  const sheet = strFromU8(book['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /武汉/);
  assert.match(sheet, /恩施/);
  assert.match(sheet, /r="B2" s="0"><v>12<\/v>/);
  assert.match(sheet, /r="C2" s="2"><v>0\.5<\/v>/);
  assert.match(sheet, /r="B3" s="0"><v>-3<\/v>/);
  assert.match(sheet, /r="C3" s="2"><v>0\.37625<\/v>/);
  const chartRanges = ['Data1!$B$2:$B$3', 'Data1!$C$2:$C$3'];
  chartRanges.forEach((range, i) => assert.ok(strFromU8(book['xl/charts/chart' + (i + 1) + '.xml']).includes(range)));
  report.source = { version: source.version, units: row.units, settlement: row.hold, chartRanges };
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  console.log('Passed: local project cover and editable workbook from a versioned document through the production editor.');
} catch (error) {
  report.failure = String(error);
  await page?.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await vite?.close();
  await fixture?.close();
}
