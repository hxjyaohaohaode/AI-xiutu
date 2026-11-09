import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { readImageHeader, ImageHeaderError } from '../src/index.js';

function bmp(width = 64, height = 40, depth = 24) {
  const stride = Math.ceil((width * depth) / 32) * 4;
  const bytes = Buffer.alloc(54 + stride * Math.abs(height));
  bytes.write('BM');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(depth, 28);
  return bytes;
}
test('BMP preflight supports explicit uncompressed RGB variants and rejects alternate encodings', () => {
  for (const depth of [24, 32])
    for (const height of [40, -40])
      assert.deepEqual(readImageHeader(bmp(64, height, depth)), {
        width: 64,
        height: 40,
        format: 'bmp',
        animated: false,
      });
  const compressed = bmp();
  compressed.writeUInt32LE(1, 30);
  assert.throws(() => readImageHeader(compressed), /uncompressed/);
  const palette = bmp();
  palette.writeUInt16LE(8, 28);
  assert.throws(() => readImageHeader(palette), /24\/32/);
  const badOffset = bmp();
  badOffset.writeUInt32LE(20, 10);
  assert.throws(() => readImageHeader(badOffset), /header/);
  assert.throws(() => readImageHeader(bmp().subarray(0, 60)), /truncated/);
});
test('real static GIF is inspected through complete frame/trailer and rejects truncation/animation', async () => {
  const bytes = await sharp({
    create: {
      width: 80,
      height: 60,
      channels: 4,
      background: { r: 20, g: 150, b: 220, alpha: 0.5 },
    },
  })
    .gif()
    .toBuffer();
  assert.deepEqual(readImageHeader(bytes), {
    width: 80,
    height: 60,
    format: 'gif',
    animated: false,
  });
  assert.throws(() => readImageHeader(bytes.subarray(0, -1)), ImageHeaderError);
  const pixels = Buffer.alloc(80 * 120 * 4, 160);
  pixels.fill(220, 80 * 60 * 4);
  const frames = await sharp(pixels, {
    raw: { width: 80, height: 120, channels: 4, pageHeight: 60 },
  })
    .gif({ delay: [100, 100], loop: 0 })
    .toBuffer();
  assert.equal(readImageHeader(frames).animated, true);
});
test('real AVIF primary-image associations work for RGB and alpha; sequence/missing/invalid boxes fail closed', async () => {
  for (const channels of [3, 4] as const) {
    const bytes = await sharp({
      create: {
        width: 120,
        height: 80,
        channels,
        background: { r: 180, g: 40, b: 30, alpha: 0.5 },
      },
    })
      .avif()
      .toBuffer();
    assert.deepEqual(readImageHeader(bytes), {
      width: 120,
      height: 80,
      format: 'avif',
      animated: false,
    });
    assert.equal((await sharp(bytes).metadata()).width, 120);
    const sequence = Buffer.from(bytes);
    sequence.write('avis', 8);
    assert.throws(() => readImageHeader(sequence), /Animated/);
    const oversized = Buffer.from(bytes);
    oversized.writeUInt32BE(0xffffffff, 28);
    assert.throws(() => readImageHeader(oversized), /container/);
    const wrongCodec = Buffer.from(bytes);
    let at = wrongCodec.indexOf('avif');
    while (at >= 0) {
      wrongCodec.write('heic', at);
      at = wrongCodec.indexOf('avif');
    }
    assert.throws(() => readImageHeader(wrongCodec), /codec/);
    assert.throws(() => readImageHeader(bytes.subarray(0, 50)), ImageHeaderError);
  }
});
test('header inspection requires explicit larger image budget, bounded at 64MP/16384', () => {
  const bytes = bmp(9000, 1);
  assert.throws(() => readImageHeader(bytes), /dimensions/);
  assert.equal(readImageHeader(bytes, { maxPixels: 67_108_864, maxDimension: 16384 }).width, 9000);
  for (const limits of [
    { maxPixels: Infinity },
    { maxPixels: 67_108_865 },
    { maxDimension: 16385 },
    { maxPixels: NaN },
  ])
    assert.throws(() => readImageHeader(bytes, limits), ImageHeaderError);
});
