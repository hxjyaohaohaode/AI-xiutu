import assert from 'node:assert/strict';
import { mkdir, open as openFile, readFile, stat, writeFile } from 'node:fs/promises';
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
      const windows = [];
      if (asset.tileComparison)
        page.on('response', (response) => {
          if (
            response.status() === 200 &&
            response.url().endsWith(`/assets/${asset.assetId}/media/preview`)
          ) {
            const region = response.request().postDataJSON().region;
            if (region) windows.push(region);
          }
        });
      await media.getByRole('button', { name: '1:1', exact: true }).click();
      await preview.locator('[data-native-window="true"] img').waitFor();
      await grade.click();
      await page.waitForFunction(
        () => document.querySelector('.media-tile-viewport')?.dataset.mediaPreview === 'ready',
      );
      let panAndZoom;
      if (asset.tileComparison && size.width >= 1024) {
        const initial = windows.at(-1);
        assert.ok(initial);
        await preview.scrollIntoViewIfNeeded();
        const bounds = await preview.boundingBox();
        assert.ok(bounds);
        const x = bounds.x + bounds.width * 0.42,
          y = bounds.y + bounds.height * 0.5;
        const shift = Math.min(96, bounds.width * 0.2);
        const moved = page.waitForResponse((response) => {
          const region =
            response.url().endsWith(`/assets/${asset.assetId}/media/preview`) &&
            response.status() === 200 &&
            response.request().postDataJSON().region;
          return region && Math.abs(initial.left - region.left) >= Math.floor(shift) - 2;
        });
        const cdp = hasTouch ? await context.newCDPSession(page) : null;
        if (cdp) {
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x, y }],
          });
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [{ x: x + shift, y }],
          });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.detach();
        } else {
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x + shift, y, { steps: 8 });
          await page.mouse.up();
        }
        const movedRegion = (await moved).request().postDataJSON().region;
        assert.ok(Math.abs(movedRegion.width - initial.width) <= 1);
        const zoomed = page.waitForResponse((response) => {
          const region =
            response.url().endsWith(`/assets/${asset.assetId}/media/preview`) &&
            response.status() === 200 &&
            response.request().postDataJSON().region;
          return region && region.width < movedRegion.width;
        });
        await media.getByRole('button', { name: '放大源图', exact: true }).click();
        const zoomRegion = (await zoomed).request().postDataJSON().region;
        await media.getByRole('button', { name: '1:1', exact: true }).click();
        await page.waitForFunction(
          () => document.querySelector('.media-tile-viewport')?.dataset.mediaPreview === 'ready',
        );
        panAndZoom = { initial, moved: movedRegion, zoomed: zoomRegion };
      }
      const slider = media.getByRole('slider', { name: '曝光', exact: true });
      const previous = await slider.inputValue();
      const frame = preview.locator('.media-precision-frame img');
      const before = await frame.getAttribute('src');
      const downloadFormat = size.width === 1440
        ? 'PNG 16-bit'
        : asset.tileComparison && size.width === 1024
          ? 'EXR 32-bit HDR'
          : asset.tileComparison && size.width === 320
            ? 'TIFF 16-bit'
            : undefined;
      async function downloadMaster(format) {
        await media.getByRole('combobox', { name: '母版输出格式', exact: true }).click();
        await media.getByRole('option', { name: format, exact: true }).click();
        const started = performance.now();
        const [download, prepared] = await Promise.all([
          page.waitForEvent('download', { timeout: 75_000 }),
          page.waitForResponse((response) => response.url().endsWith(`/assets/${asset.assetId}/media/export`), { timeout: 65_000 }).then(async (response) => {
            assert.equal(response.status(), 201, await response.text());
            return response.json();
          }),
          media.getByRole('button', { name: '导出调色母版', exact: true }).click(),
        ]);
        assert.equal(download.url(), `${origin}/v1/assets/${asset.assetId}/media/exports/${prepared.downloadId}`);
        assert.equal(await download.failure(), null);
        const path = await download.path();
        const downloadBytes = (await stat(path)).size;
        const downloadMs = Math.round(performance.now() - started);
        if (format === 'EXR 32-bit HDR') {
          const file = await openFile(path, 'r');
          try {
            const { buffer, bytesRead } = await file.read(Buffer.alloc(4), 0, 4, 0);
            assert.equal(bytesRead, 4);
            assert.equal(buffer.readUInt32LE(), 20_000_630);
          } finally {
            await file.close();
          }
        } else {
          const info = await sharp(path).metadata();
          assert.deepEqual([info.width, info.height, info.depth], [asset.width, asset.height, 'ushort']);
        }
        return { downloadBytes, downloadMs };
      }
      const overlapExport = asset.tileComparison && size.width === 1440 && process.env.MEDIA_QA_OVERLAP_BROWSER === '1';
      const converting = media.locator('details.editor-section').getByRole('button', {
        name: '正在转换', exact: true,
      });
      let concurrentDownload;
      if (overlapExport) {
        const request = page.waitForRequest((request) =>
          request.method() === 'POST' && request.url().endsWith(`/assets/${asset.assetId}/media/export`),
        );
        concurrentDownload = downloadMaster(downloadFormat).then((value) => ({ value }), (error) => ({ error }));
        const body = (await request).postDataJSON();
        assert.equal(body.precisionEdit.exposure, Number(previous));
        await converting.waitFor();
      }
      let liveNativeFrames;
      if (size.width >= 1024) {
        const nativeSize = await frame.evaluate((img) => [img.naturalWidth, img.naturalHeight]);
        assert.ok(nativeSize.every((edge) => edge > 0));
        await slider.evaluate((input) => input.scrollIntoView({ block: 'center', inline: 'nearest' }));
        await slider.waitFor();
        assert.ok(await slider.isEnabled());
        const box = await slider.boundingBox();
        assert.ok(box);
        const [min, max] = await slider.evaluate((input) => [Number(input.min), Number(input.max)]);
        const travel = box.width - 13;
        const start = {
          x: box.x + 6.5 + (travel * (Number(previous) - min)) / (max - min),
          y: box.y + box.height * 0.5,
        };
        assert.ok(await slider.evaluate((input, point) =>
          document.elementFromPoint(point.x, point.y) === input, start),
        'The exposure slider must receive the pointer at the starting position');
        const distance = (travel * Math.min(1.25, max - Number(previous))) / (max - min);
        await slider.evaluate((input) => {
          const viewport = document.querySelector('.media-tile-viewport');
          const canvas = document.createElement('canvas');
          canvas.width = 64;
          canvas.height = 1;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          const sample = (image) => {
            context.clearRect(0, 0, 64, 1);
            for (let index = 0; index < 64; index++) {
              const x = Math.floor((((index % 8) + 0.5) / 8) * image.naturalWidth);
              const y = Math.floor(((Math.floor(index / 8) + 0.5) / 8) * image.naturalHeight);
              context.drawImage(image, x, y, 1, 1, index, 0, 1, 1);
            }
            return context.getImageData(0, 0, 64, 1).data.join(',');
          };
          const trace = {
            start: null,
            end: null,
            pointer: null,
            inputs: 0,
            valueChanges: 0,
            baseline: sample(viewport.querySelector('.media-precision-frame img')),
            frames: [],
          };
          let lastUrl = viewport.querySelector('.media-precision-frame img').src;
          const record = () =>
            requestAnimationFrame(() => {
              const image = viewport.querySelector('.media-precision-frame img');
              if (!image?.complete || !image.naturalWidth || image.src === lastUrl) return;
              lastUrl = image.src;
              trace.frames.push({
                time: performance.now(),
                width: image.naturalWidth,
                height: image.naturalHeight,
                pixels: sample(image),
              });
            });
          const observer = new MutationObserver(record);
          observer.observe(viewport, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['src'],
          });
          viewport.addEventListener('load', record, true);
          const observeValue = new MutationObserver(() => trace.valueChanges++);
          observeValue.observe(input, { attributes: true, attributeFilter: ['aria-valuetext'] });
          input.addEventListener(
            'pointerdown',
            (event) => {
              trace.start = event.timeStamp;
              trace.pointer = event.pointerId;
            },
            { once: true, capture: true },
          );
          const end = (event) => {
            if (event.pointerId === trace.pointer && trace.end === null)
              trace.end = event.timeStamp;
          };
          const move = (event) => {
            if (event.pointerId === trace.pointer && trace.end === null) trace.inputs++;
          };
          document.addEventListener('pointerup', end, true);
          document.addEventListener('pointermove', move, true);
          window.readNativeWindowTrace = () => {
            observer.disconnect();
            observeValue.disconnect();
            viewport.removeEventListener('load', record, true);
            document.removeEventListener('pointerup', end, true);
            document.removeEventListener('pointermove', move, true);
            return trace;
          };
        });
        const cdp = hasTouch ? await context.newCDPSession(page) : null;
        const touch = (type, point) =>
          cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: point ? [{ ...point, id: 1 }] : [],
          });
        if (cdp) await touch('touchStart', start);
        else {
          await page.mouse.move(start.x, start.y);
          await page.mouse.down();
        }
        for (let step = 1; step <= 48; step++) {
          const point = { x: start.x + (step / 48) * distance, y: start.y };
          if (cdp) await touch('touchMove', point);
          else await page.mouse.move(point.x, point.y);
          await page.waitForTimeout(32);
        }
        if (cdp) await touch('touchEnd');
        else await page.mouse.up();
        const trace = await page.evaluate(() => window.readNativeWindowTrace());
        assert.ok(
          trace.start > 0 &&
            trace.end > trace.start &&
            trace.inputs >= 24 &&
            trace.valueChanges >= 24,
          JSON.stringify({
            start: trace.start,
            end: trace.end,
            inputs: trace.inputs,
            values: trace.valueChanges,
          }),
        );
        const rendered = trace.frames.filter(({ time }) => time >= trace.start && time < trace.end);
        let previousPixels = trace.baseline;
        let last = trace.start;
        const gaps = [];
        for (const item of rendered) {
          assert.deepEqual([item.width, item.height], nativeSize);
          if (item.pixels === previousPixels) continue;
          gaps.push(item.time - last);
          previousPixels = item.pixels;
          last = item.time;
        }
        const firstMs = gaps[0];
        const sorted = [...gaps, trace.end - last].sort((a, b) => a - b);
        liveNativeFrames = {
          count: gaps.length,
          width: nativeSize[0],
          height: nativeSize[1],
          inputs: trace.inputs,
          valueChanges: trace.valueChanges,
          heldMs: trace.end - trace.start,
          firstMs,
          maxGapMs: sorted.at(-1),
          p95GapMs: sorted[Math.ceil(sorted.length * 0.95) - 1],
          duringExport: !!overlapExport,
        };
        assert.ok(
          gaps.length >= 6 && firstMs < 240 && liveNativeFrames.maxGapMs < 350,
          JSON.stringify({ asset: asset.name, viewport: size, liveNativeFrames }),
        );
      } else await slider.press('ArrowRight');
      const after = await slider.inputValue();
      assert.notEqual(previous, after);
      await page.waitForFunction(
        (url) =>
          document.querySelector('.media-tile-viewport')?.dataset.mediaPreview === 'ready' &&
          document.querySelector('.media-precision-frame img')?.getAttribute('src') !== url,
        before,
      );
      let downloaded;
      if (concurrentDownload) {
        assert.ok(await converting.isVisible(), 'The native gesture finished while the master was still converting');
        const outcome = await concurrentDownload;
        if (outcome.error) throw outcome.error;
        downloaded = outcome.value;
        assert.equal(downloaded.downloadBytes, asset.files.find(({ format }) => format === 'png16').bytes);
      }
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
      if (asset.algorithm !== 'scene-linear-v1') {
        assert.equal(revision.edit.algorithm, asset.algorithm);
        assert.deepEqual(revision.edit.curves, asset.curves);
      }
      if (asset.algorithm === 'scene-linear-v3')
        assert.deepEqual(revision.edit.regions, asset.regions);
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
      if (downloadFormat && !downloaded) downloaded = await downloadMaster(downloadFormat);
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
        panAndZoom,
        liveNativeFrames,
        revision: revision.version,
        persistedExposure: Number(after),
        overflow,
        downloadFormat,
        ...downloaded,
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
