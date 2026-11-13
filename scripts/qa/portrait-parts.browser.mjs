import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import {
  applyPortraitValues,
  PRECISE_PORTRAIT_ANALYSIS,
  portraitToolAvailability,
  validatePortraitAnalysis,
} from '@ai-xiutu/portrait';
import {
  compileSelectionMaskV3,
  compileWarpFieldV3,
  createRecipeV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
} from '@ai-xiutu/editor';

if (process.env.CI !== 'true' || process.env.NODE_ENV === 'production')
  throw new Error('Isolated QA only');
const output = resolve(process.env.PARTS_QA_DIR || 'artifacts/portrait-parts');
await mkdir(output, { recursive: true });
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const sourceSets = await Promise.all(
  ['portrait-native-inputs.json', 'restoration-inputs.json', 'portrait-standing-inputs.json'].map(
    async (file) => JSON.parse(await readFile('scripts/qa/' + file, 'utf8')).inputs,
  ),
);
const inputs = [
  ...new Map(
    sourceSets
      .flat()
      .filter(Boolean)
      .map((item) => [item.sha256, item]),
  ).values(),
];
const generated = {
  name: 'studio-full-length',
  file: 'apps/web/public/about/review/portrait-body-source.webp',
};
const cases = [...inputs, generated];
const only = process.env.PARTS_QA_ONLY?.split(',').filter(Boolean);
let browser, vite;
const report = [];
const png = (image) =>
  sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } })
    .png()
    .toBuffer();
const beforeAfter = async (original, modified, name) => {
  const width = 480,
    height = 560;
  const resize = async (image) =>
    sharp(await png(image))
      .resize(width, height, { fit: 'contain', background: '#e8e7e4' })
      .png()
      .toBuffer();
  await sharp({ create: { width: 2 * width, height, channels: 4, background: '#e8e7e4' } })
    .composite([
      { input: await resize(original), left: 0, top: 0 },
      { input: await resize(modified), left: width, top: 0 },
    ])
    .png()
    .toFile(join(output, name + '.png'));
};
function movement(recipe, image, p) {
  const f = compileWarpFieldV3(recipe.warp, image);
  const q = f(p);
  return Math.hypot((p.x - q.x) * image.width, (p.y - q.y) * image.height);
}
async function sourceBytes(input) {
  if (input.file) return readFile(input.file);
  const cache = join('artifacts/browser-v4-source-cache', input.sha256 + '.jpg');
  let bytes;
  try {
    bytes = await readFile(cache);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(input.url, {
      signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'AI-Xiutu QA (public photo model acceptance)' },
    });
    if (!response.ok) throw new Error(input.name + ': HTTP ' + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  assert.equal(bytes.length, input.bytes, input.name);
  assert.equal(sha(bytes), input.sha256, input.name);
  return bytes;
}
try {
  vite = await createServer({
    configFile: resolve('apps/web/vite.config.ts'),
    server: { host: '127.0.0.1', port: 4193, strictPort: true },
  });
  await vite.listen();
  const origin = 'http://127.0.0.1:4193';
  browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(origin + '/v1/'))
      return route.fulfill({ status: 503, json: { error: { code: 'QA_OFFLINE' } } });
    return url.startsWith(origin + '/') ? route.continue() : route.abort();
  });
  await page.goto(origin + '/#/studio');
  for (const input of cases.filter(({ name }) => !only?.length || only.includes(name))) {
    const bytes = await sourceBytes(input);
    const { data, info } = await sharp(bytes)
      .autoOrient()
      .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    const image = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
    const frame = {
      coordinates: 'source-normalized',
      orientation: 'normalized',
      width: image.width,
      height: image.height,
      contentHash: sha(data),
    };
    const started = performance.now();
    const analysis = validatePortraitAnalysis(
      await page.evaluate(
        async ({ image, frame }) => {
          const { default: Worker } = await import('/src/editor/portrait.worker.ts?worker');
          const worker = new Worker();
          try {
            return await new Promise((yes, no) => {
              const timer = setTimeout(() => no(new Error('Analysis timeout')), 60000);
              worker.onerror = (e) => {
                clearTimeout(timer);
                no(new Error(e.message));
              };
              worker.onmessage = ({ data }) => {
                if (data.progress) return;
                clearTimeout(timer);
                if (data.error) no(new Error(data.error + ' ' + (data.diagnostic ?? '')));
                else yes(data.result);
              };
              const pixels = new Uint8ClampedArray(image.data);
              worker.postMessage(
                {
                  id: 1,
                  image: { width: image.width, height: image.height, data: pixels },
                  width: frame.width,
                  height: frame.height,
                  contentHash: frame.contentHash,
                  body: true,
                  segmentation: true,
                },
                [pixels.buffer],
              );
            });
          } finally {
            worker.terminate();
          }
        },
        { image: { ...image, data: Array.from(image.data) }, frame },
      ),
      frame,
    );
    assert.equal(analysis.algorithmVersion, PRECISE_PORTRAIT_ANALYSIS);
    await writeFile(join(output, input.name + '-analysis.json'), JSON.stringify(analysis));
    const result = {
      name: input.name,
      source: input.source ?? 'Generated full-length fixture in the About page',
      sourcePage: input.page ?? input.url,
      ...(input.license ? { comparisonLicense: input.license } : {}),
      size: [image.width, image.height],
      analysisRoundTripMs: Math.round(performance.now() - started),
      targets: [],
      warnings: analysis.warnings,
    };
    const keys = {
      face: {
        teethTone: 55,
        nostrilTone: 40,
        pupilSize: 45,
        earSize: -37,
        hairline: 34,
        hairVolume: 50,
      },
      body: { waist: 55, hips: -30, shoulders: 40, arms: 36, legs: 38, legLength: 65, height: 40 },
    };
    for (const [index, target] of analysis.targets.entries()) {
      const available = new Set(
        portraitToolAvailability(analysis, target.id)
          .filter((tool) => tool.available)
          .map((tool) => tool.id),
      );
      const controls = Object.fromEntries(
        Object.entries(keys[target.kind]).filter(([key]) => available.has(key)),
      );
      const observed = {
        kind: target.kind,
        bodyMask: !!target.bodyMask,
        bodySupport: !!target.bodySupport,
        features: Object.fromEntries(
          Object.entries(target.contours).map(([k, v]) => [k, v.length]),
        ),
        masks: Object.keys(target.featureMasks ?? {}),
        controls: Object.keys(controls),
      };
      result.targets.push(observed);
      if (!Object.keys(controls).length || (input.name !== 'studio-full-length' && index > 2))
        continue;
      const recipe = applyPortraitValues(createRecipeV4(), analysis, target.id, controls);
      const out = renderEditorRecipe(image, recipe);
      const tiled = renderEditorRecipeTiled(image, recipe, { tileSize: 173 });
      assert.deepEqual(tiled.data, out.data, input.name + ' render/tile parity');
      let changes = 0;
      for (let at = 0; at < out.data.length; at += 4) {
        if (
          out.data[at] !== image.data[at] ||
          out.data[at + 1] !== image.data[at + 1] ||
          out.data[at + 2] !== image.data[at + 2]
        )
          changes++;
      }
      assert.ok(changes > 0, input.name + ' active controls produce a visible edit');
      const away = [
        { x: 0.001, y: 0.001 },
        { x: 0.999, y: 0.001 },
        { x: 0.001, y: 0.999 },
        { x: 0.999, y: 0.999 },
      ].filter(
        (p) =>
          p.x < target.bounds.x - 0.14 ||
          p.x > target.bounds.x + target.bounds.width + 0.14 ||
          p.y < target.bounds.y - 0.24 ||
          p.y > target.bounds.y + target.bounds.height + 0.2,
      );
      for (const p of away)
        assert.ok(movement(recipe, image, p) < 0.01, input.name + ' distant background');
      if (target.kind === 'body' && available.has('legLength') && target.contours.footPins)
        assert.ok(
          target.contours.footPins.every((p) => movement(recipe, image, p) < 0.45),
          input.name + ' stable foot anchors',
        );
      observed.changedPixels = changes;
      observed.warpAnchors = recipe.warp.strokes.reduce(
        (count, s) => count + (s.anchors?.length ?? 0),
        0,
      );
      for (const id of ['teethTone', 'nostrilTone']) {
        if (!(id in controls)) continue;
        const part = applyPortraitValues(createRecipeV4(), analysis, target.id, { [id]: 65 });
        const mask = compileSelectionMaskV3(part.regionEdits[0].mask, image);
        const toned = renderEditorRecipe(image, part);
        for (let at = 0; at < out.data.length; at += 4) {
          if (
            toned.data[at] === image.data[at] &&
            toned.data[at + 1] === image.data[at + 1] &&
            toned.data[at + 2] === image.data[at + 2]
          )
            continue;
          const pixel = at / 4;
          assert.ok(
            mask(
              ((pixel % image.width) + 0.5) / image.width,
              (Math.floor(pixel / image.width) + 0.5) / image.height,
            ) > 0,
            id + ' outside-mask pixel',
          );
        }
      }
      await beforeAfter(image, out, input.name + '-' + target.kind + '-' + index);
    }
    console.log(JSON.stringify(result));
    report.push(result);
  }
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (!only?.length) {
    for (const tool of [
      'teethTone',
      'nostrilTone',
      'pupilSize',
      'earSize',
      'hairline',
      'hairVolume',
      'waist',
      'legLength',
      'height',
    ])
      assert.ok(
        report.some((p) => p.targets.some((t) => t.controls.includes(tool))),
        `No usable ${tool} in the photo set`,
      );
    const cropped = report.find((entry) => entry.name === 'portrait-hopper');
    assert.ok(
      cropped?.targets.every(
        (target) =>
          !target.controls.includes('teethTone') && !target.controls.includes('legLength'),
      ),
    );
  }
} finally {
  await browser?.close();
  await vite?.close();
}
