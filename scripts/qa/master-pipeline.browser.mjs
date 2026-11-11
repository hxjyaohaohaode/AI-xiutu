import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import sharp from 'sharp';

const token = process.env.MEDIA_QA_BROWSER_TOKEN;
const webPort = Number(process.env.MEDIA_QA_WEB_PORT);
const folder = resolve(process.env.MEDIA_QA_OUTPUT ?? 'artifacts/master-pipeline');
if (!token || !Number.isSafeInteger(webPort) || webPort < 1024 || !process.env.PORT)
  throw new Error('Run against the local master-pipeline API fixture');
const setup = JSON.parse(await readFile(resolve(folder, 'report.json'), 'utf8'));
const assets = setup.sources.filter((source) => source.linear);
assert.ok(assets.length);
const origin = 'http://127.0.0.1:' + webPort;
const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || undefined,
});
const vite = await createServer({
  configFile: resolve('apps/web/vite.config.ts'),
  server: { host: '127.0.0.1', port: webPort, strictPort: true },
});
const output = resolve(folder, 'browser');
await mkdir(output, { recursive: true });
const cases = [];
try {
  await vite.listen();
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 1024, height: 768, hasTouch: true },
    { width: 320, height: 640, hasTouch: true },
    { width: 844, height: 390, hasTouch: true },
  ]) {
    const { hasTouch, ...size } = viewport;
    const context = await browser.newContext({
      viewport: size,
      hasTouch,
      acceptDownloads: true,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const asset = assets[cases.length % assets.length];
    try {
      await context.addCookies([
        { name: 'xiutu_session', value: token, url: origin, httpOnly: true },
      ]);
      await page.goto(origin + '/#/studio');
      const toggle = page.getByRole('button', { name: '打开空间与项目', exact: true });
      const sidebar = page.locator('.sidebar');
      await toggle.click();
      await sidebar.getByRole('button', { name: /^V4 team/ }).click();
      if (!(await sidebar.getByRole('navigation', { name: '项目', exact: true }).isVisible()))
        await toggle.click();
      await sidebar
        .getByRole('navigation', { name: '项目', exact: true })
        .getByRole('button', { name: 'V4 project', exact: true })
        .click();
      const view = page.getByRole('button', { name: '切换工作视图' });
      if (await view.isVisible()) {
        await view.click();
        await page
          .getByRole('dialog', { name: '工作视图', exact: true })
          .locator('button[data-view="works"]')
          .click();
      } else {
        await page
          .getByRole('navigation', { name: '工作视图', exact: true })
          .getByRole('button', { name: '作品', exact: true })
          .click();
      }
      const card = page.locator('.library-asset').filter({
        has: page.getByRole('button', {
          name: '打开素材 ' + asset.name,
          exact: true,
        }),
      });
      async function open() {
        await card.waitFor();
        const action = card.getByRole('button', { name: '查看原件与母版', exact: true });
        const details = card.locator('.library-asset-details > summary');
        if (!(await action.isVisible()) && (await details.count())) await details.click();
        await action.click();
      }
      await open();
      const media = page.getByRole('region', { name: '原件与母版', exact: true });
      const preview = media.locator('.media-tile-viewport');
      const grade = media.locator('summary', { hasText: '母版高位深调色' });
      await media.getByRole('button', { name: '1:1', exact: true }).click();
      await preview.locator('[data-native-window="true"] img').waitFor();
      await grade.click();
      await page.waitForFunction(
        () => document.querySelector('.media-tile-viewport')?.dataset.mediaPreview === 'ready',
      );
      const slider = media.getByRole('slider', { name: '曝光', exact: true });
      const previous = await slider.inputValue();
      const frame = preview.locator('.media-precision-frame img');
      const before = await frame.getAttribute('src');
      let liveNativeFrames;
      if (size.width >= 1024) {
        const nativeSize = await frame.evaluate((img) => [img.naturalWidth, img.naturalHeight]);
        assert.ok(nativeSize.every((edge) => edge > 0));
        await slider.scrollIntoViewIfNeeded();
        const box = await slider.boundingBox();
        assert.ok(box);
        const [min, max] = await slider.evaluate((input) => [Number(input.min), Number(input.max)]);
        const travel = box.width - 13;
        const start = {
          x: box.x + 6.5 + (travel * (Number(previous) - min)) / (max - min),
          y: box.y + box.height * 0.5,
        };
        const distance = (travel * Math.min(1.25, max - Number(previous))) / (max - min);
        const cdp = hasTouch ? await context.newCDPSession(page) : null;
        const touch = (type, point) =>
          cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: point ? [{ ...point, id: 1 }] : [],
          });
        const live = new Set();
        if (cdp) await touch('touchStart', start);
        else {
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
        }
        for (let step = 1; step <= 42; step++) {
          const point = { x: start.x + (step / 42) * distance, y: start.y };
          if (cdp) await touch('touchMove', point);
          else await page.mouse.move(point.x, point.y);
          await page.waitForTimeout(110);
          const next = await frame.evaluate((img) => ({
            url: img.getAttribute('src'),
            size: [img.naturalWidth, img.naturalHeight],
          }));
          if (next.url !== before && next.size.every((edge) => edge > 0)) {
            assert.deepEqual(next.size, nativeSize);
            live.add(next.url);
          }
        }
        if (cdp) await touch('touchEnd');
        else await page.mouse.up();
        assert.ok(live.size >= 2, 'A held drag displays successive native-size frames');
        liveNativeFrames = { count: live.size, width: nativeSize[0], height: nativeSize[1] };
      } else await slider.press('ArrowRight');
      const after = await slider.inputValue();
      assert.notEqual(previous, after);
      await page.waitForFunction(
        (url) =>
          document.querySelector('.media-tile-viewport')?.dataset.mediaPreview === 'ready' &&
          document.querySelector('.media-precision-frame img')?.getAttribute('src') !== url,
        before,
      );
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          response.url().endsWith('/assets/' + asset.assetId + '/media/grades'),
      );
      await media.getByRole('button', { name: '保存母版调色版本', exact: true }).click();
      const response = await saved;
      assert.equal(response.status(), 201);
      const revision = (await response.json()).grade;
      assert.equal(revision.edit.exposure, Number(after));
      if (asset.algorithm === 'scene-linear-v2') {
        assert.equal(revision.edit.algorithm, asset.algorithm);
        assert.deepEqual(revision.edit.curves, asset.curves);
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 1, 'Page overflow: ' + overflow);
      await preview.scrollIntoViewIfNeeded();
      if (size.height >= 740) {
        const clearPreview = await preview.evaluate((viewport) => {
          const rect = viewport.getBoundingClientRect();
          const header = viewport.closest('.modal')?.querySelector('.modal-header');
          const top = Math.max(rect.top, header?.getBoundingClientRect().bottom ?? 0);
          const bottom = Math.min(rect.bottom, innerHeight);
          const x = rect.left + rect.width / 2;
          if (bottom - top < 20) return false;
          for (let y = top + 8; y < bottom - 8; y += 8)
            if (!viewport.contains(document.elementFromPoint(x, y))) return false;
          return true;
        });
        assert.equal(
          clearPreview,
          true,
          'The pinned photo is free of overlaid adjustment controls',
        );
      }
      await page.screenshot({ path: resolve(output, size.width + '-native.png') });
      await grade.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(output, size.width + '-controls.png') });
      let downloadBytes;
      if (size.width === 1440) {
        await media.getByRole('combobox', { name: '母版输出格式', exact: true }).click();
        await media.getByRole('option', { name: 'PNG 16-bit', exact: true }).click();
        const download = page.waitForEvent('download');
        await media.getByRole('button', { name: '导出调色母版', exact: true }).click();
        const stream = await (await download).createReadStream();
        const parts = [];
        for await (const part of stream) parts.push(part);
        const png = Buffer.concat(parts);
        const info = await sharp(png).metadata();
        assert.deepEqual(
          [info.width, info.height, info.depth],
          [asset.width, asset.height, 'ushort'],
        );
        downloadBytes = png.length;
      }
      await page
        .getByRole('dialog')
        .filter({ has: media })
        .getByRole('button', { name: '关闭窗口', exact: true })
        .click();
      await media.waitFor({ state: 'hidden' });
      await open();
      await grade.click();
      assert.equal(await slider.inputValue(), after);
      assert.deepEqual(errors, []);
      cases.push({
        ...size,
        asset: asset.name,
        nativeWindow: true,
        liveNativeFrames,
        revision: revision.version,
        persistedExposure: Number(after),
        overflow,
        downloadBytes,
      });
      console.log(JSON.stringify(cases.at(-1)));
    } catch (error) {
      await page.screenshot({ path: resolve(output, size.width + '-failure.png') });
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await writeFile(
    resolve(output, 'report.json'),
    JSON.stringify({ browser: browser.version(), cases }, null, 2),
  );
  await vite.close();
  await browser.close();
}
