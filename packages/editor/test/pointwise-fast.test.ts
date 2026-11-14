import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipe, createRecipeV4, renderEditorRecipe, srgbToLinear } from '../src/index.js';
import { createRenderSession, renderValidatedRegion } from '../src/engine.js';
import { preparePointPreview } from '../src/point-preview.js';

test('pointwise lookups equal the original floating-point stages, including byte boundaries and hidden RGB', () => {
  const width = 257,
    height = 259;
  const image = {
    width,
    height,
    data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
      i % 4 === 3 ? (i % 17 ? 231 : 0) : ((i * 73) ^ (i >> 5) ^ (i >> 12)) & 255,
    ),
  };
  const threshold = Math.log2(srgbToLinear(88.5 / 255) / Math.fround(srgbToLinear(73 / 255)));
  const cases = [
    ...[-4.99, -0.01, 0.01, 0.73, 4.99, threshold - 1e-12, threshold, threshold + 1e-12].map(
      (exposure) => createRecipe({ adjustments: { exposure } }),
    ),
    createRecipe({ adjustments: { temperature: -27, tint: 31 } }),
    ...[-0.2, 0.2, 0.23].map((saturation) => createRecipe({ adjustments: { saturation } })),
    createRecipe({
      adjustments: { saturation: -100, brightness: -37, highlights: 61, shadows: -24 },
    }),
    createRecipe({ adjustments: { vibrance: 48, contrast: 33, blacks: -16, whites: 47 } }),
    createRecipe({
      curves: {
        rgb: [
          [0, 0.05],
          [0.18, 0.64],
          [0.58, 0.29],
          [1, 1],
        ],
        red: [
          [0, 0],
          [0.21, 0.34],
          [0.72, 0.8],
          [1, 1],
        ],
      },
    }),
  ];
  for (const recipe of cases) {
    for (const geometry of [
      recipe.geometry,
      {
        ...recipe.geometry,
        rotation: 270 as const,
        flipX: true,
        crop: { x: 0.08, y: 0.1, width: 0.76, height: 0.8 },
      },
    ]) {
      const session = createRenderSession({ ...recipe, geometry });
      assert.deepEqual(
        renderValidatedRegion(image, session, {}),
        renderValidatedRegion(image, session, {}, undefined, undefined, {
          active: true,
          apply: (working) => working,
        }),
      );
    }
  }
});

test('indexed exposure uses exactly the same pixels during dragging, including transparent pixels and crop rotation', () => {
  const width = 1024, height = 1025;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = (i >> 3) & 63;
    data[i * 4 + 1] = i % 83;
    data[i * 4 + 2] = (i >> 9) % 31;
    data[i * 4 + 3] = i % 23 ? 255 : 0;
  }
  const image = { width, height, data };
  const render = preparePointPreview(image);
  assert.ok(render);
  for (const exposure of [-0.73, 0, 0.73]) {
    const recipe = createRecipeV4({
      adjustments: { exposure },
      geometry: { rotation: 90, crop: { x: 0.13, y: 0.11, width: 0.75, height: 0.67 }, flipX: true },
    });
    assert.deepEqual(render(recipe), renderEditorRecipe(image, recipe));
  }
});
