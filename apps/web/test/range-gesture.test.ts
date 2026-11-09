import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RangeGesture } from '../src/editor/range-gesture.ts';

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
