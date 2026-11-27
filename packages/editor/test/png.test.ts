import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { encodeRgbaPng, readImageHeader } from '../src/index.js';

test('straight RGBA PNG round-trips all channel bytes in compressed and stored streams', async () => {
  const width = 257,
    height = 9;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++)
    data.set([(17 + i * 97) % 256, (179 + i * 29) % 256, (201 + i * 43) % 256, i % 256], i * 4);

  async function check(blob: Blob) {
    assert.equal(blob.type, 'image/png');
    const bytes = Buffer.from(await blob.arrayBuffer());
    const header = readImageHeader(bytes);
    assert.deepEqual([header.format, header.width, header.height], ['png', width, height]);
    const decoded = await sharp(bytes).ensureAlpha().raw().toBuffer();
    assert.deepEqual(decoded, Buffer.from(data));
    return bytes.length;
  }

  const compressed = await check(await encodeRgbaPng({ width, height, data }));
  const native = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream')!;
  try {
    Object.defineProperty(globalThis, 'CompressionStream', {
      configurable: true,
      value: undefined,
    });
    const stored = await check(await encodeRgbaPng({ width, height, data }));
    assert.ok(stored > compressed);
  } finally {
    Object.defineProperty(globalThis, 'CompressionStream', native);
  }
});

test('explicit native raster budget encodes a cutout-sized frame above 4 MP', async () => {
  const width = 2050,
    height = 2050;
  const data = new Uint8ClampedArray(width * height * 4);
  data.set([118, 192, 46, 1], data.length - 4);
  await assert.rejects(encodeRgbaPng({ width, height, data }), /budget/);
  const blob = await encodeRgbaPng({ width, height, data }, 8_388_608);
  const decoded = await sharp(Buffer.from(await blob.arrayBuffer()))
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(Buffer.compare(decoded, Buffer.from(data)), 0);
});

test('stored PNG can split a panoramic scanline across DEFLATE blocks', async () => {
  const width = 16_384,
    height = 2;
  const data = Uint8ClampedArray.from(
    { length: width * height * 4 },
    (_, index) => (index * 37) & 255,
  );
  const restore = Object.getOwnPropertyDescriptor(globalThis, 'CompressionStream')!;
  try {
    Object.defineProperty(globalThis, 'CompressionStream', {
      configurable: true,
      value: undefined,
    });
    const png = await encodeRgbaPng({ width, height, data });
    const decoded = await sharp(Buffer.from(await png.arrayBuffer()))
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.equal(Buffer.compare(decoded, Buffer.from(data)), 0);
  } finally {
    Object.defineProperty(globalThis, 'CompressionStream', restore);
  }
});
