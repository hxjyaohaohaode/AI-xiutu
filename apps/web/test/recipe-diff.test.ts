import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRecipe,
  createRecipeV2,
  createAdjustmentRegionV2,
  parseEditorRecipe,
} from '@ai-xiutu/editor';
import { additionalRecipeChanges, recipeDifferences } from '../src/ai/recipeDiff.ts';
test('v2 AI confirmation includes advanced changes alongside legacy exposure', () => {
  const before = createRecipeV2(),
    after = createRecipeV2();
  after.adjustments.exposure = 0.4;
  after.levels.gamma = 1.18;
  after.hsl.red.hue = 5;
  const changes = recipeDifferences(before, after);
  assert.equal(changes.length, 3);
  assert.deepEqual(changes.map((item) => item.path).sort(), [
    'adjustments.exposure',
    'hsl.red.hue',
    'levels.gamma',
  ]);
  assert.equal(changes.find((item) => item.path === 'levels.gamma')?.before, 1);
  assert.equal(changes.find((item) => item.path === 'hsl.red.hue')?.after, 5);
});
test('equal JSONB-style reordered recipes do not create false numeric changes', () => {
  const before = createRecipeV2();
  const after = parseEditorRecipe(Object.fromEntries(Object.entries(before).reverse()));
  assert.deepEqual(recipeDifferences(before, after), []);
});
test('legacy candidates remain legacy and non-numeric replacements are explicitly named', () => {
  const before = createRecipe(),
    after = createRecipe();
  after.adjustments.contrast = 8;
  assert.deepEqual(
    recipeDifferences(before, after).map((item) => item.path),
    ['adjustments.contrast'],
  );
  const first = createRecipeV2(),
    second = createRecipeV2();
  second.geometry.rotation = 90;
  second.regions = [createAdjustmentRegionV2({ id: 'one', name: '一区' })];
  assert.deepEqual(additionalRecipeChanges(first, second), ['构图', '独立选区与蒙版']);
  assert.equal(before.schemaVersion, 1);
  assert.equal(after.schemaVersion, 1);
});
