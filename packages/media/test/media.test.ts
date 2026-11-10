import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, lstat, readdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { writePsdBuffer } from 'ag-psd';
import {
  processMedia,
  exportMedia,
  getMediaCapabilities,
  MediaProcessingError,
} from '../src/index.js';
import { srgbProfile, attachPngIcc } from '../src/icc.js';

async function fixture(run: (path: string) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), 'xiutu-media-test-'));
  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
const raw16 = async (path: string) => {
  const b = await sharp(path, { ignoreIcc: true })
    .toColourspace('rgb16')
    .raw({ depth: 'ushort' })
    .toBuffer();
  return [...new Uint16Array(b.buffer, b.byteOffset, b.length / 2)];
};

test('real isolated ingestion keeps source bytes, uint16 adjacent values, ICC, bounded proxy and multi-level tiles', async () =>
  fixture(async (dir) => {
    const values = Uint16Array.from({ length: 96 * 64 * 3 }, (_, i) => 12000 + (i % 1000)),
      source = join(dir, 'source.png');
    await sharp(values, { raw: { width: 96, height: 64, channels: 3 } })
      .toColourspace('rgb16')
      .png()
      .toFile(source);
    await attachPngIcc(source, await srgbProfile());
    const bytes = await readFile(source),
      output = join(dir, 'media'),
      result = await processMedia({
        inputPath: source,
        workDir: output,
        originalName: 'precise.png',
        options: { maxProxyPixels: 2048, tileSize: 256 },
      });
    assert.deepEqual(await readFile(join(output, result.original.relativePath)), bytes);
    assert.equal(result.sourceSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(result.original.bitDepth, 16);
    assert.equal(result.master.bitDepth, 16);
    assert.equal(result.original.hasIcc, true);
    assert.deepEqual(await raw16(join(output, 'master.tif')), [...values]);
    assert.ok(result.proxy.width * result.proxy.height <= 2048);
    assert.equal(result.proxy.bitDepth, 8);
    assert.deepEqual(result.proxy.normalizedDimensions, { width: 96, height: 64 });
    assert.ok((await sharp(join(output, 'master.tif')).metadata()).icc);
    assert.ok((await readFile(join(output, 'tiles.dzi'), 'utf8')).includes('Width="96"'));
    assert.ok((await readdir(join(output, 'tiles_files'))).length > 1);
    assert.ok(result.tiles!.count > 1);
    const exported = join(dir, 'export.png'),
      exportResult = await exportMedia({ workDir: output, outputPath: exported, format: 'png16' });
    assert.equal(exportResult.includesEditorRecipe, false);
    assert.equal(exportResult.bitDepth, 16);
    assert.deepEqual(await raw16(exported), [...values]);
    for (const [format, suffix] of [
      ['tiff16', 'tif'],
      ['jpeg', 'jpg'],
      ['webp', 'webp'],
    ] as const) {
      const exportedPath = join(dir, `out.${suffix}`),
        r = await exportMedia({ workDir: output, outputPath: exportedPath, format });
      assert.equal(r.bitDepth, format === 'tiff16' ? 16 : 8);
      assert.ok(r.bytes > 0);
    }
  }));

test('embedded P3 and CMYK are genuinely converted, unprofiled CMYK is rejected instead of guessed', async () =>
  fixture(async (dir) => {
    const reference = await sharp({
      create: { width: 24, height: 16, channels: 3, background: '#ab1234' },
    })
      .png()
      .toBuffer();
    const p3 = join(dir, 'p3.png');
    await sharp(reference).withIccProfile('p3').png().toFile(p3);
    const r = await processMedia({
      inputPath: p3,
      workDir: join(dir, 'p3'),
      options: { generateTiles: false },
    });
    const pixel = await sharp(join(dir, 'p3', r.proxy.relativePath), { ignoreIcc: true })
      .raw()
      .toBuffer();
    for (const [i, expected] of [171, 18, 52].entries())
      assert.ok(Math.abs(pixel[i]! - expected) <= 2, `ICC channel ${i}: ${pixel[i]}`);
    const cmyk = join(dir, 'cmyk.jpg');
    await sharp(reference).withIccProfile('cmyk').jpeg({ quality: 100 }).toFile(cmyk);
    assert.equal((await sharp(cmyk).metadata()).space, 'cmyk');
    const cm = await processMedia({
      inputPath: cmyk,
      workDir: join(dir, 'cm'),
      options: { generateTiles: false },
    });
    assert.equal(cm.original.colorSpace, 'cmyk');
    assert.equal(cm.original.hasIcc, true);
    assert.equal(cm.master.colorSpace, 'sRGB');
    const normalized = await sharp(cmyk).toColourspace('srgb').raw().toBuffer(),
      actual = await sharp(join(dir, 'cm/proxy.png'), { ignoreIcc: true })
        .removeAlpha()
        .raw()
        .toBuffer();
    assert.ok(actual.every((v, i) => Math.abs(v - normalized[i]!) <= 2));
    const cmykTiff = join(dir, 'cmyk.tif');
    await sharp(reference).withIccProfile('cmyk').tiff({ compression: 'deflate' }).toFile(cmykTiff);
    const cmTiff = await processMedia({
      inputPath: cmykTiff,
      workDir: join(dir, 'cm-tiff'),
      options: { generateTiles: false },
    });
    assert.equal(cmTiff.original.colorSpace, 'cmyk');
    assert.equal(cmTiff.original.bitDepth, 8);
    assert.equal(cmTiff.original.hasIcc, true);
    const expectedTiff = await sharp(cmykTiff).toColourspace('srgb').raw().toBuffer(),
      actualTiff = await sharp(join(dir, 'cm-tiff/proxy.png'), { ignoreIcc: true })
        .removeAlpha()
        .raw()
        .toBuffer();
    assert.ok(actualTiff.every((v, i) => Math.abs(v - expectedTiff[i]!) <= 2));
    const untagged = join(dir, 'untagged.jpg');
    // Strip APP2 ICC chunks without changing compressed image data.
    const b = await readFile(cmyk),
      pieces = [b.subarray(0, 2)];
    let at = 2;
    while (at < b.length) {
      const marker = b[at + 1]!;
      if (marker === 0xda || marker === 0xd9) {
        pieces.push(b.subarray(at));
        break;
      }
      const length = b.readUInt16BE(at + 2) + 2;
      if (marker !== 0xe2) pieces.push(b.subarray(at, at + length));
      at += length;
    }
    await writeFile(untagged, Buffer.concat(pieces));
    await assert.rejects(
      () => processMedia({ inputPath: untagged, workDir: join(dir, 'no-profile') }),
      /ICC profile|CMYK/,
    );
  }));

test('PSD uses real RGB8/RGB16 stored composites and bounded metadata, without claiming layered round trip', async () =>
  fixture(async (dir) => {
    for (const bits of [8, 16]) {
      const values =
        bits === 8
          ? new Uint8ClampedArray([130, 80, 40, 255, 180, 90, 80, 255])
          : new Uint16Array([33001, 12003, 22001, 65535, 33002, 12004, 22002, 65535]);
      const psd = writePsdBuffer({
        width: 2,
        height: 1,
        bitsPerChannel: bits,
        imageData: { width: 2, height: 1, data: values },
        children: [
          { name: 'text metadata only', left: 0, top: 0, right: 2, bottom: 1, hidden: false },
        ],
      });
      const source = join(dir, `source${bits}.psd`),
        workDir = join(dir, `psd${bits}`);
      await writeFile(source, psd);
      const result = await processMedia({
        inputPath: source,
        workDir,
        originalName: 'source.psd',
        options: { generateTiles: false },
      });
      assert.equal(result.original.format, 'psd');
      assert.equal(result.original.bitDepth, bits);
      assert.equal(result.layers.length, 1);
      assert.ok(result.warnings.some((w) => w.includes('saved composite')));
      if (bits === 16) assert.deepEqual(await raw16(join(workDir, 'master.tif')), [...values]);
    }
  }));

test('orientation is normalized in the master while the original metadata and exact encoding remain retained', async () =>
  fixture(async (dir) => {
    const source = join(dir, 'oriented.jpg');
    await sharp({ create: { width: 40, height: 20, channels: 3, background: '#123456' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(source);
    const result = await processMedia({
      inputPath: source,
      workDir: join(dir, 'media'),
      options: { generateTiles: false },
    });
    assert.equal(result.original.metadataSummary.orientation, 6);
    assert.equal(result.original.metadataSummary.hasExif, true);
    assert.deepEqual([result.master.width, result.master.height], [20, 40]);
    assert.deepEqual(await readFile(source), await readFile(join(dir, 'media/original.bin')));
  }));

test('static WebP, AVIF and GIF are decoded from their real encodings, with alpha retained in proxy and master', async () =>
  fixture(async (dir) => {
    const width = 32,
      height = 24,
      rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        rgba.set([x * 7, y * 10, (x + y) * 4, x < 8 ? 0 : 255], at);
      }
    for (const format of ['webp', 'avif', 'gif'] as const) {
      const source = join(dir, `static.${format}`),
        pipeline = sharp(rgba, { raw: { width, height, channels: 4 } });
      if (format === 'webp') await pipeline.webp({ lossless: true }).toFile(source);
      else if (format === 'avif') await pipeline.avif({ quality: 90 }).toFile(source);
      else await pipeline.gif({ dither: 0 }).toFile(source);
      const result = await processMedia({
        inputPath: source,
        workDir: join(dir, format),
        originalName: `static.${format}`,
        options: { generateTiles: false },
      });
      const expected = await sharp(source, { ignoreIcc: true })
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer();
      const actual = await sharp(join(dir, format, 'proxy.png'), { ignoreIcc: true })
        .raw()
        .toBuffer();
      assert.equal(actual.length, expected.length);
      assert.deepEqual([result.master.width, result.master.height], [width, height]);
      assert.deepEqual(await readFile(source), await readFile(join(dir, format, 'original.bin')));
      for (let i = 0; i < expected.length; i++) {
        if (i % 4 === 3) assert.equal(actual[i], expected[i], `${format} alpha ${i}`);
        else if (expected[i - (i % 4) + 3] !== 0)
          assert.ok(
            Math.abs(actual[i]! - expected[i]!) <= 1,
            `${format} color ${i}: ${actual[i]} vs ${expected[i]}`,
          );
      }
    }
  }));

test('a changed retained master cannot be exported under the original provenance, and failed export releases only its output', async () =>
  fixture(async (dir) => {
    const source = join(dir, 'source.png'),
      workDir = join(dir, 'media'),
      outputPath = join(dir, 'should-not-exist.png');
    await sharp({ create: { width: 16, height: 12, channels: 3, background: '#804030' } })
      .png()
      .toFile(source);
    const descriptor = await processMedia({
      inputPath: source,
      workDir,
      options: { generateTiles: false },
    });
    // A TIFF decoder may accept trailing data; digest/size identity must reject even that valid-decode change.
    await appendFile(join(workDir, 'master.tif'), Buffer.from('changed after import'));
    await assert.rejects(() => exportMedia({ workDir, outputPath, format: 'png16' }), /integrity/);
    await assert.rejects(() => lstat(outputPath), /ENOENT/);
    assert.equal(
      JSON.parse(await readFile(join(workDir, 'descriptor.json'), 'utf8')).sourceSha256,
      descriptor.sourceSha256,
    );
    assert.deepEqual(await readFile(source), await readFile(join(workDir, 'original.bin')));
  }));

test('resource admission, cancellation, malformed files and duplicate output identities clean only owned work', async () =>
  fixture(async (dir) => {
    const source = join(dir, 'source.png');
    await sharp({ create: { width: 64, height: 64, channels: 3, background: '#808080' } })
      .png()
      .toFile(source);
    await assert.rejects(
      () =>
        processMedia({
          inputPath: source,
          workDir: join(dir, 'oversize'),
          options: { maxPixels: 100 },
        }),
      /pixel|dimension|limit/i,
    );
    await assert.rejects(
      () =>
        processMedia({
          inputPath: source,
          workDir: join(dir, 'bad-option'),
          options: { generateTiles: 'false' as unknown as boolean },
        }),
      /boolean/,
    );
    await assert.rejects(() => lstat(join(dir, 'oversize')), /ENOENT/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () =>
        processMedia({
          inputPath: source,
          workDir: join(dir, 'cancel'),
          signal: controller.signal,
        }),
      (error) => error instanceof MediaProcessingError && error.code === 'aborted',
    );
    await assert.rejects(() => lstat(join(dir, 'cancel')), /ENOENT/);
    const broken = join(dir, 'bad.png');
    await writeFile(broken, Buffer.from('not an image'));
    await assert.rejects(() => processMedia({ inputPath: broken, workDir: join(dir, 'broken') }));
    await assert.rejects(() => lstat(join(dir, 'broken')), /ENOENT/);
    const same = join(dir, 'same'),
      attempts = await Promise.allSettled([
        processMedia({ inputPath: source, workDir: same, options: { generateTiles: false } }),
        processMedia({ inputPath: source, workDir: same, options: { generateTiles: false } }),
      ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok((await lstat(join(same, 'descriptor.json'))).size > 0);
    const sentinel = join(dir, 'immutable.png');
    await writeFile(sentinel, 'do not replace');
    await assert.rejects(
      () => exportMedia({ workDir: same, outputPath: sentinel, format: 'png16' }),
      /exists/,
    );
    assert.equal(await readFile(sentinel, 'utf8'), 'do not replace');
    const guarded = join(dir, 'auxiliary.png');
    await writeFile(`${guarded}.partial.icc`, 'unrelated previous work');
    await assert.rejects(
      () => exportMedia({ workDir: same, outputPath: guarded, format: 'png16' }),
      /exists/,
    );
    assert.equal(await readFile(`${guarded}.partial.icc`, 'utf8'), 'unrelated previous work');
    await assert.rejects(() => lstat(guarded), /ENOENT/);
    const caps = await getMediaCapabilities();
    assert.equal(caps.maxPixels, 200_000_000);
    assert.equal(caps.nativeConfigured, false);
  }));
