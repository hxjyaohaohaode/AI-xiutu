import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV4,
  createHealingOperationV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  type RGBAImage,
  type SelectionMaskV3,
} from '../src/index.js';

const mask: SelectionMaskV3 = {
  type: 'radial',
  centerX: 0.5,
  centerY: 0.5,
  radiusX: 0.11,
  radiusY: 0.13,
  feather: 0,
  invert: false,
};
function texture() {
  const image: RGBAImage = { width: 128, height: 96, data: new Uint8ClampedArray(128 * 96 * 4) };
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const v = 125 + 42 * Math.sin((y * Math.PI) / 4) + 18 * Math.cos((x * Math.PI) / 4);
      image.data.set([v + 25, v, v - 20, 255], (y * image.width + x) * 4);
    }
  return image;
}
function selected(x: number, y: number) {
  return Math.hypot(((x + 0.5) / 128 - 0.5) / 0.11, ((y + 0.5) / 96 - 0.5) / 0.13) < 1;
}
function corrupt(original: RGBAImage) {
  const source = { ...original, data: original.data.slice() };
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 128; x++)
      if (selected(x, y)) source.data.set([240, 20, 220, 255], (y * 128 + x) * 4);
  return source;
}
function error(a: RGBAImage, b: RGBAImage) {
  let sum = 0,
    n = 0;
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 128; x++)
      if (selected(x, y))
        for (let c = 0; c < 3; c++) {
          sum += Math.abs(a.data[(y * 128 + x) * 4 + c]! - b.data[(y * 128 + x) * 4 + c]!);
          n++;
        }
  return sum / n;
}
test('exemplar synthesis restores repeating texture beyond harmonic fill, while preserving source, alpha and unselected pixels', () => {
  const original = texture(),
    source = corrupt(original),
    before = source.data.slice();
  const recipe = createRecipeV4({
    healing: [
      createHealingOperationV4({
        method: 'exemplar-v1',
        mask,
        patchRadius: 4,
        searchRadius: 0.65,
        iterations: 196,
      }),
    ],
  });
  const result = renderEditorRecipe(source, recipe);
  const smooth = renderEditorRecipe(
    source,
    createRecipeV4({
      healing: [createHealingOperationV4({ method: 'diffusion', mask, iterations: 300 })],
    }),
  );
  assert.ok(
    error(result, original) < error(smooth, original) * 0.6,
    `${error(result, original)} versus ${error(smooth, original)}`,
  );
  assert.ok(
    error(result, original) < 15,
    'not merely a different fill: compare with undamaged ground truth',
  );
  assert.deepEqual(source.data, before);
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 128; x++) {
      const at = (y * 128 + x) * 4;
      assert.equal(result.data[at + 3], source.data[at + 3]);
      if (!selected(x, y))
        assert.deepEqual(result.data.slice(at, at + 4), source.data.slice(at, at + 4));
    }
  assert.deepEqual(renderEditorRecipeTiled(source, recipe, { tileSize: 23 }), result);
});
test('explicit donor, protected islands, amount and search rejection have real pixel semantics', () => {
  const original = texture(),
    source = corrupt(original);
  const protection = { ...mask, radiusX: 0.02, radiusY: 0.03 };
  const make = (opacity = 1) =>
    createRecipeV4({
      healing: [
        createHealingOperationV4({
          method: 'exemplar-v1',
          mask,
          protection,
          source: { x: 0.75, y: 0.5 },
          patchRadius: 2,
          opacity,
        }),
      ],
    });
  const full = renderEditorRecipe(source, make()),
    partial = renderEditorRecipe(source, make(0.5));
  assert.deepEqual(renderEditorRecipe(source, make(0)), source);
  const center = (48 * 128 + 64) * 4;
  assert.deepEqual(full.data.slice(center, center + 4), source.data.slice(center, center + 4));
  for (let at = 0; at < source.data.length; at++)
    assert.ok(Math.abs(partial.data[at]! - (source.data[at]! + full.data[at]!) / 2) <= 1);
  const bad = make();
  bad.healing[0]!.source = { x: 0.5, y: 0.5 };
  assert.throws(() => renderEditorRecipe(source, bad), /纹理补片/);
  assert.throws(() => createHealingOperationV4({ patchRadius: 3 }), /only valid/);
  assert.throws(
    () => createHealingOperationV4({ method: 'exemplar-v1', iterations: 1 }),
    /at least 16/,
  );
  assert.throws(
    () => createHealingOperationV4({ method: 'exemplar-v1', patchRadius: 2.5 }),
    /integer/,
  );
});
test('transparent hidden colors never guide matching and cancellation or oversize cannot publish a partial fill', () => {
  const source = corrupt(texture());
  for (let at = 0; at < source.data.length; at += 4) source.data[at + 3] = 0;
  // Opaque hole without any known opaque neighbour is not solvable.
  for (let y = 0; y < 96; y++)
    for (let x = 0; x < 128; x++) if (selected(x, y)) source.data[(y * 128 + x) * 4 + 3] = 255;
  const recipe = createRecipeV4({
    healing: [createHealingOperationV4({ method: 'exemplar-v1', mask })],
  });
  assert.throws(() => renderEditorRecipe(source, recipe), /可见边界/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => renderEditorRecipe(texture(), recipe, { signal: controller.signal }),
    /abort/i,
  );
  const big: RGBAImage = {
    width: 300,
    height: 300,
    data: new Uint8ClampedArray(300 * 300 * 4).fill(255),
  };
  recipe.healing[0]!.mask = { ...mask, radiusX: 0.4, radiusY: 0.4 };
  assert.throws(() => renderEditorRecipe(big, recipe), /32768/);
});
