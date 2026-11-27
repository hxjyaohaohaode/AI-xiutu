/** Verify the normal studio comparison gestures and full-resolution detail export in Chromium. */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { createColorBlockV3, createRecipeV4, renderEditorRecipeTiled } from '@ai-xiutu/editor';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.ts';
import { showEditorTopbar } from './studio-navigation.mjs';

const database = process.env.TEST_DATABASE_URL;
assert.ok(process.env.CI === 'true' && database && /test/.test(new URL(database).pathname));
const port = Number(process.env.PHOTO_COMPARE_PORT ?? 4179);
const origin = 'http://127.0.0.1:' + port;
const out = resolve(process.env.BROWSER_ARTIFACT_DIR ?? 'artifacts/photo-export-compare');
await mkdir(out, { recursive: true });
const fixture = await collaborationFixture(database, { origin });
let server, browser;
const errors = [];
try {
  await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  process.env.PORT = String(fixture.app.server.address().port);
  server = await preview({
    configFile: resolve('apps/web/vite.config.ts'),
    ...(process.env.BROWSER_BUILD_DIR
      ? { build: { outDir: resolve(process.env.BROWSER_BUILD_DIR) } }
      : {}),
    preview: { host: '127.0.0.1', port, strictPort: true },
  });

  // An opaque real photograph just above the native editing-raster budget.
  const width = 2400,
    height = 1800;
  const source = await sharp('apps/web/public/about/stories/ceramics-original.webp')
    .resize(width, height, { fit: 'cover' })
    .removeAlpha()
    .png()
    .toBuffer();
  const mobileSource = await sharp(source).resize({ width: 960 }).png().toBuffer();
  const recipe = createRecipeV4({
    geometry: { crop: { x: 0.1, y: 0.1, width: 0.47, height: 0.49 }, rotation: 90, flipX: true },
    adjustments: { exposure: 0.2, sharpness: 35 },
    compositeGrade: createColorBlockV3({ adjustments: { shadows: -17 } }),
    detail: { clarity: -17 },
    effects: { grain: { amount: 16, colored: true }, vignette: { amount: 12 } },
  });
  const original = new Uint8ClampedArray(await sharp(source).ensureAlpha().raw().toBuffer());
  const reference = renderEditorRecipeTiled({ width, height, data: original }, recipe, {
    maxPixels: width * height,
  });
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 820, height: 1180 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE,
      channel: process.env.BROWSER_EXECUTABLE ? undefined : process.env.BROWSER_CHANNEL,
      args: ['--disable-gpu', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      viewport,
      locale: 'zh-CN',
      hasTouch: viewport.width < 1000,
      reducedMotion: 'reduce',
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.addInitScript(() => {
        window.auxiliarySourceUploads = 0;
        const post = Worker.prototype.postMessage;
        Worker.prototype.postMessage = function (data, ...rest) {
          if (data?.type === 'source' && data.sourceDimensions && !data.original)
            window.auxiliarySourceUploads++;
          return post.call(this, data, ...rest);
        };
      });
      await page.goto(origin + '/#/studio');
      await page
        .getByLabel('选择照片', { exact: true })
        .setInputFiles({
          name: 'Ceramics.png',
          mimeType: 'image/png',
          buffer: viewport.width === 1440 ? source : mobileSource,
        });
      const canvas = page
        .locator('.canvas-stage.has-image[aria-busy="false"] .image-frame canvas:visible')
        .first();
      await canvas.waitFor();
      const compare = page.locator('.compare-press:visible').first();
      const slider = page.locator('.compare-reveal-input');
      await compare.click();
      await slider.waitFor();
      assert.equal(
        await page.evaluate(() => window.auxiliarySourceUploads),
        0,
        'untransformed before/after reuses the decoded display source',
      );
      await slider.press('Escape');
      await page.getByLabel('选择配方文件', { exact: true }).setInputFiles({
        name: 'detail.recipe.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(recipe)),
      });
      await page.getByText('配方已应用到本地编辑。', { exact: true }).waitFor();
      await canvas.waitFor();

      await compare.click();
      await slider.waitFor();
      assert.equal(
        await page.evaluate(() => window.auxiliarySourceUploads),
        1,
        'transformed comparison starts one auxiliary worker on demand',
      );
      await slider.press('Home');
      assert.equal(
        await page.locator('.compare-reveal-before').evaluate((el) => getComputedStyle(el).opacity),
        '0',
      );
      await slider.press('End');
      assert.equal(
        await page.locator('.compare-reveal-after').evaluate((el) => getComputedStyle(el).opacity),
        '0',
      );
      await slider.press('Home');
      for (let i = 0; i < 5; i++) await slider.press('PageUp');
      await page.screenshot({ path: join(out, viewport.width + 'x' + viewport.height + '.png') });
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      );
      await slider.press('Escape');

      // Freeze browser time so the release lands in the former 230–260 ms double-activation window.
      await page.clock.install({ time: new Date('2026-11-01T12:00:00Z') });
      await page.clock.pauseAt(new Date('2026-11-01T12:00:02Z'));
      const rect = await compare.boundingBox();
      assert.ok(rect);
      await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await page.mouse.down();
      await page.clock.runFor(241);
      assert.equal(await compare.getAttribute('aria-pressed'), 'true');
      await page.mouse.up();
      assert.equal(await compare.getAttribute('aria-pressed'), 'false');
      assert.equal(await slider.count(), 0);
      await page.clock.resume();

      if (viewport.width === 1440) {
        await showEditorTopbar(page);
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 120_000 }),
          page.locator('[data-action="download-photo"]:visible').first().click(),
        ]);
        const result = await sharp(await download.path())
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        assert.deepEqual(
          [result.info.width, result.info.height],
          [reference.width, reference.height],
        );
        assert.equal(
          Buffer.compare(result.data, Buffer.from(reference.data)),
          0,
          'native PNG matches all reference RGBA bytes',
        );
        console.log(
          'Decoded native cropped PNG and matched every RGBA byte:',
          reference.width,
          reference.height,
        );
        const exportDialog = page.locator('dialog.export-dialog:visible');
        if (await exportDialog.isVisible()) {
          await page.keyboard.press('Escape');
          await exportDialog.waitFor({ state: 'hidden' });
        }
      }
      const lightTool = page.locator('[data-dock-tool="light"]');
      if (await lightTool.getAttribute('aria-pressed') !== 'true') await lightTool.click();
      const balance = page.locator('.editor-light-suggestion:visible');
      await balance.locator('summary').click();
      await balance.getByLabel('光线方向').selectOption('open-shadows');
      await balance.getByRole('button', { name: '分析当前画面' }).click();
      const apply = balance.getByRole('button', { name: '应用光线建议' });
      await apply.waitFor();
      assert.match(await balance.getByRole('list', { name: '建议参数' }).innerText(), /阴影\s+-17 →/);
      await apply.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(out, 'light-' + viewport.width + '.png') });
      await apply.click();
      await apply.waitFor({ state: 'hidden' });
      await canvas.waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      console.log('Comparison, keyboard, 241 ms hold and viewport overflow passed', viewport);
    } finally {
      await browser.close();
      browser = undefined;
    }
  }
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  if (server) await new Promise((done) => server.httpServer.close(done));
  await fixture.close();
}
