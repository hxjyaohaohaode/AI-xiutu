import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RangeGesture,
  keyRangeValue,
  pointerRangeValue,
  resolveRangeNumber,
} from '../src/editor/range-gesture.ts';

test('pointer and keyboard reach signed, neutral, and partial-step endpoints', () => {
  for (const [input, expected] of [
    [-1, -1],
    [-0.74, -0.75],
    [0, 0],
    [0.73, 0.75],
    [0.9, 0.92],
    [1, 0.92],
  ] as const) {
    assert.equal(pointerRangeValue(input, -1, 0.92, 0.25), expected);
  }
  assert.equal(keyRangeValue('ArrowRight', -0.375, -1, 0.92, 0.1), -0.275);
  assert.equal(keyRangeValue('ArrowLeft', 0, -1, 0.92, 0.00001), -0.00001);
  assert.equal(keyRangeValue('ArrowRight', 0, -1, 0.92, 0.00001), 0.00001);
  assert.equal(keyRangeValue('ArrowUp', 0.91, -1, 0.92, 0.1), 0.92);
  assert.equal(keyRangeValue('PageDown', 0.001, -1, 0.92, 0.01), -0.099);
  assert.equal(keyRangeValue('Home', 0.9, -1, 0.92, 0.25), -1);
  assert.equal(keyRangeValue('End', 0.9, -1, 0.92, 0.25), 0.92);
});

test('a secondary pointer cannot steal, finish or cancel the owned slider preview', () => {
  const gesture = new RangeGesture();
  assert.equal(gesture.beginPointer(4, -3), true);
  gesture.change(1.25);
  assert.equal(gesture.beginPointer(5, 1.25, false), false);
  assert.equal(gesture.endPointer(5), null);
  assert.equal(gesture.endPointer(5, true), null);
  assert.equal(gesture.beginKey('ArrowRight', 1.25), false);
  assert.deepEqual(gesture.endPointer(4, true), { action: 'cancel', initial: -3, changed: true });
  assert.equal(gesture.endPointer(4), null);
});

test('Escape cancellation cannot be followed by a late keyup commit', () => {
  const gesture = new RangeGesture();
  gesture.beginKey('ArrowRight', 0);
  gesture.change(0.01);
  gesture.beginKey('ArrowRight', 0.01);
  gesture.change(0.02);
  assert.deepEqual(gesture.cancel(), { action: 'cancel', initial: 0, changed: true });
  assert.equal(gesture.endKey('ArrowRight'), null);
  assert.equal(gesture.commit(), null);
  assert.equal(gesture.beginKey('ArrowLeft', 0), true);
  gesture.change(-0.01);
  assert.deepEqual(gesture.endKey('ArrowLeft'), { action: 'commit', initial: 0, changed: true });
});

test('keyboard chord commits once after its final key and ignores unrelated releases', () => {
  const gesture = new RangeGesture();
  assert.equal(gesture.beginKey('Enter', 2), false);
  gesture.beginKey('ArrowRight', 2);
  gesture.beginKey('ArrowUp', 2);
  gesture.change(2.1);
  assert.equal(gesture.endKey('ArrowLeft'), null);
  assert.equal(gesture.endKey('ArrowUp'), null);
  assert.deepEqual(gesture.endKey('ArrowRight'), { action: 'commit', initial: 2, changed: true });
  assert.equal(gesture.endKey('ArrowRight'), null);
});

test('neutral gestures create no changed result and source unmount discards ownership', () => {
  const gesture = new RangeGesture();
  gesture.beginPointer(1, 5);
  gesture.change(8);
  gesture.change(5);
  assert.deepEqual(gesture.endPointer(1), { action: 'commit', initial: 5, changed: false });
  gesture.beginPointer(2, 0);
  gesture.change(30);
  gesture.discard();
  assert.equal(gesture.cancel(), null);
  assert.equal(gesture.endPointer(2), null);
  assert.equal(gesture.beginPointer(3, -1), true);
  gesture.change(Number.NaN);
  assert.deepEqual(gesture.cancel(), { action: 'cancel', initial: -1, changed: false });
});

test('precision drafts cannot replace a newer value or write after a control loses permission', () => {
  const draft = { draft: '-0.375', initial: 0, current: 0, min: -8, max: 8 };
  assert.deepEqual(resolveRangeNumber(draft), { status: 'valid', value: -0.375 });
  assert.deepEqual(resolveRangeNumber({ ...draft, current: 1.25 }), { status: 'stale' });
  assert.deepEqual(resolveRangeNumber({ ...draft, disabled: true }), { status: 'disabled' });
  assert.deepEqual(resolveRangeNumber({ ...draft, current: 1.25, disabled: true }), {
    status: 'disabled',
  });
  assert.deepEqual(resolveRangeNumber({ ...draft, initial: 1.25, current: 1.25 }), {
    status: 'valid',
    value: -0.375,
  });
});

test('numeric precision preserves allowed substeps but rejects empty, non-finite and out-of-range values', () => {
  const bounds = { initial: 0, current: 0, min: -8, max: 8 };
  for (const draft of ['', ' ', 'NaN', 'Infinity', '-Infinity', '-8.01', '8.01', 'abc']) {
    assert.deepEqual(resolveRangeNumber({ ...bounds, draft }), { status: 'invalid' }, draft);
  }
  assert.deepEqual(resolveRangeNumber({ ...bounds, draft: '-8' }), { status: 'valid', value: -8 });
  assert.deepEqual(resolveRangeNumber({ ...bounds, draft: '8' }), { status: 'valid', value: 8 });
  assert.deepEqual(resolveRangeNumber({ ...bounds, draft: '0.001' }), {
    status: 'valid',
    value: 0.001,
  });
  assert.deepEqual(resolveRangeNumber({ ...bounds, draft: '0.001', integer: true }), {
    status: 'invalid',
  });
});
