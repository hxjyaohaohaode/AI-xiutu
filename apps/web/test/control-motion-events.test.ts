import assert from 'node:assert/strict';
import test from 'node:test';
import { Children, createElement, isValidElement, type ReactNode, type ReactElement } from 'react';
import { PrecisionRange } from '../src/editor/PrecisionRange.tsx';
import { SquishSwitch } from '../src/components/control-motion/SquishSwitch.tsx';
import { RubberSegment } from '../src/components/control-motion/RubberSegment.tsx';
import { renderTestMarkup } from './support/render.ts';

type Props = Record<string, any>;
function children(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) =>
    isValidElement<Props>(child) ? [child, ...children(child.props.children)] : [],
  );
}
function capture(render: () => ReactNode, match: (props: Props) => boolean) {
  let result: Props | undefined;
  function Capture() {
    const tree = render();
    result = children(tree).find((child) => match(child.props))?.props;
    return tree;
  }
  renderTestMarkup(createElement(Capture));
  assert.ok(result);
  return result;
}
function input() {
  const captures = new Set<number>();
  const currentTarget = {
    style: { setProperty() {}, removeProperty() {} },
    setPointerCapture(id: number) {
      captures.add(id);
    },
    hasPointerCapture(id: number) {
      return captures.has(id);
    },
    releasePointerCapture(id: number) {
      captures.delete(id);
    },
  };
  return (id: number, x: number, extra: Props = {}) => ({
    pointerId: id,
    clientX: x,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    shiftKey: false,
    altKey: false,
    currentTarget,
    preventDefault() {},
    stopPropagation() {},
    ...extra,
  });
}

test('the actual numeric scrub owns one pointer and Escape cannot be followed by a late commit', () => {
  let value = 10,
    commits = 0,
    cancels = 0;
  const button = capture(
    () =>
      PrecisionRange({
        label: '曝光',
        value: 10,
        min: 0,
        max: 100,
        step: 1,
        onChange: (next) => {
          value = next;
        },
        onCommit: () => commits++,
        onCancel: () => cancels++,
      }),
    (props) => props.className === 'precision-value',
  );
  const event = input();
  button.onPointerDown(event(1, 10));
  button.onPointerMove(event(1, 12));
  assert.equal(value, 10, 'a click-sized motion still opens precise entry');
  button.onPointerMove(event(1, 18));
  assert.equal(value, 14);
  button.onPointerDown(event(2, 30));
  button.onPointerMove(event(2, 90));
  button.onPointerCancel(event(2, 90));
  assert.equal(value, 14, 'a foreign pointer cannot cancel the preview');
  button.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(value, 10);
  assert.equal(cancels, 1);
  button.onPointerUp(event(1, 18));
  assert.equal(commits, 0, 'late release cannot recommit a cancelled preview');
});

test('the actual touch scrub keeps its threshold, exact bounds and single release commit', () => {
  let value = 98,
    commits = 0;
  const button = capture(
    () =>
      PrecisionRange({
        label: '强度',
        value: 98,
        min: 0,
        max: 100,
        step: 1,
        onChange: (next) => {
          value = next;
        },
        onCommit: () => commits++,
      }),
    (props) => props.className === 'precision-value',
  );
  const pointer = input();
  button.onPointerDown(pointer(4, 0, { pointerType: 'touch' }));
  button.onPointerMove(pointer(4, 7, { pointerType: 'touch' }));
  assert.equal(value, 98);
  button.onPointerMove(pointer(4, 80, { pointerType: 'touch' }));
  assert.equal(value, 100, 'visual resistance never writes an out-of-range value');
  button.onPointerUp(pointer(4, 80, { pointerType: 'touch' }));
  button.onLostPointerCapture(pointer(4, 80, { pointerType: 'touch' }));
  button.onPointerUp(pointer(4, 80, { pointerType: 'touch' }));
  assert.equal(commits, 1);
});

test('changing scrub sensitivity preserves the current precise value and the original cancel transaction', () => {
  for (const finish of ['release', 'cancel'] as const) {
    let value = 1.234, commits = 0, cancels = 0;
    const writes: number[] = [];
    const button = capture(() => PrecisionRange({
      label: '曝光', value, min: -100, max: 100, step: 0.1,
      onChange: (next) => { value = next; writes.push(next); },
      onCommit: () => commits++, onCancel: () => cancels++,
    }), (props) => props.className === 'precision-value');
    const event = input();
    button.onPointerDown(event(1, 0));
    button.onPointerMove(event(1, 20));
    assert.equal(value, 2.234);
    button.onPointerMove(event(1, 22, { altKey: true }));
    assert.deepEqual(writes, [2.234], 'changing sensitivity alone never rewrites the value');
    button.onPointerMove(event(1, 24, { altKey: true }));
    assert.equal(value, 2.244, 'future movement uses the fine increment from the precise current value');
    button.onPointerMove(event(1, 26, { shiftKey: true }));
    assert.equal(value, 2.244);
    button.onPointerMove(event(1, 28, { shiftKey: true }));
    assert.equal(value, 3.244);
    if (finish === 'cancel') {
      button.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
      assert.equal(value, 1.234, 'modifier rebasing never replaces the original transaction baseline');
    }
    button.onPointerUp(event(1, 28));
    button.onLostPointerCapture(event(1, 28));
    assert.equal(commits, finish === 'release' ? 1 : 0);
    assert.equal(cancels, finish === 'cancel' ? 1 : 0);
  }
});

test('the actual boolean switch previews a drag, ignores a foreign cancellation, and commits once', () => {
  const writes: boolean[] = [];
  const button = capture(
    () =>
      SquishSwitch({
        checked: false,
        label: '蒙版',
        onCheckedChange: (value) => writes.push(value),
      }),
    (props) => props.role === 'switch',
  );
  const event = input();
  button.onPointerDown(event(1, 0));
  button.onPointerMove(event(1, 20));
  assert.deepEqual(writes, [], 'visual preview is not a business mutation');
  button.onPointerDown(event(2, 0));
  button.onPointerCancel(event(2, 0));
  button.onPointerUp(event(1, 20));
  button.onClick({ detail: 1 });
  assert.deepEqual(writes, [true], 'the synthetic click after dragging does not toggle twice');
});

test('cancelling the actual switch restores its controlled choice and does not swallow keyboard activation', () => {
  const writes: boolean[] = [];
  const button = capture(
    () =>
      SquishSwitch({
        checked: false,
        label: '蒙版',
        onCheckedChange: (value) => writes.push(value),
      }),
    (props) => props.role === 'switch',
  );
  const event = input();
  button.onPointerDown(event(1, 0));
  button.onPointerMove(event(1, 20));
  button.onPointerCancel(event(1, 20));
  button.onPointerUp(event(1, 20));
  assert.deepEqual(writes, []);
  button.onClick({ detail: 0 });
  assert.deepEqual(writes, [true]);
});

test('Escape cancels a segment gesture before it can reach the workspace close handler', () => {
  const previousElement = Object.getOwnPropertyDescriptor(globalThis, 'Element');
  Object.defineProperty(globalThis, 'Element', { value: class {}, configurable: true });
  try {
    const writes: string[] = [];
    const segment = capture(
      () =>
        RubberSegment({
          value: 'first',
          onChange: (value) => writes.push(value),
          label: '分类',
          options: [
            { value: 'first', label: '第一项' },
            { value: 'second', label: '第二项' },
          ],
        }),
      (props) => props.role === 'group',
    );
    const pointer = input();
    segment.onPointerDown(pointer(7, 10));
    let prevented = false;
    let stopped = false;
    segment.onKeyDown({
      key: 'Escape',
      preventDefault() { prevented = true; },
      stopPropagation() { stopped = true; },
    });
    assert.equal(prevented, true);
    assert.equal(stopped, true, 'a cancelled segment must not close the enclosing inspector/AI');
    segment.onPointerUp(pointer(7, 70));
    assert.deepEqual(writes, [], 'late release cannot select after cancellation');
  } finally {
    if (previousElement) Object.defineProperty(globalThis, 'Element', previousElement);
    else Reflect.deleteProperty(globalThis, 'Element');
  }
});
