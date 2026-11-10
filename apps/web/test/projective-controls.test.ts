import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRecipeV4,
  compileProjectiveTransformV4,
  getEditorOutputDimensions,
} from '@ai-xiutu/editor';
import {
  preProjectiveDimensions,
  projectiveDisplayPoint,
  projectivePointer,
  withProjectiveCorner,
} from '../src/editor/projective-model.ts';

test('pointer destination frame round-trips after contain expansion without inverse-content mapping', () => {
  const dims = { width: 1200, height: 800 },
    base = createRecipeV4();
  const recipe = withProjectiveCorner(base, 0, { x: -0.2, y: -0.1 }, dims),
    pre = preProjectiveDimensions(dims, recipe);
  const rect = { left: 81, top: 56, width: 720, height: 480 };
  for (const point of recipe.projective.corners) {
    const shown = projectiveDisplayPoint(point, pre, recipe);
    const restored = projectivePointer(
      { x: rect.left + shown.x * rect.width, y: rect.top + shown.y * rect.height },
      rect,
      pre,
      recipe,
    );
    assert.ok(Math.abs(point.x - restored.x) < 1e-10);
    assert.ok(Math.abs(point.y - restored.y) < 1e-10);
  }
});

test('one source-frame pixel and subpixel moves retain precision through crop and fine transform', () => {
  const dims = { width: 1601, height: 1003 };
  const recipe = createRecipeV4({
    geometry: { ...createRecipeV4().geometry, crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 } },
  });
  const frame = preProjectiveDimensions(dims, recipe);
  const next = withProjectiveCorner(recipe, 0, { x: 0.1 / frame.width, y: 1 / frame.height }, dims);
  assert.ok(Math.abs(next.projective.corners[0].x * frame.width - 0.1) < 1e-12);
  assert.equal(next.projective.corners[0].y * frame.height, 1);
  assert.deepEqual(next.geometry, recipe.geometry);
});

test('crossed, concave, non-finite, missing and excessive corners cannot enter preview', () => {
  const recipe = createRecipeV4(),
    dims = { width: 3000, height: 2000 };
  for (const point of [
    { x: 1.5, y: 1.5 },
    { x: Infinity, y: 0 },
    { x: NaN, y: 0 },
  ])
    assert.throws(() => withProjectiveCorner(recipe, 0, point, dims));
  assert.throws(() => withProjectiveCorner(recipe, 4, { x: 0, y: 0 }, dims));
  assert.throws(() => withProjectiveCorner(recipe, 0, { x: -1, y: -1 }, dims, 6_000_000), /预算/);
  assert.deepEqual(getEditorOutputDimensions(dims, recipe), dims);
  const result = compileProjectiveTransformV4(dims, recipe.projective);
  assert.equal(result.identity, true);
});
