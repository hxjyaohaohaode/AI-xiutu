import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileEditorCoordinateMap,
  createRecipe,
  createRecipeV4,
  fitOrientedCrop,
  orientGeometry,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  renderRecipe,
  translateCurvePoints,
  WarpPreviewCache,
  type CurvePoint,
  type Geometry,
  type RGBAImage,
  type WarpStrokeV3,
} from '../src/index.js';

const raster: RGBAImage = {
  width: 121,
  height: 79,
  data: Uint8ClampedArray.from({ length: 121 * 79 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 13 + (i >>> 5) * 101) % 256,
  ),
};
const neutral: Geometry = { crop: null, rotation: 0, flipX: false, flipY: false };

test('cropped rotation and both reflections compose in the displayed orientation', () => {
  const cases = ['left', 'right', 'half-turn', 'mirror', 'flip'] as const;
  for (const rotation of [0, 90, 180, 270] as const)
    for (const flipX of [false, true])
      for (const flipY of [false, true]) {
        const base = {
          ...neutral,
          crop: { x: 0.1, y: 0.09, width: 0.72, height: 0.65 },
          rotation,
          flipX,
          flipY,
        };
        const first = renderRecipe(raster, createRecipe({ geometry: base }));
        for (const action of cases) {
          const expected = renderRecipe(
            first,
            createRecipe({ geometry: orientGeometry(neutral, action) }),
          );
          assert.deepEqual(
            renderRecipe(raster, createRecipe({ geometry: orientGeometry(base, action) })),
            expected,
            JSON.stringify({ rotation, flipX, flipY, action }),
          );
        }
      }
  const rotated = orientGeometry(neutral, 'right');
  const portrait = fitOrientedCrop(raster, rotated, 9 / 16);
  assert.ok(Math.abs(portrait.height / portrait.width - 9 / 16) < 0.01);
  const landscape = fitOrientedCrop(raster, rotated, 16 / 9);
  assert.ok(Math.abs(landscape.height / landscape.width - 16 / 9) < 0.03);
});

test('visible coordinates continue to point at source content after warp and crop orientation', () => {
  const base = createRecipeV4();
  const stroke: WarpStrokeV3 = {
    id: 'push',
    mode: 'push',
    algorithm: 'flow-v2',
    from: { x: 0.5, y: 0.5 },
    to: { x: 0.64, y: 0.43 },
    radius: 0.3,
    feather: 0.62,
    strength: 0.48,
  };
  const recipe = createRecipeV4({
    geometry: orientGeometry(orientGeometry(neutral, 'mirror'), 'right'),
    warp: { ...base.warp, strokes: [stroke] },
  });
  const map = compileEditorCoordinateMap(raster, recipe, raster);
  for (const point of [
    { x: 0.48, y: 0.47 },
    { x: 0.55, y: 0.54 },
    { x: 0.85, y: 0.2 },
  ]) {
    const displayed = map.toContentOutput(point);
    assert.ok(displayed);
    const sample = map.toContent(displayed);
    assert.ok(
      Math.hypot((sample.x - point.x) * raster.width, (sample.y - point.y) * raster.height) <= 0.35,
    );
  }
});

test('selective liquify restore replays full and incremental pixels and preserves pixels outside its sweep', () => {
  const base = createRecipeV4();
  const push: WarpStrokeV3 = {
    id: 'push',
    mode: 'push',
    algorithm: 'flow-v2',
    resampling: 'bounded-cubic-v1',
    from: { x: 0.5, y: 0.5 },
    to: { x: 0.66, y: 0.48 },
    radius: 0.33,
    feather: 0.5,
    strength: 0.8,
  };
  const restore: WarpStrokeV3 = {
    ...push,
    id: 'restore',
    mode: 'restore',
    algorithm: 'restore-v1',
    from: { x: 0.44, y: 0.5 },
    to: { x: 0.6, y: 0.5 },
    radius: 0.12,
    strength: 1,
  };
  const warped = createRecipeV4({ warp: { ...base.warp, strokes: [push] } });
  const repaired = createRecipeV4({ warp: { ...base.warp, strokes: [push, restore] } });
  const before = renderEditorRecipe(raster, warped),
    after = renderEditorRecipe(raster, repaired);
  const cache = new WarpPreviewCache();
  cache.prewarm(() => renderEditorRecipe(raster, warped, { warpPreviewCache: cache }));
  assert.deepEqual(renderEditorRecipe(raster, repaired, { warpPreviewCache: cache }), after);
  assert.deepEqual(renderEditorRecipeTiled(raster, repaired, { tileSize: 32 }), after);
  let restored = 0;
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++) {
      const offset = (y * raster.width + x) * 4;
      const px = x + 0.5,
        py = y + 0.5;
      const outside =
        Math.hypot(
          px - Math.max(restore.from.x * raster.width, Math.min(restore.to.x * raster.width, px)),
          py - raster.height / 2,
        ) >=
        restore.radius * raster.height;
      if (outside) assert.equal(after.data[offset], before.data[offset]);
      if (
        y === (raster.height - 1) / 2 &&
        px >= restore.from.x * raster.width &&
        px <= restore.to.x * raster.width
      ) {
        assert.deepEqual(
          after.data.subarray(offset, offset + 4),
          raster.data.subarray(offset, offset + 4),
        );
        if (before.data[offset] !== after.data[offset]) restored++;
      }
    }
  assert.ok(restored > 8);
});

test('multiple curve knots preserve their intervals while endpoints and unselected neighbors constrain them', () => {
  const original: CurvePoint[] = [
    [0, 0],
    [0.2, 0.18],
    [0.43, 0.6],
    [0.62, 0.58],
    [0.83, 0.91],
    [1, 1],
  ];
  const after = translateCurvePoints(original, [1, 2, 4], 0.7, 0.5);
  assert.deepEqual(after[3], original[3]);
  assert.equal(after[4]![1], 1);
  assert.ok(Math.abs(after[2]![0] - after[1]![0] - (original[2]![0] - original[1]![0])) < 1e-12);
  assert.ok(after.every((p, index) => !index || p[0] > after[index - 1]![0]));
});
