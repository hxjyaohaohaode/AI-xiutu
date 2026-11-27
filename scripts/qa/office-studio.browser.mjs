import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { readPresentation, readOfficeBlock } from '@ai-xiutu/contracts';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.ts';
import { showEditorTopbar } from './studio-navigation.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (
  process.env.CI !== 'true' ||
  process.env.NODE_ENV === 'production' ||
  !databaseUrl ||
  !new URL(databaseUrl).pathname.includes('test')
)
  throw new Error('Use CI=true with a disposable test database.');
const port = Number(process.env.BROWSER_WEB_PORT || 4197);
const origin = `http://127.0.0.1:${port}`;
const artifacts = resolve(process.env.BROWSER_ARTIFACT_DIR || 'artifacts/browser-office-studio');
const report = { viewportChecks: [], pageErrors: [], externalRequests: [] };
const dimensions = [
  [1400, 900],
  [820, 1100],
  [390, 844],
  [844, 390],
];
let fixture, web, browser, owner, editor;

async function until(read, predicate, label) {
  const deadline = Date.now() + 22_000;
  let value;
  do {
    value = await read();
    if (predicate(value)) return value;
    await new Promise((resume) => setTimeout(resume, 180));
  } while (Date.now() < deadline);
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}

async function openOffice(page) {
  await page.goto(origin + '/#/studio');
  const nav = page.getByRole('button', { name: '打开空间与项目', exact: true });
  await nav.click();
  await page
    .locator('dialog.sidebar-navigation-modal')
    .getByRole('button', { name: /^V4 team/ })
    .click();
  await nav.click();
  await page
    .getByRole('navigation', { name: '项目', exact: true })
    .getByRole('button', { name: 'V4 project', exact: true })
    .click();
  await page.locator('.saved-work-open').filter({ hasText: 'Collaborative portrait' }).click();
  await page.locator('.collaboration-status[data-state="ready"]').waitFor();
  await showEditorTopbar(page);
  const compact = page.getByRole('button', { name: '切换工作视图', exact: true });
  await (
    (await compact.isVisible())
      ? compact
      : page.getByRole('button', { name: '项目与用量', exact: true })
  ).click();
  await page
    .getByRole('navigation', { name: '切换工作视图', exact: true })
    .locator('[data-view="docs"]')
    .click();
}

async function openDocument(page, title) {
  const row = page.locator('.document-row').filter({ has: page.locator(`[title="${title}"]`) });
  if (
    !(await row.isVisible()) &&
    (await page.getByRole('button', { name: '文档列表', exact: true }).isVisible())
  )
    await page.getByRole('button', { name: '文档列表', exact: true }).click();
  await row.click();
  await until(
    () => page.getByLabel('文档标题', { exact: true }).inputValue(),
    (value) => value === title,
    `Open ${title}`,
  );
}

async function getDocument(title) {
  const result = await fixture.call('GET', `/v1/projects/${fixture.projectId}/documents`);
  assert.equal(result.statusCode, 200);
  return result.json().documents.find((item) => item.title === title);
}

async function download(page, extension) {
  const menu = page.getByRole('combobox', { name: '下载文件', exact: true });
  await menu.click();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('option').filter({ hasText: extension }).click(),
  ]);
  assert.ok(file.suggestedFilename().endsWith(extension));
  const path = resolve(artifacts, file.suggestedFilename());
  await file.saveAs(path);
  const bytes = await readFile(path);
  return extension === '.png' ? bytes : unzipSync(bytes);
}

async function checkViewports(page, locator, feature) {
  for (const [width, height] of dimensions) {
    await page.setViewportSize({ width, height });
    const next = page.getByRole('button', { name: '继续编辑当前文档', exact: true });
    if ((await next.isVisible()) && !(await locator.isVisible())) await next.click();
    await locator.scrollIntoViewIfNeeded();
    const bounds = await locator.boundingBox();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    assert.ok(
      bounds && bounds.x >= -1 && bounds.x + bounds.width <= width + 1 && overflow <= 1,
      JSON.stringify({ feature, width, bounds, overflow }),
    );
    const screenshot = `${feature}-${width}x${height}.png`;
    await page.screenshot({ path: resolve(artifacts, screenshot), animations: 'disabled' });
    report.viewportChecks.push({ feature, width, height, overflow, screenshot });
  }
  await page.setViewportSize({ width: 1400, height: 900 });
}

function pcmWave() {
  const wave = Buffer.alloc(44 + 1600);
  wave.write('RIFF', 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(8000, 24);
  wave.writeUInt32LE(16_000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(1600, 40);
  return wave;
}

try {
  await mkdir(artifacts, { recursive: true });
  fixture = await collaborationFixture(databaseUrl, { origin });
  const proseTitle = '同步验收';
  const created = await fixture.call('POST', `/v1/projects/${fixture.projectId}/documents`, {
    title: proseTitle,
    body: '共编基线。',
  });
  assert.equal(created.statusCode, 201);
  await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(fixture.app.server.address().port);
  web = await preview({
    configFile: resolve('apps/web/vite.config.ts'),
    build: { outDir: process.env.BROWSER_DIST_DIR || resolve('apps/web/dist') },
    preview: { host: '127.0.0.1', port, strictPort: true },
  });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  report.browser = browser.version();
  const context = async (role) => {
    const ctx = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      reducedMotion: 'reduce',
    });
    await ctx.addCookies([
      { name: 'xiutu_session', value: fixture.actors[role].cookie.split('=')[1], url: origin },
    ]);
    const page = await ctx.newPage();
    page.on('pageerror', (error) => report.pageErrors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin)
        report.externalRequests.push(url.origin);
    });
    await openOffice(page);
    return page;
  };
  [owner, editor] = await Promise.all([context('owner'), context('editor')]);
  for (const page of [owner, editor]) {
    await openDocument(page, proseTitle);
    await page.getByRole('button', { name: '实时共编', exact: true }).click();
    await page.locator('.office-live-status[data-state="ready"]').waitFor();
  }
  const prose = (page) => page.locator('.office-live .ProseMirror');
  const type = async (page, value) => {
    await prose(page).locator('p').first().click();
    await page.keyboard.press('End');
    await page.keyboard.insertText(value);
  };
  const seeBoth = async (values) => {
    const stored = await until(
      () => getDocument(proseTitle),
      (doc) => values.every((value) => doc?.body.includes(value)),
      'Saved live edits',
    );
    await until(
      async () => Promise.all([prose(owner).innerText(), prose(editor).innerText()]),
      ([left, right]) => left === right && values.every((value) => left.includes(value)),
      'Both sessions show the same edits',
    );
    return stored;
  };
  await Promise.all([type(owner, '甲稿'), type(editor, '乙稿')]);
  await seeBoth(['甲稿', '乙稿']);
  await editor.context().setOffline(true);
  await type(editor, '离线文字');
  await editor.locator('.office-live-status[data-state="offline"]').waitFor();
  await type(owner, '在线文字');
  await until(
    () => getDocument(proseTitle),
    (doc) => doc?.body.includes('在线文字'),
    'Online edit saved during disconnect',
  );
  await editor.context().setOffline(false);
  await seeBoth(['甲稿', '乙稿', '离线文字', '在线文字']);

  let lostAck = false;
  await editor.context().route('**/v1/documents/*/live', async (route) => {
    if (route.request().method() !== 'POST' || lostAck) return route.continue();
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    lostAck = true;
    await route.abort();
  });
  await type(editor, '回执中断');
  const synced = await seeBoth(['回执中断']);
  assert.equal(synced.body.split('回执中断').length, 2);
  assert.ok(lostAck);
  await checkViewports(owner, prose(owner), 'live-document');
  report.collaboration = {
    authenticatedEditors: 2,
    concurrentSameParagraph: true,
    offlineMerge: true,
    lostResponseRecovered: lostAck,
    version: synced.version,
  };
  await owner.getByRole('button', { name: '退出共编', exact: true }).click();

  const sheetTitle = '公式列与河流图';
  await owner.getByRole('button', { name: '新建工作表', exact: true }).click();
  await owner.getByLabel('文档标题', { exact: true }).fill(sheetTitle);
  const worksheet = owner.getByRole('region', { name: '工作表', exact: true });
  for (const [cell, value] of [
    ['A2', '春'],
    ['B2', '12'],
    ['C2', '=B2*2'],
    ['A3', '夏'],
    ['B3', '15'],
    ['C3', '=SUM(B2:B3)'],
    ['A4', '秋'],
    ['B4', '9'],
    ['C4', '=SUM(B3:B4)'],
  ])
    await worksheet.getByRole('textbox', { name: cell, exact: true }).fill(value);
  await worksheet.getByRole('textbox', { name: 'A2', exact: true }).focus();
  assert.equal(
    await worksheet.getByRole('textbox', { name: 'C3', exact: true }).inputValue(),
    '27',
  );
  const savedSheet = await until(
    () => getDocument(sheetTitle),
    (doc) => doc?.body.includes('SUM(B2:B3)'),
    'Autosave formula and data',
  );
  await owner.getByRole('button', { name: '图表预览', exact: true }).click();
  await worksheet.getByLabel('图表类型', { exact: true }).selectOption('stream');
  await worksheet.getByRole('img', { name: '当前工作表图表', exact: true }).waitFor();
  await checkViewports(owner, worksheet, 'worksheet');
  const workbook = await download(owner, '.xlsx');
  assert.match(
    strFromU8(workbook['xl/worksheets/sheet1.xml']),
    /<c r="C3" t="n"><f>SUM\(B2:B3\)<\/f><v>27<\/v>/,
  );
  const png = await download(owner, '.png');
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  const size = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.deepEqual(size, [2400, 1350]);
  report.sheet = {
    version: savedSheet.version,
    displayed: 27,
    nativeFormula: 'SUM(B2:B3)',
    chart: 'stream',
    rasterPixels: size,
  };

  const deckTitle = '自由排版验收';
  await owner.getByRole('button', { name: '新建演示', exact: true }).click();
  await owner.getByLabel('文档标题', { exact: true }).fill(deckTitle);
  const slides = owner.getByRole('region', { name: '演示编辑器', exact: true });
  await slides.getByRole('button', { name: '插入文字', exact: true }).click();
  await slides.getByLabel('幻灯片文字', { exact: true }).fill('画布位置保留');
  const element = slides.getByRole('button', { name: '画布位置保留', exact: true });
  await element.scrollIntoViewIfNeeded();
  const startingX = Number(await slides.getByLabel('X', { exact: true }).inputValue());
  const box = await element.boundingBox();
  await owner.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20, { steps: 8 });
  await owner.mouse.up();
  const finalX = Number(await slides.getByLabel('X', { exact: true }).inputValue());
  assert.ok(finalX > startingX + 12);
  await slides.getByLabel('宽度', { exact: true }).fill('460');
  await slides.getByLabel('旋转', { exact: true }).fill('12');
  await slides.getByRole('button', { name: '插入图表', exact: true }).click();
  await slides.getByLabel('选择数据文档', { exact: true }).selectOption(savedSheet.id);
  await slides.getByLabel('图表类型', { exact: true }).selectOption('stream');
  await slides.getByRole('button', { name: '插入', exact: true }).click();
  await slides.getByRole('button', { name: '添加幻灯片', exact: true }).click();
  const savedDeck = await until(
    () => getDocument(deckTitle),
    (doc) => doc && readPresentation(doc.body)?.slides.length === 2,
    'Save edited presentation',
  );
  const savedSlide = readPresentation(savedDeck.body).slides[0];
  assert.equal(savedSlide.elements[0].x, Math.min(finalX, 1600 - 460));
  assert.equal(savedSlide.elements[0].width, 460);
  assert.equal(savedSlide.elements[0].rotation, 12);
  assert.equal(savedSlide.elements[1].chart.rows[1][2], '27');
  await slides
    .getByRole('navigation', { name: '幻灯片列表', exact: true })
    .getByRole('button')
    .first()
    .click();
  await checkViewports(owner, slides, 'presentation');
  const presentation = await download(owner, '.pptx');
  const slide = strFromU8(presentation['ppt/slides/slide1.xml']);
  assert.match(slide, /画布位置保留/);
  assert.match(slide, /rot="720000"/);
  assert.ok(Object.keys(presentation).some((key) => /^ppt\/media\/.+\.png$/.test(key)));
  report.presentation = {
    version: savedDeck.version,
    slides: 2,
    x: savedSlide.elements[0].x,
    width: 460,
    rotation: 12,
    chartEmbedded: true,
  };

  await openDocument(owner, proseTitle);
  await owner.getByRole('button', { name: '实时共编', exact: true }).click();
  await owner.locator('.office-live-status[data-state="ready"]').waitFor();
  const picker = owner.getByLabel('插入文档内容', { exact: true });
  const insert = owner.getByRole('button', { name: '插入到文档', exact: true });
  await picker.selectOption('audio');
  await owner
    .getByLabel('上传音频', { exact: true })
    .setInputFiles({ name: '会议音频.wav', mimeType: 'audio/wav', buffer: pcmWave() });
  await insert.click();
  const src = await owner.locator('.office-live audio').getAttribute('src');
  const audio = await owner.request.get(origin + src, { headers: { range: 'bytes=0-31' } });
  assert.equal(audio.status(), 206);
  assert.deepEqual(await audio.body(), pcmWave().subarray(0, 32));
  assert.equal((await fixture.call('GET', src, undefined, 'outsider')).statusCode, 404);
  await picker.selectOption('reference');
  await owner.getByLabel('选择项目内容', { exact: true }).selectOption(savedDeck.id);
  await insert.click();
  await picker.selectOption('chart');
  await owner.getByLabel('选择项目内容', { exact: true }).selectOption(savedSheet.id);
  await owner
    .locator('.office-live')
    .getByLabel('图表类型', { exact: true })
    .selectOption('stream');
  await insert.click();
  const blocks = (doc) => doc?.body.split('\n').map(readOfficeBlock).filter(Boolean) ?? [];
  const rich = await until(
    () => getDocument(proseTitle),
    (doc) => blocks(doc).length === 3,
    'Resources were saved to the shared document',
  );
  assert.deepEqual(
    blocks(rich).map((block) => block.kind),
    ['audio', 'reference', 'chart'],
  );
  const document = await download(owner, '.docx');
  const relationships = strFromU8(document['word/_rels/document.xml.rels']);
  assert.ok(Object.keys(document).some((key) => /^word\/media\/.+\.png$/.test(key)));
  assert.match(relationships, /office-audio/);
  assert.match(relationships, /documents/);
  await owner.getByRole('button', { name: '退出共编', exact: true }).click();
  await openDocument(owner, deckTitle);
  await slides.getByLabel('画布图层', { exact: true }).selectOption({ label: '1 · 画布位置保留' });
  assert.equal(
    Number(await slides.getByLabel('X', { exact: true }).inputValue()),
    savedSlide.elements[0].x,
  );
  await openDocument(owner, sheetTitle);
  assert.equal(
    await worksheet.getByRole('textbox', { name: 'C3', exact: true }).inputValue(),
    '27',
  );
  report.resources = {
    version: rich.version,
    audioRangeStatus: audio.status(),
    externalProjectAccessDenied: true,
    crossReferenceAndChartInDocument: true,
  };

  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.externalRequests, []);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await new Promise((done) => (web ? web.httpServer.close(done) : done()));
  await fixture?.close();
}
