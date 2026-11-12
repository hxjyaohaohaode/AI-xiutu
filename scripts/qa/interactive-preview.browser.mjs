import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';
import {
  compileEditorCoordinateMap,
  createRecipeV4,
  HSL_BANDS,
  renderEditorRecipe,
  renderEditorRecipeTiled,
} from '@ai-xiutu/editor';

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
const report = {
  cases: [],
  workerRecovery: { state: 'not-run', reason: 'The independent recovery check has not started.' },
};
let browser;

function hslProbePositions(rgba, width, height, band) {
  // A one-degree adjustment can affect only a small subset of real pixels.
  // Select probes against the tiled reference before the measured gesture.
  const stride = Math.ceil((width * height) / 32_768);
  const count = Math.ceil((width * height) / stride);
  const data = new Uint8ClampedArray(256 * Math.ceil(count / 256) * 4);
  for (let i = 0; i < count; i++) {
    const at = i * stride * 4;
    data.set(rgba.subarray(at, at + 4), i * 4);
  }
  const recipe = createRecipeV4();
  recipe.hsl[band].hue = 1;
  const edited = renderEditorRecipeTiled({ width: 256, height: data.length / 1024, data }, recipe);
  const changed = [];
  for (let i = 0; i < count; i++) {
    const at = i * 4;
    if (!data.subarray(at, at + 3).some((value, channel) => value !== edited.data[at + channel]))
      continue;
    const pixel = i * stride;
    changed.push([(Math.floor(pixel / width) + 0.5) / height, ((pixel % width) + 0.5) / width]);
  }
  assert.ok(changed.length, `the source contains pixels affected by a one-degree ${band} edit`);
  const samples = Math.min(32, changed.length);
  return Array.from(
    { length: samples },
    (_, i) => changed[Math.floor((i * changed.length) / samples)],
  );
}

async function verifyLocalMaskAndLiquify(input) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  });
  const result = (report.maskAndLiquify = { state: 'running', errors: [] });
  page.on('pageerror', (error) => result.errors.push(String(error)));
  try {
    await page.addInitScript(() => {
      const paint = CanvasRenderingContext2D.prototype.putImageData;
      window.warpPaints = null;
      window.warpRequests = null;
      window.workerMessages = [];
      const terminate = Worker.prototype.terminate;
      Worker.prototype.terminate = function () {
        window.workerMessages.push({ type: 'terminated', at: performance.now() });
        return terminate.call(this);
      };
      const send = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, ...args) {
        window.workerMessages.push({
          type: message.type,
          previewQuality: message.previewQuality,
          at: performance.now(),
        });
        if (
          window.warpRequests &&
          message.type === 'interactive-preview' &&
          message.previewQuality === 'warp'
        ) {
          const record = { id: message.id, sent: performance.now() };
          window.warpRequests.push(record);
          const reply = ({ data }) => {
            if (data.id !== record.id) return;
            record.reply = performance.now();
            record.width = data.result?.width;
            record.error = data.error;
            this.removeEventListener('message', reply);
          };
          this.addEventListener('message', reply);
        }
        return send.call(this, message, ...args);
      };
      CanvasRenderingContext2D.prototype.putImageData = function (image, ...args) {
        paint.call(this, image, ...args);
        if (
          !window.warpPaints ||
          !this.canvas.matches('.image-frame canvas[aria-label="照片编辑预览"]')
        )
          return;
        const { width, height, data } = image;
        let signature = 0;
        for (let y = 42; y <= 55; y++)
          for (let x = 39; x <= 56; x++) {
            const at = (Math.floor((y * height) / 100) * width + Math.floor((x * width) / 100)) * 4;
            signature =
              Math.imul(signature ^ data[at], 16777619) ^ data[at + 1] ^ (data[at + 2] << 8);
          }
        window.warpPaints.push({ width, height, signature, at: performance.now() });
      };
    });
    const bytes = process.env.PREVIEW_PUBLIC_PHOTO
      ? await readFile(process.env.PREVIEW_PUBLIC_PHOTO)
      : input;
    const encoded = await sharp(bytes)
      .autoOrient()
      .resize(980, 760, { fit: 'inside' })
      .removeAlpha()
      .png()
      .toBuffer();
    const { data, info } = await sharp(encoded)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
    const tool = (name) =>
      page
        .getByRole('navigation', { name: '编辑工具' })
        .getByRole('button', { name, exact: true })
        .click();
    const selectedPanel = page.locator('.free-panel[aria-hidden="false"]');
    const canvas = page.locator('.image-frame canvas[aria-label="照片编辑预览"]');
    const settled = () => page.locator('.canvas-stage[aria-busy="false"]').waitFor();
    const png = async () =>
      Buffer.from(await canvas.evaluate((node) => node.toDataURL().split(',')[1]), 'base64');
    const boxCenter = async (locator) => {
      const box = await locator.boundingBox();
      assert.ok(box);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    await page.route('**/v1/**', (route) =>
      route.fulfill({ status: 503, json: { message: 'offline' } }),
    );
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/#/studio`);
    await page
      .getByLabel('选择照片', { exact: true })
      .setInputFiles({ name: 'scene-preview.png', mimeType: 'image/png', buffer: encoded });
    await canvas.waitFor();
    await settled();
    await tool('局部');
    await selectedPanel.getByRole('button', { name: '径向', exact: true }).click();
    const outline = page.locator('.mask-overlay');
    await outline.waitFor({ state: 'visible' });
    assert.equal(await page.locator('.selection-preview').count(), 0);
    const overlay = selectedPanel.getByRole('checkbox', { name: '持续显示选区', exact: true });
    assert.equal(await overlay.isChecked(), false);
    await overlay.check();
    await page.locator('.selection-preview').waitFor();
    await overlay.uncheck();
    await page.locator('.selection-preview').waitFor({ state: 'hidden' });
    await selectedPanel.getByRole('combobox', { name: '选区形状', exact: true }).click();
    await page.getByRole('option', { name: '矩形', exact: true }).click();
    const center = await boxCenter(page.getByRole('button', { name: '拖动选区中心', exact: true }));
    const grip = await boxCenter(page.getByRole('button', { name: '拖动旋转选区', exact: true }));
    const turn = Math.PI / 4;
    const dx = grip.x - center.x,
      dy = grip.y - center.y;
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(
      center.x + dx * Math.cos(turn) - dy * Math.sin(turn),
      center.y + dx * Math.sin(turn) + dy * Math.cos(turn),
      { steps: 12 },
    );
    await page.mouse.up();
    const exposure = selectedPanel.getByRole('slider', { name: '曝光', exact: true });
    await exposure.press('ArrowLeft');
    assert.equal(Number(await exposure.inputValue()), -0.01);
    await exposure.press('Alt+ArrowRight');
    assert.equal(Number(await exposure.inputValue()), -0.009);
    await settled();
    await exposure.scrollIntoViewIfNeeded();
    const localTrack = await exposure.boundingBox();
    assert.ok(localTrack);
    const localBefore = await png();
    await page.evaluate(() => {
      window.warpPaints = [];
    });
    const localX = localTrack.x + localTrack.width * 0.5;
    const localY = localTrack.y + localTrack.height * 0.5;
    await page.mouse.move(localX, localY);
    await page.mouse.down();
    await page.mouse.move(localTrack.x + localTrack.width * 0.75, localY, { steps: 16 });
    await outline.waitFor({ state: 'hidden' });
    await page.waitForFunction((before) => {
      const canvas = document.querySelector('.image-frame canvas[aria-label="照片编辑预览"]');
      return canvas?.toDataURL().split(',')[1] !== before;
    }, localBefore.toString('base64'));
    const localFrames = await page.evaluate(() => window.warpPaints);
    assert.ok(localFrames.length > 0);
    assert.ok(
      localFrames.every(({ width, height }) => width === source.width && height === source.height),
    );
    await page.mouse.up();
    await settled();
    await outline.waitFor({ state: 'visible' });
    await selectedPanel.getByRole('button', { name: /^曝光数值/ }).click();
    await selectedPanel.getByRole('spinbutton', { name: '曝光精确数值' }).fill('0.64');
    await selectedPanel.getByRole('spinbutton', { name: '曝光精确数值' }).press('Enter');
    await settled();
    await page.screenshot({ path: resolve(artifacts, 'local-mask-settled.png') });
    await selectedPanel.getByRole('button', { name: '多边形', exact: true }).click();
    const firstVertex = await boxCenter(
      page.getByRole('button', { name: '拖动多边形点 1', exact: true }),
    );
    await page.mouse.move(firstVertex.x, firstVertex.y);
    await page.mouse.down();
    await page.mouse.move(firstVertex.x + 25, firstVertex.y + 16, { steps: 8 });
    await page.mouse.up();
    const polygonCenter = await boxCenter(
      page.getByRole('button', { name: '移动整个选区', exact: true }),
    );
    const polygonGrip = await boxCenter(
      page.getByRole('button', { name: '旋转选区', exact: true }),
    );
    const heightToGrip = polygonCenter.y - polygonGrip.y;
    await page.mouse.move(polygonGrip.x, polygonGrip.y);
    await page.mouse.down();
    await page.mouse.move(
      polygonCenter.x + heightToGrip * 0.5,
      polygonCenter.y - heightToGrip * Math.sqrt(0.75),
      { steps: 8 },
    );
    await page.mouse.up();
    await settled();
    await tool('液化');
    const before = await png();
    const frame = await canvas.boundingBox();
    assert.ok(frame);
    const start = { x: frame.x + frame.width * 0.47, y: frame.y + frame.height * 0.49 };
    await page.evaluate(() => {
      window.warpPaints = [];
      window.warpRequests = [];
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const started = await page.evaluate(() => performance.now());
    await page.mouse.move(start.x + frame.width * 0.075, start.y - frame.height * 0.04, {
      steps: 24,
    });
    await page.waitForFunction(
      ({ baseline, w, h }) => {
        const active = document.querySelector('.image-frame canvas[aria-label="照片编辑预览"]');
        return (
          active?.width === w &&
          active?.height === h &&
          active.toDataURL().split(',')[1] !== baseline
        );
      },
      { baseline: before.toString('base64'), w: source.width, h: source.height },
    );
    const live = await png();
    const paints = await page.evaluate(() => window.warpPaints);
    const requests = await page.evaluate(() => window.warpRequests);
    const workerMessages = await page.evaluate(() => window.workerMessages);
    assert.ok(paints.length > 0);
    assert.ok(
      requests.some((request) => request.width === source.width && !request.error),
      'the collaboration wrapper reaches the high-detail lane',
    );
    assert.ok(
      new Set(paints.map((paint) => paint.signature)).size >= 2,
      'multiple changed high-detail frames appear before pointer release',
    );
    assert.equal(
      workerMessages.some(({ type, at }) => type === 'compare-preview' && at >= started),
      false,
    );
    assert.ok(
      paints.every((paint) => paint.width === source.width && paint.height === source.height),
    );
    await page.screenshot({ path: resolve(artifacts, 'liquify-during-drag.png') });
    await page.mouse.up();
    await settled();
    const final = await png();
    await tool('修复');
    await selectedPanel.locator('[data-motion="repair-controls"]').waitFor();
    assert.deepEqual(await png(), final, 'switching to repair keeps the composed liquify frame');
    const repairFrame = await canvas.boundingBox();
    assert.ok(repairFrame);
    const repairPoint = { x: 0.47, y: 0.49 };
    const repairStart = {
      x: repairFrame.x + repairFrame.width * repairPoint.x,
      y: repairFrame.y + repairFrame.height * repairPoint.y,
    };
    await page.mouse.move(repairStart.x, repairStart.y);
    const footprint = page.locator('.brush-footprint > path:not(.canvas-gesture-trail)');
    assert.ok(await footprint.getAttribute('d'));
    await page.mouse.down();
    await page.mouse.move(repairStart.x + 17, repairStart.y + 9, { steps: 6 });
    await page.mouse.up();
    await settled();
    const repaired = await png();
    await page.getByRole('button', { name: '撤销本次编辑' }).click();
    await settled();
    assert.deepEqual(
      await png(),
      final,
      'undo of the first repair stroke restores the warped frame',
    );
    await page.getByRole('button', { name: '重做本次编辑' }).click();
    await settled();
    assert.deepEqual(await png(), repaired, 'redo restores the exact combined result');
    await page.screenshot({ path: resolve(artifacts, 'liquify-then-repair.png') });
    await page.getByRole('button', { name: '交付', exact: true }).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存编辑配方' }).click();
    const download = await pending;
    const recipe = JSON.parse(await readFile(await download.path(), 'utf8'));
    const mask = recipe.regionEdits[0].mask;
    assert.equal(mask.shape, 'rectangle');
    assert.ok(Math.abs(mask.rotationDegrees - 45) < 2, JSON.stringify(mask));
    assert.equal(recipe.regionEdits[0].color.adjustments.exposure, 0.64);
    const polygon = recipe.regionEdits[1].mask;
    assert.equal(polygon.type, 'polygon');
    assert.equal(polygon.points.length, 4);
    assert.ok(
      Math.abs(polygon.points[0].y - polygon.points[1].y) > 0.05,
      'polygon vertices rotate together',
    );
    assert.equal(recipe.warp.strokes[0].resampling, 'bounded-cubic-v1');
    assert.equal(recipe.warp.strokes[0].algorithm, 'flow-v2');
    const brush = recipe.healing[0]?.mask;
    assert.equal(brush?.type, 'brush', 'a repair region is created on the first stroke');
    const coordinateMap = compileEditorCoordinateMap(source, recipe, source);
    const expectedPoint = coordinateMap.toContent(repairPoint);
    const firstPoint = brush.strokes[0].points[0];
    assert.ok(Math.hypot(expectedPoint.x - firstPoint.x, expectedPoint.y - firstPoint.y) < 0.005);
    const expected = renderEditorRecipe(source, { ...recipe, healing: [] });
    const actual = await sharp(final).ensureAlpha().raw().toBuffer();
    assert.ok(
      actual.equals(Buffer.from(expected.data)),
      'settled browser pixels match the shared render engine',
    );
    const expectedRepair = renderEditorRecipe(source, recipe);
    const actualRepair = await sharp(repaired).ensureAlpha().raw().toBuffer();
    assert.ok(
      actualRepair.equals(Buffer.from(expectedRepair.data)),
      'repair and warp use the same browser and reference pixels',
    );
    assert.notDeepEqual(live, before);
    assert.deepEqual(result.errors, []);
    Object.assign(result, {
      state: 'passed',
      mask,
      polygon,
      firstWarpPaintMs: paints[0].at - started,
      distinctWarpFrames: new Set(paints.map((paint) => paint.signature)).size,
      warpRequests: requests.map(({ id, sent, reply, width, error }) => ({
        id,
        sentMs: sent - started,
        durationMs: reply ? reply - sent : null,
        width,
        error,
      })),
      width: source.width,
      height: source.height,
      exactSettledPixels: source.width * source.height,
      localDragFramesAtNativeSize: localFrames.length,
      repairAfterWarp: {
        keptWarpWhenSwitching: true,
        directBrush: true,
        undoRedoExact: true,
        changedChannels: actualRepair.reduce(
          (n, value, index) => n + Number(value !== actual[index]),
          0,
        ),
      },
    });
  } catch (error) {
    result.state = 'failed';
    result.error = String(error);
    await page
      .screenshot({ path: resolve(artifacts, 'local-mask-liquify-failure.png') })
      .catch(() => {});
    throw error;
  } finally {
    await page.close();
  }
}
async function verifyWorkerRecovery({ png, source }) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    acceptDownloads: true,
    reducedMotion: 'reduce',
  });
  const result = (report.workerRecovery = {
    state: 'running',
    fault: 'terminate actual main worker, then dispatch its error event',
    source: { width: source.width, height: source.height, format: 'PNG' },
    pageErrors: [],
  });
  page.on('pageerror', (error) => result.pageErrors.push(String(error)));
  try {
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      const records = new WeakMap();
      const probe = (window.workerRecoveryTrace = {
        workers: [],
        paints: [],
        terminateNextPreview: null,
        fault: null,
      });
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          if (!new URL(String(url), location.href).pathname.endsWith('/render.worker.ts')) return;
          const record = {
            id: probe.workers.length + 1,
            instance: this,
            terminated: false,
            role: 'unassigned',
            sources: 0,
            sent: [],
            replies: [],
          };
          records.set(this, record);
          probe.workers.push(record);
          this.addEventListener('message', ({ data }) => {
            record.replies.push({
              id: data.id,
              type: data.type,
              t: performance.now(),
              result: !!data.result,
              width: data.result?.width,
              height: data.result?.height,
              error: data.error,
            });
          });
        }
        postMessage(message, ...options) {
          // Forward every real message. Record only recipe/receipt metadata, never
          // substitute successful replies or the worker's source/pixel buffers.
          super.postMessage(message, ...options);
          const record = records.get(this);
          if (!record) return;
          if (message.type === 'source') {
            record.sources++;
            // CanvasStage also owns this worker URL, but only the editor's
            // main worker receives original pixels; stage previews do not.
            record.role = message.original ? 'main' : 'auxiliary';
          } else if (message.type === 'interactive-source') record.role = 'interactive';
          record.sent.push({
            id: message.id,
            type: message.type,
            recipe: message.recipe ? structuredClone(message.recipe) : null,
          });
          if (message.type === 'preview' && probe.terminateNextPreview === record.id) {
            probe.terminateNextPreview = null;
            this.terminate();
            probe.fault = { workerId: record.id, requestId: message.id };
          }
        }
        terminate() {
          const record = records.get(this);
          if (record) record.terminated = true;
          super.terminate();
        }
      };
      const paint = CanvasRenderingContext2D.prototype.putImageData;
      CanvasRenderingContext2D.prototype.putImageData = function (image, ...args) {
        paint.call(this, image, ...args);
        if (this.canvas.getAttribute('aria-label') === '照片编辑预览')
          probe.paints.push({ t: performance.now(), width: image.width, height: image.height });
      };
    });
    await page.route('**/v1/**', (route) =>
      route.fulfill({ status: 503, json: { message: 'offline' } }),
    );
    const file = { name: 'worker-recovery.png', mimeType: 'image/png', buffer: png };
    const waitForSettled = async (exposure, excludeWorkerId = null) => {
      const handle = await page.waitForFunction(
        ({ exposure, excludeWorkerId }) => {
          const trace = window.workerRecoveryTrace;
          const worker = trace.workers.findLast(
            (item) =>
              item.role === 'main' &&
              item.sources > 0 &&
              !item.terminated &&
              item.id !== excludeWorkerId,
          );
          const reply = worker?.replies.findLast(
            (item) =>
              item.type === 'preview' &&
              item.result &&
              !item.error &&
              worker.sent.find((request) => request.id === item.id)?.recipe?.adjustments
                .exposure === exposure,
          );
          const paint = trace.paints.at(-1);
          return (
            reply &&
            paint &&
            paint.t >= reply.t &&
            paint.width === reply.width &&
            paint.height === reply.height &&
            document.querySelector('.canvas-stage')?.getAttribute('aria-busy') === 'false' && {
              workerId: worker.id,
              requestId: reply.id,
              width: paint.width,
              height: paint.height,
            }
          );
        },
        { exposure, excludeWorkerId },
      );
      const value = await handle.jsonValue();
      await handle.dispose();
      return value;
    };
    const downloadRecipe = async () => {
      const views = page.getByRole('navigation', { name: '工作视图', exact: true });
      await views.getByRole('button', { name: '交付', exact: true }).click();
      const pending = page.waitForEvent('download');
      await page.getByRole('button', { name: '保存编辑配方', exact: true }).click();
      const download = await pending;
      const stream = await download.createReadStream();
      assert.ok(stream, 'the draft is downloaded through the real product action');
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.equal(await download.failure(), null);
      const bytes = Buffer.concat(chunks);
      await views.getByRole('button', { name: '精修', exact: true }).click();
      await page.locator('.canvas-stage').waitFor();
      return { bytes, recipe: JSON.parse(bytes.toString('utf8')) };
    };
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/#/studio`);
    await page.getByLabel('选择照片', { exact: true }).setInputFiles(file);
    const original = await waitForSettled(0);
    const canvas = page.locator('.image-frame canvas[aria-label="照片编辑预览"]');
    assert.deepEqual([original.width, original.height], [source.width, source.height]);
    const tools = page.getByRole('navigation', { name: '编辑工具', exact: true });
    const light = tools.getByRole('button', { name: '明暗', exact: true });
    if ((await light.getAttribute('aria-pressed')) !== 'true') await light.click();
    const panel = page.locator('.free-panel[aria-hidden="false"]');
    const beforeOwners = await page.evaluate((workerId) => {
      const trace = window.workerRecoveryTrace;
      trace.terminateNextPreview = workerId;
      return trace.workers
        .filter((item) => item.role === 'main' || item.role === 'interactive')
        .map((item) => item.id);
    }, original.workerId);
    await panel.getByRole('button', { name: /^曝光数值/ }).click();
    await panel.getByRole('spinbutton', { name: '曝光精确数值', exact: true }).fill('-0.65');
    await panel.getByRole('spinbutton', { name: '曝光精确数值', exact: true }).press('Enter');
    await page.waitForFunction(
      () =>
        !!window.workerRecoveryTrace.fault &&
        document.querySelector('.canvas-stage')?.getAttribute('aria-busy') === 'true',
    );
    const beforeFailure = await downloadRecipe();
    assert.equal(beforeFailure.recipe.adjustments.exposure, -0.65);
    assert.equal(await page.locator('.canvas-stage').getAttribute('aria-busy'), 'true');
    // Termination was real and occurred at a real pending preview. Notify the hook
    // only after its busy DOM state and recoverable draft have both been observed.
    await page.evaluate(() => {
      const trace = window.workerRecoveryTrace;
      const record = trace.workers.find((item) => item.id === trace.fault.workerId);
      if (!record?.terminated) throw new Error('The actual main worker was not terminated');
      record.instance.dispatchEvent(
        new ErrorEvent('error', { message: 'Isolated QA: main render worker terminated' }),
      );
    });
    await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
    const error = page.locator('.canvas-error').getByRole('alert');
    await error.waitFor();
    result.visibleError = await error.innerText();
    assert.match(result.visibleError, /图像处理暂时中断/);
    assert.match(result.visibleError, /重新导入/);
    // A real layout-reset action creates a fresh notification without changing
    // the failed source or draft. Do not race the original import toast's timer.
    await page.getByRole('button', { name: '布局与工作台设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '工作台设置', exact: true });
    await settings.getByRole('button', { name: '重置当前屏幕布局', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    const noticeText = '已恢复当前屏幕的默认布局。';
    await page.locator('.toast').getByText(noticeText, { exact: true }).waitFor();
    await page.waitForFunction(
      (message) =>
        [...document.querySelectorAll('.toast')].some(
          (toast) =>
            toast.querySelector(':scope > span')?.textContent?.trim() === message &&
            toast.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
            !toast.inert &&
            toast.getAttribute('aria-hidden') !== 'true',
        ),
      noticeText,
    );
    const errorVisibility = await error.evaluate((element, expectedNotice) => {
      const rect = (bounds) => {
        const { x, y, top, right, bottom, left, width, height } = bounds;
        return { x, y, top, right, bottom, left, width, height };
      };
      const box = rect(element.getBoundingClientRect());
      const clipping = (node) => {
        const clip = { top: 0, right: innerWidth, bottom: innerHeight, left: 0 };
        const ancestors = [];
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const bounds = parent.getBoundingClientRect();
          const viewport = {
            left: bounds.left + parent.clientLeft,
            top: bounds.top + parent.clientTop,
            right: bounds.left + parent.clientLeft + parent.clientWidth,
            bottom: bounds.top + parent.clientTop + parent.clientHeight,
          };
          if (/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowX)) {
            clip.left = Math.max(clip.left, viewport.left);
            clip.right = Math.min(clip.right, viewport.right);
          }
          if (/^(auto|scroll|hidden|clip|overlay)$/.test(style.overflowY)) {
            clip.top = Math.max(clip.top, viewport.top);
            clip.bottom = Math.min(clip.bottom, viewport.bottom);
          }
          ancestors.push({
            tag: parent.tagName,
            className: parent.className,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            viewport,
          });
        }
        return { clip, ancestors };
      };
      const { clip, ancestors } = clipping(element);
      const message = [...element.querySelectorAll(':scope > span')].find((part) =>
        part.textContent?.trim(),
      );
      if (!message) throw new Error('The actual canvas error has no message span');
      const range = document.createRange();
      range.selectNodeContents(message);
      const textRects = [...range.getClientRects()]
        .map(rect)
        .filter((line) => line.width > 0 && line.height > 0);
      const toasts = [...document.querySelectorAll('.toast')]
        .filter((toast) => toast.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
        .map((toast) => ({
          box: rect(toast.getBoundingClientRect()),
          clip: clipping(toast).clip,
          text: toast.querySelector(':scope > span')?.textContent?.trim(),
          active: !toast.inert && toast.getAttribute('aria-hidden') !== 'true',
        }))
        .filter((toast) => toast.box.width > 0 && toast.box.height > 0);
      const hit = (x, y) => {
        const target = document.elementFromPoint(x, y);
        return { x, y, unobscured: target === element || element.contains(target) };
      };
      return {
        notificationSource: 'actual user action: reset current screen layout',
        expectedNotice,
        message: range.toString(),
        visible: element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        box,
        clip,
        ancestors,
        textRects,
        toasts,
        center: hit(box.x + box.width / 2, box.y + box.height / 2),
        textSamples: textRects.flatMap((line) =>
          [0.1, 0.5, 0.9].map((fraction) =>
            hit(line.left + line.width * fraction, line.top + line.height / 2),
          ),
        ),
      };
    }, noticeText);
    result.errorVisibility = errorVisibility;
    await page.screenshot({ path: resolve(artifacts, 'worker-recovery-error.png') });
    const fits = (box, clip) =>
      box.left >= clip.left - 1 &&
      box.top >= clip.top - 1 &&
      box.right <= clip.right + 1 &&
      box.bottom <= clip.bottom + 1;
    const overlaps = (a, b) =>
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    assert.equal(errorVisibility.visible, true, 'the actual canvas error stays visible');
    assert.equal(
      errorVisibility.message,
      result.visibleError,
      'the full failure explanation survives layout reset',
    );
    assert.ok(errorVisibility.textRects.length > 0, 'the error explanation has real text layout');
    assert.ok(
      errorVisibility.toasts.some(
        (toast) => toast.active && toast.text === noticeText && fits(toast.box, toast.clip),
      ),
      'the real layout-reset notification and canvas error are visible together',
    );
    assert.ok(
      fits(errorVisibility.box, errorVisibility.clip),
      'the full alert fits every clipping ancestor',
    );
    assert.ok(
      errorVisibility.textRects.every(
        (line) => fits(line, errorVisibility.clip) && fits(line, errorVisibility.box),
      ),
      'every line of the error explanation fits the alert and effective viewport',
    );
    assert.ok(
      errorVisibility.toasts.every(
        (toast) =>
          !overlaps(errorVisibility.box, toast.box) &&
          errorVisibility.textRects.every((line) => !overlaps(line, toast.box)),
      ),
      'actual visible notifications do not cover any part of the canvas error',
    );
    assert.ok(
      errorVisibility.center.unobscured &&
        errorVisibility.textSamples.every((sample) => sample.unobscured),
      'the alert centre and three points on every text line are unobscured',
    );
    const afterFailure = await downloadRecipe();
    assert.deepEqual(
      afterFailure.recipe,
      beforeFailure.recipe,
      'the complete draft survives failure',
    );
    // CanvasStage legitimately recreates its auxiliary worker after a view
    // change. Resolve its source role, then compare only the editor's owners.
    await page.waitForFunction(() =>
      window.workerRecoveryTrace.workers.every(
        (item) => item.terminated || item.role !== 'unassigned',
      ),
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.workerRecoveryTrace.workers
          .filter((item) => item.role === 'main' || item.role === 'interactive')
          .map((item) => item.id),
      ),
      beforeOwners,
      'failure and view changes do not automatically replace the main/interactive owners',
    );
    await writeFile(resolve(artifacts, 'worker-recovery-draft.recipe.json'), afterFailure.bytes);

    // This is an explicit user reimport, including the existing dirty-draft consent.
    await page.getByLabel('选择照片', { exact: true }).setInputFiles(file);
    const confirm = page.getByRole('dialog', { name: '确认操作', exact: true });
    await confirm.getByRole('button', { name: '确认继续', exact: true }).click();
    await confirm.waitFor({ state: 'hidden' });
    const reopened = await waitForSettled(0, original.workerId);
    assert.notEqual(reopened.workerId, original.workerId);
    await page.getByLabel('选择配方文件', { exact: true }).setInputFiles({
      name: 'worker-recovery-draft.recipe.json',
      mimeType: 'application/json',
      buffer: afterFailure.bytes,
    });
    const recovered = await waitForSettled(-0.65, original.workerId);
    assert.equal(
      recovered.workerId,
      reopened.workerId,
      'the new source owner renders the restored draft',
    );
    assert.equal(await page.locator('.canvas-error').getByRole('alert').count(), 0);
    const pixels = Buffer.from(
      await canvas.evaluate((node) => node.toDataURL('image/png').split(',')[1]),
      'base64',
    );
    const expected = renderEditorRecipe(source, beforeFailure.recipe);
    const actual = await sharp(pixels).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([actual.info.width, actual.info.height], [expected.width, expected.height]);
    assert.ok(
      actual.data.equals(Buffer.from(expected.data)),
      'new worker settled pixels match the recovered recipe exactly',
    );
    assert.ok(
      !actual.data.equals(Buffer.from(source.data)),
      'the recovered nonzero edit changes pixels',
    );
    await page.screenshot({ path: resolve(artifacts, 'worker-recovery-complete.png') });
    assert.deepEqual(result.pageErrors, []);
    Object.assign(result, {
      state: 'passed',
      busyObservedBeforeFaultNotification: true,
      busyReleasedAfterFault: true,
      completeDraftPreserved: true,
      recreatedOnlyAfterExplicitImport: true,
      originalWorkerId: original.workerId,
      recoveredWorkerId: recovered.workerId,
      restoredExposure: beforeFailure.recipe.adjustments.exposure,
      exactSettledPixels: expected.width * expected.height,
      actualWorkerReplyAndCanvasPaint: recovered,
    });
    process.stdout.write(JSON.stringify({ workerRecovery: result }) + '\n');
  } catch (error) {
    result.state = 'failed';
    result.message = String(error);
    result.trace = await page
      .evaluate(() => {
        const trace = window.workerRecoveryTrace;
        return {
          fault: trace?.fault,
          paints: trace?.paints,
          workers: trace?.workers.map(({ instance: _instance, ...record }) => record),
          busy: document.querySelector('.canvas-stage')?.getAttribute('aria-busy'),
          visibleError: document.querySelector('.canvas-error')?.textContent,
        };
      })
      .catch(() => null);
    await page
      .screenshot({ path: resolve(artifacts, 'worker-recovery-failure.png') })
      .catch(() => {});
    throw error;
  } finally {
    await page.close();
  }
}
try {
  await vite.listen();
  const channel = process.env.BROWSER_CHANNEL;
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
  report.browser = browser.version();
  const largePhoto = process.env.PREVIEW_LARGE_PHOTO;
  let width, height, rgba;
  if (largePhoto) {
    const photo = await sharp(await readFile(largePhoto))
      .autoOrient()
      .toColourspace('srgb')
      .removeAlpha()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    ({ width, height } = photo.info);
    rgba = photo.data;
    assert.ok(width * height > 4_194_304 && width * height <= 16_777_216);
  } else {
    width = 2200;
    height = 1700;
    rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        rgba[i] = 25 + Math.floor((x * 195) / width);
        rgba[i + 1] = 20 + Math.floor((y * 200) / height);
        rgba[i + 2] = 100 + (Math.floor(x / 13) % 8) * 12;
        rgba[i + 3] = 255;
      }
    }
  }
  const buffer = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const selectedCase = process.env.PREVIEW_CASE;
  const hslBand = HSL_BANDS.find((band) => band.id === (process.env.PREVIEW_HSL_BAND ?? 'red'));
  assert.ok(hslBand, 'the requested HSL band exists');
  for (const [size, test] of [
    [{ width: 1440, height: 900, deviceScaleFactor: 2 }, '曝光'],
    [{ width: 1440, height: 900, deviceScaleFactor: 2 }, '曲线'],
    [{ width: 1440, height: 900, deviceScaleFactor: 2 }, '饱和度'],
    [{ width: 1440, height: 900, deviceScaleFactor: 2 }, 'HSL'],
    [{ width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true }, '曝光'],
  ]) {
    const { width: w, height: h, ...device } = size;
    if (
      selectedCase === 'mask' ||
      (selectedCase === 'saturation' && test !== '饱和度') ||
      (selectedCase === 'hsl' && test !== 'HSL') ||
      (selectedCase === 'phone' && !device.hasTouch)
    )
      continue;
    const page = await browser.newPage({
      viewport: { width: w, height: h },
      acceptDownloads: true,
      reducedMotion: 'reduce',
      ...device,
    });
    // Record actual paints on the visible canvas. No readbacks or serialization in the hot path.
    await page.addInitScript(
      ({ large, band, probes }) => {
        if (large) localStorage.setItem('editor:pixel-budget:v2', '16777216');
        const paint = CanvasRenderingContext2D.prototype.putImageData;
        const observed = new WeakSet();
        const post = Worker.prototype.postMessage;
        const positions = Array.from({ length: 81 }, (_, i) => [
          (Math.floor(i / 9) + 0.5) / 9,
          ((i % 9) + 0.5) / 9,
        ]).concat(probes);
        window.previewTrace = {
          paints: [],
          worker: [],
          inputs: [],
          valueChanges: [],
          armed: false,
          pointerId: null,
          pointerType: null,
          start: null,
          end: null,
        };
        Worker.prototype.postMessage = function (message, ...args) {
          if (message?.type === 'interactive-preview') {
            const trace = window.previewTrace;
            trace.worker.push({
              id: message.id,
              sent: performance.now(),
              saturation: message.recipe?.adjustments?.saturation,
              hue: message.recipe?.hsl?.[band]?.hue,
            });
            if (!observed.has(this)) {
              observed.add(this);
              this.addEventListener('message', ({ data }) => {
                const job = trace.worker.find(({ id }) => id === data?.id);
                if (job) job.received = performance.now();
              });
            }
          }
          return post.call(this, message, ...args);
        };
        CanvasRenderingContext2D.prototype.putImageData = function (image, ...args) {
          paint.call(this, image, ...args);
          if (this.canvas.getAttribute('aria-label') !== '照片编辑预览') return;
          const sample = positions.flatMap(([y, x]) => {
            const at =
              (Math.floor(image.height * y) * image.width + Math.floor(image.width * x)) * 4;
            return Array.from(image.data.subarray(at, at + 4));
          });
          window.previewTrace.paints.push({
            t: performance.now(),
            width: image.width,
            height: image.height,
            sample,
          });
        };
        document.addEventListener(
          'pointerdown',
          (event) => {
            const trace = window.previewTrace;
            if (!trace.armed || trace.start !== null || event.button !== 0) return;
            // Start at the actual DOM input, before the control handles the gesture.
            // The first pointermove is later and can follow a valid pointerdown paint.
            trace.start = event.timeStamp;
            trace.pointerId = event.pointerId;
            trace.pointerType = event.pointerType;
            trace.armed = false;
          },
          true,
        );
        document.addEventListener(
          'pointermove',
          (event) => {
            const trace = window.previewTrace;
            if (
              trace.start !== null &&
              trace.end === null &&
              event.pointerId === trace.pointerId &&
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
          (event) => {
            const trace = window.previewTrace;
            if (trace.start !== null && trace.end === null && event.pointerId === trace.pointerId)
              trace.end = performance.now();
          },
          true,
        );
      },
      {
        large: Boolean(largePhoto),
        band: hslBand.id,
        probes: test === 'HSL' ? hslProbePositions(rgba, width, height, hslBand.id) : [],
      },
    );
    // Local editor works without an authenticated API. Keep unrelated config requests deterministic.
    await page.route('**/v1/**', (route) =>
      route.fulfill({ status: 503, json: { message: 'offline' } }),
    );
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/#/studio`);
    await page.getByLabel('选择照片', { exact: true }).setInputFiles({
      name: 'interactive-preview.png',
      mimeType: 'image/png',
      buffer,
    });
    await page.waitForFunction(() => window.previewTrace.paints.length >= 2);
    await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
    const canvas = page.locator('.image-frame canvas[aria-label="照片编辑预览"]');
    const readCanvas = () => canvas.evaluate((node) => node.toDataURL('image/png').split(',')[1]);
    const original = Buffer.from(await readCanvas(), 'base64');
    if (largePhoto) {
      const opened = await sharp(original).metadata();
      assert.deepEqual([opened.width, opened.height], [width, height]);
    }
    const tools = page.getByRole('navigation', { name: '编辑工具' });
    const tool = tools.getByRole('button', {
      name:
        test === '曲线'
          ? '曲线'
          : test === '饱和度' || test === 'HSL'
            ? '色彩'
            : w < 760
              ? '调节'
              : '明暗',
      exact: true,
    });
    if ((await tool.getAttribute('aria-pressed')) !== 'true') await tool.click();
    const panel = page.locator('.free-panel[aria-hidden="false"]');
    await panel.waitFor();
    const sliderName = test === 'HSL' ? hslBand.label + '色色相' : test;
    let start, target;
    if (test === '曲线') {
      const graph = panel.locator('.curve-graph');
      const box = await graph.boundingBox();
      assert.ok(box);
      const preparationStartedAt = await page.evaluate(() => performance.now());
      await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.waitForFunction(
        () => document.querySelectorAll('.curve-graph [data-curve-point]').length === 3,
      );
      // Adding a curve point is a separate edit. Its final paint must not be
      // counted as feedback from the drag that follows, even if it looks identical.
      await page.waitForFunction((after) => {
        const paints = window.previewTrace.paints;
        const latest = paints.at(-1);
        return (
          document.querySelector('.canvas-stage')?.getAttribute('aria-busy') === 'false' &&
          latest &&
          latest.t >= after &&
          latest.width === Math.max(...paints.map((frame) => frame.width))
        );
      }, preparationStartedAt);
      const point = await graph.locator('[data-curve-point="1"] circle').first().boundingBox();
      assert.ok(point);
      start = { x: point.x + point.width / 2, y: point.y + point.height / 2 };
      target = { x: start.x, y: box.y + box.height * 0.14 };
    } else {
      if (test === 'HSL') {
        await panel.getByRole('button', { name: 'HSL', exact: true }).click();
        const chip = panel.getByRole('button', { name: hslBand.label + '色段', exact: true });
        if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
      }
      const slider = panel.getByRole('slider', { name: sliderName, exact: true });
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
    await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
    await page.evaluate(() => {
      const trace = window.previewTrace;
      trace.baseline = trace.paints.reduce((full, frame) =>
        frame.width >= full.width ? frame : full,
      );
      trace.paints = [];
      trace.worker = [];
      trace.inputs = [];
      trace.valueChanges = [];
      trace.pointerId = null;
      trace.pointerType = null;
      trace.start = null;
      trace.end = null;
      trace.armed = true;
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
    await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
    const trace = await page.evaluate(() => window.previewTrace);
    const inputTime = trace.start;
    assert.ok(Number.isFinite(inputTime), 'the measured gesture has an actual pointerdown');
    assert.ok(Number.isFinite(trace.end) && trace.end > inputTime, 'the same pointer ended');
    assert.ok(
      trace.inputs.length > 0 && trace.inputs.every((t) => t >= inputTime && t <= trace.end),
      'actual pointermove inputs belong to the measured pointerdown/up interval',
    );
    const changed = (p) => p.sample.some((v, i) => v !== trace.baseline.sample[i]);
    const duringGesture = trace.paints.filter((p) => p.t >= inputTime && p.t < trace.end);
    const frames = duringGesture.filter(changed);
    const distinct = new Set(frames.map((p) => p.sample.join(','))).size;
    assert.ok(
      duringGesture.every(
        (p) => p.width === trace.baseline.width && p.height === trace.baseline.height,
      ),
      'every paint during the gesture must keep the full working image dimensions',
    );
    const gaps = frames.length
      ? [
          ...frames.map((frame, index) => frame.t - (frames[index - 1]?.t ?? inputTime)),
          trace.end - frames.at(-1).t,
        ].sort((a, b) => a - b)
      : [];
    const caseReport = {
      test,
      ...(test === 'HSL' ? { band: hslBand.id } : {}),
      viewport: `${w}×${h}`,
      inputStartEvent: 'pointerdown',
      pointerType: trace.pointerType,
      inputEvents: trace.inputs.length,
      gestureMs: trace.end - inputTime,
      firstPaintMs: duringGesture.length ? duringGesture[0].t - inputTime : null,
      firstChangedMs: frames.length ? frames[0].t - inputTime : null,
      firstRangeChangeMs: trace.valueChanges.length ? trace.valueChanges[0] - inputTime : null,
      firstWorkerDispatchMs: trace.worker[0] ? trace.worker[0].sent - inputTime : null,
      firstWorkerRoundTripMs: trace.worker[0]?.received
        ? trace.worker[0].received - trace.worker[0].sent
        : null,
      firstWorkerSaturation: trace.worker[0]?.saturation ?? null,
      ...(test === 'HSL' ? { firstWorkerHue: trace.worker[0]?.hue ?? null } : {}),
      distinctLiveFrames: distinct,
      liveRasterPixels: duringGesture.length
        ? {
            minimum: Math.min(...duringGesture.map((frame) => frame.width * frame.height)),
            maximum: Math.max(...duringGesture.map((frame) => frame.width * frame.height)),
            settled: trace.baseline.width * trace.baseline.height,
          }
        : null,
      p95FrameGapMs: gaps[Math.ceil(gaps.length * 0.95) - 1] ?? null,
      maxFrameGapMs: gaps.at(-1) ?? null,
      firstPostReleasePaintMs:
        trace.paints.find((p) => p.t >= trace.end && p.width === trace.baseline.width && changed(p))
          .t - trace.end,
      settledMs: trace.paints.at(-1).t - trace.end,
      baseline: trace.baseline.sample,
      settled: trace.paints.at(-1).sample,
    };
    if (process.env.PREVIEW_RECORD_ONLY !== '1') {
      const rendered = Buffer.from(await readCanvas(), 'base64');
      if (cdp) {
        const slider = panel.getByRole('slider', { name: sliderName, exact: true });
        const settledValue = await slider.inputValue();
        await touch('touchStart', target);
        await touch('touchMove', start);
        const control = await slider.elementHandle();
        await page.waitForFunction(
          ([node, value]) => node.value !== value,
          [control, settledValue],
        );
        await touch('touchCancel');
        await page.waitForFunction(
          ([node, value]) => node.value === value,
          [control, settledValue],
        );
        await page.locator('.canvas-stage[aria-busy="false"]').waitFor();
        assert.equal(await readCanvas(), rendered.toString('base64'));
        caseReport.touchCancellationRestoredPixels = true;
      }
      const view = page.getByRole('button', { name: '切换工作视图' });
      if (await view.isVisible()) {
        await view.click();
        const navigation = page.getByRole('dialog', { name: '工作视图', exact: true });
        await navigation.locator('button[data-view="deliver"]').click();
        await navigation.waitFor({ state: 'hidden' });
      } else
        await page
          .getByRole('navigation', { name: '工作视图', exact: true })
          .getByRole('button', { name: '交付', exact: true })
          .click();
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: '保存编辑配方', exact: true }).click(),
      ]);
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const recipe = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const source = await sharp(original)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const renderReference = test === 'HSL' ? renderEditorRecipeTiled : renderEditorRecipe;
      const expected = renderReference(
        {
          width: source.info.width,
          height: source.info.height,
          data: new Uint8ClampedArray(source.data),
        },
        recipe,
        { maxPixels: source.info.width * source.info.height },
      );
      const actual = await sharp(rendered).ensureAlpha().raw().toBuffer();
      assert.ok(
        actual.equals(Buffer.from(expected.data)),
        `${test} ${w} exact settled pixel parity`,
      );
      caseReport.exactSettledPixels = expected.width * expected.height;
    }
    report.cases.push(caseReport);
    if (largePhoto)
      await page.screenshot({
        path: resolve(
          artifacts,
          `native-${test === '曲线' ? 'curve' : test === '饱和度' ? 'saturation' : test === 'HSL' ? 'hsl' : 'exposure'}-${w}.png`,
        ),
      });
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
      assert.ok(
        test.firstChangedMs !== null && test.firstChangedMs >= 0 && test.firstChangedMs < 240,
        JSON.stringify(test),
      );
      assert.ok(test.maxFrameGapMs !== null && test.maxFrameGapMs < 350, JSON.stringify(test));
    }
  }
  if (
    !largePhoto &&
    process.env.PREVIEW_RECORD_ONLY !== '1' &&
    (!selectedCase || selectedCase === 'mask')
  ) {
    if (selectedCase !== 'mask')
      await verifyWorkerRecovery({
        png: buffer,
        source: { width, height, data: new Uint8ClampedArray(rgba) },
      });
    await verifyLocalMaskAndLiquify(buffer);
  } else {
    report.workerRecovery = {
      state: 'not-run',
      reason: 'Run the independent worker recovery case with the default input.',
    };
  }
} finally {
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await vite.close();
  await rm(temporary, { recursive: true, force: true });
}
