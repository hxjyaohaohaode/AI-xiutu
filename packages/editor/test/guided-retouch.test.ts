import test from 'node:test';
import assert from 'node:assert/strict';
import { boxSum } from '../src/guided-retouch.js';
import {
  createRecipeV4,
  createRetouchRegionV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  compileSelectionMaskV3,
  type RGBAImage,
  type RetouchRegionV4,
} from '../src/index.js';

test('running box sums match brute-force clipped neighbourhoods including single-row, oversized radius and cancellation', () => {
  for (const [width, height] of [
    [1, 9],
    [13, 1],
    [17, 13],
  ])
    for (const radius of [1, 4, 30]) {
      const data = Float32Array.from({ length: width! * height! }, (_, i) => ((i * 13) % 19) / 20);
      const result = boxSum(data, width!, height!, radius, {});
      for (let y = 0; y < height!; y++)
        for (let x = 0; x < width!; x++) {
          let sum = 0;
          for (let sy = Math.max(0, y - radius); sy <= Math.min(height! - 1, y + radius); sy++)
            for (let sx = Math.max(0, x - radius); sx <= Math.min(width! - 1, x + radius); sx++)
              sum += data[sy * width! + sx]!;
          assert.ok(Math.abs(result[y * width! + x]! - sum) < 1e-4);
        }
    }
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => boxSum(new Float32Array(1), 1, 1, 1, { signal: controller.signal }),
    /abort/i,
  );
});
function sample() {
  const image: RGBAImage = { width: 128, height: 96, data: new Uint8ClampedArray(128 * 96 * 4) };
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 128; x++) {
      const base = x < 64 ? 110 : 200,
        noise = ((x * 7 + y * 11) % 13) - 6;
      image.data.set([base + 22 + noise, base + noise, base - 18 + noise, 255], (y * 128 + x) * 4);
    }
  return image;
}
const region = (settings: Partial<RetouchRegionV4> = {}) =>
  createRecipeV4({
    retouch: [
      createRetouchRegionV4({
        algorithm: 'guided-v1',
        radius: 0.06,
        mask: {
          type: 'radial',
          centerX: 0.5,
          centerY: 0.5,
          radiusX: 0.45,
          radiusY: 0.45,
          feather: 0,
          invert: false,
        },
        ...settings,
      }),
    ],
  });
function rms(image: RGBAImage) {
  let sum = 0,
    n = 0;
  for (let y = 32; y < 64; y++)
    for (let x = 30; x < 50; x++) {
      sum += (image.data[(y * 128 + x) * 4 + 1]! - 110) ** 2;
      n++;
    }
  return Math.sqrt(sum / n);
}
test('guided smoothing reduces flat noise while preserving the large edge, neutral state, exact exterior and export pixels', () => {
  const image = sample(),
    frozen = image.data.slice(),
    recipe = region({ smoothing: 100 });
  const result = renderEditorRecipe(image, recipe);
  assert.ok(rms(result) < rms(image) * 0.4, `${rms(result)} / ${rms(image)}`);
  const left = result.data[(48 * 128 + 62) * 4 + 1]!,
    right = result.data[(48 * 128 + 65) * 4 + 1]!;
  assert.ok(right - left > 80, 'the 90-value contour must survive');
  assert.deepEqual(renderEditorRecipe(image, region()), image);
  assert.deepEqual(image.data, frozen);
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 128; x++) {
      const at = (y * 128 + x) * 4;
      assert.equal(result.data[at + 3], image.data[at + 3]);
      if (Math.hypot(((x + 0.5) / 128 - 0.5) / 0.45, ((y + 0.5) / 96 - 0.5) / 0.45) >= 1)
        assert.deepEqual(result.data.slice(at, at + 4), image.data.slice(at, at + 4));
    }
  assert.deepEqual(renderEditorRecipeTiled(image, recipe, { tileSize: 19 }), result);
});
test('detail has opposite signed effects; explicit protection and zero amount preserve byte values', () => {
  const source = sample(),
    enhanced = renderEditorRecipe(source, region({ texture: 100 })),
    reduced = renderEditorRecipe(source, region({ texture: -100 }));
  assert.ok(rms(enhanced) > rms(source) * 1.5);
  assert.ok(rms(reduced) < rms(source) * 0.3);
  const recipe = region({
    smoothing: 100,
    uniformity: 100,
    fineLines: 100,
    shine: 100,
    speckle: 100,
  });
  recipe.retouch[0]!.protection = {
    type: 'radial',
    centerX: 0.5,
    centerY: 0.5,
    radiusX: 0.1,
    radiusY: 0.1,
    feather: 0,
    invert: false,
  };
  const result = renderEditorRecipe(source, recipe),
    at = (48 * 128 + 64) * 4;
  assert.deepEqual(result.data.slice(at, at + 4), source.data.slice(at, at + 4));
  recipe.retouch[0]!.opacity = 0;
  assert.deepEqual(renderEditorRecipe(source, recipe), source);
});
test('invisible RGB cannot bleed into guided skin colours', () => {
  const a = sample(),
    b = sample();
  for (let y = 0; y < 96; y++)
    for (let x = 50; x < 60; x++) {
      const at = (y * 128 + x) * 4;
      a.data.set([255, 0, 0, 0], at);
      b.data.set([0, 255, 0, 0], at);
    }
  const recipe = region({ smoothing: 100, uniformity: 100, fineLines: 100 });
  const ra = renderEditorRecipe(a, recipe),
    rb = renderEditorRecipe(b, recipe);
  for (let at = 0; at < a.data.length; at += 4) {
    if (a.data[at + 3]) assert.deepEqual(ra.data.slice(at, at + 4), rb.data.slice(at, at + 4));
    else assert.deepEqual(ra.data.slice(at, at + 4), a.data.slice(at, at + 4));
  }
});

test('guided-v2 treats protected and exterior pixels as zero-weight samples at every slider setting', () => {
  const a = sample(),
    b = sample();
  const protection = {
    type: 'radial' as const,
    centerX: 0.53,
    centerY: 0.5,
    radiusX: 0.13,
    radiusY: 0.12,
    feather: 0,
    invert: false,
  };
  const base = region({ algorithm: 'guided-v2', protection });
  const operation = base.retouch[0]!;
  const selected = compileSelectionMaskV3(operation.mask, a, a);
  const excluded = compileSelectionMaskV3(protection, a, a);
  const included = (i: number) =>
    selected(((i % a.width) + 0.5) / a.width, (Math.floor(i / a.width) + 0.5) / a.height) &&
    !excluded(((i % a.width) + 0.5) / a.width, (Math.floor(i / a.width) + 0.5) / a.height);
  for (let i = 0; i < a.width * a.height; i++) {
    if (!included(i)) {
      a.data.set([250, 1, 50, 255], i * 4);
      b.data.set([1, 243, 249, 255], i * 4);
    }
  }
  assert.deepEqual(renderEditorRecipe(a, base), a);
  for (const amount of [25, 50, 75, 100])
    for (const texture of [-amount, amount]) {
      const recipe = region({
        algorithm: 'guided-v2',
        protection,
        texture,
        smoothing: amount,
        uniformity: amount,
        fineLines: amount,
        speckle: amount,
        shine: amount,
      });
      const ra = renderEditorRecipe(a, recipe),
        rb = renderEditorRecipe(b, recipe);
      let changed = 0;
      for (let i = 0; i < a.width * a.height; i++) {
        const start = 4 * i,
          end = start + 4;
        assert.equal(ra.data[start + 3], a.data[start + 3]);
        if (included(i)) {
          assert.deepEqual(ra.data.slice(start, end), rb.data.slice(start, end));
          if (ra.data[start] !== a.data[start]) changed++;
        } else {
          assert.deepEqual(ra.data.slice(start, end), a.data.slice(start, end));
          assert.deepEqual(rb.data.slice(start, end), b.data.slice(start, end));
        }
      }
      assert.ok(changed > 25, `effect must reach real pixels at ${amount}/${texture}`);
      assert.deepEqual(renderEditorRecipeTiled(a, recipe, { tileSize: 17 }), ra);
    }
});
