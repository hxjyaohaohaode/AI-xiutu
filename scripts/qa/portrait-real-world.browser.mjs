import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';
import {
  PORTRAIT_TOOLS,
  applyPortraitValues,
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

assert.equal(process.env.CI, 'true', 'Use only with public photo fixtures');
const commit =
  process.env.PORTRAIT_QA_REVISION ??
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.match(commit, /^[a-f0-9]{40}$/);
const output = resolve(process.env.PORTRAIT_QA_DIR ?? 'artifacts/portrait-real-world');
const cache = resolve('artifacts/portrait-real-world-inputs');
const fixtures = new URL('./fixtures/portrait/', import.meta.url);
const { inputs } = JSON.parse(await readFile('scripts/qa/portrait-real-world-inputs.json', 'utf8'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const filter = process.env.PORTRAIT_QA_CASES?.split(',');
const meterOnly = process.env.PORTRAIT_QA_METER_ONLY === 'true';
// Manually marked nose positions for the people in the comparative crops.
// Both revisions must select the same person even if detector ordering changes.
const subjects = {
  'group-crew': { face: [0.757, 0.276] },
  'group-street': { face: [0.407, 0.104], body: [0.407, 0.104] },
  'group-distance': { body: [0.856, 0.398], face: [0.856, 0.398] },
};
const parts = {
  face: {
    smooth: 26,
    even: 18,
    skinBlemish: 20,
    faceSlim: 28,
    vFace: 24,
    faceNarrow: 16,
    eyeSize: 21,
    pupilSize: 20,
    teethTone: 31,
    nostrilTone: 17,
    hairline: -20,
    hairVolume: 28,
    earSize: -21,
  },
  body: {
    headSize: 18,
    neckLength: 19,
    shoulders: 25,
    arms: 22,
    waist: 29,
    hips: -13,
    legs: 26,
    legLength: 30,
    height: 21,
  },
};
const stacks = {
  face: { ...parts.face, lipstick: 12, blush: 10 },
  body: parts.body,
};
const singles = {
  'low-phone-light': 'eyeSize',
  'low-nina': 'hairVolume',
  'group-crew': 'eyeSize',
  'group-street': 'legLength',
  'group-distance': 'waist',
  'half-mask': 'pupilSize',
  'smile-fringe': 'hairline',
  'profile-curls': 'earSize',
  'smile-freckles': 'pupilSize',
  'smile-headshot': 'teethTone',
  'smile-studio': 'smooth',
  'low-vox': 'smooth',
  'low-koshy': 'eyeSize',
  'standing-pat': 'waist',
  'standing-guo': 'legLength',
  'profile-pedro': 'earSize',
  'group-aerobics': 'arms',
};
const cases = [];
const inventory = Object.fromEntries(
  PORTRAIT_TOOLS.map(({ id, group, label }) => [id, { group, label, examples: [] }]),
);
const writeReport = () =>
  writeFile(join(output, 'report.json'), JSON.stringify({ commit, cases, inventory }, null, 2));

function selectSubject(analysis, name, kind) {
  const people = analysis.targets.filter((target) => target.kind === kind);
  const hint = subjects[name]?.[kind];
  if (!hint)
    return people.sort(
      (a, b) => b.bounds.width * b.bounds.height - a.bounds.width * a.bounds.height,
    )[0];
  const distance = (target) => {
    const nose = target.landmarks[kind === 'face' ? 1 : 0];
    return Math.hypot(nose.x - hint[0], nose.y - hint[1]);
  };
  return people
    .filter((target) => distance(target) < 0.055)
    .sort((a, b) => distance(a) - distance(b))[0];
}

async function imageInput(input) {
  const name = input.name + '.jpg';
  const path = input.vendored ? new URL(name, fixtures) : join(cache, name);
  let bytes;
  let downloaded = false;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (input.vendored || error.code !== 'ENOENT') throw error;
    const response = await fetch(input.url, {
      signal: AbortSignal.timeout(30000),
      headers: { 'User-Agent': 'AI-Xiutu QA (public portrait fixture)' },
    });
    assert.ok(response.ok, `${input.name} HTTP ${response.status}`);
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      assert.ok(length <= input.bytes, input.name + ' exceeds its pinned size');
      chunks.push(chunk);
    }
    bytes = Buffer.concat(chunks, length);
    downloaded = true;
  }
  assert.equal(bytes.length, input.bytes, input.name);
  assert.equal(sha(bytes), input.sha256, input.name);
  if (downloaded) {
    await mkdir(cache, { recursive: true });
    await writeFile(path, bytes);
  }
  const decoded = sharp(bytes);
  const metadata = await decoded.metadata();
  const { data, info } = await decoded
    .autoOrient()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    image: { width: info.width, height: info.height, data: new Uint8ClampedArray(data) },
    frame: {
      coordinates: 'source-normalized',
      orientation: 'normalized',
      ...metadata.autoOrient,
      contentHash: input.sha256,
    },
  };
}

function metrics(original, edited) {
  let changed = 0,
    abs = 0;
  for (let at = 0; at < original.data.length; at += 4) {
    const delta =
      Math.abs(original.data[at] - edited.data[at]) +
      Math.abs(original.data[at + 1] - edited.data[at + 1]) +
      Math.abs(original.data[at + 2] - edited.data[at + 2]);
    if (delta) changed++;
    abs += delta;
  }
  return { changedPixels: changed, meanAbsoluteRgb: abs / (original.width * original.height * 3) };
}

function displacement(recipe, image, analysis, selected) {
  const field = compileWarpFieldV3(recipe.warp, image);
  const move = (p) => {
    const q = field(p);
    return Math.hypot((p.x - q.x) * image.width, (p.y - q.y) * image.height);
  };
  const neighbors = analysis.targets
    .filter((t) => t.kind === selected.kind && t !== selected)
    .flatMap((other) =>
      (other.kind === 'face' ? [1, 33, 263, 152] : [0, 11, 12, 23, 24, 27, 28])
        .map((i) => other.landmarks[i])
        .filter((p) => p && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1 && (p.visibility ?? 1) >= 0.7),
    );
  const feet = selected.contours.footPins ?? [];
  return {
    neighborCount: neighbors.length,
    maxNeighborPx: Math.max(0, ...neighbors.map(move)),
    maxFootPx: Math.max(0, ...feet.map(move)),
    footCount: feet.length,
  };
}

function writePng(directory, name, image) {
  return sharp(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength), {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toFile(join(directory, `${name}.png`));
}

async function inventoryOnImage(input, image, analysis) {
  const { data, info } = await sharp(Buffer.from(image.data), {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
  })
    .resize(440, 440, { fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raster = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
  for (const target of analysis.targets) {
    const availability = new Set(
      portraitToolAvailability(analysis, target.id)
        .filter((tool) => tool.available)
        .map((tool) => tool.id),
    );
    for (const tool of PORTRAIT_TOOLS.filter(
      (tool) => tool.target === target.kind && availability.has(tool.id),
    )) {
      if (inventory[tool.id].examples.length >= 2) continue;
      const base = createRecipeV4();
      try {
        const zero = applyPortraitValues(base, analysis, target.id, { [tool.id]: 0 });
        assert.deepEqual(renderEditorRecipe(raster, zero).data, raster.data, tool.id + ' at zero');
        const directions = [];
        for (const value of tool.min < 0 ? [-38, 38] : [38]) {
          const recipe = applyPortraitValues(base, analysis, target.id, { [tool.id]: value });
          directions.push({ value, ...metrics(raster, renderEditorRecipe(raster, recipe)) });
        }
        inventory[tool.id].examples.push({ photo: input.name, target: target.id, directions });
      } catch (error) {
        inventory[tool.id].examples.push({
          photo: input.name,
          target: target.id,
          error: String(error.message),
        });
      }
    }
  }
}

const vite = await createServer({
  configFile: resolve('apps/web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 4195, strictPort: true },
});
const origin = 'http://127.0.0.1:4195';
let browser;
try {
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    const url = route.request().url();
    return url.startsWith(origin + '/') && !url.startsWith(origin + '/v1/')
      ? route.continue()
      : route.abort();
  });
  await page.goto(origin + '/vision/manifest.json');
  await mkdir(output, { recursive: true });
  for (const input of inputs.filter(({ name }) => !filter || filter.includes(name))) {
    const directory = join(output, input.name);
    await mkdir(directory, { recursive: true });
    console.log('START ' + input.name);
    try {
      const { image, frame } = await imageInput(input);
      const pixels = Buffer.from(image.data.buffer).toString('base64');
      const found = await page.evaluate(
        async ({ image: { width, height }, pixels, frame }) => {
          const { default: PortraitWorker } = await import('/src/editor/portrait.worker.ts?worker');
          const worker = new PortraitWorker();
          const start = performance.now();
          const time = [];
          try {
            return await new Promise((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error('Portrait worker timed out')),
                60_000,
              );
              worker.onmessage = ({ data }) => {
                if (data.progress) {
                  time.push([data.progress, Math.round(performance.now() - start)]);
                  return;
                }
                clearTimeout(timer);
                if (data.error) reject(new Error(data.error + '\n' + (data.diagnostic ?? '')));
                else
                  resolve({
                    analysis: data.result,
                    time,
                    totalMs: Math.round(performance.now() - start),
                  });
              };
              worker.onerror = (error) => {
                clearTimeout(timer);
                reject(new Error(error.message));
              };
              const data = new Uint8ClampedArray(Uint8Array.fromBase64(pixels).buffer);
              worker.postMessage(
                {
                  id: 1,
                  image: { width, height, data },
                  width: frame.width,
                  height: frame.height,
                  contentHash: frame.contentHash,
                  body: true,
                  segmentation: true,
                },
                [data.buffer],
              );
            });
          } finally {
            worker.terminate();
          }
        },
        { image: { width: image.width, height: image.height }, pixels, frame },
      );
      const analysis = validatePortraitAnalysis(found.analysis, frame);
      let auditLineup;
      if (analysis.algorithmVersion === 'mediapipe-v4-visible-regions') {
        if (input.name === 'smile-headshot') {
          assert.ok(
            analysis.targets.some((t) => t.featureMasks?.teeth),
            'The smile has visible enamel',
          );
        }
        if (input.name === 'half-mask') {
          for (const face of analysis.targets.filter((t) => t.kind === 'face')) {
            assert.ok(
              !face.featureMasks?.teeth && !face.contours.hairline,
              'The half-mask must not be mistaken for visible enamel or a hairline',
            );
          }
        }
        for (const target of analysis.targets) {
          if ((target.visibleParts?.pixels ?? Infinity) >= 34) continue;
          assert.ok(
            portraitToolAvailability(analysis, target.id).every((tool) => !tool.available),
            input.name + ' must not expose edits for a tiny face',
          );
        }
        if (input.name === 'group-distance') {
          const noses = analysis.targets
            .filter((t) => t.kind === 'face')
            .map((t) => t.landmarks[1]);
          const marked = [0.111, 0.204, 0.276, 0.361, 0.475, 0.579, 0.663, 0.751, 0.855];
          const matched = marked.filter((x) =>
            noses.some((p) => Math.abs(x - p.x) < 0.022 && p.y > 0.34 && p.y < 0.44),
          );
          auditLineup = { annotated: marked.length, matched: matched.length };
          assert.ok(
            matched.length >= 7,
            'Recover the distant lineup without counting duplicate faces',
          );
        }
      }
      if (meterOnly) {
        cases.push({
          name: input.name,
          algorithm: analysis.algorithmVersion,
          targets: analysis.targets.length,
          lineup: auditLineup,
          time: found.time,
          totalMs: found.totalMs,
        });
        await writeReport();
        console.log('PASS ' + input.name + ' ' + found.totalMs + 'ms');
        continue;
      }
      await writeFile(join(directory, 'analysis.json'), JSON.stringify(analysis));
      await writePng(directory, 'original', image);
      const audit = {
        name: input.name,
        time: found.time,
        totalMs: found.totalMs,
        photoSha256: input.sha256,
        algorithm: analysis.algorithmVersion,
        warnings: analysis.warnings,
        size: [image.width, image.height],
        ...(auditLineup ? { lineup: auditLineup } : {}),
        targets: [],
        comparisons: [],
      };
      const availability = new Map();
      for (const target of analysis.targets) {
        const available = portraitToolAvailability(analysis, target.id)
          .filter((tool) => tool.available)
          .map((tool) => tool.id);
        audit.targets.push({
          id: target.id,
          kind: target.kind,
          bounds: target.bounds,
          controls: available,
          masks: Object.keys(target.featureMasks ?? {}),
          evidence: Object.keys(target.contours),
        });
        availability.set(target.id, new Set(available));
      }
      for (const kind of ['face', 'body']) {
        const target = selectSubject(analysis, input.name, kind);
        const enabled = availability.get(target?.id) ?? new Set();
        const stress = Object.fromEntries(
          Object.entries(stacks[kind]).map(([id, value]) => [id, Math.sign(value) * 80]),
        );
        for (const [mode, controls] of [
          ['stack', stacks[kind]],
          ['strong', stress],
          ['single', { [singles[input.name]]: parts[kind][singles[input.name]] }],
        ]) {
          const values = Object.fromEntries(
            Object.entries(controls).filter(
              ([id, value]) => value !== undefined && enabled.has(id),
            ),
          );
          const recipe = Object.keys(values).length
            ? applyPortraitValues(createRecipeV4(), analysis, target.id, values)
            : createRecipeV4();
          const edited = renderEditorRecipe(image, recipe);
          if (
            mode === 'stack' &&
            kind === 'face' &&
            ['half-mask', 'group-distance', 'smile-headshot'].includes(input.name)
          ) {
            const tiled = renderEditorRecipeTiled(image, recipe, { tileSize: 173 });
            assert.deepEqual(
              tiled.data,
              edited.data,
              'Reference and tiled renders match at equal size',
            );
          }
          if (mode === 'single' && 'teethTone' in values) {
            const mask = compileSelectionMaskV3(recipe.regionEdits[0].mask, image);
            for (let y = 0; y < image.height; y++)
              for (let x = 0; x < image.width; x++) {
                if (mask((x + 0.5) / image.width, (y + 0.5) / image.height) > 0) continue;
                const offset = (y * image.width + x) * 4;
                assert.equal(
                  edited.data[offset],
                  image.data[offset],
                  'Teeth tone outside its mask',
                );
                assert.equal(
                  edited.data[offset + 1],
                  image.data[offset + 1],
                  'Teeth tone outside its mask',
                );
                assert.equal(
                  edited.data[offset + 2],
                  image.data[offset + 2],
                  'Teeth tone outside its mask',
                );
              }
          }
          const name = `${kind}-${mode}`;
          await writePng(directory, name, edited);
          audit.comparisons.push({
            name,
            target: target?.id,
            bounds: target?.bounds,
            values,
            ...metrics(image, edited),
            ...(target ? displacement(recipe, image, analysis, target) : {}),
          });
        }
      }
      await inventoryOnImage(input, image, analysis);
      cases.push(audit);
      console.log(
        'PASS ' +
          input.name +
          ' ' +
          found.totalMs +
          'ms ' +
          audit.targets.map((t) => t.kind + ':' + t.controls.length).join(' '),
      );
    } catch (error) {
      cases.push({ name: input.name, error: String(error.stack ?? error) });
      console.error('FAIL ' + input.name + ' ' + error.message);
      process.exitCode = 1;
    }
    await writeReport();
  }
} finally {
  await browser?.close();
  await vite.close();
}
