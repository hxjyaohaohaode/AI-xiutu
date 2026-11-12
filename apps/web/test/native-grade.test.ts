import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NEUTRAL_PRECISION_EDIT, parsePrecisionEdit,
  type CurvePoint, type PrecisionEdit, type PrecisionEditV3,
} from '@ai-xiutu/editor';
import {
  addNativeCurvePoint, appendNativeRegion, createNativeRegion, moveNativeCurvePoint,
  moveNativeHandle, moveNativeRegion, nativeCurveInputBounds, nativeCurveOutput, nativeGradeLimits,
  nativeGradePayload, nativeGradeSupported, nativeHandlePoint, nativeRegions,
  nativeSourcePoint, updateNativeRegion, withNativeCurve, withNativeRegions,
  type NativeGradeCapabilities,
} from '../src/media/native-grade-model';

const capabilities: NativeGradeCapabilities = {
  curves: {
    algorithm: 'scene-linear-v2', input: 'linear-master', available: true,
    channels: ['luminance', 'red', 'green', 'blue'], referenceGrey: .18,
    minEv: -16, maxEv: 16, maxPoints: 16,
  },
  regions: {
    algorithm: 'scene-linear-v3', input: 'linear-master', available: true,
    coordinates: 'source-normalized', maxRegions: 8, masks: ['radial', 'linear'],
    adjustments: ['exposure', 'temperature', 'tint', 'contrast', 'saturation', 'shadows', 'highlights'],
  },
};
const sourceSha256 = 'ab'.repeat(32);

test('native capabilities fail closed and never advertise linear controls for the SDR master', () => {
  const missing = nativeGradeLimits(undefined, 'linear-master');
  assert.equal(missing.canCurves, false);
  assert.equal(missing.canRegions, false);
  assert.equal(nativeGradeLimits(capabilities, 'master16').canCurves, false);
  assert.equal(nativeGradeLimits(capabilities, 'master16').canRegions, false);
  assert.equal(nativeGradeLimits({ ...capabilities, curves: { ...capabilities.curves!, available: false } }, 'linear-master').canCurves, false);
  assert.equal(nativeGradeLimits({ ...capabilities, regions: { ...capabilities.regions!, coordinates: 'preview-normalized' } }, 'linear-master').canRegions, false);
  const limits = nativeGradeLimits({
    curves: { ...capabilities.curves!, maxPoints: 99 },
    regions: { ...capabilities.regions!, maxRegions: 99 },
  }, 'linear-master');
  assert.equal(limits.maxPoints, 16);
  assert.equal(limits.maxRegions, 8);
  assert.deepEqual(limits.channels, ['luminance', 'red', 'green', 'blue']);
});

test('EV curves retain negative stops, 0.18 reference grey and linear native offset interpolation', () => {
  const points: CurvePoint[] = [[-12, -11], [0, 0], [4, 5], [12, 13]];
  const edit = withNativeCurve({ ...NEUTRAL_PRECISION_EDIT, exposure: .35 }, 'luminance', points);
  assert.equal(edit.algorithm, 'scene-linear-v2');
  assert.equal(edit.exposure, .35);
  if (edit.algorithm === 'scene-linear-v1') throw new Error('Expected native curves');
  assert.deepEqual(edit.curves.luminance, points);
  assert.equal(nativeCurveOutput(points, -16), -15);
  assert.equal(nativeCurveOutput(points, 16), 17);
  assert.equal(nativeCurveOutput(points, 2), 2.5);
  assert.ok(nativeGradeSupported(edit, 'linear-master', capabilities));
  assert.equal(nativeGradeSupported(edit, 'master16', capabilities), false);
  assert.equal(nativeGradeSupported(edit, 'linear-master', { ...capabilities, curves: { ...capabilities.curves!, channels: ['red'] } }), false);
  assert.deepEqual(withNativeCurve(NEUTRAL_PRECISION_EDIT, 'luminance', null), NEUTRAL_PRECISION_EDIT);
});

test('curve point editing maintains strict input order, bounded EV and the server point budget', () => {
  const initial: CurvePoint[] = [[-16, -16], [0, 1], [16, 16]];
  const moved = moveNativeCurvePoint(initial, 1, [30, -40]);
  assert.deepEqual(initial[1], [0, 1], 'the prior revision remains immutable');
  assert.ok(moved[1]![0] < 16);
  assert.equal(moved[1]![1], -16);
  parsePrecisionEdit({ ...NEUTRAL_PRECISION_EDIT, algorithm: 'scene-linear-v2', curves: { red: moved } });
  const adjacent: CurvePoint[] = [[-16, -16], [0, 0], [.0001, 1], [16, 16]];
  const tight = moveNativeCurvePoint(adjacent, 1, [1, 2]);
  assert.ok(tight[1]![0] < tight[2]![0]);
  assert.equal(tight[1]![1], 2);
  const outputOnly = moveNativeCurvePoint(adjacent, 1, [adjacent[1]![0], 2]);
  assert.equal(outputOnly[1]![0], adjacent[1]![0], 'editing output preserves a read-only input beside a close knot');
  assert.equal(outputOnly[1]![1], 2);
  const dense: CurvePoint[] = [[-16, -16], [0, 0], [.0004, 1], [.0008, 2], [16, 16]];
  const bounds = nativeCurveInputBounds(dense, 2);
  assert.equal(bounds.editable, false);
  assert.ok(bounds.minimum < bounds.maximum, 'even a read-only native range has valid bounds');
  assert.ok(dense[2]![0] >= bounds.minimum && dense[2]![0] <= bounds.maximum);
  assert.equal(nativeCurveInputBounds(initial, 1).step, .001);
  const added = addNativeCurvePoint(initial, [-4, -2], 16);
  assert.equal(added.index, 1);
  assert.deepEqual(added.points[1], [-4, -2]);
  assert.equal(addNativeCurvePoint(initial, [4, 4], 3).points, initial);
  assert.equal(addNativeCurvePoint(initial, [0, 3], 16).points, initial);
});

test('local edits upgrade to V3 without dropping global curves or any of the seven adjustments', () => {
  const base = withNativeCurve({
    ...NEUTRAL_PRECISION_EDIT, exposure: .6, temperature: 12, tint: -8,
    contrast: 20, saturation: 13, shadows: 5, highlights: -14, toneMap: 'reinhard',
  }, 'blue', [[-16, -16], [0, -.2], [16, 16]]);
  let edit = appendNativeRegion(base, createNativeRegion('radial-1', 'radial'), 8);
  edit = updateNativeRegion(edit, 'radial-1', (region) => ({
    ...region, enabled: false, opacity: .7,
    mask: region.mask.type === 'radial' ? { ...region.mask, rotationDegrees: 32, shape: 'diamond', invert: true } : region.mask,
    adjustments: { exposure: 1, temperature: 2, tint: 3, contrast: 4, saturation: 5, shadows: 6, highlights: 7 },
  }));
  assert.equal(edit.algorithm, 'scene-linear-v3');
  assert.equal(edit.toneMap, 'reinhard');
  assert.equal(edit.exposure, .6);
  assert.equal(edit.highlights, -14);
  assert.ok(nativeGradeSupported(edit, 'linear-master', capabilities));
  const region = nativeRegions(edit)[0]!;
  assert.equal(region.enabled, false);
  assert.equal(region.opacity, .7);
  assert.equal(region.mask.type, 'radial');
  if (region.mask.type !== 'radial') throw new Error('Expected radial');
  assert.equal(region.mask.rotationDegrees, 32);
  assert.equal(region.mask.shape, 'diamond');
  assert.equal(region.mask.invert, true);
  assert.equal(Object.keys(region.adjustments).length, 7);
  const changedCurve = withNativeCurve(edit, 'red', [[-16, -16], [1, 2], [16, 16]]) as PrecisionEditV3;
  assert.deepEqual(changedCurve.regions, (edit as PrecisionEditV3).regions);
  assert.deepEqual(changedCurve.curves.blue, (base as Exclude<PrecisionEdit, typeof NEUTRAL_PRECISION_EDIT>).curves.blue);
});

test('ordered locals support eight regions, moves and deletion without sorting identifiers', () => {
  let edit: PrecisionEdit = { ...NEUTRAL_PRECISION_EDIT };
  for (let index = 0; index < 8; index++)
    edit = appendNativeRegion(edit, createNativeRegion('region-' + index, index % 2 ? 'linear' : 'radial'), 8);
  assert.equal(nativeRegions(edit).length, 8);
  assert.equal(appendNativeRegion(edit, createNativeRegion('ninth', 'radial'), 8), edit);
  const moved = moveNativeRegion(edit, 'region-2', -1);
  assert.deepEqual(nativeRegions(moved).map((region) => region.id), ['region-0', 'region-2', 'region-1', 'region-3', 'region-4', 'region-5', 'region-6', 'region-7']);
  assert.equal(nativeRegions(edit)[1]!.id, 'region-1');
  const deleted = withNativeRegions(moved, nativeRegions(moved).filter((region) => region.id !== 'region-0'));
  assert.equal(deleted.regions[0]!.id, 'region-2');
  assert.equal(nativeGradeSupported(edit, 'linear-master', { ...capabilities, regions: { ...capabilities.regions!, maxRegions: 4 } }), false);
});

test('preview, CAS save and attachment export use the same native payload and current source digest', () => {
  const curved = withNativeCurve(NEUTRAL_PRECISION_EDIT, 'luminance', [[-16, -16], [0, .5], [16, 16]]);
  const edit = appendNativeRegion(curved, createNativeRegion('local-a', 'linear'), 8);
  const common = nativeGradePayload({ edit, input: 'linear-master', sourceSha256 });
  assert.equal(common.precisionInput, 'linear-master');
  assert.equal(common.expectedSourceSha256, sourceSha256);
  assert.equal(common.precisionEdit.algorithm, 'scene-linear-v3');
  assert.deepEqual(parsePrecisionEdit(common.precisionEdit), edit);
  const save = nativeGradePayload({ edit, input: 'linear-master', sourceSha256, expectedVersion: 7 });
  assert.equal(save.expectedVersion, 7);
  assert.deepEqual(save.precisionEdit, common.precisionEdit);
  const exportBody = { format: 'exr32', delivery: 'attachment', ...common };
  assert.equal(exportBody.delivery, 'attachment');
  assert.equal(exportBody.precisionEdit.algorithm, 'scene-linear-v3');
  assert.ok(!('recipe' in common) && !('schemaVersion' in common.precisionEdit));
  assert.throws(() => nativeGradePayload({ edit, input: 'master16', sourceSha256 }), /retained float master/);
  assert.equal(nativeGradePayload({ edit: NEUTRAL_PRECISION_EDIT, input: 'master16', sourceSha256 }).precisionEdit.algorithm, 'scene-linear-v1');
});

test('region geometry stays in the full oriented source across pan, zoom and native window previews', () => {
  const source = { width: 2000, height: 1000 };
  assert.deepEqual(nativeSourcePoint({ x: 170, y: 100 }, { x: -30, y: 50, zoom: .25 }, source), { x: .4, y: .2 });
  const radial = createNativeRegion('radial', 'radial').mask;
  if (radial.type !== 'radial') throw new Error('Expected radial');
  const rotated = { ...radial, radiusX: .2, radiusY: .3, rotationDegrees: 90 };
  const anchor = nativeHandlePoint(rotated, 'radiusX', source);
  assert.ok(Math.abs(anchor.x - .5) < 1e-12);
  assert.ok(Math.abs(anchor.y - .9) < 1e-12);
  const resized = moveNativeHandle(rotated, 'radiusX', { x: .5, y: .7 }, source);
  if (resized.type !== 'radial') throw new Error('Expected radial');
  assert.ok(Math.abs(resized.radiusX - .1) < 1e-12);
  assert.equal(resized.radiusY, .3);
  assert.equal(resized.rotationDegrees, 90);
  assert.deepEqual(nativeSourcePoint({ x: 620, y: 100 }, { x: -30, y: 50, zoom: .25 }, source), { x: 1.3, y: .2 });
  const outside = { ...radial, centerX: .8, radiusX: .4 };
  const enlarged = moveNativeHandle(outside, 'radiusX', { x: 1.201, y: .5 }, { width: 1000, height: 1000 });
  if (enlarged.type !== 'radial') throw new Error('Expected radial');
  assert.ok(Math.abs(enlarged.radiusX - .401) < 1e-12, 'a valid off-image radius handle must not jump inward');
  const clampedCenter = moveNativeHandle(outside, 'center', { x: 1.2, y: -.2 }, source);
  if (clampedCenter.type !== 'radial') throw new Error('Expected radial');
  assert.equal(clampedCenter.centerX, 1);
  assert.equal(clampedCenter.centerY, 0);
  const linear = createNativeRegion('linear', 'linear').mask;
  if (linear.type !== 'linear') throw new Error('Expected linear');
  assert.equal(moveNativeHandle(linear, 'start', linear.end, source), linear, 'a zero-length gradient is rejected');
  const moved = moveNativeHandle(linear, 'end', { x: 2, y: -1 }, source);
  assert.equal(moved.type, 'linear');
  if (moved.type !== 'linear') throw new Error('Expected linear');
  assert.deepEqual(moved.end, { x: 1, y: 0 });
  assert.deepEqual(moved.start, linear.start);
  parsePrecisionEdit(withNativeRegions(NEUTRAL_PRECISION_EDIT, [{ ...createNativeRegion('linear', 'linear'), mask: moved }]));
});
