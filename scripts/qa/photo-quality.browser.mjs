/** Real public photographs, actual inference and independent known degradations. No paid calls. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import {
  createRecipeV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  renderCutout,
  compileSelectionMaskV3,
  renderPhotoRestoration,
  motionKernel,
  srgbToLinear,
  linearToSrgb,
} from '@ai-xiutu/editor';
import {
  validatePortraitAnalysis,
  applyPortraitValues,
  portraitToolAvailability,
} from '@ai-xiutu/portrait';

if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production')
  throw new Error('Isolated QA only');
const output = resolve(process.env.PHOTO_QUALITY_ARTIFACT_DIR ?? 'artifacts/photo-quality');
await mkdir(output, { recursive: true });
const sources = [
  ...JSON.parse(await readFile('scripts/qa/portrait-native-inputs.json', 'utf8')).inputs,
  ...JSON.parse(await readFile('scripts/qa/restoration-inputs.json', 'utf8')).inputs,
];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const models = JSON.parse(await readFile('apps/web/public/vision/manifest.json', 'utf8'));
for (const model of models.assets)
  assert.equal(sha(await readFile(join('apps/web/public/vision', model.file))), model.sha256);
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  models,
  source:
    'Pinned public photographs; actual local MediaPipe inference; deterministic degradation ground truth',
  paidCalls: 0,
  manualVisualReview: false,
  photos: [],
  cases: [],
};
const png = (i) =>
  sharp(i.data, { raw: { width: i.width, height: i.height, channels: 4 } })
    .png()
    .toBuffer();
async function sheet(name, tiles) {
  const width = 340,
    height = 310,
    columns = 3,
    composites = [];
  for (let i = 0; i < tiles.length; i++) {
    const left = (i % columns) * width,
      top = Math.floor(i / columns) * height;
    const image = await sharp(await png(tiles[i].image))
      .resize(width, height - 28, { fit: 'contain', background: '#dedede' })
      .png()
      .toBuffer();
    composites.push({ input: image, left, top: top + 28 });
    composites.push({
      input: Buffer.from(
        `<svg width="340" height="28"><rect width="340" height="28" fill="white"/><text x="6" y="19" font-size="14">${tiles[i].label.replace(/[<>&]/g, '')}</text></svg>`,
      ),
      left,
      top,
    });
  }
  await sharp({
    create: {
      width: width * columns,
      height: height * Math.ceil(tiles.length / columns),
      channels: 4,
      background: '#fff',
    },
  })
    .composite(composites)
    .png()
    .toFile(join(output, `${name}.png`));
}
const mse = (a, b) => {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) if (i % 4 !== 3) sum += (a.data[i] - b.data[i]) ** 2;
  return sum / (a.width * a.height * 3);
};
function checkPortraitSupport(image, edited, recipe) {
  const mask = [...recipe.regionEdits, ...recipe.retouch]
    .filter((op) => op.enabled && op.opacity > 0)
    .map((op) => ({
      selected: compileSelectionMaskV3(op.mask, image, image),
      protect: op.protection ? compileSelectionMaskV3(op.protection, image, image) : null,
    }));
  let changed = 0;
  for (let at = 0; at < image.data.length; at += 4) {
    assert.equal(edited.data[at + 3], image.data[at + 3], 'portrait alpha');
    if (
      edited.data[at] === image.data[at] &&
      edited.data[at + 1] === image.data[at + 1] &&
      edited.data[at + 2] === image.data[at + 2]
    )
      continue;
    const pixel = at / 4,
      x = ((pixel % image.width) + 0.5) / image.width,
      y = (Math.floor(pixel / image.width) + 0.5) / image.height;
    assert.ok(
      mask.some(({ selected, protect }) => selected(x, y) > 0 && (protect?.(x, y) ?? 0) < 1),
      `changed outside portrait mask: ${pixel}`,
    );
    changed++;
  }
  return changed;
}
async function getBytes(source) {
  const path = join('artifacts/browser-v4-source-cache', `${source.sha256}.jpg`);
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    const response = await fetch(source.url, { signal: AbortSignal.timeout(30000) });
    assert.ok(response.ok, `${source.name}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.length, source.bytes);
    assert.equal(sha(bytes), source.sha256);
    await mkdir('artifacts/browser-v4-source-cache', { recursive: true });
    await writeFile(path, bytes);
  }
  assert.equal(sha(bytes), source.sha256);
  return bytes;
}
let vite, browser;
try {
  vite = await createServer({
    configFile: resolve('apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 4186, strictPort: true },
  });
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return u.origin === 'http://127.0.0.1:4186' || ['data:', 'blob:'].includes(u.protocol)
      ? route.continue()
      : route.abort();
  });
  await page.goto('http://127.0.0.1:4186');
  for (const source of sources) {
    const decoded = await sharp(await getBytes(source))
      .autoOrient()
      .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const image = {
      width: decoded.info.width,
      height: decoded.info.height,
      data: new Uint8ClampedArray(decoded.data),
    };
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
          return await new Promise((done, reject) => {
            const timer = setTimeout(
              () => reject(new Error('Actual model inference timed out')),
              60000,
            );
            worker.onerror = (event) => {
              clearTimeout(timer);
              reject(new Error(event.message));
            };
            worker.onmessage = (event) => {
              if (event.data.error) {
                clearTimeout(timer);
                reject(new Error(event.data.error));
              }
              if (event.data.result) {
                clearTimeout(timer);
                done(event.data.result);
              }
            };
            worker.postMessage({
              id: 1,
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
          });
        } finally {
          worker.terminate();
        }
      },
      { ...frame, bytes: decoded.data.toString('base64') },
    );
    const analysis = validatePortraitAnalysis(result, frame);
    report.photos.push({
      ...source,
      frame,
      targets: analysis.targets.map((t) => ({ id: t.id, kind: t.kind })),
      warnings: analysis.warnings,
    });
    const beautyTiles = [{ label: 'Original', image }];
    for (const target of analysis.targets.filter((t) => t.kind === 'face')) {
      const available = new Map(
        portraitToolAvailability(analysis, target.id, 4).map((t) => [t.id, t]),
      );
      for (const tool of [
        'smooth',
        'texture',
        'wrinkles',
        'even',
        'skinShine',
        'skinBlemish',
        'skinColorSpot',
      ]) {
        if (!available.get(tool)?.available) {
          report.cases.push({
            photo: source.name,
            tool,
            state: 'unavailable',
            reason: available.get(tool)?.reason,
          });
          continue;
        }
        for (const value of tool === 'texture' ? [-100, -50, 0, 50, 100] : [0, 25, 50, 75, 100]) {
          const recipe = applyPortraitValues(createRecipeV4(), analysis, target.id, {
              [tool]: value,
            }),
            start = performance.now();
          const edited = renderEditorRecipe(image, recipe);
          assert.deepEqual(renderEditorRecipeTiled(image, recipe, { tileSize: 61 }), edited);
          if (value === 0) assert.deepEqual(edited.data, image.data);
          report.cases.push({
            photo: source.name,
            target: target.id,
            tool,
            value,
            state: 'passed',
            ms: performance.now() - start,
            hash: sha(edited.data),
            mseChange: mse(image, edited),
            changedPixels: checkPortraitSupport(image, edited, recipe),
          });
          if (target === analysis.targets.find((t) => t.kind === 'face') && value === 50)
            beautyTiles.push({ label: `${tool} 50`, image: edited });
        }
      }
    }
    await sheet(`${source.name}-beauty`, beautyTiles);
    if (analysis.segmentation?.subject) {
      const tiles = [{ label: 'Original', image }];
      for (const algorithm of ['ray-v1', 'guided-v2']) {
        const start = performance.now(),
          cutout = renderCutout(image, {
            algorithm,
            selection: analysis.segmentation.subject,
            radius: 0.02,
            decontaminate: 0.8,
          });
        for (let at = 3; at < cutout.data.length; at += 4)
          assert.ok(cutout.data[at] <= image.data[at]);
        report.cases.push({
          photo: source.name,
          tool: algorithm,
          state: 'passed',
          ms: performance.now() - start,
          hash: sha(cutout.data),
          qualityVerdict: 'requires visual review; no natural-photo ground-truth alpha',
        });
        for (const background of ['#151515', '#ffffff']) {
          const bytes = await sharp(await png(cutout))
            .flatten({ background })
            .ensureAlpha()
            .raw()
            .toBuffer();
          tiles.push({
            label: `${algorithm} ${background}`,
            image: { ...image, data: new Uint8ClampedArray(bytes) },
          });
        }
      }
      await sheet(`${source.name}-hair-occlusion`, tiles);
    }
    let state = 1997;
    const noisy = { ...image, data: image.data.slice() };
    for (let at = 0; at < noisy.data.length; at++)
      if (at % 4 !== 3) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        noisy.data[at] += (state % 33) - 16;
      }
    const base = {
      algorithm: 'photo-restore-v1',
      luminanceNoise: 55,
      chromaNoise: 75,
      motion: { length: 0, angle: 0, iterations: 6, strength: 0 },
    };
    let start = performance.now();
    const denoised = renderPhotoRestoration(noisy, base);
    const beforeNoise = mse(image, noisy),
      afterNoise = mse(image, denoised);
    assert.ok(
      afterNoise < beforeNoise,
      `${source.name}: actual-image denoise ${beforeNoise} -> ${afterNoise}`,
    );
    report.cases.push({
      photo: source.name,
      tool: 'photo-restore-v1-noise',
      state: 'passed',
      ms: performance.now() - start,
      beforeMse: beforeNoise,
      afterMse: afterNoise,
      truth: 'original real photo before controlled added noise',
    });
    const blurred = { ...image, data: image.data.slice() },
      taps = motionKernel(5, 13);
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++)
        for (let c = 0; c < 3; c++) {
          let sum = 0,
            weight = 0;
          for (const tap of taps) {
            const xx = x + tap.dx,
              yy = y + tap.dy;
            if (xx < 0 || yy < 0 || xx >= image.width || yy >= image.height) continue;
            sum += srgbToLinear(image.data[(yy * image.width + xx) * 4 + c] / 255) * tap.weight;
            weight += tap.weight;
          }
          blurred.data[(y * image.width + x) * 4 + c] = 255 * linearToSrgb(sum / weight);
        }
    start = performance.now();
    const deblurred = renderPhotoRestoration(blurred, {
      ...base,
      luminanceNoise: 0,
      chromaNoise: 0,
      motion: { length: 5, angle: 13, iterations: 6, strength: 0.8 },
    });
    const beforeMotion = mse(image, blurred),
      afterMotion = mse(image, deblurred);
    assert.ok(
      afterMotion < beforeMotion,
      `${source.name}: known motion ${beforeMotion} -> ${afterMotion}`,
    );
    report.cases.push({
      photo: source.name,
      tool: 'photo-restore-v1-motion',
      state: 'passed',
      ms: performance.now() - start,
      beforeMse: beforeMotion,
      afterMse: afterMotion,
      truth: 'original real photo before known linear-light directional PSF',
    });
    await sheet(`${source.name}-restoration`, [
      { label: 'Original truth', image },
      { label: 'Added noise', image: noisy },
      { label: 'Denoise', image: denoised },
      { label: 'Original truth', image },
      { label: 'Known motion blur', image: blurred },
      { label: 'Directional deblur', image: deblurred },
    ]);
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    process.stdout.write(
      `Real-photo quality observations: ${source.name}; ${analysis.targets.length} targets\n`,
    );
  }
} catch (error) {
  report.failure = String(error.stack);
  throw error;
} finally {
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await browser?.close();
  await vite?.close();
}
