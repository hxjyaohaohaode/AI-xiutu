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
