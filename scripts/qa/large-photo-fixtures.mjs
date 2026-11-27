/** Deterministic camera JPEG and lossless PNG. Files are generated in a disposable directory. */
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const directory = process.argv[2];
assert.ok(directory, 'Pass an output directory.');
await mkdir(directory, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);
async function fixture(name, width, height, encode) {
  const noise = createCipheriv('aes-256-ctr', Buffer.alloc(32, 14), Buffer.alloc(16, 25));
  const raw = Buffer.allocUnsafe(width * height * 3), zeros = Buffer.alloc(1024 * 1024);
  for (let offset = 0; offset < raw.length; offset += zeros.length)
    noise.update(zeros.subarray(0, Math.min(zeros.length, raw.length - offset))).copy(raw, offset);
  const file = join(resolve(directory), name);
  const result = await encode(sharp(raw, { raw: { width, height, channels: 3 } })).toFile(file);
  assert.ok(result.size >= 20 * 1024 ** 2 && result.size <= 30 * 1024 ** 2, name + ' ' + result.size);
  console.log(name, width + 'x' + height, result.size);
}
await fixture('camera.jpg', 8000, 6000, (image) => image.withMetadata({ orientation: 6 }).jpeg({ quality: 67 }));
await fixture('drawing.png', 3200, 2500, (image) => image.png({ compressionLevel: 1 }));
