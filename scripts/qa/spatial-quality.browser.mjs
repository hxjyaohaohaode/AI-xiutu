/** Actual public-photo model inference and pixel acceptance. Never calls a paid provider. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import {
  createRecipeV4,
  createHealingOperationV4,
  createRetouchRegionV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  renderCutout,
  compileSelectionMaskV3,
} from '@ai-xiutu/editor';
import {
  applyPortraitValues,
  portraitToolAvailability,
  validatePortraitAnalysis,
  PORTRAIT_TOOLS,
} from '@ai-xiutu/portrait';
if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production')
  throw new Error('Isolated QA only');
const output = resolve('artifacts/spatial-quality');
await mkdir(output, { recursive: true });
const sources = JSON.parse(await readFile('scripts/qa/portrait-native-inputs.json', 'utf8')).inputs;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile('apps/web/public/vision/manifest.json', 'utf8'));
for (const asset of manifest.assets)
  assert.equal(sha(await readFile(join('apps/web/public/vision', asset.file))), asset.sha256);
const report = {
  source: 'actual browser MediaPipe CPU/WASM inference on pinned public photographs',
  paidCalls: 0,
  models: manifest,
  photos: [],
  cases: [],
  manualVisualReview: false,
};
let browser, vite;
function rgba(bytes, width, height) {
  return { width, height, data: new Uint8ClampedArray(bytes) };
}
async function png(image) {
  return sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
    .png()
    .toBuffer();
}
async function sheet(name, tiles) {
  const w = 320,
    h = 290,
    columns = 3,
    rows = Math.ceil(tiles.length / columns),
    composites = [];
  for (let i = 0; i < tiles.length; i++) {
    const tile = tiles[i],
      x = (i % columns) * w,
      y = Math.floor(i / columns) * h;
    const content = await sharp(await png(tile.image))
      .resize(w, h - 24, { fit: 'contain', background: '#ededed' })
      .png()
      .toBuffer();
    composites.push({ input: content, left: x, top: y + 24 });
    composites.push({
      input: Buffer.from(
        `<svg width="320" height="24"><rect width="320" height="24" fill="white"/><text x="8" y="17" font-size="13" fill="black">${tile.label.replace(/[<>&]/g, '')}</text></svg>`,
      ),
      left: x,
      top: y,
    });
  }
  await sharp({ create: { width: w * columns, height: h * rows, channels: 4, background: '#fff' } })
    .composite(composites)
    .png()
    .toFile(join(output, `${name}.png`));
}
try {
  vite = await createServer({
    configFile: resolve('apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 4184, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  report.browser = browser.version();
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return u.origin === 'http://127.0.0.1:4184' || ['data:', 'blob:'].includes(u.protocol)
      ? route.continue()
      : route.abort();
  });
  await page.goto('http://127.0.0.1:4184');
  for (const source of sources) {
    const bytes = await readFile(join('artifacts/browser-v4-source-cache', `${source.sha256}.jpg`));
    assert.equal(sha(bytes), source.sha256);
    const decoded = await sharp(bytes)
      .autoOrient()
      .resize(512, 512, { fit: 'inside' })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const image = rgba(decoded.data, decoded.info.width, decoded.info.height);
    const frame = {
      width: image.width,
      height: image.height,
      coordinates: 'source-normalized',
      orientation: 'normalized',
      contentHash: sha(
        Buffer.concat([Buffer.from(`${image.width}x${image.height}:srgb-rgba8:`), decoded.data]),
      ),
    };
    const result = await page.evaluate(
      async (input) => {
        const { default: Worker } = await import('/src/editor/portrait.worker.ts?worker');
        const worker = new Worker();
        try {
          const results = [];
          for (let requestId = 1; requestId <= 2; requestId++) {
            results.push(
              await new Promise((resolve, reject) => {
                const timer = setTimeout(
                  () => reject(new Error('Real model inference timed out')),
                  90000,
                );
                worker.onerror = (e) => {
                  clearTimeout(timer);
                  reject(new Error(e.message));
                };
                worker.onmessage = (e) => {
                  if (e.data.error) {
                    clearTimeout(timer);
                    reject(new Error(e.data.error));
                  }
                  if (e.data.result) {
                    clearTimeout(timer);
                    resolve(e.data.result);
                  }
                };
                worker.postMessage({
                  id: requestId,
                  width: input.width,
                  height: input.height,
                  contentHash: input.contentHash,
                  body: true,
                  segmentation: true,
                  image: {
                    width: input.width,
                    height: input.height,
                    data: Uint8ClampedArray.from(atob(input.bytes), (c) => c.charCodeAt(0)),
                  },
                });
              }),
            );
          }
          if (results.some((r) => !r.segmentation?.skin || !r.targets.length))
            throw new Error('Repeated inference lost its segmentation or target');
          return results[1];
        } finally {
          worker.terminate();
        }
      },
      { ...frame, bytes: decoded.data.toString('base64') },
    );
    const analysis = validatePortraitAnalysis(result, frame);
    assert.ok(analysis.targets.length > 0, `${source.name}: actual model target`);
    assert.ok(
      analysis.segmentation?.skin,
      `${source.name}: actual skin segmentation: ${analysis.warnings.join('; ')}`,
    );
    await writeFile(join(output, `${source.name}.analysis.json`), JSON.stringify(analysis));
    await writeFile(join(output, `${source.name}.canonical.png`), await png(image));
    report.photos.push({
      ...source,
      frame,
      targets: analysis.targets.map((t) => ({ id: t.id, kind: t.kind })),
      warnings: analysis.warnings,
    });
    if (analysis.segmentation.subject) {
      const matte = renderCutout(image, { selection: analysis.segmentation.subject, radius: 0.015, decontaminate: 0.8 });
      let transparent = 0, partial = 0, opaque = 0;
      for (let at = 3; at < matte.data.length; at += 4) {
        assert.ok(matte.data[at] <= image.data[at]);
        if (matte.data[at] === 0) transparent++;
        else if (matte.data[at] === 255) opaque++;
        else partial++;
      }
      assert.ok(transparent && opaque && partial, `${source.name}: matte has foreground, background and soft edges`);
      report.cases.push({ photo: source.name, tool: 'linear-trimap-v1', state: 'passed', transparent, partial, opaque, hash: sha(matte.data) });
      await sheet(`${source.name}-matte`, [{ label: 'Original', image }, { label: 'Subject alpha', image: matte }]);
    } else report.cases.push({ photo: source.name, tool: 'linear-trimap-v1', state: 'unavailable', reason: 'Insufficient foreground/background confidence' });
    for (const target of analysis.targets) {
      const available = new Map(
        portraitToolAvailability(analysis, target.id, 4).map((t) => [t.id, t]),
      );
      for (const tool of PORTRAIT_TOOLS.filter((t) => t.target === target.kind)) {
        if (!available.get(tool.id)?.available) {
          report.cases.push({
            photo: source.name,
            target: target.kind,
            tool: tool.id,
            state: 'unavailable',
            reason: available.get(tool.id)?.reason,
          });
          continue;
        }
        const values = [...new Set([tool.min, tool.min / 2, 0, tool.max / 2, tool.max])];
        const tiles = [{ label: 'Original', image }];
        for (const value of values) {
          const recipe = applyPortraitValues(createRecipeV4(), analysis, target.id, {
            [tool.id]: value,
          });
          const start = performance.now(),
            result = renderEditorRecipe(image, recipe),
            duration = performance.now() - start;
          assert.deepEqual(renderEditorRecipeTiled(image, recipe, { tileSize: 37 }), result);
          if (value === 0) assert.deepEqual(result, image);
          let changedPixels = 0,
            maximumDelta = 0,
            totalDelta = 0;
          for (let at = 0; at < image.data.length; at += 4) {
            let changed = false;
            for (let c = 0; c < 4; c++) {
              const delta = Math.abs(image.data[at + c] - result.data[at + c]);
              changed ||= delta > 0;
              maximumDelta = Math.max(maximumDelta, delta);
              totalDelta += delta;
            }
            if (changed) changedPixels++;
          }
          if (value !== 0)
            assert.ok(
              changedPixels > 0,
              `${source.name}/${tool.id}/${value}: no visible pixels changed`,
            );
          report.cases.push({
            photo: source.name,
            target: target.kind,
            tool: tool.id,
            value,
            state: 'passed',
            ms: duration,
            hash: sha(result.data),
            changedPixels,
            maximumDelta,
            meanAbsoluteDelta: totalDelta / image.data.length,
          });
          tiles.push({ label: `${tool.id} ${value}`, image: result });
        }
        await sheet(`${source.name}-${target.kind}-${tool.id}`, tiles);
        if (target.kind === 'face') {
          const l = Math.max(0, Math.floor((target.bounds.x - 0.03) * image.width));
          const t = Math.max(0, Math.floor((target.bounds.y - 0.03) * image.height));
          const w = Math.min(
            image.width - l,
            Math.ceil((target.bounds.width + 0.06) * image.width),
          );
          const h = Math.min(
            image.height - t,
            Math.ceil((target.bounds.height + 0.06) * image.height),
          );
          const details = [];
          for (const tile of tiles) {
            const raw = await sharp(tile.image.data, {
              raw: { width: image.width, height: image.height, channels: 4 },
            })
              .extract({ left: l, top: t, width: w, height: h })
              .raw()
              .toBuffer();
            details.push({ label: tile.label, image: rgba(raw, w, h) });
          }
          await sheet(`${source.name}-${target.kind}-${tool.id}-detail`, details);
        }
      }
    }
    // Ground truth is retained before damage. A real photo repair is compared
    // numerically with it; quality is recorded, never inferred from a changed hash.
    const mask = {
      type: 'radial',
      centerX: 0.2,
      centerY: 0.75,
      radiusX: 0.025,
      radiusY: 0.025,
      feather: 0,
      invert: false,
    };
    const selected = compileSelectionMaskV3(mask, image, image);
    const damaged = { ...image, data: image.data.slice() };
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        if (selected((x + 0.5) / image.width, (y + 0.5) / image.height))
          damaged.data.set([245, 20, 210, 255], (y * image.width + x) * 4);
    const tiles = [
      { label: 'Original truth', image },
      { label: 'Damaged', image: damaged },
    ];
    for (const method of ['diffusion', 'patch-poisson', 'exemplar-v1']) {
      const recipe = createRecipeV4({
        healing: [createHealingOperationV4({ method, mask, iterations: 256, searchRadius: 0.25 })],
      });
      const start = performance.now(),
        repaired = renderEditorRecipe(damaged, recipe);
      let error = 0,
        count = 0;
      for (let y = 0; y < image.height; y++)
        for (let x = 0; x < image.width; x++) {
          const at = (y * image.width + x) * 4;
          if (!selected((x + 0.5) / image.width, (y + 0.5) / image.height))
            assert.deepEqual(repaired.data.slice(at, at + 4), image.data.slice(at, at + 4));
          else
            for (let c = 0; c < 3; c++) {
              error += Math.abs(repaired.data[at + c] - image.data[at + c]);
              count++;
            }
        }
      assert.deepEqual(renderEditorRecipeTiled(damaged, recipe, { tileSize: 37 }), repaired);
      report.cases.push({
        photo: source.name,
        tool: method,
        state: 'passed',
        maeToGroundTruth: error / count,
        ms: performance.now() - start,
      });
      tiles.push({ label: `${method} MAE ${(error / count).toFixed(2)}`, image: repaired });
    }
    await sheet(`${source.name}-healing`, tiles);
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`Real portrait and repair sweep passed: ${source.name}\n`);
  }
} catch (e) {
  report.failure = String(e.stack);
  throw e;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await vite?.close();
}
