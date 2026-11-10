/** Optional expensive/native acceptance. No downloads and no execution during ordinary npm test.
 * node --import tsx scripts/qa/media-verify.ts [--large]
 * MEDIA_QA_PYTHON=/absolute/pinned/venv/bin/python MEDIA_QA_RAW=/path/sample.NEF
 */
import sharp from 'sharp';
import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import { execFile } from 'node:child_process';
import { watch, existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { processMedia, exportMedia, getMediaCapabilities } from '../../packages/media/src/index.js';
const exec = promisify(execFile),
  output = resolve('artifacts/media-v4');
await mkdir(output, { recursive: true });
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  capabilities: await getMediaCapabilities({ pythonExecutable: process.env.MEDIA_QA_PYTHON }),
  samples: [],
};
const results = report.samples as Record<string, unknown>[];
async function run(name: string, inputPath: string, maxPixels = 200_000_000) {
  const workDir = join(output, name);
  await rm(workDir, { recursive: true, force: true });
  const start = performance.now();
  try {
    const descriptor = await processMedia({
      inputPath,
      workDir,
      originalName: basename(inputPath),
      options: {
        maxPixels,
        maxProxyPixels: 1_048_576,
        generateTiles: true,
        timeoutMs: 600_000,
        pythonExecutable: process.env.MEDIA_QA_PYTHON,
      },
    });
    if (name === 'radiance') {
      assert.equal(descriptor.original.bitDepth, 8);
      assert.equal(descriptor.original.sampleEncoding, 'rgbe');
      assert.equal(descriptor.original.decodedBitDepth, 32);
    }
    if (name === 'camera-raw') {
      assert.equal(descriptor.original.sampleEncoding, 'sensor-raw');
      assert.equal(descriptor.original.decodedBitDepth, 16);
      assert.ok(descriptor.original.bitDepth > 0 && descriptor.original.bitDepth <= 16);
    }
    const exportPath = join(output, `${name}-export.png`);
    await rm(exportPath, { force: true });
    const exported =
      name === '200mp'
        ? null
        : await exportMedia({ workDir, outputPath: exportPath, format: 'png16' });
    const sample = {
      name,
      success: true,
      elapsedMs: Math.round(performance.now() - start),
      descriptor,
      exported,
    };
    if (name === 'exr-alpha') {
      const raw = await sharp(join(workDir, descriptor.master.relativePath), { ignoreIcc: true })
        .toColourspace('rgb16')
        .raw({ depth: 'ushort' })
        .toBuffer();
      const expected = [65535, 42979, 22526, 32768];
      for (let c = 0; c < 4; c++)
        assert.ok(
          Math.abs(raw.readUInt16LE(c * 2) - expected[c]!) < 100,
          'HDR associated alpha must be unassociated before nonlinear tone mapping',
        );
    }
    results.push(sample);
    console.log(
      JSON.stringify({
        name,
        success: true,
        sourcePixels: descriptor.original.width * descriptor.original.height,
        elapsedMs: sample.elapsedMs,
        processor: descriptor.processor,
      }),
    );
  } catch (error) {
    results.push({
      name,
      success: false,
      elapsedMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(name, error);
  }
  await writeFile(join(output, 'evidence.json'), JSON.stringify(report, null, 2));
}
async function rejected(name: string, inputPath: string, code?: string, options = {}) {
  const workDir = join(output, name);
  await rm(workDir, { recursive: true, force: true });
  const start = performance.now();
  try {
    await processMedia({
      inputPath,
      workDir,
      options: { pythonExecutable: process.env.MEDIA_QA_PYTHON, ...options },
    });
    results.push({ name, success: false, error: 'invalid source unexpectedly accepted' });
  } catch (error) {
    const cleaned = await access(workDir).then(
      () => false,
      () => true,
    );
    results.push({
      name,
      success: cleaned && (code === undefined || (error as { code?: string }).code === code),
      expectedRejection: true,
      cleanupConfirmed: cleaned,
      elapsedMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
if (process.env.MEDIA_QA_PYTHON) {
  await exec(process.env.MEDIA_QA_PYTHON, [
    '-c',
    `import OpenImageIO as o,numpy as n,sys\nfrom pathlib import Path\np=Path(sys.argv[1])\na=n.zeros((96,128,3),dtype=n.float32)\na[:,:,0]=n.linspace(0,8,128);a[:,:,1]=n.linspace(0,3,96)[:,None];a[:,:,2]=0.08\nfor suffix in ['exr','hdr']:\n out=o.ImageOutput.create(str(p/('hdr-fixture.'+suffix)));s=o.ImageSpec(128,96,3,o.FLOAT);s.attribute('oiio:ColorSpace','Linear');out.open(str(p/('hdr-fixture.'+suffix)),s);assert out.write_image(a);out.close()\n`,
    output,
  ]);
  await run('exr', join(output, 'hdr-fixture.exr'));
  await run('radiance', join(output, 'hdr-fixture.hdr'));
  await exec(process.env.MEDIA_QA_PYTHON, [
    '-c',
    `import OpenImageIO as o,numpy as n,sys\nfrom pathlib import Path\np=Path(sys.argv[1])\na=n.tile(n.array([2.,.5,.125,.5],dtype=n.float32),(16,16,1))\ns=o.ImageSpec(16,16,4,o.FLOAT);s.attribute('oiio:ColorSpace','Linear');out=o.ImageOutput.create(str(p/'alpha-fixture.exr'));out.open(str(p/'alpha-fixture.exr'),s);assert out.write_image(a);out.close()\ns=o.ImageSpec(16,16,3,o.FLOAT);s.attribute('oiio:ColorSpace','ACEScg');out=o.ImageOutput.create(str(p/'aces-fixture.exr'));out.open(str(p/'aces-fixture.exr'),s);assert out.write_image(a[:,:,:3]);out.close()\n`,
    output,
  ]);
  await run('exr-alpha', join(output, 'alpha-fixture.exr'));
  await rejected('explicit-aces-rejected', join(output, 'aces-fixture.exr'));
}
if (process.env.MEDIA_QA_RAW) await run('camera-raw', resolve(process.env.MEDIA_QA_RAW));
if (process.argv.includes('--large')) {
  const path = join(output, 'source-200mp.tif'),
    width = 20000,
    height = 10000,
    line = Uint16Array.from(
      { length: width * 3 },
      (_, i) => ((i % 3) * 13001 + Math.floor(i / 3) * 3) % 65536,
    );
  await sharp(line, { raw: { width, height: 1, channels: 3 } })
    .resize(width, height, { fit: 'fill' })
    .toColourspace('rgb16')
    .tiff({
      compression: 'deflate',
      predictor: 'horizontal',
      tile: true,
      tileWidth: 256,
      tileHeight: 256,
    })
    .toFile(path);
  await run('200mp', path);
  // A genuine in-flight cancel: the source is already encoded, processing begins in its own child.
  const cancelled = join(output, 'cancelled-200mp');
  await rm(cancelled, { recursive: true, force: true });
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 1500);
  try {
    await processMedia({ inputPath: path, workDir: cancelled, signal: controller.signal });
    results.push({ name: 'cancel-200mp', success: false, error: 'unexpected completion' });
  } catch (error) {
    const cleaned = await access(cancelled).then(
      () => false,
      () => true,
    );
    results.push({
      name: 'cancel-200mp',
      success: cleaned && (error as { code?: string }).code === 'aborted',
      cleanupConfirmed: cleaned,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
  await rejected('timeout-200mp', path, 'timeout', { timeoutMs: 1000 });
  // Catch cancellation inside the streaming ICC insertion, not only during decode.
  const exportPath = join(output, 'cancelled-200mp-export.png'),
    exportController = new AbortController();
  for (const suffix of ['', '.partial', '.partial.icc'])
    await rm(`${exportPath}${suffix}`, { force: true });
  let reachedIcc = false;
  const watcher = watch(output, (_event, filename) => {
      if (
        filename?.toString() === `${basename(exportPath)}.partial.icc` &&
        existsSync(`${exportPath}.partial.icc`)
      ) {
        reachedIcc = true;
        exportController.abort();
      }
    }),
    exportTimer = setTimeout(() => exportController.abort(), 120_000);
  try {
    await exportMedia({
      workDir: join(output, '200mp'),
      outputPath: exportPath,
      format: 'png16',
      signal: exportController.signal,
      options: { timeoutMs: 180_000 },
    });
    results.push({
      name: 'cancel-export-during-icc',
      success: false,
      reachedIcc,
      error: 'unexpected completion',
    });
  } catch (error) {
    const cleaned = ['', '.partial', '.partial.icc'].every(
      (suffix) => !existsSync(`${exportPath}${suffix}`),
    );
    results.push({
      name: 'cancel-export-during-icc',
      success: reachedIcc && cleaned && (error as { code?: string }).code === 'aborted',
      reachedIcc,
      cleanupConfirmed: cleaned,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    watcher.close();
    clearTimeout(exportTimer);
  }
}
report.completedAt = new Date().toISOString();
await writeFile(join(output, 'evidence.json'), JSON.stringify(report, null, 2));
const summary = await readFile(join(output, 'evidence.json'));
console.log(
  JSON.stringify({
    report: 'artifacts/media-v4/evidence.json',
    sha256: createHash('sha256').update(summary).digest('hex'),
    cases: results.length,
    passed: results.filter((r) => r.success === true).length,
  }),
);
if (results.some((r) => !r.success)) process.exitCode = 1;
