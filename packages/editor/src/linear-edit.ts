import { record, number, RecipeValidationError } from './recipe.js';

/** Separate, explicit scene-linear protocol. Never reinterpret an RGBA8 V4 recipe. */
export interface PrecisionEditV1 {
  algorithm: 'scene-linear-v1';
  exposure: number;
  temperature: number;
  tint: number;
  contrast: number;
  saturation: number;
  shadows: number;
  highlights: number;
  toneMap: 'none' | 'reinhard';
}
export const NEUTRAL_PRECISION_EDIT: Readonly<PrecisionEditV1> = Object.freeze({
  algorithm: 'scene-linear-v1',
  exposure: 0,
  temperature: 0,
  tint: 0,
  contrast: 0,
  saturation: 0,
  shadows: 0,
  highlights: 0,
  toneMap: 'none',
});
export function parsePrecisionEdit(input: unknown): PrecisionEditV1 {
  const errors: string[] = [];
  const row = record(input, Object.keys(NEUTRAL_PRECISION_EDIT), 'precisionEdit', errors);
  if (row.algorithm !== 'scene-linear-v1') errors.push('precisionEdit.algorithm: unsupported');
  if (row.toneMap !== 'none' && row.toneMap !== 'reinhard')
    errors.push('precisionEdit.toneMap: unsupported');
  const result: PrecisionEditV1 = {
    algorithm: 'scene-linear-v1',
    exposure: number(row.exposure, -10, 10, 'precisionEdit.exposure', errors),
    temperature: number(row.temperature, -100, 100, 'precisionEdit.temperature', errors),
    tint: number(row.tint, -100, 100, 'precisionEdit.tint', errors),
    contrast: number(row.contrast, -100, 100, 'precisionEdit.contrast', errors),
    saturation: number(row.saturation, -100, 100, 'precisionEdit.saturation', errors),
    shadows: number(row.shadows, -100, 100, 'precisionEdit.shadows', errors),
    highlights: number(row.highlights, -100, 100, 'precisionEdit.highlights', errors),
    toneMap: row.toneMap as PrecisionEditV1['toneMap'],
  };
  if (errors.length) throw new RecipeValidationError(errors);
  return result;
}
export function compilePrecisionEdit(input: PrecisionEditV1) {
  const edit = parsePrecisionEdit(input);
  const gains = [
    2 ** (edit.exposure + 0.0035 * edit.temperature + 0.0012 * edit.tint),
    2 ** (edit.exposure - 0.0018 * edit.tint),
    2 ** (edit.exposure - 0.0035 * edit.temperature + 0.0012 * edit.tint),
  ];
  const exponent = 2 ** (edit.contrast / 100),
    saturation = 1 + edit.saturation / 100;
  return (r: number, g: number, b: number, output: Float64Array) => {
    r *= gains[0]!;
    g *= gains[1]!;
    b *= gains[2]!;
    const signedY = 0.2126 * r + 0.7152 * g + 0.0722 * b,
      y = Math.max(0, signedY);
    const highlight = y / (y + 0.18);
    const toneGain = 2 ** ((edit.shadows * (1 - highlight) + edit.highlights * highlight) / 100);
    const contrastGain = edit.contrast === 0 || y === 0 ? 1 : (y / 0.18) ** (exponent - 1);
    const gain = toneGain * contrastGain;
    r = (saturation === 1 ? r : signedY + (r - signedY) * saturation) * gain;
    g = (saturation === 1 ? g : signedY + (g - signedY) * saturation) * gain;
    b = (saturation === 1 ? b : signedY + (b - signedY) * saturation) * gain;
    const denominator = edit.toneMap === 'reinhard' ? 1 + y * gain : 1;
    output[0] = r / denominator;
    output[1] = g / denominator;
    output[2] = b / denominator;
  };
}
