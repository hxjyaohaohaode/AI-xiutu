import { linearToSrgb, srgbToLinear, validateImage } from './engine.js';
import { compileSelectionMaskV3 } from './v3-mask.js';
import { parseSelectionMaskV3 } from './v3-recipe.js';
import { checkV3 } from './v3-pixels.js';
import type { RGBAImage, RenderOptions } from './types.js';
import type { SelectionMaskV3 } from './v3-types.js';

export const MAX_CUTOUT_PIXELS = 8_388_608;
const linear = Float64Array.from({ length: 256 }, (_, value) => srgbToLinear(value / 255));
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const directions = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

export interface CutoutSettings {
  selection: SelectionMaskV3;
  foreground?: SelectionMaskV3;
  background?: SelectionMaskV3;
  /** Search radius as a fraction of the shorter source edge. */
  radius: number;
  decontaminate: number;
}

/** Solve alpha only in the uncertain band, in linear RGB. Keep the user's hard trimap constraints. */
export function renderCutout(
  image: RGBAImage,
  settings: CutoutSettings,
  options: RenderOptions = {},
): RGBAImage {
  validateImage(image, { maxPixels: MAX_CUTOUT_PIXELS });
  if (!(
    settings.radius >= 0 &&
    settings.radius <= 0.05 &&
    settings.decontaminate >= 0 &&
    settings.decontaminate <= 1
  ))
    throw new RangeError('Cutout parameters outside the supported range');
  const { width, height } = image;
  const selection = compileSelectionMaskV3(parseSelectionMaskV3(settings.selection), image, image);
  const foreground =
    settings.foreground &&
    compileSelectionMaskV3(parseSelectionMaskV3(settings.foreground), image, image);
  const background =
    settings.background &&
    compileSelectionMaskV3(parseSelectionMaskV3(settings.background), image, image);
  const matte = new Float32Array(width * height);
  const data = image.data.slice();
  let uncertain = 0;
  for (let y = 0; y < height; y++) {
    if ((y & 31) === 0) checkV3(options);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const u = (x + 0.5) / width,
        v = (y + 0.5) / height;
      const fg = foreground?.(u, v) ?? 0,
        bg = background?.(u, v) ?? 0;
      const prior = selection(u, v);
      // Painted foreground wins only in proportion to its weight. Exact opposing paint is ambiguous.
      if (fg >= 0.999 && bg >= 0.999)
        throw new RangeError('Foreground and background trimap overlap');
      const value = data[i * 4 + 3] === 0 ? 0 : clamp(prior + fg * (1 - prior) - bg * prior);
      matte[i] = value <= 0.035 ? 0 : value >= 0.965 ? 1 : value;
      if (matte[i] !== 0 && matte[i] !== 1) uncertain++;
    }
  }
  if (settings.radius > 0 && uncertain > 1_048_576)
    throw new RangeError(
      'Too many uncertain matte pixels. Refine the foreground and background first.',
    );
  const radius = Math.min(64, Math.round(settings.radius * Math.min(width, height)));
  const distances = [
    ...new Set([1, 2, 4, 8, 16, 32, radius].filter((value) => value <= radius)),
  ].sort((a, b) => a - b);
  const colors = new Float64Array(8);
  for (let y = 0; y < height; y++) {
    if ((y & 15) === 0) checkV3(options);
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        at = i * 4;
      let alpha = matte[i]!;
      if (alpha > 0 && alpha < 1 && radius > 0) {
        colors.fill(0);
        for (const [dx, dy] of directions) {
          let found = 0;
          for (const distance of distances) {
            const xx = x + dx * distance,
              yy = y + dy * distance;
            if (xx < 0 || xx >= width || yy < 0 || yy >= height) break;
            const n = yy * width + xx,
              sample = n * 4;
            const label = matte[n];
            if (
              (label !== 0 && label !== 1) ||
              image.data[sample + 3]! < 224 ||
              found & (1 << label)
            )
              continue;
            const k = label * 4,
              weight = 1 / Math.sqrt(distance);
            for (let c = 0; c < 3; c++) colors[k + c]! += linear[image.data[sample + c]!]! * weight;
            colors[k + 3]! += weight;
            found |= 1 << label;
            if (found === 3) break;
          }
        }
        if (colors[3]! && colors[7]!) {
          let dot = 0,
            contrast = 0;
          for (let c = 0; c < 3; c++) {
            const bg = colors[c]! / colors[3]!,
              fg = colors[4 + c]! / colors[7]!;
            dot += (linear[image.data[at + c]!]! - bg) * (fg - bg);
            contrast += (fg - bg) ** 2;
          }
          // Regularization retains the semantic prior where both sides have similar colors.
          alpha = clamp((dot + 0.015 * alpha) / (contrast + 0.015));
          if (alpha > 0.04 && alpha < 0.995 && settings.decontaminate > 0 && contrast > 0.015) {
            for (let c = 0; c < 3; c++) {
              const observed = linear[image.data[at + c]!]!,
                bg = colors[c]! / colors[3]!;
              const unmix = clamp((observed - (1 - alpha) * bg) / alpha);
              const strength = settings.decontaminate * (1 - alpha) * Math.min(1, alpha / 0.15);
              data[at + c] = 255 * linearToSrgb(observed + strength * (unmix - observed));
            }
          }
        }
      }
      data[at + 3] = image.data[at + 3]! * alpha;
      if (data[at + 3] === 0) data.fill(0, at, at + 3);
    }
  }
  return { width, height, data };
}
