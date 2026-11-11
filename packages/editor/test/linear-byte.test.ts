import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFloat32Byte } from '../src/linear-byte.js';
import { linearToSrgb, createRenderSession, mapPoint, renderRecipe } from '../src/engine.js';
import { createRecipe } from '../src/recipe.js';

test('Float32 byte encoder agrees with the transfer function around every byte transition and across the float exponent range', () => {
  const bits = new Uint32Array(1),
    value = new Float32Array(bits.buffer);
  const check = (n: number) => {
    const v = Math.fround(n);
    assert.equal(
      encodeFloat32Byte(v),
      Math.round(Math.max(0, Math.min(1, linearToSrgb(v))) * 255),
      `${v}`,
    );
  };
  for (let byte = 0; byte < 255; byte++) {
    const encoded = (byte + 0.5) / 255;
    value[0] = encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
    const center = bits[0]!;
    for (let delta = -8; delta <= 8; delta++) {
      bits[0] = center + delta;
      check(value[0]!);
    }
  }
  let seed = 0x5a1c3f07;
  for (let i = 0; i < 1_000_000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    bits[0] = seed % 0x3f800001;
    check(value[0]!);
  }
  for (const v of [-Infinity, -0.5, -0, 0, 1, 1.5, Infinity]) check(v);
});

test('compiled input transfers and output quantization preserve original per-pixel reference math with alpha and all tone operations', () => {
  const width = 256,
    height = 256,
    data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++)
    data.set([i & 255, i >>> 8, (i * 139) & 255, i % 29 === 0 ? 0 : (i % 255) + 1], i * 4);
  const image = { width, height, data };
  const recipes = [
    createRecipe({
      curves: {
        rgb: [
          [0, 0.1],
          [0.21, 0.35],
          [0.77, 0.61],
          [1, 0.95],
        ],
      },
    }),
    ...[-5, -1.31, 0.73, 5].map((exposure) => createRecipe({ adjustments: { exposure } })),
    createRecipe({
      adjustments: {
        exposure: -0.65,
        brightness: 24,
        contrast: 51,
        shadows: -62,
        highlights: 35,
        whites: -13,
        blacks: 14,
        temperature: 36,
        tint: -21,
        saturation: 71,
        vibrance: -12,
      },
    }),
  ];
  const decode = Float32Array.from({ length: 256 }, (_, i) =>
    i / 255 <= 0.04045 ? i / 255 / 12.92 : ((i / 255 + 0.055) / 1.055) ** 2.4,
  );
  for (const recipe of recipes) {
    const session = createRenderSession(recipe),
      expected = data.slice(),
      sample = new Float32Array(3);
    for (let at = 0; at < data.length; at += 4) {
      if (!data[at + 3]) continue;
      mapPoint(
        decode[data[at]!]!,
        decode[data[at + 1]!]!,
        decode[data[at + 2]!]!,
        session.globalTone,
        session.curves,
        sample,
        0,
      );
      for (let c = 0; c < 3; c++)
        expected[at + c] = Math.round(Math.max(0, Math.min(1, linearToSrgb(sample[c]!))) * 255);
    }
    assert.deepEqual(renderRecipe(image, recipe).data, expected);
  }
});
