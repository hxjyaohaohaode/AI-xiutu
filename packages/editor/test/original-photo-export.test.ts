import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  createRecipeV4,
  getOutputDimensions,
  originalPhotoExportSupported,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  renderOriginalPhotoPng,
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

async function compare(image: RGBAImage, recipe: ReturnType<typeof createRecipeV4>) {
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

test('local and spatial operations and invalid recipes fail before reading source pixels', () => {
  const neutral = createRecipeV4();
  assert.ok(originalPhotoExportSupported(neutral));
  for (const recipe of [
    createRecipeV4({ adjustments: { sharpness: 10 } }),
    createRecipeV4({ effects: { vignette: { amount: 11 } } }),
    { ...neutral, local: { ...neutral.local, enabled: true } },
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
