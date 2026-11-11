import test from 'node:test';
import assert from 'node:assert/strict';
import {
  renderPhotoRestoration,
  motionKernel,
  restorationCost,
  type PhotoRestorationSettings,
} from '../src/restoration.js';
import { linearToSrgb, srgbToLinear } from '../src/engine.js';
import { createRasterMask } from '../src/index.js';
import type { RGBAImage } from '../src/types.js';

const settings: PhotoRestorationSettings = {
  algorithm: 'photo-restore-v1',
  luminanceNoise: 0,
  chromaNoise: 0,
  motion: { length: 0, angle: 0, iterations: 6, strength: 0 },
};
test('bounded Richardson-Lucy improves a known directional blur without changing source/alpha or protected pixels', () => {
  const width = 96,
    height = 64,
    truth = new Float32Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      truth[y * width + x] =
        0.35 +
        0.2 * Math.sin(x / 2.8) * Math.cos(y / 8) +
        (x > 35 && x < 55 && y > 12 && y < 50 ? 0.18 : 0);
  const data = new Uint8ClampedArray(width * height * 4),
    taps = motionKernel(5, 0);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0,
        weight = 0;
      for (const tap of taps) {
        const xx = x + tap.dx,
          yy = y + tap.dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        sum += truth[yy * width + xx]! * tap.weight;
        weight += tap.weight;
      }
      const gray = 255 * linearToSrgb(sum / weight),
        at = (y * width + x) * 4;
      data.set([gray, gray, gray, 255], at);
    }
  const image: RGBAImage = { width, height, data },
    original = data.slice();
  const result = renderPhotoRestoration(image, {
    ...settings,
    motion: { length: 5, angle: 0, iterations: 8, strength: 1 },
  });
  let before = 0,
    after = 0;
  for (let y = 8; y < height - 8; y++)
    for (let x = 8; x < width - 8; x++) {
      const at = y * width + x;
      before += (srgbToLinear(data[at * 4]! / 255) - truth[at]!) ** 2;
      after += (srgbToLinear(result.data[at * 4]! / 255) - truth[at]!) ** 2;
      assert.equal(result.data[at * 4 + 3], 255);
    }
  assert.ok(after < before * 0.45, `MSE ${before} -> ${after}`);
  assert.deepEqual(data, original);
  const protectedResult = renderPhotoRestoration(image, {
    ...settings,
    luminanceNoise: 70,
    protection: createRasterMask(1, 1, Uint8Array.of(255)),
  });
  assert.deepEqual(protectedResult.data, original);
});

test('independent luma/chroma reduction lowers deterministic noise, preserves exact neutrality, transparency and zero-weight exterior', () => {
  const width = 48,
    height = 48,
    data = new Uint8ClampedArray(width * height * 4);
  let state = 157;
  for (let i = 0; i < width * height; i++) {
    for (let c = 0; c < 3; c++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[i * 4 + c] = 120 + (state % 31) - 15;
    }
    data[i * 4 + 3] = i % 17 === 0 ? 0 : 190;
  }
  const image: RGBAImage = { width, height, data };
  assert.deepEqual(renderPhotoRestoration(image, settings).data, data);
  const mask = createRasterMask(2, 1, Uint8Array.of(255, 0));
  const result = renderPhotoRestoration(image, {
    ...settings,
    luminanceNoise: 85,
    chromaNoise: 90,
    selection: mask,
  });
  let before = 0,
    after = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      assert.equal(result.data[at + 3], data[at + 3]);
      if (x >= 25 || !data[at + 3])
        assert.deepEqual(result.data.subarray(at, at + 4), data.subarray(at, at + 4));
      else if (x < 20)
        for (let c = 0; c < 3; c++) {
          before += (data[at + c]! - 120) ** 2;
          after += (result.data[at + c]! - 120) ** 2;
        }
    }
  assert.ok(after < before * 0.25, `${before} -> ${after}`);
  assert.equal(
    restorationCost(2048, 2048, {
      ...settings,
      motion: { length: 31, angle: 31, iterations: 12, strength: 1 },
    }).available,
    false,
  );
  assert.throws(
    () =>
      renderPhotoRestoration(image, {
        ...settings,
        motion: { length: 32, angle: 0, iterations: 12, strength: 1 },
      }),
    /Invalid/,
  );
  const stop = new AbortController();
  stop.abort();
  assert.throws(() => renderPhotoRestoration(image, settings, { signal: stop.signal }), /cancel/i);
  for (const angle of [-180, -47.7, 0, 23.1, 90, 180])
    assert.ok(
      Math.abs(motionKernel(7.5, angle).reduce((sum, tap) => sum + tap.weight, 0) - 1) < 1e-12,
    );
});
