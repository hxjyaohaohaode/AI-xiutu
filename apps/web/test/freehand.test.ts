import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeV4, renderEditorRecipe, renderEditorRecipeTiled } from '@ai-xiutu/editor';
import {
  appendFreehandPoints,
  pointerPathSamples,
  startFreehandPath,
} from '../src/editor/freehand.js';

const sample = (x: number, y: number, pointerId = 7) => ({ clientX: x, clientY: y, pointerId });
const dimensions = { width: 64, height: 64 };
const project = (point: ReturnType<typeof sample>) => ({
  x: point.clientX / 64,
  y: point.clientY / 64,
});

test('coalesced samples keep actual device order and exclude the summary and other pointers', () => {
  const curve = [sample(12, 20), sample(32, 44), sample(52, 20)];
  const event = {
    ...sample(32, 28),
    getCoalescedEvents() {
      assert.equal(this, event, 'native methods retain their receiver');
      return [curve[0]!, sample(90, 90, 9), curve[1]!, sample(NaN, 1), curve[2]!];
    },
  };
  assert.deepEqual(pointerPathSamples(event), curve);
  const frozen = Object.freeze([{ x: 10 / 64, y: 20 / 64 }]);
  const sampled = appendFreehandPoints(
    frozen,
    pointerPathSamples(event),
    project,
    dimensions,
    0.5,
    1024,
  );
  assert.deepEqual(sampled.points, [...frozen, ...curve.map(project)]);
  assert.equal(frozen.length, 1, 'an earlier preview must never acquire later points by mutation');
  assert.equal(sampled.changed, true);
  assert.equal(sampled.limitReached, false);
});

test('empty, unsupported or restricted coalescing falls back to the real event', () => {
  for (const event of [
    sample(4, 8),
    { ...sample(4, 8), getCoalescedEvents: () => [] },
    {
      ...sample(4, 8),
      getCoalescedEvents: () => {
        throw new Error('unsupported');
      },
    },
  ])
    assert.deepEqual(pointerPathSamples(event), [event]);
});

test('lifting retains a short terminal segment without duplicated alpha or oversized paths', () => {
  const previous = [project(sample(8, 8))];
  const motion = [sample(9, 8)];
  assert.equal(appendFreehandPoints(previous, motion, project, dimensions, 4, 4).changed, false);
  const final = appendFreehandPoints(previous, motion, project, dimensions, 4, 4, true);
  assert.deepEqual(final.points.at(-1), project(motion[0]!));
  const repeated = appendFreehandPoints(final.points, motion, project, dimensions, 4, 4, true);
  assert.equal(repeated.changed, false);
  const bounded = appendFreehandPoints(
    previous,
    [sample(20, 8), sample(30, 8), sample(40, 8)],
    project,
    dimensions,
    1,
    3,
    true,
  );
  assert.equal(bounded.points.length, 3);
  assert.equal(bounded.limitReached, true);
  assert.deepEqual(bounded.points.at(-1), project(sample(30, 8)));
  assert.equal(previous.length, 1);
});

test('zero-pressure contact and the last observed pressure survive thinning and lifting', () => {
  const first = { ...sample(12, 12), pressure: 0 };
  const path = startFreehandPath(first, true);
  const almost = appendFreehandPoints(
    [project(first)],
    [{ ...sample(12.3, 12.1), pressure: 0.004 }],
    project,
    dimensions,
    1,
    10,
    false,
    path,
  );
  assert.equal(almost.changed, false);
  assert.deepEqual(path.pressures, [0]);
  const lift = appendFreehandPoints(
    almost.points,
    [{ ...sample(12.4, 12.2), pressure: 0 }],
    project,
    dimensions,
    1,
    10,
    true,
    almost.path,
  );
  assert.deepEqual(lift.path?.pressures, [0, 0.004]);
});

test('native curve samples paint the bend instead of an invented chord, identically in export tiles', () => {
  const data = Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, i) => [20, 40, 60, 255][i % 4]!);
  const source = { ...dimensions, data };
  const original = new Uint8ClampedArray(data);
  const events = [sample(16.5, 16.5), sample(32.5, 44.5), sample(48.5, 16.5)];
  const points = appendFreehandPoints(
    [project(events[0]!)],
    events,
    project,
    dimensions,
    0.5,
    1024,
  ).points;
  const recipe = createRecipeV4({
    paintLayers: [
      {
        id: 'curve',
        name: 'curve',
        enabled: true,
        opacity: 1,
        blendMode: 'normal',
        mask: null,
        strokes: [
          {
            mode: 'paint',
            source: null,
            radius: 2 / 64,
            feather: 0,
            opacity: 0.5,
            color: [220, 40, 60, 255],
            points,
          },
        ],
      },
    ],
  });
  const actual = renderEditorRecipe(source, recipe);
  assert.deepEqual(actual, renderEditorRecipeTiled(source, recipe, { tileSize: 37 }));
  assert.equal(
    actual.data[(44 * 64 + 32) * 4],
    120,
    'bend is painted exactly once at half opacity',
  );
  assert.equal(actual.data[(16 * 64 + 32) * 4], 20, 'shortcut across the curve is not painted');
  assert.deepEqual(data, original);
});

test('non-finite and rejected samples cannot enter the saved source path', () => {
  const previous = [project(sample(8, 8))];
  const actual = appendFreehandPoints(
    previous,
    [sample(-10, 8), sample(NaN, 8), sample(12, 8)],
    (point) => (point.clientX < 0 ? null : project(point)),
    dimensions,
    0.5,
    4,
    true,
  );
  assert.deepEqual(actual.points, [...previous, project(sample(12, 8))]);
});
