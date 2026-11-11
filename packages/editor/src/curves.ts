import { createRecipe } from './recipe.js';
import type { CurveChannel, CurveInterpolation, CurvePoint, Curves } from './types.js';

export function withCurve(
  curves: Curves,
  channel: CurveChannel,
  points: CurvePoint[],
  mode: CurveInterpolation = curves.interpolation?.[channel] ?? 'linear',
): Curves {
  const { interpolation, ...channels } = curves;
  const next = { ...interpolation };
  if (mode === 'pchip-v1') next[channel] = mode;
  else delete next[channel];
  return {
    ...channels,
    [channel]: points,
    ...(Object.keys(next).length ? { interpolation: next } : {}),
  };
}

/** Translate selected knots together. Interior knots keep their order and relative spacing. */
export function translateCurvePoints(
  points: CurvePoint[],
  indices: readonly number[],
  dx: number,
  dy: number,
): CurvePoint[] {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return points;
  const selected = new Set(
    indices.filter((i) => Number.isInteger(i) && i >= 0 && i < points.length),
  );
  const movable = (i: number) => i > 0 && i < points.length - 1 && selected.has(i);
  let left = -1,
    right = 1,
    bottom = -1,
    top = 1;
  for (const i of selected) {
    const [x, y] = points[i]!;
    bottom = Math.max(bottom, -y);
    top = Math.min(top, 1 - y);
    if (!movable(i)) continue;
    if (!movable(i - 1)) {
      const gap = x - points[i - 1]![0];
      left = Math.max(left, -gap + Math.min(0.004, gap / 4));
    }
    if (!movable(i + 1)) {
      const gap = points[i + 1]![0] - x;
      right = Math.min(right, gap - Math.min(0.004, gap / 4));
    }
  }
  const x = Math.max(left, Math.min(right, dx)),
    y = Math.max(bottom, Math.min(top, dy));
  return points.map((p, i) => (selected.has(i) ? [p[0] + (movable(i) ? x : 0), p[1] + y] : p));
}

/** Shape-preserving cubic Hermite interpolation with one derivative per knot.
 * Reverse slopes and plateaus have zero tangent. Adjacent knots bound every segment. */
export function smoothCurveSegments(points: readonly CurvePoint[]) {
  const widths = points.slice(1).map(([x], i) => x - points[i]![0]);
  const slopes = widths.map(
    (w, i) => (points[i + 1]![1] - points[i]![1]) / Math.max(w, Number.EPSILON),
  );
  const endpoint = (w: number, nextW: number, slope: number, nextSlope: number) => {
    const m = slope + (w / (w + nextW)) * (slope - nextSlope);
    if (Math.sign(m) !== Math.sign(slope)) return 0;
    return Math.sign(slope) * Math.min(Math.abs(m), 3 * Math.abs(slope));
  };
  const tangents = points.map((_, i) => {
    if (slopes.length === 1) return slopes[0]!;
    const last = slopes.length - 1;
    if (i === 0) return endpoint(widths[0]!, widths[1]!, slopes[0]!, slopes[1]!);
    if (i === points.length - 1)
      return endpoint(widths[last]!, widths[last - 1]!, slopes[last]!, slopes[last - 1]!);
    const a = slopes[i - 1]!,
      b = slopes[i]!;
    if (a === 0 || b === 0 || Math.sign(a) !== Math.sign(b)) return 0;
    const fraction = widths[i]! / (widths[i - 1]! + widths[i]!);
    const weight = (1 + fraction) / 3;
    return 1 / (weight / a + (1 - weight) / b);
  });
  return widths.map((width, i) => {
    const [x, from] = points[i]!,
      [, to] = points[i + 1]!;
    return {
      x,
      width,
      from,
      to,
      first: from + (width * tangents[i]!) / 3,
      second: to - (width * tangents[i + 1]!) / 3,
    };
  });
}

/** The smooth path evaluates actual segments instead of losing close knots in a uniform LUT. */
export function compileCurveFunction(points: CurvePoint[], mode: CurveInterpolation) {
  if (mode === 'linear') {
    const lut = buildCurveLut(points);
    return (value: number) => sampleCurveLut(lut, value);
  }
  const segments = smoothCurveSegments(points);
  let index = 0;
  const bins = Uint8Array.from({ length: 256 }, (_, i) => {
    while (index < segments.length - 1 && i / 256 >= segments[index + 1]!.x) index++;
    return index;
  });
  return (value: number) => {
    const x = Math.min(1, Math.max(0, value));
    let i = bins[Math.min(255, Math.floor(x * 256))]!;
    while (i < segments.length - 1 && x >= segments[i + 1]!.x) i++;
    const { x: start, width, from, to, first, second } = segments[i]!;
    const t = Math.min(1, (x - start) / width),
      s = 1 - t;
    return s * s * (s * from + 3 * t * first) + t * t * (3 * s * second + t * to);
  };
}

export function isIdentityCurve(points: readonly CurvePoint[]): boolean {
  return points.every((point) => point[0] === point[1]);
}

/** Linear segments cannot overshoot their control-point values. y can be non-monotonic. */
export function buildCurveLut(points: readonly CurvePoint[], size = 4096): Float32Array {
  const lut = new Float32Array(size);
  let segment = 0;
  for (let i = 0; i < size; i += 1) {
    const x = i / (size - 1);
    while (segment < points.length - 2 && x > points[segment + 1]![0]) segment += 1;
    const left = points[segment]!;
    const right = points[segment + 1]!;
    const t = (x - left[0]) / (right[0] - left[0]);
    lut[i] = left[1] + (right[1] - left[1]) * t;
  }
  return lut;
}

export function compileCurveLut(points: CurvePoint[], size = 4096): Float32Array {
  if (!Number.isSafeInteger(size) || size < 2 || size > 65536)
    throw new RangeError('LUT size must be an integer from 2 to 65536');
  const validated = createRecipe({ curves: { rgb: points } }).curves.rgb;
  return buildCurveLut(validated, size);
}

export function sampleCurveLut(lut: Float32Array, value: number): number {
  const position = Math.min(1, Math.max(0, value)) * (lut.length - 1);
  const left = Math.floor(position);
  const right = Math.min(lut.length - 1, left + 1);
  const t = position - left;
  return lut[left]! * (1 - t) + lut[right]! * t;
}
