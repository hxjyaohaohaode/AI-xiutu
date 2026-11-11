import { MAX_DIMENSION, validateDimensions } from './geometry.js';
import { arrayData, record, RecipeValidationError } from './recipe.js';
import type { Dimensions } from './types.js';
import { integer, parseSelectionMaskV3 } from './v3-recipe.js';
import type { SelectionMaskV3 } from './v3-types.js';

export const MAX_CUTOUT_PIXELS = 8_388_608;
export const MAX_CUTOUT_TRIMAP_RUNS = 131_072;
const values: readonly number[] = [0, 128, 255];

/** Each run is length × 3 plus a label (background, unknown, foreground). */
export interface CutoutTrimap extends Dimensions {
  type: 'trimap';
  runs: number[];
}

export function createCutoutTrimap(
  width: number,
  height: number,
  weights: Uint8Array | Uint8ClampedArray,
): CutoutTrimap {
  validateDimensions({ width, height }, MAX_CUTOUT_PIXELS);
  if (
    !(weights instanceof Uint8Array || weights instanceof Uint8ClampedArray) ||
    weights.length !== width * height
  )
    throw new RecipeValidationError(['trimap: expected one label for each source pixel']);
  const runs: number[] = [];
  let previous = weights[0]!;
  let length = 0;
  for (const weight of weights) {
    if (weight !== previous) {
      runs.push(length * 3 + values.indexOf(previous));
      if (runs.length >= MAX_CUTOUT_TRIMAP_RUNS)
        throw new RecipeValidationError(['trimap: exceeds the cutout run budget']);
      previous = weight;
      length = 0;
    }
    if (weight !== 0 && weight !== 128 && weight !== 255)
      throw new RecipeValidationError(['trimap: labels must be 0, 128 or 255']);
    length++;
  }
  runs.push(length * 3 + values.indexOf(previous));
  return { type: 'trimap', width, height, runs };
}

export function parseCutoutSelection(input: unknown): SelectionMaskV3 | CutoutTrimap {
  if (
    !input ||
    typeof input !== 'object' ||
    Object.getOwnPropertyDescriptor(input, 'type')?.value !== 'trimap'
  )
    return parseSelectionMaskV3(input);
  const errors: string[] = [];
  const source = record(input, ['type', 'width', 'height', 'runs'], 'trimap', errors);
  const width = integer(source.width, 1, MAX_DIMENSION, 'trimap.width', errors);
  const height = integer(source.height, 1, MAX_DIMENSION, 'trimap.height', errors);
  if (width * height > MAX_CUTOUT_PIXELS) errors.push('trimap: exceeds the cutout pixel budget');
  let count = 0;
  let previous = -1;
  const runs = arrayData(source.runs, 1, MAX_CUTOUT_TRIMAP_RUNS, 'trimap.runs', errors).map(
    (value, index) => {
      const packed = integer(value, 3, MAX_CUTOUT_PIXELS * 3 + 2, `trimap.runs[${index}]`, errors);
      const label = packed % 3;
      if (label === previous) errors.push(`trimap.runs[${index}]: adjacent runs must differ`);
      previous = label;
      count += Math.floor(packed / 3);
      return packed;
    },
  );
  if (count !== width * height) errors.push('trimap: runs must cover exactly width × height');
  if (errors.length) throw new RecipeValidationError(errors);
  return { type: 'trimap', width, height, runs };
}

export function expandCutoutTrimap(trimap: CutoutTrimap, image: Dimensions): Uint8Array {
  if (trimap.width !== image.width || trimap.height !== image.height)
    throw new RecipeValidationError(['trimap: dimensions must match the original source']);
  const labels = new Uint8Array(trimap.width * trimap.height);
  let start = 0;
  for (const packed of trimap.runs) {
    const end = start + Math.floor(packed / 3);
    labels.fill(values[packed % 3]!, start, end);
    start = end;
  }
  return labels;
}
