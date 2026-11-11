import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { createCutoutTrimap, renderCutout } from '@ai-xiutu/editor';

const output = resolve(process.env.MATTE_QA_DIR ?? 'artifacts/matte-reference');
const base = 'https://www.alphamatting.com/datasets/trainingdata';
const p3mDirectory = process.env.MATTE_QA_P3M_DIR;
const algorithms = ['guided-v4', 'guided-v5'];
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });

async function source(kind, name) {
  const path = join(output, name + '-' + kind + '.png');
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const response = await fetch(base + '/' + kind + '/' + name + '.png', {
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
  });
  assert.ok(response.ok, 'Source download failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length < 2_000_000, 'Source is larger than a benchmark thumbnail');
  await writeFile(path, bytes);
  return bytes;
}

function trimap(alpha, width, height, radius) {
  const prior = new Uint8Array(alpha.length);
  const foreground = new Uint16Array(width);
  const background = new Uint16Array(width);
  const addRow = (row, delta) => {
    if (row < 0 || row >= height) return;
    for (let x = 0; x < width; x++) {
      const value = alpha[row * width + x];
      if (value !== 255) foreground[x] += delta;
      if (value !== 0) background[x] += delta;
    }
  };
  for (let row = 0; row < radius; row++) addRow(row, 1);
  for (let y = 0; y < height; y++) {
    addRow(y + radius, 1);
    addRow(y - radius - 1, -1);
    let f = 0;
    let b = 0;
    for (let x = 0; x < Math.min(radius, width); x++) {
      f += foreground[x];
      b += background[x];
    }
    for (let x = 0; x < width; x++) {
      if (x + radius < width) {
        f += foreground[x + radius];
        b += background[x + radius];
      }
      if (x - radius - 1 >= 0) {
        f -= foreground[x - radius - 1];
        b -= background[x - radius - 1];
      }
      prior[y * width + x] = f === 0 ? 255 : b === 0 ? 0 : 128;
    }
  }
  return prior;
}

const samples = [];
const entries = p3mDirectory
  ? JSON.parse(await readFile(join(p3mDirectory, 'manifest.json'), 'utf8'))
  : Array.from({ length: 27 }, (_, i) => ({ id: 'GT' + String(i + 1).padStart(2, '0') }));
if (p3mDirectory) assert.equal(entries.length, 30);
for (const entry of entries) {
  const name = entry.id;
  if (p3mDirectory) assert.match(name, /^P3M-\d{3}$/);
  const [photo, reference] = await Promise.all(
    ['input', 'alpha'].map((kind) =>
      p3mDirectory ? readFile(join(p3mDirectory, name + '-' + kind + '.bin')) : source(kind, name),
    ),
  );
  if (p3mDirectory) {
    assert.equal(digest(photo), entry.inputSha256);
    assert.equal(digest(reference), entry.alphaSha256);
  }
  const raster = await sharp(photo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const truth = await sharp(reference)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = raster.info;
  assert.deepEqual([width, height, 1], [truth.info.width, truth.info.height, truth.info.channels]);
  const image = { width, height, data: new Uint8ClampedArray(raster.data) };
  const sample = {
    name,
    width,
    height,
    inputSha256: digest(photo),
    alphaSha256: digest(reference),
    bands: [],
  };
  for (const radius of [2, 5]) {
    const prior = trimap(truth.data, width, height, radius);
    const selection = createCutoutTrimap(width, height, prior);
    const band = { radius, runs: selection.runs.length, algorithms: {} };
    const tileRow = [
      { input: photo, left: 0, top: 0 },
      { input: reference, left: width, top: 0 },
    ];
    for (const [order, algorithm] of algorithms.entries()) {
      const started = performance.now();
      const result = renderCutout(image, { selection, algorithm, radius: 0.05, decontaminate: 0 });
      const ms = performance.now() - started;
      let count = 0,
        sum = 0,
        gradient = 0,
        edges = 0,
        fractionalCount = 0,
        fractionalSum = 0;
      const mask = Buffer.alloc(width * height);
      for (let p = 0; p < prior.length; p++) {
        const alpha = result.data[p * 4 + 3];
        mask[p] = alpha;
        if (prior[p] !== 128) {
          assert.equal(alpha, prior[p], 'Hard labels changed');
          continue;
        }
        count++;
        const error = Math.abs(alpha - truth.data[p]) / 255;
        sum += error;
        for (const next of [(p % width) + 1 < width ? p + 1 : -1, p + width]) {
          if (next < 0 || next >= prior.length) continue;
          gradient +=
            Math.abs(alpha - result.data[next * 4 + 3] - (truth.data[p] - truth.data[next])) / 255;
          edges++;
        }
        if (truth.data[p] > 0 && truth.data[p] < 255) {
          fractionalCount++;
          fractionalSum += error;
        }
      }
      band.algorithms[algorithm] = {
        count,
        sum,
        gradient,
        edges,
        fractionalCount,
        fractionalSum,
        ms,
      };
      if (radius === 5)
        tileRow.push({
          input: await sharp(mask, { raw: { width, height, channels: 1 } })
            .png()
            .toBuffer(),
          left: (order + 2) * width,
          top: 0,
        });
    }
    if (radius === 5)
      await sharp({ create: { width: width * 4, height, channels: 3, background: 'white' } })
        .composite(tileRow)
        .png()
        .toFile(join(output, name + '-compare.png'));
    sample.bands.push(band);
  }
  samples.push(sample);
}
const summary = [2, 5].map((radius) => {
  const bands = samples.map((sample) => sample.bands.find((band) => band.radius === radius));
  return {
    radius,
    versions: Object.fromEntries(
      algorithms.map((algorithm) => {
        const rows = bands.map((band) => band.algorithms[algorithm]);
        const total = (field) => rows.reduce((sum, row) => sum + row[field], 0);
        return [
          algorithm,
          {
            compared: total('count'),
            sad: total('sum'),
            mae: total('sum') / total('count'),
            gradientMae: total('gradient') / total('edges'),
            fractionalMae: total('fractionalSum') / total('fractionalCount'),
            ms: total('ms'),
          },
        ];
      }),
    ),
    improved: bands.filter(
      (band) => band.algorithms['guided-v5'].sum < band.algorithms['guided-v4'].sum,
    ).length,
    legacyRunBudgetRejected: bands.filter((band) => band.runs > 4096).length,
    maxRuns: Math.max(...bands.map((band) => band.runs)),
  };
});
await writeFile(
  join(output, 'report.json'),
  JSON.stringify(
    {
      source: p3mDirectory
        ? 'https://github.com/JizhiziLi/P3M'
        : 'https://www.alphamatting.com/datasets.php',
      scope: p3mDirectory
        ? '30 P3M-500-P face-blurred photos at dataset resolution; reference-derived trimaps'
        : '27 public training thumbnails; exact reference alpha; reference-derived trimaps',
      contactSheetColumns: ['source', 'reference alpha', ...algorithms],
      summary,
      samples,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(summary));
