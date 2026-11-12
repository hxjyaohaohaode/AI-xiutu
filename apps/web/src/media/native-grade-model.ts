import {
  MAX_PRECISION_REGIONS,
  PRECISION_CURVE_CHANNELS,
  PRECISION_CURVE_LIMITS,
  PRECISION_EDIT_CONTROLS,
  PRECISION_REGION_MASKS,
  parsePrecisionEdit,
  type CurvePoint,
  type PrecisionCurveChannel,
  type PrecisionEdit,
  type PrecisionEditV3,
  type PrecisionRegionV3,
} from '@ai-xiutu/editor';
import type { MediaPrecisionInput } from '@ai-xiutu/media';
import type { TileView } from './tile-layout';

export interface NativeGradeCapabilities {
  curves?: {
    algorithm: string;
    input: string;
    available: boolean;
    channels: readonly string[];
    referenceGrey: number;
    minEv: number;
    maxEv: number;
    maxPoints: number;
  };
  regions?: {
    algorithm: string;
    input: string;
    available: boolean;
    coordinates: string;
    maxRegions: number;
    masks: readonly string[];
    adjustments: readonly string[];
  };
}

export function nativeGradeLimits(capabilities: NativeGradeCapabilities | undefined, input: MediaPrecisionInput) {
  const curves = capabilities?.curves;
  const regions = capabilities?.regions;
  const curveRange = !!curves && Array.isArray(curves.channels) && Number.isFinite(curves.minEv) && Number.isFinite(curves.maxEv) &&
    Number.isInteger(curves.maxPoints) && curves.maxPoints >= 2 &&
    curves.minEv >= PRECISION_CURVE_LIMITS.minEv && curves.maxEv <= PRECISION_CURVE_LIMITS.maxEv &&
    curves.minEv < curves.maxEv && curves.referenceGrey === .18;
  const canCurves = input === 'linear-master' && curves?.available === true &&
    curves.algorithm === 'scene-linear-v2' && curves.input === 'linear-master' && curveRange;
  const canRegions = input === 'linear-master' && regions?.available === true &&
    regions.algorithm === 'scene-linear-v3' && regions.input === 'linear-master' &&
    regions.coordinates === 'source-normalized' && Array.isArray(regions.masks) && Array.isArray(regions.adjustments) &&
    Number.isInteger(regions.maxRegions) && regions.maxRegions > 0;
  return {
    channels: canCurves && curves ? PRECISION_CURVE_CHANNELS.filter((channel) => curves.channels.includes(channel)) : [],
    minEv: canCurves && curves ? curves.minEv : PRECISION_CURVE_LIMITS.minEv,
    maxEv: canCurves && curves ? curves.maxEv : PRECISION_CURVE_LIMITS.maxEv,
    maxPoints: canCurves && curves ? Math.min(curves.maxPoints, PRECISION_CURVE_LIMITS.maxPoints) : 0,
    masks: canRegions && regions ? PRECISION_REGION_MASKS.filter((mask) => regions.masks.includes(mask)) : [],
    maxRegions: canRegions && regions ? Math.min(regions.maxRegions, MAX_PRECISION_REGIONS) : 0,
    adjustments: canRegions && regions ? PRECISION_EDIT_CONTROLS.filter(({ key }) => regions.adjustments.includes(key)) : [],
    canCurves,
    canRegions,
  };
}

export function nativeGradeSupported(
  edit: PrecisionEdit,
  input: MediaPrecisionInput,
  capabilities: NativeGradeCapabilities | undefined,
): boolean {
  if (edit.algorithm === 'scene-linear-v1') return true;
  if (input !== 'linear-master') return false;
  const limits = nativeGradeLimits(capabilities, input);
  if (edit.algorithm === 'scene-linear-v2' && !limits.canCurves) return false;
  for (const [channel, points] of Object.entries(edit.curves)) {
    if (!limits.channels.includes(channel as PrecisionCurveChannel) || !points ||
      points.length > limits.maxPoints || points.some(([x, y]) =>
        x < limits.minEv || x > limits.maxEv || y < limits.minEv || y > limits.maxEv)) return false;
  }
  if (edit.algorithm === 'scene-linear-v3') {
    if (!limits.canRegions || edit.regions.length > limits.maxRegions) return false;
    if (edit.regions.some((region) => !limits.masks.includes(region.mask.type) ||
      Object.keys(region.adjustments).some((key) => !limits.adjustments.some((control) => control.key === key)))) return false;
  }
  return true;
}

/** The scene-linear payload is independent from an SDR EditorRecipe. */
export function nativeGradePayload({
  edit, input, sourceSha256, expectedVersion,
}: {
  edit: PrecisionEdit;
  input: MediaPrecisionInput;
  sourceSha256: string;
  expectedVersion?: number;
}) {
  const parsed = parsePrecisionEdit(edit);
  if (parsed.algorithm !== 'scene-linear-v1' && input !== 'linear-master')
    throw new Error('Scene-linear curves and regions require the retained float master');
  return {
    expectedSourceSha256: sourceSha256,
    precisionInput: input,
    precisionEdit: parsed,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}

export const nativeIdentityCurve = (minEv = -16, maxEv = 16): CurvePoint[] => [[minEv, minEv], [maxEv, maxEv]];

export function nativeCurvePoints(edit: PrecisionEdit, channel: PrecisionCurveChannel, minEv = -16, maxEv = 16): CurvePoint[] {
  return edit.algorithm === 'scene-linear-v1' ? nativeIdentityCurve(minEv, maxEv) :
    edit.curves[channel] ?? nativeIdentityCurve(minEv, maxEv);
}

export function withNativeCurve(edit: PrecisionEdit, channel: PrecisionCurveChannel, points: CurvePoint[] | null): PrecisionEdit {
  if (points === null && edit.algorithm === 'scene-linear-v1') return edit;
  const curves: Partial<Record<PrecisionCurveChannel, CurvePoint[]>> = edit.algorithm === 'scene-linear-v1' ? {} : { ...edit.curves };
  if (points === null) delete curves[channel];
  else curves[channel] = points;
  return parsePrecisionEdit({
    ...edit,
    algorithm: edit.algorithm === 'scene-linear-v3' ? 'scene-linear-v3' : 'scene-linear-v2',
    curves,
  });
}

/** Native linear_export.py interpolates EV offsets; outside knots the offset continues. */
export function nativeCurveOutput(points: CurvePoint[], x: number): number {
  if (x <= points[0]![0]) return x + points[0]![1] - points[0]![0];
  const last = points.at(-1)!;
  if (x >= last[0]) return x + last[1] - last[0];
  const right = points.findIndex(([input]) => input > x);
  const a = points[right - 1]!, b = points[right]!;
  return a[1] + (b[1] - a[1]) * ((x - a[0]) / (b[0] - a[0]));
}

export function nativeCurveInputBounds(points: CurvePoint[], index: number, minEv = -16, maxEv = 16) {
  const minimum = index ? points[index - 1]![0] + .001 : minEv;
  const maximum = index < points.length - 1 ? points[index + 1]![0] - .001 : maxEv;
  const value = points[index]?.[0];
  const editable = value !== undefined && minimum < maximum && value >= minimum && value <= maximum;
  return {
    minimum: editable ? minimum : minEv,
    maximum: editable ? maximum : maxEv,
    step: .001,
    editable,
  };
}

export function moveNativeCurvePoint(
  points: CurvePoint[], index: number, point: CurvePoint, minEv = -16, maxEv = 16,
): CurvePoint[] {
  if (!points[index] || point.some((value) => !Number.isFinite(value))) return points;
  const low = index ? points[index - 1]![0] + .001 : minEv;
  const high = index < points.length - 1 ? points[index + 1]![0] - .001 : maxEv;
  const x = !nativeCurveInputBounds(points, index, minEv, maxEv).editable
    ? points[index]![0] : Math.max(low, Math.min(high, point[0]));
  const y = Math.max(minEv, Math.min(maxEv, point[1]));
  return points.map((current, at): CurvePoint => at === index ? [x, y] : current);
}

export function addNativeCurvePoint(points: CurvePoint[], point: CurvePoint, maxPoints: number, minEv = -16, maxEv = 16) {
  if (points.length >= Math.min(maxPoints, PRECISION_CURVE_LIMITS.maxPoints)) return { points, index: 0 };
  const x = Math.max(minEv, Math.min(maxEv, point[0]));
  const near = points.findIndex(([input]) => Math.abs(input - x) < .001);
  if (near >= 0) return { points, index: near };
  const next: CurvePoint[] = [...points, [x, Math.max(minEv, Math.min(maxEv, point[1]))]];
  next.sort((a, b) => a[0] - b[0]);
  return { points: next, index: next.findIndex(([input]) => input === x) };
}

export function nativeRegions(edit: PrecisionEdit): PrecisionRegionV3[] {
  return edit.algorithm === 'scene-linear-v3' ? edit.regions : [];
}

export function withNativeRegions(edit: PrecisionEdit, regions: PrecisionRegionV3[]): PrecisionEditV3 {
  return parsePrecisionEdit({
    ...edit,
    algorithm: 'scene-linear-v3',
    curves: edit.algorithm === 'scene-linear-v1' ? {} : edit.curves,
    regions,
  }) as PrecisionEditV3;
}

export function createNativeRegion(id: string, type: 'radial' | 'linear'): PrecisionRegionV3 {
  return {
    id,
    enabled: true,
    opacity: 1,
    mask: type === 'radial'
      ? { type, centerX: .5, centerY: .5, radiusX: .25, radiusY: .25, feather: .5, invert: false }
      : { type, start: { x: .25, y: .5 }, end: { x: .75, y: .5 }, smooth: true, invert: false },
    adjustments: {},
  };
}

export function appendNativeRegion(edit: PrecisionEdit, region: PrecisionRegionV3, maximum: number): PrecisionEdit {
  const regions = nativeRegions(edit);
  if (regions.length >= Math.min(maximum, MAX_PRECISION_REGIONS) || regions.some((item) => item.id === region.id)) return edit;
  return withNativeRegions(edit, [...regions, region]);
}

export function updateNativeRegion(edit: PrecisionEdit, id: string, update: (region: PrecisionRegionV3) => PrecisionRegionV3): PrecisionEdit {
  const regions = nativeRegions(edit);
  if (!regions.some((region) => region.id === id)) return edit;
  return withNativeRegions(edit, regions.map((region) => region.id === id ? update(region) : region));
}

export function moveNativeRegion(edit: PrecisionEdit, id: string, direction: -1 | 1): PrecisionEdit {
  const regions = [...nativeRegions(edit)];
  const index = regions.findIndex((region) => region.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= regions.length) return edit;
  const [region] = regions.splice(index, 1);
  regions.splice(target, 0, region!);
  return withNativeRegions(edit, regions);
}

export type NativeMask = PrecisionRegionV3['mask'];
export type NativeRegionHandle = 'center' | 'radiusX' | 'radiusY' | 'start' | 'end';
export type NativeSourceSize = { width: number; height: number };
export type NativePoint = { x: number; y: number };
const bound = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

/** Full oriented source plane, not the preview window. Radius handles may lie outside [0, 1]. */
export function nativeSourcePoint(point: NativePoint, view: TileView, source: NativeSourceSize): NativePoint {
  return {
    x: (point.x - view.x) / (source.width * view.zoom),
    y: (point.y - view.y) / (source.height * view.zoom),
  };
}

export function nativeHandlePoint(mask: NativeMask, handle: NativeRegionHandle, source: NativeSourceSize): NativePoint {
  if (mask.type === 'linear') return handle === 'end' ? mask.end : mask.start;
  const angle = (mask.rotationDegrees ?? 0) * Math.PI / 180;
  if (handle === 'radiusX') return {
    x: mask.centerX + Math.cos(angle) * mask.radiusX,
    y: mask.centerY + Math.sin(angle) * mask.radiusX * source.width / source.height,
  };
  if (handle === 'radiusY') return {
    x: mask.centerX - Math.sin(angle) * mask.radiusY * source.height / source.width,
    y: mask.centerY + Math.cos(angle) * mask.radiusY,
  };
  return { x: mask.centerX, y: mask.centerY };
}

export function moveNativeHandle(mask: NativeMask, handle: NativeRegionHandle, point: NativePoint, source: NativeSourceSize): NativeMask {
  const next = { x: bound(point.x), y: bound(point.y) };
  if (mask.type === 'linear') {
    const end = handle === 'end' ? next : mask.end;
    const start = handle === 'start' ? next : mask.start;
    if ((end.x - start.x) ** 2 + (end.y - start.y) ** 2 < 1e-12) return mask;
    return { ...mask, start, end };
  }
  if (handle === 'center') return { ...mask, centerX: next.x, centerY: next.y };
  const angle = (mask.rotationDegrees ?? 0) * Math.PI / 180;
  const dx = (point.x - mask.centerX) * source.width, dy = (point.y - mask.centerY) * source.height;
  if (handle === 'radiusX') return { ...mask, radiusX: bound(Math.abs(dx * Math.cos(angle) + dy * Math.sin(angle)) / source.width, .0001) };
  if (handle === 'radiusY') return { ...mask, radiusY: bound(Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle)) / source.height, .0001) };
  return mask;
}
