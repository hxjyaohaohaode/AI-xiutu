import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createServer } from 'vite';
import { renderCutout } from '@ai-xiutu/editor';
import { validatePortraitAnalysis } from '@ai-xiutu/portrait';

const inputDir = resolve(process.env.MATTE_QA_P3M_DIR ?? 'artifacts/matte-next/p3m-500-p');
const output = resolve(process.env.MATTE_QA_DIR ?? 'artifacts/matte-automatic');
const port = Number(process.env.MATTE_QA_PORT ?? 4196);
assert.ok(Number.isInteger(port) && port > 1024 && port <= 65535);
const origin = `http://127.0.0.1:${port}`;
const rasterUrl = origin + '/__matte_qa_raster';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cases = JSON.parse(await readFile(join(inputDir, 'manifest.json'), 'utf8'));
assert.equal(cases.length, 30);
assert.equal(new Set(cases.map((sample) => sample.id)).size, 30);
await mkdir(output, { recursive: true });

function edgeBand(alpha, width, height) {
  const band = new Uint8Array(width * height);
  // Five-pixel fixed reference band around intermediate alpha or a hard edge.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      const value = alpha[at];
      if (
        (value === 0 || value === 255) &&
        (x + 1 === width || alpha[at + 1] === value) &&
        (y + 1 === height || alpha[at + width] === value)
      )
        continue;
      for (let row = Math.max(0, y - 5); row <= Math.min(height - 1, y + 5); row++)
        band.fill(1, row * width + Math.max(0, x - 5), row * width + Math.min(width, x + 6));
    }
  }
  return band;
}

function measure(result, truth, edge) {
  const { width, height, data } = result;
  const alpha = Buffer.alloc(width * height);
  let sad = 0,
    edgeSad = 0,
    edgeCount = 0,
    gradient = 0,
    gradients = 0;
  let fractional = 0,
    fractionalSad = 0,
    opaqueLost = 0,
    clearKept = 0;
  for (let p = 0; p < truth.length; p++) {
    const a = data[p * 4 + 3];
    alpha[p] = a;
    const error = Math.abs(a - truth[p]) / 255;
    sad += error;
    if (truth[p] === 255) opaqueLost += error;
    else if (truth[p] === 0) clearKept += error;
    else {
      fractional++;
      fractionalSad += error;
    }
    if (!edge[p]) continue;
    edgeCount++;
    edgeSad += error;
    if ((p + 1) % width !== 0) {
      gradient += Math.abs(a - data[(p + 1) * 4 + 3] - truth[p] + truth[p + 1]) / 255;
      gradients++;
    }
    if (p + width < truth.length) {
      gradient += Math.abs(a - data[(p + width) * 4 + 3] - truth[p] + truth[p + width]) / 255;
      gradients++;
    }
  }
  return {
    alpha,
    sad,
    edgeSad,
    edgeCount,
    gradient,
    gradients,
    fractional,
    fractionalSad,
    opaqueLost,
    clearKept,
  };
}

function summarize(rows, key) {
  const values = rows.flatMap((row) => (row[key] ? [row[key]] : []));
  const total = (field) => values.reduce((sum, row) => sum + row[field], 0);
  return {
    samples: values.length,
    sad: total('sad'),
    mae: total('sad') / total('pixels'),
    edgeMae: total('edgeSad') / total('edgeCount'),
    gradientMae: total('gradient') / total('gradients'),
    fractionalMae: total('fractionalSad') / total('fractional'),
    opaqueLost: total('opaqueLost'),
    clearKept: total('clearKept'),
  };
}

let browser;
const vite = await createServer({
  configFile: resolve('apps/web/vite.config.ts'),
  server: { host: '127.0.0.1', port, strictPort: true },
});
const samples = [];
try {
  await vite.listen();
  browser = await chromium.launch({
    headless: true,
    channel: process.env.BROWSER_CHANNEL || undefined,
  });
  const page = await browser.newPage();
  let raster;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.href === rasterUrl && raster) {
      await route.fulfill({ body: raster, contentType: 'application/octet-stream' });
    } else if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) {
      await route.continue();
    } else await route.abort();
  });
  await page.goto(origin + '/#/studio');
  for (const entry of cases) {
    assert.match(entry.id, /^P3M-\d{3}$/);
    const [photo, reference] = await Promise.all(
      ['input', 'alpha'].map((kind) => readFile(join(inputDir, `${entry.id}-${kind}.bin`))),
    );
    assert.equal(digest(photo), entry.inputSha256);
    assert.equal(digest(reference), entry.alphaSha256);
    const decoded = await sharp(photo)
      .autoOrient()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const truth = await sharp(reference)
      .removeAlpha()
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = decoded.info;
    assert.deepEqual(
      [width, height, 1],
      [truth.info.width, truth.info.height, truth.info.channels],
    );
    const contentHash = createHash('sha256')
      .update(`${width}x${height}:srgb-rgba8:`)
      .update(decoded.data)
      .digest('hex');
    const frame = {
      width,
      height,
      contentHash,
      coordinates: 'source-normalized',
      orientation: 'normalized',
    };
    raster = decoded.data;
    const model = await page.evaluate(async ({ width, height, contentHash }) => {
      const { default: PortraitWorker } = await import('/src/editor/portrait.worker.ts?worker');
      const pixels = new Uint8ClampedArray(await (await fetch('/__matte_qa_raster')).arrayBuffer());
      const image = { width, height, data: pixels };
      async function infer(worker, input) {
        try {
          return await new Promise((done, reject) => {
            const timer = setTimeout(() => reject(new Error('Portrait worker timed out')), 60_000);
            worker.onerror = (event) => {
              clearTimeout(timer);
              reject(new Error(event.message));
            };
            worker.onmessage = ({ data }) => {
              if (data.progress) return;
              clearTimeout(timer);
              if (data.error) reject(new Error(data.error));
              else done(data);
            };
            worker.postMessage(input);
          });
        } finally {
          worker.terminate();
        }
      }
      const start = performance.now();
      const { result: analysis } = await infer(new PortraitWorker(), {
        id: 1,
        width,
        height,
        contentHash,
        body: false,
        segmentation: true,
        image,
      });
      const inferenceMs = performance.now() - start;
      const subject = analysis.segmentation?.subject;
      if (!subject) return { analysis, inferenceMs };
      const { default: MatteWorker } = await import('/src/editor/portrait-matte.worker.ts?worker');
      const matteStart = performance.now();
      const matte = await infer(new MatteWorker(), { image, source: { width, height }, subject });
      return { analysis, inferenceMs, matteMs: performance.now() - matteStart, ...matte };
    }, frame);
    raster = undefined;
    const analysis = validatePortraitAnalysis(model.analysis, frame);
    assert.equal(model.diagnostic, undefined, `${entry.id}: ${model.diagnostic}`);
    const record = {
      id: entry.id,
      row: entry.row,
      split: entry.split ?? 'P3M_500_P',
      inputSha256: entry.inputSha256,
      alphaSha256: entry.alphaSha256,
      width,
      height,
      faces: analysis.targets.length,
      inferenceMs: model.inferenceMs,
      matteMs: model.matteMs,
      fallback: !!analysis.segmentation?.subject && !model.prior,
    };
    const selection = analysis.segmentation?.subject;
    if (selection) {
      const image = { width, height, data: new Uint8ClampedArray(decoded.data) };
      const edge = edgeBand(truth.data, width, height);
      const settings = { selection, algorithm: 'guided-v5', radius: 0.015, decontaminate: 0.8 };
      const variants = [
        ['prior', { ...settings, radius: 0 }],
        ['result', settings],
      ];
      if (model.prior)
        variants.push([
          'candidate',
          { ...settings, selection: model.prior, algorithm: 'continuous-alpha-v1' },
        ]);
      for (const [key, edit] of variants) {
        const begin = performance.now();
        const rendered = renderCutout(image, edit);
        const renderMs = performance.now() - begin;
        const { alpha, ...stats } = measure(rendered, truth.data, edge);
        record[key] = { ...stats, pixels: width * height, renderMs };
        if (key !== 'prior') {
          const name = key === 'candidate' ? `${entry.id}-candidate` : entry.id;
          await writeFile(join(output, `${name}-settings.json`), JSON.stringify(edit));
          await sharp(alpha, { raw: { width, height, channels: 1 } })
            .png()
            .toFile(join(output, `${name}-alpha.png`));
          await sharp(Buffer.from(rendered.data), { raw: { width, height, channels: 4 } })
            .png()
            .toFile(join(output, `${name}-rgba.png`));
        }
      }
      if (record.fallback) record.candidate = record.result;
    }
    samples.push(record);
    console.log(
      JSON.stringify({
        id: entry.id,
        faces: record.faces,
        ms: Math.round(record.inferenceMs),
        priorSad: record.prior?.sad,
        resultSad: record.result?.sad,
        candidateSad: record.candidate?.sad,
      }),
    );
  }
  const summary = {
    prior: summarize(samples, 'prior'),
    result: summarize(samples, 'result'),
    candidate: summarize(samples, 'candidate'),
    fallbacks: samples.filter((row) => row.fallback).length,
    improved: samples.filter((row) => row.candidate?.sad < row.result?.sad).length,
  };
  await writeFile(
    join(output, 'report.json'),
    JSON.stringify({ source: 'https://github.com/JizhiziLi/P3M', summary, samples }, null, 2),
  );
  console.log(JSON.stringify(summary));
} finally {
  await browser?.close();
  await vite.close();
}
