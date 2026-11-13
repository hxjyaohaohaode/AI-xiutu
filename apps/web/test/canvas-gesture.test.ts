import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileSelectionMaskV3, createRecipeV3 } from '@ai-xiutu/editor';
import { bodyStretchGuard, moveBodyStretchBoundary } from '../src/editor/BodyStretchGuides.tsx';
import { CanvasPointerOwnership, ownedCanvasRollback } from '../src/editor/canvas-gesture.ts';

test('a body stretch band protects pixels outside its displayed boundaries', () => {
  const initial = { top: 0.38, bottom: 0.72 };
  const range = moveBodyStretchBoundary(initial, 'top', 0.284);
  assert.deepEqual(range, { top: 0.284, bottom: 0.72 });
  assert.equal(moveBodyStretchBoundary(range, 'top', 0.9).top, range.bottom - 0.04);
  assert.equal(moveBodyStretchBoundary(range, 'bottom', 0).bottom, range.top + 0.04);
  assert.equal(moveBodyStretchBoundary(range, 'bottom', Number.NaN), range);
  for (const dimensions of [{ width: 400, height: 600 }, { width: 600, height: 400 }]) {
    const protection = compileSelectionMaskV3(bodyStretchGuard(range), dimensions);
    assert.equal(protection(0.5, range.top - 0.01), 1);
    assert.equal(protection(0.5, range.bottom + 0.01), 1);
    assert.equal(protection(0.02, 0.5), 0);
    assert.equal(protection(0.98, 0.5), 0);
    assert.ok(protection(0.5, range.top + 0.01) > 0);
    assert.ok(protection(0.5, range.top + 0.01) < 1);
  }
});

test('second contact cancels a drawing transaction once and suppresses both pointers until released', () => {
  for (const releaseOrder of [
    [11, 22],
    [22, 11],
  ]) {
    const ownership = new CanvasPointerOwnership();
    assert.equal(ownership.down(11, null), 'allow');
    assert.equal(ownership.canStart(11), true);
    assert.equal(ownership.down(22, 11), 'cancel-edit');
    assert.equal(ownership.blocked, true);
    assert.equal(ownership.canStart(11), false);
    assert.equal(ownership.canStart(22), false);
    // The cancelled transaction no longer owns an edit pointer. A repeated
    // event must still be consumed rather than becoming zoom/pan or a new pen.
    assert.equal(ownership.down(22, null), 'block');
    assert.equal(ownership.up(releaseOrder[0]!), true);
    assert.equal(ownership.blocked, true);
    assert.equal(ownership.up(releaseOrder[1]!), true);
    assert.equal(ownership.blocked, false);
    assert.equal(ownership.up(11), false);
    assert.equal(ownership.down(33, null), 'allow');
    assert.equal(ownership.canStart(33), true);
  }
});

test('third contact and unrelated releases cannot unlock the suppressed transaction early', () => {
  const ownership = new CanvasPointerOwnership();
  ownership.down(1, null);
  ownership.down(2, 1);
  assert.equal(ownership.down(3, null), 'block');
  assert.equal(ownership.up(99), true);
  assert.equal(ownership.up(1), true);
  assert.equal(ownership.up(2), true);
  assert.equal(ownership.blocked, true);
  assert.equal(ownership.canStart(3), false);
  assert.equal(ownership.up(3), true);
  assert.equal(ownership.blocked, false);
});

test('duplicate down by the owned pointer is blocked without cancelling the valid stroke', () => {
  const ownership = new CanvasPointerOwnership();
  ownership.down(7, null);
  assert.equal(ownership.down(7, 7), 'block');
  assert.equal(ownership.blocked, false);
  assert.equal(ownership.canStart(7), true);
  assert.equal(ownership.up(7), false);
});

test('normal two-finger navigation remains possible but a new edit cannot join the gesture', () => {
  const ownership = new CanvasPointerOwnership();
  assert.equal(ownership.down(4, null), 'allow');
  assert.equal(ownership.down(5, null), 'allow');
  assert.equal(ownership.blocked, false);
  assert.equal(ownership.canStart(5), false);
  assert.equal(ownership.canStart(4), false);
  ownership.up(5);
  assert.equal(ownership.canStart(5), false);
  ownership.up(4);
  assert.equal(ownership.down(6, null), 'allow');
  assert.equal(ownership.canStart(6), true);
});

test('blur/source reset discards obsolete contacts without leaving the next gesture disabled', () => {
  const ownership = new CanvasPointerOwnership();
  ownership.down(1, null);
  ownership.down(2, 1);
  ownership.reset();
  assert.equal(ownership.blocked, false);
  assert.equal(ownership.canStart(1), false);
  assert.equal(ownership.up(2), false);
  assert.equal(ownership.down(8, null), 'allow');
  assert.equal(ownership.canStart(8), true);
});

test('rollback uses the original pre-stroke recipe and never removes a newer edit or source', () => {
  const original = createRecipeV3();
  const withNewLayer = createRecipeV3();
  const visibleStroke = createRecipeV3();
  visibleStroke.adjustments.exposure = 0.2;
  const newerControl = structuredClone(visibleStroke);
  newerControl.adjustments.exposure = 0.3;
  const state = {
    identity: 17,
    base: withNewLayer,
    rollback: original,
    lastPreview: visibleStroke,
  };
  assert.equal(ownedCanvasRollback(state, 17, visibleStroke), original);
  assert.equal(ownedCanvasRollback(state, 18, visibleStroke), null);
  assert.equal(ownedCanvasRollback(state, 17, newerControl), null);
  assert.equal(ownedCanvasRollback(state, 17, structuredClone(visibleStroke)), null);
  const ordinary = { identity: 17, base: original, lastPreview: visibleStroke };
  assert.equal(ownedCanvasRollback(ordinary, 17, visibleStroke), original);
  assert.equal(newerControl.adjustments.exposure, 0.3);
});
