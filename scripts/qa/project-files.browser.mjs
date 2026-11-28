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
const editedBody = body.replace('\t12\t50%', '\t19\t62.5%');
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
    assert.equal(source.context, editedBody);
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

async function checkFormattedDocument(page, fixture) {
  const text = '  今天的重点  A😀\n\n保留空行与空格。';
  const docTitle = '版式验收';
  const editor = page.locator('.document-editor');
  await page.getByRole('complementary',{name:'项目文档列表'}).getByRole('button', { name: '新建文档', exact: true }).click();
  await page.getByLabel('文档标题', { exact: true }).fill(docTitle);
  await page.getByRole('button', { name: '文字排版', exact: true }).click();
  const rich=editor.locator('.ProseMirror');
  await rich.focus();
  await rich.evaluate((el,value)=>{
    const data=new DataTransfer();
    data.setData('text/plain',value);
    data.setData('text/html','<strong>different content</strong><img src="https://example.invalid/image">');
    el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  },text);
  assert.deepEqual(await rich.locator('p').allTextContents(),text.split('\n'));
  assert.equal(await rich.locator('img,strong').count(),0);
  const paragraph = editor.locator('.ProseMirror > p').first();
  await paragraph.evaluate(node => {
    const target = node.firstChild;
    const from = target.textContent.indexOf('重点');
    const range = document.createRange();
    range.setStart(target, from); range.setEnd(target, from + 2);
    node.closest('[contenteditable=true]').focus();
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  });
  await page.keyboard.press('Control+b');
  await editor.getByRole('button',{name:'斜体',exact:true}).click();
  await editor.getByRole('button',{name:'下划线',exact:true}).click();
  await editor.getByRole('combobox',{name:'字体',exact:true}).selectOption('Georgia');
  await editor.getByRole('combobox',{name:'字号',exact:true}).selectOption('24');
  await editor.getByRole('radiogroup',{name:'段落对齐',exact:true}).getByRole('button',{name:'居中',exact:true}).click();
  await editor.getByRole('combobox',{name:'段后间距',exact:true}).selectOption('12');
  const [created] = await Promise.all([page.waitForResponse(r =>
    r.request().method()==='POST' && r.url().endsWith('/documents')), editor.getByRole('button',{name:'保存文档',exact:true}).click()]);
  assert.equal(created.status(),201);
  const saved = (await created.json()).document;
  assert.equal(saved.body,text);
  assert.deepEqual(saved.formatting, {version:1,paragraphs:[{line:0,align:'center',after:12,
    runs:[{from:5,to:7,font:'Georgia',size:24,bold:true,italic:true,underline:true}]}]});
  const row = page.locator('.document-row').filter({ hasText:docTitle });
  await row.waitFor();
  await page.getByRole('complementary',{name:'项目文档列表'}).getByRole('button', { name: '新建文档', exact: true }).click();
  await row.click();
  await paragraph.locator('strong em u').waitFor();
  assert.equal(await paragraph.textContent(),text.split('\n')[0]);
  assert.equal(await paragraph.evaluate(e=>getComputedStyle(e).textAlign),'center');
  assert.equal(await paragraph.locator('strong em u span').last().evaluate(e=>getComputedStyle(e).fontSize),'32px');
  await page.screenshot({path:resolve(artifacts,'formatted-editor.png')});
  const menu=editor.getByRole('combobox',{name:'下载文件'});
  const word=unzipSync(await readFile(await downloadFrom(menu,'.docx',docTitle+'.docx','formatted.docx')));
  const slide=unzipSync(await readFile(await downloadFrom(menu,'.pptx',docTitle+'.pptx','formatted.pptx')));
  const w=strFromU8(word['word/document.xml']), d=strFromU8(slide['ppt/slides/slide1.xml']);
  for(const part of ['Georgia','重点','  今天的','  A😀','保留空行与空格。']) { assert.ok(w.includes(part),part); assert.ok(d.includes(part),part); }
  assert.match(w, /<w:jc w:val="center"/); assert.match(w, /w:after="240"/); assert.match(w, /<w:sz w:val="48"/);
  assert.match(d, /algn="ctr"/); assert.match(d, /sz="2400"/); assert.match(d, /<a:latin typeface="Georgia"/);
  const call=(method,url,payload,actor='owner')=>fixture.call(method,url,payload,actor);
  const url='/v1/documents/'+saved.id;
  assert.equal((await call('PATCH',url,{expectedVersion:1,title:'denied'},'viewer')).statusCode,403);
  const inconsistent=structuredClone(saved.formatting);
  inconsistent.paragraphs[0].runs[0].to=1000;
  assert.equal((await call('PATCH',url,{expectedVersion:1,formatting:inconsistent})).statusCode,400);
  const next=await call('PATCH',url,{expectedVersion:1,title:'协作修改'});
  assert.equal(next.statusCode,200,next.body);
  assert.deepEqual(next.json().document.formatting,saved.formatting);
  // Another editor saved v2. Keep the local selection's draft visible on a stale version.
  await editor.getByLabel('文档标题',{exact:true}).fill('我的本地标题');
  const [stale]=await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith(url.slice(3))),
    editor.getByRole('button',{name:'保存文档',exact:true}).click()]);
  assert.equal(stale.status(),409);
  assert.equal(await editor.getByLabel('文档标题',{exact:true}).inputValue(),'我的本地标题');
  assert.equal(await paragraph.textContent(),text.split('\n')[0]);
  const policyUrl='/v1/spaces/'+fixture.teamId+'/sharing-policy';
  const policy=(await call('GET',policyUrl)).json().policy;
  assert.equal((await call('PUT',policyUrl,{...policy,allowCopy:true})).statusCode,200);
  const copy=await call('POST','/v1/projects/'+fixture.projectId+'/copy',{idempotencyKey:randomUUID(),title:'格式副本'});
  assert.equal(copy.statusCode,201,copy.body);
  const copyId=copy.json().project.id;
  const docs=await call('GET','/v1/projects/'+copyId+'/documents');
  const copied=docs.json().documents.find(d=>d.title==='协作修改');
  assert.deepEqual(copied.formatting,saved.formatting);
  assert.equal(copied.version,1);
  assert.deepEqual((await fixture.db.query('SELECT formatting FROM document_versions WHERE document_id=$1',[copied.id])).rows[0].formatting,saved.formatting);
  // A background update while the confirmation is open should not invalidate
  // the user's local draft identity or prevent reading the latest revision.
  await editor.getByRole('button',{name:'读取最新版本',exact:true}).click();
  const confirm = page.getByRole('dialog').getByRole('button', {name:'确认继续',exact:true});
  await confirm.waitFor();
  const nonRich=await call('PATCH',url,{expectedVersion:2,body:'新行\n'+text});
  assert.equal(nonRich.statusCode,200);
  assert.equal(nonRich.json().document.formatting.paragraphs[0].line,1);
  const history = await fixture.db.query('SELECT version,formatting FROM document_versions WHERE document_id=$1 ORDER BY version',[saved.id]);
  assert.deepEqual(history.rows.map(r=>r.formatting.paragraphs[0].line),[0,0,1]);
  await page.locator('.document-row').filter({ hasText:'协作修改' }).getByText(/V3/).waitFor();
  await confirm.click();
  await page.waitForFunction(()=>document.querySelector('.document-title')?.value==='协作修改');
  await editor.getByRole('button', { name:'版本历史',exact:true }).click();
  const versions = page.getByRole('dialog',{name:'版本历史',exact:true});
  await versions.getByRole('button',{name:/^版本 1 ·/}).click();
  await versions.getByRole('button',{name:'载入为草稿',exact:true}).click();
  await page.waitForFunction(value=>document.querySelector('.document-title')?.value===value, docTitle);
  const [loaded] = (await fixture.db.query('SELECT version,body FROM documents WHERE id=$1', [saved.id])).rows;
  assert.deepEqual([loaded.version, loaded.body], [3, '新行\n'+text]);
  const [restored] = await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith(url.slice(3))),
    editor.getByRole('button',{name:'保存文档',exact:true}).click()]);
  assert.equal(restored.status(),200);
  const restoredDoc = (await restored.json()).document;
  assert.deepEqual([restoredDoc.version, restoredDoc.body, restoredDoc.formatting], [4, text, saved.formatting]);
  report.formatted = { originalBody:text, version:saved.version, formatted:saved.formatting,
    historicalParagraphLines:[0,0,1], staleStatus:stale.status(), unauthorizedStatus:403, nativeFormats:['docx','pptx'] };
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
  vite = await preview({ configFile: resolve('apps/web/vite.config.ts'), build: { outDir: process.env.BROWSER_DIST_DIR || resolve('apps/web/dist') }, preview: { host: '127.0.0.1', port, strictPort: true } });
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
  await checkFormattedDocument(page, fixture);
  await page.getByRole('complementary', { name: '项目文档列表' }).getByRole('button', { name: '新建文档', exact: true }).click();
  const composer = page.getByRole('region', { name: '文档内容与排版' });
  const editor = composer.getByRole('textbox', { name: '文档内容' });
  const written = '第三章\n中文强调\n\n类别 | 值\n---|---\n武汉 | 2\n恩施 | -3';
  await page.getByLabel('文档标题', { exact: true }).fill('排版验收');
  await editor.fill(written);
  await editor.evaluate(el => { el.focus(); el.setSelectionRange(0, 3); });
  await composer.getByRole('button', { name: '小标题', exact: true }).click();
  await editor.fill((await editor.inputValue()).replace('中文强调','中文***强调***'));
  await composer.getByRole('button', { name: '排版设置' }).click();
  await composer.getByLabel('全文字体', { exact: true }).selectOption('SimSun');
  await composer.getByLabel('正文字号').selectOption('16');
  await composer.getByLabel('行距').selectOption('1.5');
  await composer.getByLabel('全文对齐').selectOption('center');
  await composer.getByLabel('图表类型').selectOption('line');
  await composer.getByRole('button', { name: '排版预览' }).click();
  assert.equal(await composer.locator('strong em').innerText(), '强调');
  const bodySize = await composer.locator('.office-prose p').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(Math.abs(bodySize - 16 * 96 / 72) < .1, 'Preview must display the selected point size');
  assert.equal(await composer.getByRole('table').locator('tbody tr').count(), 2);
  for (const [width, height] of [[1400,900],[820,1100],[390,844],[844,390]]) {
    await page.setViewportSize({ width, height });
    const actual = await composer.boundingBox();
    assert.ok(actual && actual.x >= -1 && actual.x + actual.width <= width + 1, JSON.stringify(actual));
    await composer.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(artifacts, 'composer-' + width + '.png') });
  }
  await page.setViewportSize({ width: 1400, height: 900 });
  await composer.getByRole('button', { name: '图表预览' }).click();
  const graph = composer.getByRole('img', { name: '图表预览' });
  await graph.evaluate(image => image.decode());
  // Single-unit tables use the themed engine; mixed units keep the per-series layout.
  assert.match(decodeURIComponent(await graph.getAttribute('src')), /<polyline |data-chart-kind="line"/);
  const [styledSave] = await Promise.all([page.waitForResponse(response =>
    response.request().method() === 'POST' && response.url().endsWith('/documents')),
    page.getByRole('button', { name: '保存文档', exact: true }).click()]);
  assert.equal(styledSave.status(), 201);
  const styledDocument = (await styledSave.json()).document;
  assert.ok(styledDocument.body.includes('***强调***'));
  assert.equal(styledDocument.formatting.layout.font,'SimSun');
  assert.deepEqual(styledDocument.formatting.paragraphs,[]);
  const formattedMenu = page.locator('.document-editor').getByRole('combobox', { name: '下载文件' });
  for (const format of ['docx','pptx','xlsx','svg']) {
    const path = await downloadFrom(formattedMenu, '.' + format, '排版验收.' + format);
    const bytes = await readFile(path);
    if (format === 'svg') assert.match(bytes.toString(), /<polyline |data-chart-kind="line"/);
    else {
      const contents = unzipSync(bytes);
      if (format === 'docx') {
        assert.match(strFromU8(contents['word/document.xml']), /Heading2/);
        assert.match(strFromU8(contents['word/styles.xml']), /w:line="360"/);
      } else {
        const charts = Object.entries(contents).filter(([name]) => /charts\/chart\d+\.xml$/.test(name));
        assert.ok(charts.some(([, xml]) => strFromU8(xml).includes('<c:lineChart>')));
      }
    }
  }
  report.formatting = { version: styledDocument.version, font: 'SimSun', spacing: 1.5, chart: 'line',
    viewports: 4, formats: ['docx','pptx','xlsx','svg'] };
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
  const worksheet = page.getByRole('region',{name:'工作表',exact:true});
  assert.equal(await worksheet.getByRole('textbox',{name:'B2',exact:true}).inputValue(),'12');
  assert.equal(saved.status(), 201);
  const source = (await saved.json()).document;
  assert.deepEqual([source.title, source.body, source.version], [title, body, 1]);
  report.imported = { file: 'project-data.xlsx', sheet: '源数据', range: 'A1:C3', sha256: sourceHash, inputFormat: 'xlsx' };
  await worksheet.getByRole('textbox',{name:'B2',exact:true}).fill('19');
  await worksheet.getByRole('textbox',{name:'C2',exact:true}).fill('62.5%');
  await worksheet.getByRole('button',{name:'图表预览'}).click();
  const chartSource=decodeURIComponent(await worksheet.getByRole('img',{name:'当前工作表图表'}).getAttribute('src'));
  assert.ok(chartSource.includes('武汉 · 数量 · 19'));
  assert.ok(chartSource.includes('武汉 · 完成率 · 62.5%'));
  const [updated]=await Promise.all([page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/documents/'+source.id)),
    page.locator('.document-editor').getByRole('button',{name:'保存文档'}).click()]);
  assert.equal(updated.status(),200);
  const revision=(await updated.json()).document;
  assert.deepEqual([revision.version,revision.body],[2,editedBody]);
  const firstVersion=(await fixture.db.query('SELECT body FROM document_versions WHERE document_id=$1 AND version=1',[source.id])).rows[0];
  assert.equal(firstVersion.body,body);
  await worksheet.getByRole('button',{name:'正文',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'文档内容',exact:true}).inputValue(),editedBody);
  await page.locator('.document-editor').getByRole('button',{name:'工作表',exact:true}).click();
  report.editedWorksheet = {version:2,cells:{B2:19,C2:'62.5%'},previewMatched:true};
  const docsMenu = page.locator('.document-editor').getByRole('combobox', { name: '下载文件', exact: true });
  for (const [width, height, format] of [[1400,900,'docx'],[820,1100,'pptx'],[390,844,'xlsx'],[844,390,'svg']]) {
    await page.setViewportSize({ width, height });
    await downloadFrom(docsMenu, '.' + format, title + '.' + format);
    await page.screenshot({ path: resolve(artifacts, 'layout-' + width + '.png') });
    await page.getByRole('button', { name: '版本历史', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '版本历史', exact: true });
    await dialog.getByRole('button', { name: /^版本 1 ·/ }).click();
    await dialog.getByRole('button', { name: '载入为草稿', exact: true }).waitFor();
    const historicalRow = dialog.getByRole('row').filter({ hasText: '武汉' });
    assert.deepEqual(await historicalRow.getByRole('cell').allTextContents(), ['武汉', '12', '50%']);
    assert.ok(await dialog.evaluate(element => element.getBoundingClientRect().width <= innerWidth));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(artifacts, 'history-' + width + '.png') });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
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
  assert.ok((await picker.innerText()).includes(title + ' · V2'));
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
  assert.deepEqual([request.contextDocumentId, request.expectedDocumentVersion, request.modelId], [source.id, 2, modelId]);
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
  assert.match(sheet, /r="B2" s="0"><v>19<\/v>/);
  assert.match(sheet, /r="C2" s="2"><v>0\.625<\/v>/);
  assert.match(sheet, /r="B3" s="0"><v>-3<\/v>/);
  assert.match(sheet, /r="C3" s="2"><v>0\.37625<\/v>/);
  const chartRanges = ['Data1!$B$2:$B$3', 'Data1!$C$2:$C$3'];
  chartRanges.forEach((range, i) => assert.ok(strFromU8(book['xl/charts/chart' + (i + 1) + '.xml']).includes(range)));
  report.source = { version: request.expectedDocumentVersion, units: row.units, settlement: row.hold, chartRanges };
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
