import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createRecipeV3,
  createColorBlockV3,
  createAdjustmentRegionV3,
  parseSelectionMaskV3,
} from '@ai-xiutu/editor';
import {
  NUMERIC_CONTROLS,
  withNumeric,
  numericAt,
  scopeColor,
  withScopeColor,
  checkedRecipe,
  newMask,
} from '../src/editor/advanced-model.ts';

test('editing one region or group retains every other color block, mask, composition and version', () => {
  const base = createRecipeV3({
    regionEdits: [
      createAdjustmentRegionV3({ id: 'first', name: '人物一', groupId: 'set' }),
      createAdjustmentRegionV3({ id: 'second', name: '人物二' }),
    ],
    regionGroups: [
      { id: 'set', name: '共同范围', enabled: true, opacity: 1, color: createColorBlockV3() },
    ],
    imageLayers: [
      {
        id: 'layer',
        name: '参考',
        enabled: true,
        opacity: 0.5,
        blendMode: 'screen',
        sourceId: 'ref',
        x: 0.2,
        y: 0.1,
        width: 0.5,
        height: 0.7,
        rotationDegrees: 3.75,
        flipX: false,
        flipY: true,
        mask: null,
      },
    ],
  });
  const curve = {
    ...scopeColor(base, { kind: 'region', id: 'first' }),
    curves: {
      ...base.curves,
      red: [
        [0, 0.2],
        [0.5, 0.8],
        [1, 0.9],
      ] as [number, number][],
    },
  };
  const local = checkedRecipe(withScopeColor(base, { kind: 'region', id: 'first' }, curve), {
    width: 913,
    height: 687,
  });
  assert.deepEqual(local.regionEdits[0]!.color.curves.red, curve.curves.red);
  assert.deepEqual(local.regionEdits[1], base.regionEdits[1]);
  assert.deepEqual(local.imageLayers, base.imageLayers);
  assert.deepEqual(local.curves, base.curves);
  const group = scopeColor(local, { kind: 'group', id: 'set' });
  const adjusted = withScopeColor(
    local,
    { kind: 'group', id: 'set' },
    { ...group, adjustments: { ...group.adjustments, exposure: -0.75 } },
  );
  assert.equal(adjusted.regionGroups[0]!.color.adjustments.exposure, -0.75);
  assert.deepEqual(adjusted.regionEdits, local.regionEdits);
  assert.equal(base.regionGroups[0]!.color.adjustments.exposure, 0);
  assert.throws(() => withScopeColor(base, { kind: 'region', id: 'deleted' }, curve), /不存在/);
});

test('numeric controls require registry identity and preserve independent fields', () => {
  const source = createColorBlockV3(),
    exposure = NUMERIC_CONTROLS.find((tool) => tool.path === 'adjustments.exposure')!;
  const next = withNumeric(source, exposure, -0.01);
  assert.equal(numericAt(next, exposure.path), -0.01);
  assert.equal(source.adjustments.exposure, 0);
  assert.deepEqual(source.optics, next.optics);
  assert.throws(() => withNumeric(source, { ...exposure }, 0), /注册/);
  assert.throws(() => withNumeric(source, exposure, Number.NaN), /注册/);
  assert.throws(() => withNumeric(source, exposure, exposure.max + 1), /注册/);
  assert.throws(() => withNumeric(source, { ...exposure, path: '__proto__.polluted' }, 1), /注册/);
});

test('singular or excessive transformations are rejected before preview reaches React or the renderer', () => {
  const source = createRecipeV3();
  assert.throws(
    () =>
      checkedRecipe(
        { ...source, transform: { ...source.transform, skewX: 45, skewY: 45 } },
        { width: 400, height: 300 },
      ),
    /singular/,
  );
  assert.throws(
    () =>
      checkedRecipe(
        { ...source, transform: { ...source.transform, scaleX: 4, scaleY: 4 } },
        { width: 2000, height: 2000 },
      ),
    /预算|budget|pixel|dimension/i,
  );
  const free = checkedRecipe(
    { ...source, transform: { ...source.transform, rotationDegrees: 1.01, perspectiveX: -3.02 } },
    { width: 913, height: 687 },
  );
  assert.equal(free.transform.rotationDegrees, 1.01);
  assert.equal(free.transform.perspectiveX, -3.02);
});

test('all interactive mask creation kinds start from valid editable geometry', () => {
  for (const type of ['radial', 'linear', 'polygon', 'brush', 'color-range'] as const) {
    const mask = newMask(type);
    assert.deepEqual(parseSelectionMaskV3(mask), mask);
  }
  const continuous = newMask('color-range');
  assert.equal(continuous.type, 'color-range');
  const shape = {
    type: 'compound',
    operation: 'subtract',
    masks: [newMask('radial'), newMask('brush')],
    invert: false,
  };
  assert.deepEqual(parseSelectionMaskV3(shape), shape);
});
