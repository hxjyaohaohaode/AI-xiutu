import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdjustmentRegionV3, createRecipeV4, setEditorParameter } from '@ai-xiutu/editor';
import {
  applyOperation,
  inverseOnLatest,
  mergeOwnDraft,
  operationBetween,
  operationTarget,
  same,
} from '../src/collaboration/model.ts';

test('JSONB key ordering does not manufacture a whole-document change; array order is preserved', () => {
  const base = createRecipeV4();
  const reorder = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, item]) => [key, reorder(item)]),
          )
        : value;
  const persisted = reorder(base) as typeof base;
  assert.equal(same(persisted, base), true);
  assert.equal(operationBetween(persisted, base), null);
  assert.equal(
    operationBetween(persisted, setEditorParameter(base, 'adjustments.exposure', -0.4))?.type,
    'set-parameter',
  );
  assert.equal(same([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'a' }]), false);
  assert.equal(same({ a: undefined }, {}), false);
});

test('a single registered parameter or curve gets its exact lease scope; geometry and structure need document ownership', () => {
  const base = createRecipeV4(),
    next = setEditorParameter(base, 'adjustments.exposure', 0.25);
  assert.deepEqual(operationBetween(base, next), {
    type: 'set-parameter',
    path: 'adjustments.exposure',
    value: 0.25,
  });
  assert.deepEqual(operationTarget(operationBetween(base, next)!), {
    kind: 'parameter',
    id: 'adjustments.exposure',
  });
  const curve = createRecipeV4({
    curves: {
      ...base.curves,
      red: [
        [0, 0],
        [0.3, 0.2],
        [1, 1],
      ],
    },
  });
  assert.equal(operationBetween(base, curve)?.type, 'set-curve');
  assert.equal(
    operationBetween(base, createRecipeV4({ projective: { ...base.projective, enabled: true } }))
      ?.type,
    'replace-recipe',
  );
  assert.equal(
    operationBetween(
      base,
      createRecipeV4({ regionEdits: [createAdjustmentRegionV3({ id: 'face' })] }),
    )?.type,
    'replace-recipe',
  );
  assert.equal(operationBetween(base, base), null);
});

test('non-conflicting current targets rebase while preserving teammates and all V4 fields', () => {
  const base = createRecipeV4(),
    local = setEditorParameter(base, 'adjustments.exposure', -1.25),
    latest = setEditorParameter(base, 'adjustments.saturation', 40);
  const result = mergeOwnDraft(base, local, latest);
  assert.equal(result.adjustments.exposure, -1.25);
  assert.equal(result.adjustments.saturation, 40);
  assert.equal(result.schemaVersion, 4);
  assert.deepEqual(result, applyOperation(latest, operationBetween(base, local)!));
  assert.throws(
    () => mergeOwnDraft(base, local, setEditorParameter(latest, 'adjustments.exposure', 0.5)),
    /同一编辑对象/,
  );
  assert.throws(
    () =>
      mergeOwnDraft(base, local, createRecipeV4({ geometry: { ...base.geometry, flipX: true } })),
    /构图|画幅/,
  );
});

test('a region edit excludes siblings; membership/order/size changes demand document scope', () => {
  const a = createAdjustmentRegionV3({ id: 'a' }),
    b = createAdjustmentRegionV3({ id: 'b' });
  const base = createRecipeV4({ regionEdits: [a, b] });
  const next = createRecipeV4({ regionEdits: [{ ...a, opacity: 0.25 }, b] });
  const operation = operationBetween(base, next)!;
  assert.deepEqual(operationTarget(operation), {
    kind: 'region',
    collection: 'regionEdits',
    id: 'a',
  });
  const latest = createRecipeV4({ regionEdits: [a, { ...b, opacity: 0.5 }] });
  const merged = mergeOwnDraft(base, next, latest);
  assert.equal(merged.schemaVersion === 4 && merged.regionEdits[1]!.opacity, 0.5);
  assert.equal(
    operationBetween(base, createRecipeV4({ regionEdits: [b, a] }))?.type,
    'replace-recipe',
  );
});

test('owned undo keeps newer unrelated changes and refuses to erase another edit of the same target', () => {
  const base = createRecipeV4(),
    own = setEditorParameter(base, 'adjustments.exposure', 0.5),
    later = setEditorParameter(own, 'adjustments.contrast', 20);
  const undone = inverseOnLatest(base, own, later);
  assert.equal(undone.adjustments.exposure, 0);
  assert.equal(undone.adjustments.contrast, 20);
  assert.throws(
    () => inverseOnLatest(base, own, setEditorParameter(later, 'adjustments.exposure', 1)),
    /队员/,
  );
  const geometry = createRecipeV4({ geometry: { ...base.geometry, flipY: true } });
  assert.deepEqual(inverseOnLatest(base, geometry, geometry), base);
  assert.throws(
    () => inverseOnLatest(base, geometry, setEditorParameter(geometry, 'adjustments.exposure', 1)),
    /队员/,
  );
});
