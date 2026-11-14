import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';
import sharp from 'sharp';

const out = resolve(process.env.BROWSER_ARTIFACT_DIR ?? 'artifacts/portrait-interactions');
const dist = resolve(process.env.PREVIEW_BUILT_DIST ?? 'apps/web/dist');
await mkdir(out, { recursive: true });
const file = await readFile('scripts/qa/fixtures/portrait/smile-headshot.jpg');
const photo = await sharp(file).autoOrient().resize(1400, 1400, { fit: 'inside' }).png().toBuffer();
const vite = await preview({
  configFile: resolve('apps/web/vite.config.ts'),
  build: { outDir: dist },
  preview: { host: '127.0.0.1', port: 0 },
});
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const report = { browser: browser.version(), devices: [] };
const url = 'http://127.0.0.1:' + vite.httpServer.address().port + '/#/studio';
try {
  for (const { name, width, height, touch } of [
    { name: 'desktop', width: 1440, height: 960, touch: false },
    { name: 'tablet', width: 1024, height: 768, touch: true },
    { name: 'phone', width: 360, height: 740, touch: true },
    { name: 'landscape', width: 844, height: 390, touch: true },
  ]) {
    const result = { name, width, height, pageErrors: [] };
    report.devices.push(result);
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: touch,
      locale: 'zh-CN',
      reducedMotion: 'reduce',
    });
    page.on('pageerror', (error) => result.pageErrors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('ui-language', 'zh-CN');
      const send = Worker.prototype.postMessage;
      const subscribed = new WeakSet();
      window.portraitTrace = { start: 0, live: [], requests: new Map() };
      Worker.prototype.postMessage = function (message, ...args) {
        const trace = window.portraitTrace;
        if (trace.start && message.type === 'interactive-preview') {
          trace.requests.set(message.id, performance.now());
          if (!subscribed.has(this)) {
            subscribed.add(this);
            this.addEventListener('message', ({ data }) => {
              if (trace.start && trace.requests.has(data.id) && data.result) {
                trace.live.push({
                  afterMs: Math.round(performance.now() - trace.start),
                  pixels: data.result.width * data.result.height,
                });
              }
            });
          }
        }
        return send.call(this, message, ...args);
      };
    });
    try {
      await page.route('**/v1/**', (route) =>
        route.fulfill({ status: 503, json: { message: 'offline' } }),
      );
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('选择照片', { exact: true }).setInputFiles({
        name: 'public-portrait.png',
        mimeType: 'image/png',
        buffer: photo,
      });
      await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
      const canvas = page.locator('.image-frame canvas[aria-label="照片编辑预览"]');
      await canvas.waitFor();
      await page.locator('[data-dock-tool="beauty"]').click();
      const panel = page.locator('.portrait-controls-v3');
      await panel.locator('[data-segment-value="features"]').click();
      const tool = panel.locator('[data-control-id="faceSlim"]');
      await page.waitForFunction(
        () => document.querySelector('.portrait-controls-v3 [data-control-id="faceSlim"]:enabled'),
        undefined,
        { timeout: 90_000 },
      );
      await tool.click();
      const slider = panel.locator('.parameter-shelf-current input[type="range"]');
      await slider.scrollIntoViewIfNeeded();
      await slider.waitFor();
      const box = await slider.boundingBox();
      assert.ok(box && box.width > 45);
      const x = box.x + box.width * 0.52,
        y = box.y + box.height * 0.5;
      const png = () => canvas.evaluate((node) => node.toDataURL());
      const startingPixels = await png();
      await page.evaluate(() => {
        window.portraitTrace.start = performance.now();
      });
      const cdp = touch ? await page.context().newCDPSession(page) : null;
      const sendTouch = (type, at) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x: at, y, id: 1 }],
        });
      if (cdp) await sendTouch('touchStart', x);
      else {
        await page.mouse.move(x, y);
        await page.mouse.down();
      }
      for (let i = 0; i < 24; i++) {
        const move = x + ((i + 1) * box.width * 0.25) / 24;
        if (cdp) await sendTouch('touchMove', move);
        else await page.mouse.move(move, y);
        await page.waitForTimeout(34);
      }
      await page.waitForFunction(
        (original) =>
          document.querySelector('.image-frame canvas[aria-label="照片编辑预览"]')?.toDataURL() !==
          original,
        startingPixels,
        { timeout: 5000 },
      );
      result.duringDrag = await page.evaluate(() => {
        const { live } = window.portraitTrace;
        return {
          frames: live.length,
          firstMs: live[0]?.afterMs,
          pixels: [...new Set(live.map((x) => x.pixels))],
        };
      });
      assert.ok(
        result.duringDrag.frames >= 2,
        'Several worker frames must complete before release',
      );
      if (cdp) await sendTouch('touchEnd', x);
      else await page.mouse.up();
      await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
      assert.notEqual(await png(), startingPixels);
      result.afterDrag = Number(await slider.inputValue());
      const oldValue = Number(await slider.inputValue());
      if (!touch) {
        await slider.focus();
        await slider.hover();
        await page.mouse.wheel(0, -48);
        await page.waitForFunction((old) => Number(document.activeElement.value) > old, oldValue);
        result.wheel = Number(await slider.inputValue()) > oldValue;
        const afterWheel = Number(await slider.inputValue());
        await slider.press('ArrowLeft');
        result.keyboard = Number(await slider.inputValue()) < afterWheel;
        assert.ok(result.keyboard);
      }
      const beforeButton = Number(await slider.inputValue());
      await panel.locator('.parameter-shelf-current .precision-step').first().click();
      assert.ok(Number(await slider.inputValue()) < beforeButton);
      const extents = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(extents.scroll <= extents.client + 1);
      result.overflow = extents.scroll - extents.client;
      await page.screenshot({ path: resolve(out, name + '-portrait.png') });
      await page.locator('[data-dock-tool="crop"]').click();
      await page.locator('.crop-geometry-controls [data-segment-value="transform"]').click();
      await page
        .locator('.crop-geometry-controls [data-control-id="transform.rotationDegrees"]')
        .click();
      const rotation = page.locator(
        '.crop-geometry-controls .parameter-shelf-current input[type="range"]',
      );
      await rotation.press('Shift+ArrowRight');
      assert.notEqual(Number(await rotation.inputValue()), 0);
      await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
      await page.screenshot({ path: resolve(out, name + '-composition.png') });
      assert.deepEqual(result.pageErrors, []);
      console.log(JSON.stringify(result));
    } catch (error) {
      result.error = String(error.message);
      await page.screenshot({ path: resolve(out, name + '-error.png') }).catch(() => {});
      throw error;
    } finally {
      await page.close();
    }
  }
} finally {
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  await vite.close();
}
