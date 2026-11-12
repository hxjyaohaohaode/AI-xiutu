import { RecipeValidationError, record } from './recipe.js';
import { MAX_DIMENSION } from './geometry.js';
import { integer } from './v3-recipe.js';
import type { Dimensions } from './types.js';

export const MAX_CUTOUT_ALPHA_EDGE = 1024;
const base64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Continuous alpha8 in a rectangular, source-normalized model grid. */
export interface CutoutAlphaPrior extends Dimensions {
  type: 'alpha-prior';
  sourceWidth: number;
  sourceHeight: number;
  alpha: string;
}

export function parseCutoutAlphaPrior(input: unknown, maxSourcePixels: number): CutoutAlphaPrior {
  const errors: string[] = [];
  const path = 'alpha-prior';
  const value = record(
    input,
    ['type', 'width', 'height', 'sourceWidth', 'sourceHeight', 'alpha'],
    path,
    errors,
  );
  const width = integer(value.width, 1, MAX_CUTOUT_ALPHA_EDGE, `${path}.width`, errors);
  const height = integer(value.height, 1, MAX_CUTOUT_ALPHA_EDGE, `${path}.height`, errors);
  const sourceWidth = integer(value.sourceWidth, 1, MAX_DIMENSION, `${path}.sourceWidth`, errors);
  const sourceHeight = integer(
    value.sourceHeight,
    1,
    MAX_DIMENSION,
    `${path}.sourceHeight`,
    errors,
  );
  if (sourceWidth * sourceHeight > maxSourcePixels)
    errors.push(`${path}: source exceeds the cutout pixel budget`);
  const samples = width * height;
  const padding = (3 - (samples % 3)) % 3;
  const alpha = value.alpha;
  if (
    typeof alpha !== 'string' ||
    alpha.length !== 4 * Math.ceil(samples / 3) ||
    /[^A-Za-z0-9+/]/.test(alpha.slice(0, alpha.length - padding)) ||
    !alpha.endsWith('='.repeat(padding)) ||
    (padding !== 0 &&
      (base64.indexOf(alpha[alpha.length - padding - 1]!) & (padding === 2 ? 15 : 3)) !== 0)
  )
    errors.push(`${path}: expected canonical base64 with one byte per sample`);
  if (errors.length) throw new RecipeValidationError(errors);
  return { type: 'alpha-prior', width, height, sourceWidth, sourceHeight, alpha: alpha as string };
}

export function encodeCutoutAlpha(samples: Uint8Array | Uint8ClampedArray): string {
  const chunks: string[] = [];
  for (let at = 0; at < samples.length; at += 8192)
    chunks.push(String.fromCharCode(...samples.subarray(at, at + 8192)));
  return btoa(chunks.join(''));
}

const cubic = (a: number, b: number, c: number, d: number, t: number) =>
  b + t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a))) * 0.5;

/** Reconstruct soft alpha at original pixel centers. Source RGB is never resampled. */
export function compileCutoutAlphaPrior(prior: CutoutAlphaPrior) {
  const { width, height } = prior;
  const samples = atob(prior.alpha);
  if (prior.sourceWidth === width && prior.sourceHeight === height)
    return (x: number, y: number) => samples.charCodeAt(y * width + x) / 255;
  const axis = (pixels: number, cells: number, stride: number) =>
    Array.from({ length: pixels }, (_, i) => {
      const position = ((i + 0.5) * cells) / pixels - 0.5;
      const origin = Math.floor(position);
      const offset = (delta: number) => Math.max(0, Math.min(cells - 1, origin + delta)) * stride;
      return [offset(-1), offset(0), offset(1), offset(2), position - origin] as const;
    });
  const columns = axis(prior.sourceWidth, width, 1);
  const rows = axis(prior.sourceHeight, height, width);
  return (x: number, y: number) => {
    const [a, b, c, d, tx] = columns[x]!;
    const [r0, r1, r2, r3, ty] = rows[y]!;
    const mix = (offset: number) =>
      cubic(
        samples.charCodeAt(offset + a),
        samples.charCodeAt(offset + b),
        samples.charCodeAt(offset + c),
        samples.charCodeAt(offset + d),
        tx,
      );
    const weight = cubic(mix(r0), mix(r1), mix(r2), mix(r3), ty);
    return Math.min(1, Math.max(0, weight / 255));
  };
}
