import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeV3, createAdjustmentRegionV3 } from '@ai-xiutu/editor';
import { collaborationCommandSchema } from '@ai-xiutu/contracts';
import {
  applyCollaborationOperation,
  assertRebasable,
  maskBounds,
  targetsConflict,
  targetBounds,
} from '../src/collaboration-operations.js';
import { csvCell } from '../src/usage.js';

test('authoritative granular replay preserves disjoint edits and rejects overwritten targets', () => {
  const base = createRecipeV3();
  const current = applyCollaborationOperation(base, {
    type: 'set-parameter',
    path: 'adjustments.exposure',
    value: 1,
  });
  const own = { type: 'set-parameter' as const, path: 'adjustments.contrast', value: -30 };
  assert.doesNotThrow(() => assertRebasable(base, current, own));
  const combined = applyCollaborationOperation(current, own);
  assert.equal(combined.adjustments.exposure, 1);
  assert.equal(combined.adjustments.contrast, -30);
  assert.equal(base.adjustments.exposure, 0);
  assert.throws(
    () => assertRebasable(base, current, { ...own, path: 'adjustments.exposure' }),
    /已有更新/,
  );
  assert.throws(
    () => assertRebasable(base, current, { type: 'replace-recipe', recipe: base }),
    /已有更新/,
  );
  assert.throws(() => applyCollaborationOperation(base, { ...own, path: '__proto__.polluted' }));
  assert.throws(() =>
    applyCollaborationOperation(base, { ...own, path: 'adjustments.exposure', value: 1000 }),
  );
});
test('spatial lease bounds are conservative and protect mask growth and inverse/global masks', () => {
  const left = createAdjustmentRegionV3({
    id: 'left',
    mask: {
      type: 'radial',
      centerX: 0.2,
      centerY: 0.5,
      radiusX: 0.15,
      radiusY: 0.2,
      feather: 1,
      invert: false,
    },
  });
  const right = createAdjustmentRegionV3({
    id: 'right',
    mask: {
      type: 'radial',
      centerX: 0.8,
      centerY: 0.5,
      radiusX: 0.15,
      radiusY: 0.2,
      feather: 0,
      invert: false,
    },
  });
  const recipe = createRecipeV3({ regionEdits: [left, right] });
  const a = { kind: 'region' as const, collection: 'regionEdits' as const, id: 'left' },
    b = { ...a, id: 'right' };
  assert.equal(
    targetsConflict(a, targetBounds(recipe, a, 100, 200), b, targetBounds(recipe, b, 100, 200)),
    false,
  );
  assert.equal(
    targetsConflict(a, { x: 0, y: 0, width: 1, height: 1 }, b, targetBounds(recipe, b, 100, 200)),
    true,
  );
  assert.deepEqual(maskBounds({ ...left.mask, invert: true }, 100, 200), {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
  });
  assert.equal(targetsConflict({ kind: 'document' }, null, b, null), true);
  assert.equal(
    targetsConflict(
      { kind: 'parameter', id: 'adjustments.exposure' },
      null,
      { kind: 'parameter', id: 'adjustments.exposure' },
      null,
    ),
    true,
  );
  assert.equal(
    targetsConflict(
      { kind: 'parameter', id: 'adjustments.exposure' },
      null,
      { kind: 'parameter', id: 'adjustments.contrast' },
      null,
    ),
    false,
  );
  assert.throws(
    () =>
      applyCollaborationOperation(recipe, {
        type: 'replace-node',
        collection: 'regionEdits',
        id: 'left',
        value: { ...left, id: 'right' },
      }),
    /标识/,
  );
  assert.throws(
    () =>
      applyCollaborationOperation(recipe, {
        type: 'replace-node',
        collection: 'regionEdits',
        id: 'left',
        value: { ...left, groupId: 'new-group' },
      }),
    /分组关系/,
  );
});
test('fencing and curve schemas reject unsafe numeric cursors and arbitrary command keys; CSV escapes formulas', () => {
  const valid = {
    protocolVersion: 1,
    idempotencyKey: 'd84bc8fa-e352-4ecb-9a6a-05b060fe56e1',
    sessionId: '72ff8096-b7a0-4082-99cc-ad1d4917dac1',
    leaseId: '813c4820-e010-4381-98aa-362f1bc8d8cf',
    fence: '9007199254740993',
    baseVersion: 1,
    operation: {
      type: 'set-curve',
      channel: 'rgb',
      points: [
        [0, 0],
        [0.4, 0.2],
        [1, 1],
      ],
    },
  };
  assert.equal(collaborationCommandSchema.parse(valid).fence, valid.fence);
  assert.equal(
    collaborationCommandSchema.safeParse({ ...valid, fence: Number(valid.fence) }).success,
    false,
  );
  assert.equal(collaborationCommandSchema.safeParse({ ...valid, bypass: true }).success, false);
  const curveCommand = (count: number) => ({
    ...valid,
    operation: {
      ...valid.operation,
      points: Array.from({ length: count }, (_, i) => [i / (count - 1), i / (count - 1)]),
    },
  });
  assert.equal(collaborationCommandSchema.safeParse(curveCommand(16)).success, true);
  assert.equal(collaborationCommandSchema.safeParse(curveCommand(17)).success, false);
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell(' \t+SUM(A1)'), '"\' \t+SUM(A1)"');
  assert.equal(csvCell('ordinary,"label"'), '"ordinary,""label"""');
});
