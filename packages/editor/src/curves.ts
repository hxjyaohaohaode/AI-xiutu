import { createRecipe } from './recipe.js';
import type { CurvePoint } from './types.js';

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
