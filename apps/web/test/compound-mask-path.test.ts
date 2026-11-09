import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSelectionMaskV3, type SelectionMaskV3 } from '@ai-xiutu/editor';
import { maskAtPath, replaceMaskAtPath } from '../src/editor/precision.ts';
import { newMask } from '../src/editor/advanced-model.ts';

function composed(): SelectionMaskV3 {
  return {
    type: 'compound',
    operation: 'subtract',
    invert: false,
    masks: [
      newMask('radial'),
      {
        type: 'compound',
        operation: 'union',
        invert: true,
        masks: [newMask('brush'), newMask('color-range')],
      },
    ],
  };
}

test('editing a nested region preserves siblings and independently edited latest data', () => {
  const original = composed();
  const brush = maskAtPath(original, [1, 0]);
  assert.equal(brush.type, 'brush');
  const brushed = replaceMaskAtPath(original, [1, 0], {
    type: 'brush',
    invert: false,
    strokes: [
      {
        mode: 'add',
        radius: 0.02,
        feather: 0.35,
        opacity: 0.7,
        points: [
          { x: 0.1, y: 0.3 },
          { x: 0.15, y: 0.4 },
        ],
      },
    ],
  });
  const originalColor = maskAtPath(brushed, [1, 1]);
  assert.equal(originalColor.type, 'color-range');
  const edited = replaceMaskAtPath(brushed, [1, 1], {
    ...originalColor,
    hue: 219.37,
  } as SelectionMaskV3);
  assert.deepEqual(parseSelectionMaskV3(edited), edited);
  assert.equal(maskAtPath(edited, [0]), maskAtPath(original, [0]));
  assert.equal(maskAtPath(edited, [1, 0]), maskAtPath(brushed, [1, 0]));
  assert.notDeepEqual(maskAtPath(edited, [1, 1]), maskAtPath(original, [1, 1]));
  assert.equal(maskAtPath(original, [1, 0]), brush);
});

test('stale nested paths cannot write into a sibling or silently replace the parent', () => {
  const original = composed();
  const snapshot = structuredClone(original);
  for (const path of [[4], [1, 9], [0, 0], [-1], [1, 0.5]])
    assert.throws(() => replaceMaskAtPath(original, path, newMask('linear')), /选区结构已改变/);
  assert.deepEqual(original, snapshot);
  assert.equal(maskAtPath(original, [9]), original);
  assert.equal(maskAtPath(original, [1, 9]), maskAtPath(original, [1]));
});
