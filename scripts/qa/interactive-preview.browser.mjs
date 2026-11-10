import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';
import { renderEditorRecipe } from '@ai-xiutu/editor';

const root = fileURLToPath(new URL('../..', import.meta.url));
const artifacts = resolve(
  root,
  process.env.BROWSER_ARTIFACT_DIR ?? 'artifacts/interactive-preview',
);
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(resolve(tmpdir(), 'xiutu-preview-'));
const vite = await createServer({
  configFile: resolve(root, 'apps/web/vite.config.ts'),
  cacheDir: resolve(temporary, 'vite'),
  server: { host: '127.0.0.1', port: 0 },
});
const report = { cases: [] };
let browser;
try {
  await vite.listen();
  const channel = process.env.BROWSER_CHANNEL;
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  report.browser = browser.version();
  const width = 2200;
  const height = 1700;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = 25 + Math.floor((x * 195) / width);
      rgba[i + 1] = 20 + Math.floor((y * 200) / height);
      rgba[i + 2] = 100 + (Math.floor(x / 13) % 8) * 12;
      rgba[i + 3] = 255;
    }
  }
  const buffer = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  for (const [size, test] of [
    [{ width: 1440, height: 900, deviceScaleFactor: 2 }, '曝光'],
    [{ width: 1440, height: 900, deviceScaleFactor: 2 }, '曲线'],
    [{ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true }, '曝光'],
  ]) {
    const { width: w, height: h, ...device } = size;
    if (process.env.PREVIEW_CASE === 'phone' && !device.hasTouch) continue;
    const page = await browser.newPage({
      viewport: { width: w, height: h },
      acceptDownloads: true,
      reducedMotion: 'reduce',
      ...device,
    });
    // Record actual paints on the visible canvas. No readbacks or serialization in the hot path.
    await page.addInitScript(() => {
      const paint = CanvasRenderingContext2D.prototype.putImageData;
      window.previewTrace = { paints: [], inputs: [], valueChanges: [], start: null, end: null };
      CanvasRenderingContext2D.prototype.putImageData = function (image, ...args) {
        paint.call(this, image, ...args);
        if (this.canvas.getAttribute('aria-label') !== '照片编辑预览') return;
        const at = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 3)) * 4;
        window.previewTrace.paints.push({
          t: performance.now(),
          width: image.width,
          height: image.height,
          sample: Array.from(image.data.subarray(at, at + 4)),
        });
      };
      document.addEventListener(
        'pointermove',
        (event) => {
          const trace = window.previewTrace;
          if (
            trace.start !== null &&
            trace.end === null &&
            (event.buttons & 1 || event.pointerType === 'touch')
          )
            trace.inputs.push(performance.now());
        },
        true,
      );
      new MutationObserver((mutations) => {
        const trace = window.previewTrace;
        if (
          trace.start !== null &&
          trace.end === null &&
          mutations.some(({ target }) => target.matches('input[type=range]'))
        )
          trace.valueChanges.push(performance.now());
      }).observe(document, { subtree: true, attributeFilter: ['aria-valuetext'] });
      document.addEventListener(
        'pointerup',
        () => {
          const trace = window.previewTrace;
          if (trace.start !== null && trace.end === null) trace.end = performance.now();
        },
        true,
      );
    });
    // Local editor works without an authenticated API. Keep unrelated config requests deterministic.
    await page.route('**/v1/**', (route) =>
      route.fulfill({ status: 503, json: { message: 'offline' } }),
    );
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
    await page.getByLabel('选择照片', { exact: true }).setInputFiles({
      name: 'interactive-preview.png',
      mimeType: 'image/png',
      buffer,
    });
    await page.waitForFunction(() => window.previewTrace.paints.length >= 2);
    const canvas = page.locator('.image-frame canvas[aria-label="照片编辑预览"]');
    const readCanvas = () => canvas.evaluate((node) => node.toDataURL('image/png').split(',')[1]);
    const original = Buffer.from(await readCanvas(), 'base64');
    const tools = page.getByRole('navigation', { name: '编辑工具' });
    const tool = tools.getByRole('button', {
      name: test === '曲线' ? '曲线' : w < 760 ? '调节' : '明暗',
      exact: true,
    });
    if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click();
    const panel = page.locator('.free-panel[aria-hidden="false"]');
    await panel.waitFor();
    let start, target;
    if (test === '曲线') {
      const graph = panel.locator('.curve-graph');
      const box = await graph.boundingBox();
      assert.ok(box);
      await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.waitForFunction(
        () => document.querySelectorAll('.curve-graph [data-curve-point]').length === 3,
      );
      const point = await graph.locator('[data-curve-point="1"] circle').first().boundingBox();
      assert.ok(point);
      start = { x: point.x + point.width / 2, y: point.y + point.height / 2 };
      target = { x: start.x, y: box.y + box.height * 0.14 };
    } else {
      const slider = panel.getByRole('slider', { name: test, exact: true });
      await slider.scrollIntoViewIfNeeded();
      const box = await slider.boundingBox();
      assert.ok(box);
      start = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
      target = { x: box.x + box.width * 0.87, y: start.y };
      const hit = await slider.evaluate((node, point) => {
        const actual = document.elementFromPoint(point.x, point.y);
        return {
          ok: actual === node,
          point,
          actual: actual?.outerHTML.slice(0, 450),
          stack: document
            .elementsFromPoint(point.x, point.y)
            .map((element) => element.className)
            .slice(0, 10),
        };
      }, start);
      assert.ok(hit.ok, JSON.stringify(hit));
    }
    await page.mouse.move(start.x, start.y);
    await page.evaluate(() => {
      const trace = window.previewTrace;
      trace.baseline = trace.paints.reduce((full, frame) =>
        frame.width >= full.width ? frame : full,
      );
      trace.paints = [];
      trace.start = performance.now();
    });
    const cdp = device.hasTouch ? await page.context().newCDPSession(page) : null;
    const touch = (type, point) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: point ? [{ ...point, id: 1 }] : [],
      });
    if (cdp) await touch('touchStart', start);
    else await page.mouse.down();
    for (let i = 1; i <= 48; i++) {
      const fraction = i / 48;
      const point = {
        x: start.x + (target.x - start.x) * fraction,
        y: start.y + (target.y - start.y) * fraction,
      };
      if (cdp) await touch('touchMove', point);
      else await page.mouse.move(point.x, point.y);
      await new Promise((done) => setTimeout(done, 8));
    }
    if (cdp) await touch('touchEnd');
    else await page.mouse.up();
    await page
      .waitForFunction(
        () => {
          const t = window.previewTrace;
          return t.paints.some(
            (p) =>
              p.t >= t.end &&
              p.width === t.baseline.width &&
              p.sample.some((v, i) => v !== t.baseline.sample[i]),
          );
        },
        undefined,
        { timeout: 8_000 },
      )
      .catch(async (error) => {
        report.failure = await page.evaluate(() => ({
          trace: window.previewTrace,
          points: [...document.querySelectorAll('.curve-graph [data-curve-point]')].map((node) =>
            node.getAttribute('aria-label'),
          ),
          errors: document.querySelector('.canvas-error')?.textContent,
        }));
        await page.screenshot({ path: resolve(artifacts, 'failure.png') });
        throw error;
      });
    const trace = await page.evaluate(() => window.previewTrace);
    const changed = (p) => p.sample.some((v, i) => v !== trace.baseline.sample[i]);
    const frames = trace.paints.filter((p) => p.t < trace.end && changed(p));
    const distinct = new Set(frames.map((p) => p.sample.join(','))).size;
    const inputTime = trace.inputs[0];
    const caseReport = {
      test,
      viewport: `${w}×${h}`,
      inputEvents: trace.inputs.length,
      gestureMs: trace.end - inputTime,
      firstChangedMs: frames.length ? frames[0].t - inputTime : null,
      firstRangeChangeMs: trace.valueChanges.length ? trace.valueChanges[0] - inputTime : null,
      distinctLiveFrames: distinct,
      maxFrameGapMs: frames.length
        ? Math.max(
            ...frames.map((f, i) => f.t - (frames[i - 1]?.t ?? inputTime)),
            trace.end - frames.at(-1).t,
          )
        : null,
      settledMs:
        trace.paints.find((p) => p.t >= trace.end && p.width === trace.baseline.width && changed(p))
          .t - trace.end,
      baseline: trace.baseline.sample,
      settled: trace.paints.at(-1).sample,
    };
    if (process.env.PREVIEW_RECORD_ONLY !== '1') {
      const rendered = Buffer.from(await readCanvas(), 'base64');
      if (cdp) {
        const slider = panel.getByRole('slider', { name: test, exact: true });
        const settledValue = await slider.inputValue();
        await touch('touchStart', target);
        await touch('touchMove', start);
        const control = await slider.elementHandle();
        await page.waitForFunction(([node, value]) => node.value !== value, [control, settledValue]);
        await touch('touchCancel');
        await page.waitForFunction(([node, value]) => node.value === value, [control, settledValue]);
        await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
        assert.equal(await readCanvas(), rendered.toString('base64'));
        caseReport.touchCancellationRestoredPixels = true;
      }
      const view = page.getByRole('combobox', { name: '切换工作视图' });
      if (await view.isVisible()) await view.selectOption('deliver');
      else
        await page
          .getByRole('navigation', { name: '工作视图', exact: true })
          .getByRole('button', { name: '交付', exact: true })
          .click();
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: '下载配方 JSON' }).click();
      const stream = await (await pending).createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const recipe = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const source = await sharp(original)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const expected = renderEditorRecipe(
        {
          width: source.info.width,
          height: source.info.height,
          data: new Uint8ClampedArray(source.data),
        },
        recipe,
      );
      const actual = await sharp(rendered).ensureAlpha().raw().toBuffer();
      assert.ok(
        actual.equals(Buffer.from(expected.data)),
        `${test} ${w} exact settled pixel parity`,
      );
      caseReport.exactSettledPixels = expected.width * expected.height;
    }
    report.cases.push(caseReport);
    process.stdout.write(JSON.stringify(caseReport) + '\n');
    await page.close();
  }
  if (process.env.PREVIEW_RECORD_ONLY !== '1') {
    for (const test of report.cases) {
      assert.ok(
        test.inputEvents >= (test.viewport.startsWith('390') ? 28 : 40),
        JSON.stringify(test),
      );
      assert.ok(test.distinctLiveFrames >= 6, JSON.stringify(test));
      assert.ok(test.firstChangedMs !== null && test.firstChangedMs < 240, JSON.stringify(test));
      assert.ok(test.maxFrameGapMs !== null && test.maxFrameGapMs < 350, JSON.stringify(test));
    }
  }
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await vite.close();
  await rm(temporary, { recursive: true, force: true });
}
