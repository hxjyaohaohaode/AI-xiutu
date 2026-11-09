import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipe,
  createRecipeV2,
  createAdjustmentRegionV2,
  compileSelectionMask,
  getOutputDimensions,
  mapOutputToSource,
  parseEditorRecipe,
  V2_TOOLS,
} from '@ai-xiutu/editor';
import {
  cropFromPixels,
  brushPointAtSource,
  duplicateRegionForEditor,
  sampleSourcePreview,
  numericRecipeValue,
  replaceSelectionMask,
  setNumericRecipeValue,
} from '../src/editor/precision.js';

test('pixel crop keeps exact boundaries at small, odd, tall and 16K sizes', () => {
  for (const dimensions of [
    { width: 1, height: 1 },
    { width: 7, height: 13 },
    { width: 4033, height: 3023 },
    { width: 16384, height: 4096 },
    { width: 1, height: 8192 },
  ]) {
    for (const [x, y, w, h] of [
      [0, 0, 1, 1],
      [dimensions.width - 1, dimensions.height - 1, 1, 1],
      [0, 0, dimensions.width, dimensions.height],
      [
        Math.floor(dimensions.width / 3),
        Math.floor(dimensions.height / 3),
        Math.max(1, Math.floor(dimensions.width / 3)),
        Math.max(1, Math.floor(dimensions.height / 3)),
      ],
    ]) {
      const crop = cropFromPixels(dimensions, { x: x!, y: y!, width: w!, height: h! });
      const recipe = createRecipeV2({ geometry: { crop } });
      assert.deepEqual(getOutputDimensions(dimensions, recipe.geometry), { width: w, height: h });
      const point = mapOutputToSource({ x: 0, y: 0 }, dimensions, recipe.geometry);
      assert.equal(Math.round(point.x * dimensions.width), x);
      assert.equal(Math.round(point.y * dimensions.height), y);
      parseEditorRecipe(recipe);
    }
  }
});
test('pixel crop clamps edge drags to at least one real source pixel', () => {
  const dimensions = { width: 2309, height: 4093 };
  const crop = cropFromPixels(dimensions, { x: 99999, y: -100, width: -3, height: 100000 });
  const recipe = createRecipe({ geometry: { crop } });
  assert.deepEqual(getOutputDimensions(dimensions, recipe.geometry), { width: 1, height: 4093 });
});
test('numeric editor changes require trusted registry identity and leave input untouched', () => {
  const recipe = createRecipeV2();
  const tool = V2_TOOLS.find((tool) => tool.path === 'hsl.blue.hue')!;
  const next = setNumericRecipeValue(recipe, tool, -15.125, V2_TOOLS);
  assert.equal(numericRecipeValue(next, tool), -15.125);
  assert.equal(recipe.hsl.blue.hue, 0);
  parseEditorRecipe(next);
  assert.throws(() =>
    setNumericRecipeValue(recipe, { ...tool, path: '__proto__.polluted' }, 1, V2_TOOLS),
  );
  assert.throws(() => setNumericRecipeValue(recipe, tool, NaN, V2_TOOLS));
  assert.throws(() => setNumericRecipeValue(recipe, tool, 61, V2_TOOLS));
});
test('legacy radial selection updates never erase v2 color, effects or independent regions', () => {
  const recipe = createRecipeV2({ hsl: { red: { hue: 12 } }, effects: { grain: { amount: 20 } } });
  const next = replaceSelectionMask(recipe, null, {
    type: 'radial',
    centerX: 0.3,
    centerY: 0.4,
    radiusX: 0.2,
    radiusY: 0.1,
    feather: 0.5,
    invert: true,
  });
  assert.equal(next.schemaVersion, 2);
  if (next.schemaVersion !== 2) throw new Error('version lost');
  assert.equal(next.hsl.red.hue, 12);
  assert.equal(next.effects.grain.amount, 20);
  assert.equal(next.local.enabled, true);
  assert.equal(recipe.local.enabled, false);
  parseEditorRecipe(next);
});

test('one-pixel brush snaps a boundary click to exactly one original pixel center', () => {
  const dimensions = { width: 10, height: 10 },
    radius = 0.05;
  for (const click of [
    { x: 0.5, y: 0.5 },
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]) {
    const point = brushPointAtSource(click, dimensions, radius);
    const sample = compileSelectionMask(
      {
        type: 'brush',
        invert: false,
        strokes: [{ points: [point], radius, feather: 0, opacity: 1, mode: 'add' }],
      },
      dimensions,
    );
    let selected = 0;
    for (let y = 0; y < 10; y++)
      for (let x = 0; x < 10; x++) if (sample((x + 0.5) / 10, (y + 0.5) / 10) > 0) selected++;
    assert.equal(selected, 1);
  }
  const free = { x: 0.5123, y: 0.7532 };
  assert.equal(brushPointAtSource(free, dimensions, 0.1), free);
});

test('source preview sampling maps normalized source locations and clamps outer edge', () => {
  const source = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 128]),
  };
  const recipe = createRecipeV2({ geometry: { rotation: 90 } });
  const sourcePoint = mapOutputToSource({ x: 0.5, y: 0.25 }, source, recipe.geometry);
  assert.deepEqual(sampleSourcePreview(source, sourcePoint).rgba, [255, 0, 0, 255]);
  assert.deepEqual(sampleSourcePreview(source, { x: 1, y: 1 }), {
    x: 1,
    y: 0,
    rgba: [0, 0, 255, 128],
  });
});

test('duplicate validates global brush complexity and preserves original when budget would overflow', () => {
  const region = createAdjustmentRegionV2({
    id: 'region-1',
    mask: {
      type: 'brush',
      invert: false,
      strokes: Array.from({ length: 4 }, () => ({
        points: Array.from({ length: 256 }, (_, i) => ({ x: i / 255, y: 0.5 })),
        radius: 0.01,
        feather: 0,
        opacity: 1,
        mode: 'add' as const,
      })),
    },
  });
  const one = createRecipeV2({ regions: [region] });
  const two = duplicateRegionForEditor(one, region.id, 'region-2');
  assert.equal(two.regions.length, 2);
  assert.throws(() => duplicateRegionForEditor(two, region.id, 'region-3'), /brush point budget/);
  assert.equal(one.regions.length, 1);
  assert.equal(two.regions.length, 2);
  assert.throws(() => duplicateRegionForEditor(two, 'missing', 'region-3'));
});
