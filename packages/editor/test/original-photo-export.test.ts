import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  createRecipe,
  createRecipeV4,
  createAdjustmentRegionV2,
  getOutputDimensions,
  originalPhotoExportSupported,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  renderOriginalPhotoPng,
  type EditorRecipe,
  type Geometry,
  type RGBAImage,
} from '../src/index.js';

function fixture(width: number, height: number): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++)
    data.set(
      [(i * 23) & 255, ((i >>> 2) * 17) & 255, ((i >>> 7) * 41) & 255, i % 13 ? i & 255 : 0],
      i * 4,
    );
  return { width, height, data };
}

async function compare(image: RGBAImage, recipe: EditorRecipe) {
  const reference =
    Math.max(image.width, image.height) > 8192 ? renderEditorRecipeTiled : renderEditorRecipe;
  const result = reference(image, recipe);
  let reads = 0,
    largestRead = 0;
  const blob = await renderOriginalPhotoPng(image, recipe, (r) => {
    const data = new Uint8ClampedArray(r.width * r.height * 4);
    for (let row = 0; row < r.height; row++) {
      const start = ((r.top + row) * image.width + r.left) * 4;
      data.set(image.data.subarray(start, start + r.width * 4), row * r.width * 4);
    }
    reads++;
    largestRead = Math.max(largestRead, r.width * r.height);
    return { ...r, data };
  });
  const out = await sharp(Buffer.from(await blob.arrayBuffer()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([out.info.width, out.info.height], [result.width, result.height]);
  assert.equal(
    out.data.compare(Buffer.from(result.data)),
    0,
    'Every straight RGBA sample must agree',
  );
  assert.ok(largestRead <= 262_144);
  return reads;
}

test('native-size PNG uses the same cropped integer-pixel geometry across all turns and reflections', async () => {
  const image = fixture(79, 53);
  for (const rotation of [0, 90, 180, 270] as const)
    for (const flipX of [false, true])
      for (const flipY of [false, true]) {
        const geometry: Geometry = {
          crop: { x: 0.13, y: 0.12, width: 0.76, height: 0.81 },
          rotation,
          flipX,
          flipY,
        };
        await compare(
          image,
          createRecipeV4({ adjustments: { exposure: 0.45, saturation: 18 }, geometry }),
        );
      }
});

test('strip boundaries preserve near-transparent samples, extended levels/curves and quarter turns', async () => {
  const image = fixture(977, 491);
  const recipe = createRecipeV4({
    geometry: { rotation: 270, flipY: true, crop: { x: 0.04, y: 0.02, width: 0.93, height: 0.96 } },
    adjustments: { exposure: -0.4, brightness: 12 },
    effects: { fade: 22 },
    curves: {
      red: [
        [0, 0],
        [0.42, 0.71],
        [1, 1],
      ],
    },
  });
  assert.ok((await compare(image, recipe)) > 1);
});

test('panoramas above 8192 pixels per side keep their native geometry and exact color', async () => {
  const image = fixture(9001, 37);
  assert.ok((await compare(image, createRecipeV4({ adjustments: { temperature: -21 } }))) > 1);
});

test('source-coordinate masks, neighboring-pixel operations, grain and color selections survive tile seams and crop edges', async () => {
  const image = fixture(731, 547);
  const recipe = createRecipeV4({
    geometry: {
      rotation: 90,
      flipY: true,
      crop: { x: 0.024, y: 0.018, width: 0.956, height: 0.974 },
    },
    adjustments: { sharpness: 41, saturation: 19 },
    local: { enabled: true, adjustments: { exposure: 0.6, soften: 35 } },
    effects: { grain: { amount: 17, size: 3, seed: 17, colored: true }, vignette: { amount: 31 } },
    detail: { clarity: 23, texture: -15 },
    regions: [
      createAdjustmentRegionV2({
        id: 'gradient',
        mask: {
          type: 'linear',
          start: { x: 0.25, y: 0.33 },
          end: { x: 0.71, y: 0.63 },
          smooth: true,
          invert: false,
        },
        adjustments: { temperature: 18, sharpness: 42 },
      }),
      createAdjustmentRegionV2({
        id: 'color',
        mask: {
          type: 'color-range',
          hue: 153,
          hueWidth: 107,
          saturationMin: 0.12,
          saturationMax: 0.95,
          luminanceMin: 0.13,
          luminanceMax: 0.77,
          feather: 0.25,
          invert: true,
        },
        opacity: 0.63,
        adjustments: { contrast: -22, soften: 12 },
      }),
      createAdjustmentRegionV2({
        id: 'raster',
        mask: {
          type: 'raster',
          width: 2,
          height: 2,
          runs: [1, 0, 1, 73, 1, 255, 1, 132],
          sampling: 'bilinear-v1',
          invert: false,
        },
        adjustments: { exposure: -0.3 },
      }),
    ],
  });
  assert.ok(originalPhotoExportSupported(recipe));
  assert.ok((await compare(image, recipe)) > 1);
});

test('unstreamed composition and invalid recipes fail before reading source pixels', () => {
  const neutral = createRecipeV4();
  assert.ok(originalPhotoExportSupported(neutral));
  for (const recipe of [
    createRecipeV4({ transform: { rotationDegrees: 7 } }),
    { ...neutral, projective: { ...neutral.projective, enabled: true } },
  ]) {
    assert.equal(originalPhotoExportSupported(recipe), false);
    assert.throws(
      () => renderOriginalPhotoPng({ width: 10, height: 11 }, recipe, () => assert.fail()),
      /配方/,
    );
  }
  assert.throws(
    () => renderOriginalPhotoPng({ width: 8001, height: 8000 }, neutral, () => assert.fail()),
    /6400/,
  );
  assert.equal(
    originalPhotoExportSupported({
      ...neutral,
      geometry: { ...neutral.geometry, rotation: 32 },
    } as never),
    false,
  );
  assert.deepEqual(
    getOutputDimensions({ width: 6000, height: 8000 }, { ...neutral.geometry, rotation: 90 }),
    { width: 8000, height: 6000 },
  );
});

test('source-space filters and local selections retain every channel across strips, crop edges and rotated tile seams', async () => {
  const source = fixture(761, 683);
  const recipe = createRecipeV4({
    geometry: { rotation: 270, flipY: true, crop: { x: 0.04, y: 0.02, width: 0.93, height: 0.96 } },
    adjustments: { exposure: -0.25, sharpness: 45, soften: 21 },
    local: { enabled: true, adjustments: { sharpness: 65, exposure: 0.45 } },
    detail: { texture: -17, clarity: 29 },
    effects: {
      vignette: { amount: 58, centerX: 0.61 },
      grain: { amount: 22, colored: true, size: 2 },
    },
    regions: [
      createAdjustmentRegionV2({
        mask: {
          type: 'linear',
          start: { x: 0.14, y: 0.15 },
          end: { x: 0.8, y: 0.9 },
          smooth: true,
          invert: false,
        },
        adjustments: { soften: 28, exposure: 0.3 },
      }),
    ],
  });
  assert.equal(originalPhotoExportSupported(recipe), true);
  assert.ok((await compare(source, recipe)) >= 4);
  const v1 = createRecipe({
    adjustments: { sharpness: 30 },
    geometry: { rotation: 90, flipX: true },
  });
  assert.ok((await compare(source, v1)) >= 4);
});
