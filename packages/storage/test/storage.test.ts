import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
  LocalPrivateStorage,
  serverImportFormats,
  MAX_CANONICAL_BYTES,
  StorageError,
} from '../src/index.js';

const fixture = () =>
  sharp({ create: { width: 64, height: 80, channels: 3, background: '#123456' } });
async function withStorage(
  work: (storage: LocalPrivateStorage, directory: string) => Promise<void>,
  maxPixels = 40_000_000,
) {
  const directory = await mkdtemp(join(tmpdir(), 'xiutu-storage-'));
  const storage = new LocalPrivateStorage({
    storageDir: directory,
    maxPixels,
    maxUploadBytes: 20 * 1024 * 1024,
  });
  await storage.initialize();
  try {
    await work(storage, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const ingest = (storage: LocalPrivateStorage, bytes: Buffer) =>
  storage.ingest({ file: Readable.from([bytes]) });

test('real JPEG/PNG/WebP/AVIF/static GIF/single-page TIFF codecs normalize to private PNG', async () => {
  assert.deepEqual(serverImportFormats(), ['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff']);
  await withStorage(async (storage, directory) => {
    for (const format of ['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'] as const) {
      const source = await fixture().toFormat(format).toBuffer();
      const stored = await ingest(storage, source);
      const bytes = await storage.readBytes(stored.key, MAX_CANONICAL_BYTES);
      const metadata = await sharp(bytes).metadata();
      assert.equal(metadata.format, 'png', format);
      assert.equal(stored.width, 64);
      assert.equal(stored.height, 80);
      assert.equal(metadata.exif, undefined);
      assert.equal(metadata.pages, undefined);
      assert.equal(stored.hash, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(stored.bytes, bytes.length);
      // Windows uses inherited ACLs; POSIX mode bits do not describe its access.
      if (process.platform !== 'win32')
        assert.equal((await stat(storage.path(stored.key))).mode & 0o777, 0o600);
      await storage.discard(stored.key);
      assert.deepEqual(await readdir(directory), []);
    }
  });
});

test('real animated GIF/WebP and multipage TIFF are rejected without first-frame flattening', async () => {
  const raw = Buffer.alloc(64 * 160 * 3);
  raw.fill(30, 0, 64 * 80 * 3);
  raw.fill(240, 64 * 80 * 3);
  await withStorage(async (storage, directory) => {
    for (const format of ['gif', 'webp', 'tiff'] as const) {
      const source = await sharp(raw, {
        raw: { width: 64, height: 160, channels: 3, pageHeight: 80 },
      })
        .toFormat(format)
        .toBuffer();
      assert.equal((await sharp(source, { animated: true }).metadata()).pages, 2);
      await assert.rejects(ingest(storage, source), { code: 'MULTIPAGE_IMAGE_UNSUPPORTED' });
      assert.deepEqual(await readdir(directory), []);
    }
  });
});

test('APNG/AVIF sequence declarations and unsupported containers are refused before decoding', async () => {
  await withStorage(async (storage, directory) => {
    const png = await fixture().png().toBuffer();
    const control = Buffer.alloc(20);
    control.writeUInt32BE(8);
    control.write('acTL', 4);
    control.writeUInt32BE(2, 8);
    const apng = Buffer.concat([png.subarray(0, 33), control, png.subarray(33)]);
    await assert.rejects(ingest(storage, apng), { code: 'ANIMATED_IMAGE_UNSUPPORTED' });
    const avif = await fixture().avif().toBuffer();
    const sequence = Buffer.from(avif);
    sequence.write('avis', 8);
    await assert.rejects(ingest(storage, sequence), { code: 'ANIMATED_IMAGE_UNSUPPORTED' });
    const heic = Buffer.alloc(24);
    heic.writeUInt32BE(24);
    heic.write('ftypheic', 4);
    heic.write('mif1heic', 16);
    for (const bytes of [
      heic,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      Buffer.from('8BPS unsupported layered photoshop'),
      Buffer.from('BM unsupported bitmap fixture'),
    ])
      await assert.rejects(ingest(storage, bytes), { code: 'UNSUPPORTED_IMAGE' });
    assert.deepEqual(await readdir(directory), []);
  });
});

test('high-resolution normalization processes a real 20MP source and enforces independent server bounds', async () => {
  await withStorage(async (storage) => {
    const source = await sharp({
      create: { width: 5000, height: 4000, channels: 3, background: '#345678' },
    })
      .png()
      .toBuffer();
    const stored = await ingest(storage, source);
    assert.equal(stored.width, 5000);
    assert.equal(stored.height, 4000);
    assert.equal(storage.capabilities().maxPixels, 40_000_000);
    assert.ok(stored.bytes < MAX_CANONICAL_BYTES);
  });
  await withStorage(async (storage, directory) => {
    await assert.rejects(
      ingest(storage, await fixture().png().toBuffer()),
      (error) => error instanceof StorageError && [400, 413].includes(error.statusCode),
    );
    assert.deepEqual(await readdir(directory), []);
  }, 5000);
  assert.throws(
    () =>
      new LocalPrivateStorage({
        storageDir: '/unused',
        maxPixels: 64_000_001,
        maxUploadBytes: 1024,
      }),
    { code: 'INVALID_STORAGE_CONFIG' },
  );
  const large = new LocalPrivateStorage({
    storageDir: '/unused',
    maxPixels: 64_000_000,
    maxUploadBytes: 1024,
  });
  assert.equal(large.capabilities().maxPixels, 64_000_000);
  assert.equal(large.capabilities().maxDimension, 16384);
});

test('streaming byte cap and process-wide decoder admission apply across storage instances', async () => {
  await withStorage(async (storage, directory) => {
    const source = await fixture().png().toBuffer();
    const slow = new Readable({ read() {} });
    const running = storage.ingest({ file: slow });
    const other = new LocalPrivateStorage({
      storageDir: directory,
      maxPixels: 40_000_000,
      maxUploadBytes: 1024,
    });
    await assert.rejects(other.storeGenerated(source), { code: 'MEDIA_BUSY' });
    slow.push(source);
    slow.push(null);
    const result = await running;
    await storage.discard(result.key);
    await assert.rejects(ingest(other, randomBytes(1025)), { code: 'UPLOAD_TOO_LARGE' });
    assert.deepEqual(await readdir(directory), []);
    await assert.rejects(other.readBytes('not-a-storage-key', 1024), { code: 'ASSET_NOT_FOUND' });
  });
});

test('private thumbnails preserve aspect and alpha, do not enlarge, and reuse immutable cached files', async () => {
  await withStorage(async (storage, directory) => {
    const wide = await ingest(
      storage,
      await sharp({
        create: {
          width: 1600,
          height: 800,
          channels: 4,
          background: { r: 20, g: 80, b: 160, alpha: 0.5 },
        },
      })
        .png()
        .toBuffer(),
    );
    const small = await ingest(storage, await fixture().png().toBuffer());
    const [a, duplicate, b] = await Promise.all([
      storage.thumbnail(wide.key),
      storage.thumbnail(wide.key),
      storage.thumbnail(small.key),
    ]);
    assert.deepEqual(a, duplicate);
    assert.equal(a.width, 512);
    assert.equal(a.height, 256);
    assert.equal(b.width, 64);
    assert.equal(b.height, 80);
    assert.equal(a.mime, 'image/webp');
    const derivatives = (await readdir(directory)).filter((name) => name.endsWith('.thumb.webp'));
    assert.equal(derivatives.length, 2);
    const filename = join(directory, wide.key.replace(/\.png$/, '.thumb.webp'));
    const before = await stat(filename);
    const metadata = await sharp(filename).metadata();
    assert.equal(metadata.hasAlpha, true);
    if (process.platform !== 'win32') assert.equal(before.mode & 0o777, 0o600);
    assert.deepEqual(await storage.thumbnail(wide.key), a);
    assert.equal((await stat(filename)).mtimeMs, before.mtimeMs);
    assert.throws(() => storage.path(wide.key.replace(/\.png$/, '.thumb.webp')), {
      code: 'ASSET_NOT_FOUND',
    });
    await storage.discard(wide.key);
    assert.equal(
      (await readdir(directory)).includes(wide.key.replace(/\.png$/, '.thumb.webp')),
      false,
    );
  });
});
