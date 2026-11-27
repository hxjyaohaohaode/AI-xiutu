/** Pass the 8000×6000 EXIF-6 JPEG from large-photo-fixtures.mjs. Tests the production-bundled Worker. */
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { build, preview } from 'vite';

sharp.cache(false);
sharp.concurrency(1);
const source = resolve(process.argv[2] || 'camera.jpg');
const metadata = await sharp(source).metadata();
assert.deepEqual(
  [metadata.format, metadata.width, metadata.height, metadata.orientation],
  ['jpeg', 8000, 6000, 6],
);
assert.ok((await stat(source)).size >= 20 * 1024 ** 2);
const fixture = await mkdtemp(join(tmpdir(), 'original-photo-worker-'));
const site = join(fixture, 'site');
let browser, server;
try {
  const entry = 'virtual:original-photo-qa';
  await build({
    root: process.cwd(),
    configFile: false,
    logLevel: 'warn',
    publicDir: false,
    plugins: [
      {
        name: 'original-photo-qa-entry',
        resolveId(id) {
          if (id === entry) return '\0' + id;
        },
        load(id) {
          if (id !== '\0' + entry) return;
          return `import { exportOriginalPhoto, originalPhotoExportAvailable } from "/apps/web/src/editor/original-photo-export.ts";
import { renderEditorRecipe, createRecipeV4 } from "/packages/editor/src/index.ts";
window.photoQa = { exportOriginalPhoto, originalPhotoExportAvailable, renderEditorRecipe, createRecipeV4 };`;
        },
      },
    ],
    build: {
      outDir: site,
      emptyOutDir: false,
      rollupOptions: { input: entry, output: { entryFileNames: 'qa.js' } },
    },
  });
  await writeFile(
    join(site, 'index.html'),
    '<input type="file"><script type="module" src="/qa.js"></script>',
  );
  server = await preview({
    configFile: false,
    root: fixture,
    build: { outDir: site },
    preview: { host: '127.0.0.1', port: 0 },
  });
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || undefined });
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port);
  await page.waitForFunction(() => window.photoQa?.originalPhotoExportAvailable());
  await page.locator('input').setInputFiles(source);
  const checks = await page.evaluate(async () => {
    const { createRecipeV4, exportOriginalPhoto, renderEditorRecipe } = window.photoQa;
    const file = document.querySelector('input').files[0];
    const wrong = await exportOriginalPhoto(file, createRecipeV4(), {
      width: 8000,
      height: 6000,
    }).then(
      () => 'resolved',
      (e) => e.message,
    );
    const controller = new AbortController();
    const pending = exportOriginalPhoto(
      file,
      createRecipeV4(),
      { width: 6000, height: 8000 },
      controller.signal,
    );
    controller.abort();
    const aborted = await pending.then(
      () => 'resolved',
      (e) => e.name,
    );
    const probe = new OffscreenCanvas(1024, 1024);
    const probeCtx = probe.getContext('2d');
    probeCtx.fillStyle = '#4d8caa';
    probeCtx.fillRect(0, 0, probe.width, probe.height);
    const interrupted = new AbortController();
    const seen = [];
    const interruptedName = await exportOriginalPhoto(
      new File([await probe.convertToBlob()], 'cancel.png'),
      createRecipeV4({ adjustments: { exposure: 0.3 } }),
      { width: probe.width, height: probe.height },
      interrupted.signal,
      (fraction) => {
        seen.push(fraction);
        interrupted.abort();
      },
    ).then(
      () => 'resolved',
      (error) => error.name,
    );
    // Decode a transparent PNG the same way as regular import. Compare the encoder's
    // straight RGBA bytes outside the browser, without premultiplying the output.
    const canvas = new OffscreenCanvas(29, 19);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = ctx.createImageData(29, 19);
    for (let i = 0; i < 29 * 19; i++)
      pixels.data.set([(i * 61) & 255, (i * 79) & 255, (i * 37) & 255, (i * 19) & 255], i * 4);
    ctx.putImageData(pixels, 0, 0);
    const png = new File([await canvas.convertToBlob()], 'alpha.png');
    const image = await createImageBitmap(png, { imageOrientation: 'from-image' });
    ctx.clearRect(0, 0, 29, 19);
    ctx.drawImage(image, 0, 0);
    image.close();
    const recipe = createRecipeV4({
      geometry: {
        rotation: 270,
        flipX: true,
        crop: { x: 0.13, y: 0.17, width: 0.76, height: 0.79 },
      },
      adjustments: { vibrance: 27, contrast: -12 },
    });
    const expected = renderEditorRecipe(ctx.getImageData(0, 0, 29, 19), recipe);
    const output = await exportOriginalPhoto(png, recipe, { width: 29, height: 19 });
    return {
      aborted,
      interruptedName,
      seen,
      wrong,
      width: expected.width,
      height: expected.height,
      rgba: Array.from(expected.data),
      png: Array.from(new Uint8Array(await output.arrayBuffer())),
    };
  });
  assert.equal(checks.aborted, 'AbortError');
  assert.deepEqual(checks.seen, [0.25]);
  assert.equal(checks.interruptedName, 'AbortError');
  assert.match(checks.wrong, /尺寸/);
  const small = await sharp(Buffer.from(checks.png))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([small.info.width, small.info.height], [checks.width, checks.height]);
  assert.deepEqual(small.data, Buffer.from(checks.rgba));

  // sampleOutput is in the final 8000×6000 frame. A clockwise turn followed by
  // horizontal reflection transposes the already EXIF-upright source coordinates.
  const sampleOutput = [
    [0, 0],
    [7999, 0],
    [0, 5999],
    [7999, 5999],
    [199, 31],
    [200, 31],
    [201, 32],
    [6021, 63],
    [44, 64],
    [3451, 2910],
    [3452, 2910],
    [7777, 5421],
  ];
  const [download, measured] = await Promise.all([
    page.waitForEvent('download', { timeout: 300_000 }),
    page.evaluate(async (points) => {
      const { createRecipeV4, exportOriginalPhoto, renderEditorRecipe } = window.photoQa;
      const file = document.querySelector('input').files[0];
      const source = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (source.width !== 6000 || source.height !== 8000)
        throw Error('Incorrect EXIF orientation');
      const ctx = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
      const adjustments = { exposure: 0.45, temperature: -14 };
      const pointRecipe = createRecipeV4({ adjustments });
      const samples = points.map(([x, y]) => {
        ctx.drawImage(source, -y, -x); // independent of the worker's source-rectangle draw
        const input = ctx.getImageData(0, 0, 1, 1);
        return {
          x,
          y,
          input: Array.from(input.data),
          rgba: Array.from(renderEditorRecipe(input, pointRecipe).data),
        };
      });
      source.close();
      const recipe = createRecipeV4({ adjustments, geometry: { rotation: 90, flipX: true } });
      const progress = [];
      const blob = await exportOriginalPhoto(
        file,
        recipe,
        { width: 6000, height: 8000 },
        undefined,
        (fraction) => progress.push(fraction),
      );
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'edited-original.png';
      link.click();
      return { samples, progress };
    }, sampleOutput),
  ]);
  const { samples, progress } = measured;
  assert.deepEqual(
    progress,
    Array.from({ length: 20 }, (_, i) => (i + 1) / 20),
  );
  const png = join(fixture, 'edited-original.png');
  await download.saveAs(png);
  await browser.close();
  browser = undefined;
  const info = await sharp(png).metadata();
  assert.deepEqual([info.format, info.width, info.height], ['png', 8000, 6000]);
  // Stream the decoded result, retaining only four bytes per sample.
  const actual = samples.map(() => Buffer.alloc(4));
  let offset = 0;
  for await (const chunk of sharp(png).ensureAlpha().raw()) {
    samples.forEach(({ x, y }, i) => {
      const start = (y * info.width + x) * 4;
      const lo = Math.max(offset, start),
        hi = Math.min(offset + chunk.length, start + 4);
      if (lo < hi) chunk.copy(actual[i], lo - start, lo - offset, hi - offset);
    });
    offset += chunk.length;
  }
  assert.equal(offset, 48_000_000 * 4);
  samples.forEach((p, i) =>
    assert.deepEqual(actual[i], Buffer.from(p.rgba), 'Pixel at ' + p.x + ',' + p.y),
  );
  assert.ok(new Set(samples.map((p) => p.rgba.join())).size >= 10);
  assert.ok(samples.some((p) => p.input.join() !== p.rgba.join()));
  console.log(
    JSON.stringify({
      inputBytes: (await stat(source)).size,
      stored: [8000, 6000],
      exif: 6,
      upright: [6000, 8000],
      edited: [info.width, info.height],
      pngBytes: (await stat(png)).size,
      matched: samples.map((p) => [p.x, p.y, p.rgba]),
      transparentPng: 'all samples matched',
      cancellation: checks.aborted,
      cancellationAfterProgress: checks.seen[0],
      progressEvents: progress.length,
    }),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((done) => server.httpServer.close(done));
  await rm(fixture, { recursive: true, force: true });
}
