import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV4,
  createHealingOperationV4,
  createRetouchRegionV4,
  createAdjustmentRegionV3,
  parseRecipeV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  type RGBAImage,
  type SelectionMaskV3,
} from '../src/index.js';

const mask: SelectionMaskV3 = {
  type: 'radial',
  centerX: 0.48,
  centerY: 0.53,
  radiusX: 0.08,
  radiusY: 0.12,
  feather: 0.15,
  invert: false,
};
function source(): RGBAImage {
  const width = 96,
    height = 72,
    data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const texture = 30 * Math.cos((x * Math.PI) / 4) + 15 * Math.sin((y * Math.PI) / 4);
      data.set(
        [140 + texture, 100 + texture, 60 + texture, x < 3 ? x * 85 : 255],
        (y * width + x) * 4,
      );
    }
  return { width, height, data };
}
test('local processing uses the original frame before all integer crops, turns and flips; every output byte matches independent pixel mapping', () => {
  const input = source();
  for (const method of ['diffusion', 'patch-poisson', 'exemplar-v1'] as const) {
    const recipe = createRecipeV4({
      adjustments: { exposure: 0.4, saturation: -17 },
      curves: {
        red: [
          [0, 0],
          [0.4, 0.35],
          [1, 1],
        ],
      },
      regionEdits: [
        createAdjustmentRegionV3({
          id: 'local-light',
          mask: { ...mask, radiusX: 0.3 },
          color: { adjustments: { shadows: 42, temperature: -30 } },
        }),
      ],
      healing: [createHealingOperationV4({ method, mask, iterations: 144, searchRadius: 0.5 })],
      retouch: [
        createRetouchRegionV4({
          algorithm: 'guided-v1',
          mask: { ...mask, radiusX: 0.3, radiusY: 0.3 },
          smoothing: 60,
          texture: 18,
          uniformity: 35,
          fineLines: 20,
          radius: 0.03,
        }),
      ],
    });
    const full = renderEditorRecipe(input, recipe),
      frozen = JSON.stringify(recipe);
    for (const rotation of [0, 90, 180, 270] as const)
      for (const flipX of [false, true])
        for (const flipY of [false, true]) {
          // Exact integer crop boundaries, plus every discrete orientation.
          const next = parseRecipeV4(recipe);
          next.geometry = {
            crop: { x: 8 / 96, y: 6 / 72, width: 80 / 96, height: 60 / 72 },
            rotation,
            flipX,
            flipY,
          };
          const output = renderEditorRecipe(input, next);
          const w = rotation % 180 ? 60 : 80,
            h = rotation % 180 ? 80 : 60;
          assert.equal(output.width, w);
          assert.equal(output.height, h);
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const u = flipX ? w - 1 - x : x,
                v = flipY ? h - 1 - y : y;
              const sx =
                rotation === 0 ? u : rotation === 90 ? v : rotation === 180 ? 79 - u : 79 - v;
              const sy =
                rotation === 0 ? v : rotation === 90 ? 59 - u : rotation === 180 ? 59 - v : u;
              const a = (y * w + x) * 4,
                b = ((sy + 6) * 96 + sx + 8) * 4;
              assert.deepEqual(
                output.data.slice(a, a + 4),
                full.data.slice(b, b + 4),
                `${method}/${rotation}/${flipX}/${flipY}/${x},${y}`,
              );
            }
          assert.deepEqual(renderEditorRecipeTiled(input, next, { tileSize: 17 }), output);
        }
    assert.equal(JSON.stringify(recipe), frozen);
  }
});
test('guided ROI includes the full 2-radius dependency halo and protection does not perturb adjacent unprotected calculations', () => {
  const input = source();
  const fullMask: SelectionMaskV3 = {
    type: 'radial',
    centerX: 0.5,
    centerY: 0.5,
    radiusX: 1,
    radiusY: 1,
    feather: 0,
    invert: false,
  };
  const full = createRecipeV4({
    retouch: [
      createRetouchRegionV4({
        algorithm: 'guided-v1',
        mask: fullMask,
        smoothing: 75,
        texture: -12,
        uniformity: 100,
        fineLines: 45,
        shine: 30,
        speckle: 40,
        radius: 0.07,
      }),
    ],
  });
  const local = parseRecipeV4(full);
  local.retouch[0]!.mask = { ...mask, feather: 0 };
  const a = renderEditorRecipe(input, full),
    b = renderEditorRecipe(input, local);
  for (let y = 0; y < 72; y++)
    for (let x = 0; x < 96; x++) {
      const inside = Math.hypot(((x + 0.5) / 96 - 0.48) / 0.08, ((y + 0.5) / 72 - 0.53) / 0.12) < 1;
      const at = (y * 96 + x) * 4;
      assert.deepEqual(b.data.slice(at, at + 4), (inside ? a : input).data.slice(at, at + 4));
    }
  local.retouch[0]!.protection = { ...mask, radiusX: 0.03, radiusY: 0.03, feather: 0 };
  const protectedResult = renderEditorRecipe(input, local);
  for (let y = 0; y < 72; y++)
    for (let x = 0; x < 96; x++) {
      const protectedPixel =
        Math.hypot(((x + 0.5) / 96 - 0.48) / 0.03, ((y + 0.5) / 72 - 0.53) / 0.03) < 1;
      const at = (y * 96 + x) * 4;
      assert.deepEqual(
        protectedResult.data.slice(at, at + 4),
        (protectedPixel ? input : b).data.slice(at, at + 4),
      );
    }
});
