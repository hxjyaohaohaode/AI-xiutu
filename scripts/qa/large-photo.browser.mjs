/** Imports actual large photographs through the studio and compares original downloads before and after saving. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { preview } from 'vite';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.ts';
import { showEditorTopbar } from './studio-navigation.mjs';

const fixtures = process.argv.slice(2).map((file) => resolve(file));
const databaseUrl = process.env.TEST_DATABASE_URL;
assert.ok(process.env.CI === 'true' && process.env.NODE_ENV !== 'production' && databaseUrl &&
  /test/.test(new URL(databaseUrl).pathname) && fixtures.length, 'Use a disposable test database and pass source photos.');
process.env.MEDIA_ADVANCED_ENABLED = 'false';
const port = Number(process.env.BROWSER_WEB_PORT || 4195);
const origin = 'http://127.0.0.1:' + port;
async function sha256(stream) {
  const hash = createHash('sha256');
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}
const digest = (file) => sha256(createReadStream(file));
const pixelDigest = (file) => sha256(sharp(file, { sequentialRead: true }).autoOrient().toColourspace('srgb').ensureAlpha().raw());
const fixture = await collaborationFixture(databaseUrl, { origin });
let server, browser;
const errors = [];
async function enterProject(context, existing) {
  const page = await context.newPage();
  page.setDefaultTimeout(75_000);
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/#/studio');
  const nav = page.getByRole('button', { name: '打开空间与项目', exact: true });
  await nav.click();
  await page.locator('dialog.sidebar-navigation-modal').getByRole('button', { name: /^V4 team/ }).click();
  await nav.click();
  await page.getByRole('navigation', { name: '项目', exact: true }).getByRole('button', { name: 'V4 project', exact: true }).click();
  if (existing) {
    await page.locator('.saved-work-open').filter({ hasText: existing }).first().click();
    await page.locator('.canvas-stage.has-image[aria-busy="false"] .image-frame canvas:visible').first().waitFor();
  }
  return page;
}
async function compareOriginal(page, file, expected, cloud) {
  const filename = basename(file);
  await showEditorTopbar(page);
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const dialog = page.locator('dialog.export-dialog[open]');
  const originalOutput = '原片编辑成品 · ' + expected.width + ' × ' + expected.height;
  const dimensions = dialog.getByRole('combobox', { name: '输出尺寸', exact: true });
  await dimensions.click();
  const choices = page.getByRole('listbox', { name: '输出尺寸', exact: true });
  await choices.getByText(originalOutput, { exact: true }).click();
  assert.ok((await dimensions.textContent()).includes(originalOutput));
  const link = dialog.getByRole(cloud ? 'link' : 'button', { name: '下载原件', exact: true });
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  assert.equal(download.suggestedFilename(), filename);
  assert.equal(await digest(await download.path()), expected.hash);
  if (cloud && extname(file).toLowerCase() === '.png') {
    // This is the actual export control. Observe the authenticated source read
    // and hash the complete resulting raster independently of its PNG encoding.
    const [source, result] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'GET' && /\/v1\/assets\/[^/]+\/media\/original$/.test(r.url())),
      page.waitForEvent('download', { timeout: 120_000 }),
      dialog.getByRole('button', { name: '下载 PNG', exact: true }).click(),
    ]);
    assert.equal(source.status(), 200);
    assert.equal(result.suggestedFilename(), filename.replace(/\.png$/i, '-编辑.png'));
    const output = await result.path(), metadata = await sharp(output).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['png', expected.width, expected.height]);
    const rgbaSha256 = await pixelDigest(output);
    assert.equal(rgbaSha256, await pixelDigest(file));
    console.log(JSON.stringify({ renderedFromCloudOriginal: filename, width: metadata.width, height: metadata.height, rgbaSha256 }));
  }
  await dialog.getByRole('button', { name: '关闭窗口', exact: true }).click();
}
async function context() {
  // Use a separate browser context to prove that a later session uses the stored original.
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE
    ? { executablePath: process.env.BROWSER_EXECUTABLE, args: ['--no-zygote', '--single-process', '--disable-gpu'] }
    : { channel: process.env.BROWSER_CHANNEL || undefined });
  const result = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  await result.addCookies([{ name: 'xiutu_session', value: fixture.actors.owner.cookie.split('=')[1], url: origin }]);
  return result;
}
try {
  await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(fixture.app.server.address().port);
  server = await preview({ configFile: resolve('apps/web/vite.config.ts'),
    ...(process.env.BROWSER_BUILD_DIR ? { build: { outDir: resolve(process.env.BROWSER_BUILD_DIR) } } : {}),
    preview: { host: '127.0.0.1', port, strictPort: true } });
  for (const file of fixtures) {
    const filename = basename(file), { width, height } = (await sharp(file).metadata()).autoOrient;
    const expected = { width, height, hash: await digest(file) };
    console.log('Opening', filename);
    const local = await context(), page = await enterProject(local);
    let uploads = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/media-imports')) uploads++;
    });
    await page.getByLabel('选择照片', { exact: true }).setInputFiles(file);
    await page.locator('.canvas-stage.has-image[aria-busy="false"] .image-frame canvas:visible').first().waitFor();
    console.log('Loaded the editing raster', filename);
    await compareOriginal(page, file, expected, false);
    assert.equal(uploads, 0);
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/artworks'), { timeout: 180_000 }),
      page.getByRole('button', { name: '保存', exact: true }).click(),
    ]);
    assert.equal(created.status(), 201, await created.text());
    const work = (await created.json()).artwork;
    assert.equal(work.projectId, fixture.projectId);
    assert.equal(uploads, 1);
    console.log('Saved artwork', work.id);
    await browser.close();
    const later = await context(), reopened = await enterProject(later, work.title);
    await compareOriginal(reopened, file, expected, true);
    await browser.close();
    console.log(JSON.stringify({ filename, width, height, originalSha256: expected.hash, artworkId: work.id,
      localDownload: 'matched', cloudDownload: 'matched' }));
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  if (server) await new Promise((done) => server.httpServer.close(done));
  await fixture.close();
}
