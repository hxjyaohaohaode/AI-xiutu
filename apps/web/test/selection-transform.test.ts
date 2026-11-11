import assert from 'node:assert/strict';
import test from 'node:test';
import { compileSelectionMaskV3, parseSelectionMaskV3, type Dimensions } from '@ai-xiutu/editor';
import {
  polygonCenter,
  polygonRotationDelta,
  rotatePolygon,
  translatePolygon,
  type PolygonSelection,
} from '../src/editor/selection-transform.ts';

const dimensions: Dimensions = { width: 1800, height: 900 };
const selection: PolygonSelection = {
  type: 'polygon',
  points: [
    { x: 0.4, y: 0.3 },
    { x: 0.6, y: 0.3 },
    { x: 0.6, y: 0.7 },
    { x: 0.4, y: 0.7 },
  ],
  feather: 0.03,
  invert: false,
};
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot((a.x - b.x) * dimensions.width, (a.y - b.y) * dimensions.height);

test('rotating an actual non-square source preserves physical distances, center and mask semantics', () => {
  const before = structuredClone(selection);
  const rotated = rotatePolygon(selection, 37.25, dimensions)!;
  assert.ok(rotated);
  assert.doesNotThrow(() => parseSelectionMaskV3(rotated));
  for (let i = 0; i < selection.points.length; i++)
    for (let j = i + 1; j < selection.points.length; j++) {
      assert.ok(
        Math.abs(
          distance(selection.points[i]!, selection.points[j]!) -
            distance(rotated.points[i]!, rotated.points[j]!),
        ) < 1e-8,
      );
    }
  assert.ok(Math.abs(polygonCenter(rotated.points).x - 0.5) < 1e-12);
  assert.ok(Math.abs(polygonCenter(rotated.points).y - 0.5) < 1e-12);
  assert.equal(rotated.feather, selection.feather);
  assert.equal(rotated.invert, selection.invert);
  assert.deepEqual(selection, before);
  const restored = rotatePolygon(rotated, -37.25, dimensions)!;
  restored.points.forEach((point, index) =>
    assert.ok(distance(point, selection.points[index]!) < 1e-8),
  );
});

test('a quarter-turn of a pixel-square selection replays through the real mask sampler without distortion', () => {
  const original = compileSelectionMaskV3(selection, dimensions);
  const rotated = compileSelectionMaskV3(rotatePolygon(selection, 90, dimensions)!, dimensions);
  for (let y = 0.1; y < 0.9; y += 0.05)
    for (let x = 0.3; x < 0.7; x += 0.025) {
      assert.ok(Math.abs(original(x, y) - rotated(x, y)) < 1e-7, `mask changed at ${x},${y}`);
    }
});

test('whole-selection movement stops at source boundaries without crushing vertices', () => {
  const moved = translatePolygon(selection, 10, -10);
  assert.equal(Math.max(...moved.points.map((p) => p.x)), 1);
  assert.equal(Math.min(...moved.points.map((p) => p.y)), 0);
  for (let i = 0; i < selection.points.length; i++) {
    assert.ok(
      Math.abs(
        distance(selection.points[i]!, selection.points[(i + 1) % 4]!) -
          distance(moved.points[i]!, moved.points[(i + 1) % 4]!),
      ) < 1e-8,
    );
  }
  assert.deepEqual(translatePolygon(moved, 0, 0), moved);
  assert.equal(translatePolygon(moved, Infinity, 0), moved);
});

test('out-of-bounds rotations are rejected as one operation and pointer rotation uses source aspect', () => {
  const nearEdge = translatePolygon(selection, -0.4, 0);
  const frozen = structuredClone(nearEdge);
  assert.equal(rotatePolygon(nearEdge, 45, dimensions), null);
  assert.deepEqual(nearEdge, frozen);
  assert.equal(rotatePolygon(selection, 5, { width: Infinity, height: 1 }), null);
  assert.equal(rotatePolygon(selection, NaN, dimensions), null);
  assert.equal(
    polygonRotationDelta({ x: 0.6, y: 0.5 }, { x: 0.5, y: 0.7 }, { x: 0.5, y: 0.5 }, dimensions),
    90,
  );
});
