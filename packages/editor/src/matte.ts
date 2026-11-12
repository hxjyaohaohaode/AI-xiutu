import { linearToSrgb, srgbToLinear, validateImage } from './engine.js';
import { compileSelectionMaskV3 } from './v3-mask.js';
import { parseSelectionMaskV3 } from './v3-recipe.js';
import { checkV3 } from './v3-pixels.js';
import type { RGBAImage, RenderOptions } from './types.js';
import type { SelectionMaskV3 } from './v3-types.js';
import { refineGuidedMatte } from './guided-matte.js';
import { findMatteAnchors, findVisibleMatteAnchors, MATTE_RAYS } from './matte-anchors.js';
import { compileCutoutAlphaPrior } from './matte-alpha-prior.js';
import {
  cutoutSelectionDimensionError,
  expandCutoutTrimap,
  MAX_CUTOUT_PIXELS,
  parseCutoutSelection,
  type CutoutSelection,
} from './matte-trimap.js';

const linear = Float64Array.from({ length: 256 }, (_, value) => srgbToLinear(value / 255));
const clamp = (value: number) => Math.min(1, Math.max(0, value));
export const CUTOUT_ALGORITHMS = [
  'ray-v1',
  'guided-v2',
  'guided-v3',
  'guided-v4',
  'guided-v5',
  'continuous-alpha-v1',
] as const;

export interface CutoutSettings {
  /** Missing preserves the published eight-ray solver. */
  algorithm?: (typeof CUTOUT_ALGORITHMS)[number];
  selection: CutoutSelection;
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
  if (settings.algorithm !== undefined && !CUTOUT_ALGORITHMS.includes(settings.algorithm))
    throw new RangeError('Unsupported cutout algorithm');
  if (!(
    settings.radius >= 0 &&
    settings.radius <= 0.05 &&
    settings.decontaminate >= 0 &&
    settings.decontaminate <= 1
  ))
    throw new RangeError('Cutout parameters outside the supported range');
  const { width, height } = image;
  const parsedSelection = parseCutoutSelection(settings.selection, settings.algorithm);
  if (cutoutSelectionDimensionError(parsedSelection, image))
    throw new RangeError('Cutout selection dimensions must match the original source');
  const continuous = parsedSelection.type === 'alpha-prior';
  const trimap =
    parsedSelection.type === 'trimap' ? expandCutoutTrimap(parsedSelection, image) : null;
  const sampleAlpha =
    parsedSelection.type === 'alpha-prior' ? compileCutoutAlphaPrior(parsedSelection) : null;
  const selection =
    parsedSelection.type === 'trimap' || parsedSelection.type === 'alpha-prior'
      ? null
      : compileSelectionMaskV3(parsedSelection, image, image);
  const foreground =
    settings.foreground &&
    compileSelectionMaskV3(parseSelectionMaskV3(settings.foreground), image, image);
  const background =
    settings.background &&
    compileSelectionMaskV3(parseSelectionMaskV3(settings.background), image, image);
  let matte: Float32Array = new Float32Array(width * height);
  const preserveOccluders = continuous || settings.algorithm === 'guided-v5';
  const connected = preserveOccluders || settings.algorithm === 'guided-v4';
  const dense = connected || settings.algorithm === 'guided-v3';
  const guided = dense || settings.algorithm === 'guided-v2';
  const constraints = guided && !continuous ? new Uint8Array(width * height) : null;
  const data = image.data.slice();
  const labelLimit = continuous ? 0.5 / 255 : 0.035;
  let uncertain = 0;
  for (let y = 0; y < height; y++) {
    if ((y & 31) === 0) checkV3(options);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const u = (x + 0.5) / width,
        v = (y + 0.5) / height;
      const fg = foreground?.(u, v) ?? 0,
        bg = background?.(u, v) ?? 0;
      const prior = trimap ? trimap[i]! / 255 : sampleAlpha ? sampleAlpha(x, y) : selection!(u, v);
      // Painted foreground wins only in proportion to its weight. Exact opposing paint is ambiguous.
      if (fg >= 0.999 && bg >= 0.999)
        throw new RangeError('Foreground and background trimap overlap');
      if (constraints)
        constraints[i] = fg >= 0.999 ? 2 : bg >= 0.999 || data[i * 4 + 3] === 0 ? 1 : 0;
      const value = data[i * 4 + 3] === 0 ? 0 : clamp(prior + fg * (1 - prior) - bg * prior);
      matte[i] = value <= labelLimit ? 0 : value >= 1 - labelLimit ? 1 : value;
      if (matte[i] !== 0 && matte[i] !== 1) uncertain++;
    }
  }
  if (settings.radius > 0 && uncertain > 1_048_576)
    throw new RangeError(
      'Too many uncertain matte pixels. Refine the foreground and background first.',
    );
  const radius = Math.min(64, Math.round(settings.radius * Math.min(width, height)));
  const labels = matte;
  if (guided && !continuous && radius > 0) {
    matte = uncertain ? refineGuidedMatte(image, labels, radius * 2, options) : labels.slice();
    uncertain = 0;
    for (let i = 0; i < matte.length; i++) {
      if ((i & 16383) === 0) checkV3(options);
      // The semantic model owns the support. Color guidance must never recruit
      // confident background texture as new hair or discard a confident limb.
      const value =
        constraints![i] === 2
          ? 1
          : constraints![i] === 1
            ? 0
            : labels[i] === 0 || labels[i] === 1
              ? labels[i]!
              : matte[i]!;
      matte[i] = value <= 0.003 ? 0 : value >= 0.997 ? 1 : value;
      if (matte[i] !== 0 && matte[i] !== 1) uncertain++;
    }
    if (uncertain > 1_048_576)
      throw new RangeError(
        'Too many uncertain matte pixels. Refine the foreground and background first.',
      );
  }
  const searchRadius = guided ? radius * 4 : radius;
  const anchors =
    connected && radius && uncertain
      ? findMatteAnchors(image, labels, searchRadius, options)
      : null;
  const visibleRays =
    preserveOccluders && anchors
      ? findVisibleMatteAnchors(image, labels, matte, searchRadius, options)
      : null;
  const nearestDistance = [0];
  const distances = [
    ...new Set(
      (dense
        ? [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, searchRadius]
        : [1, 2, 4, 8, 16, 32, 64, 128, searchRadius]
      ).filter((value) => value <= searchRadius),
    ),
  ].sort((a, b) => a - b);
  const colors = new Float64Array(8);
  const candidates = new Int32Array(anchors ? 18 : 16);
  const candidateDistances = new Float64Array(candidates.length);
  const candidateColors = new Float64Array(candidates.length * 3);
  const observed = new Float64Array(3);
  const collectRay = (x: number, y: number, d: number, steps: number[], missing = 3) => {
    const [dx, dy] = MATTE_RAYS[d]!;
    let found = 0;
    for (const distance of steps) {
      const xx = x + dx * distance,
        yy = y + dy * distance;
      if (xx < 0 || xx >= width || yy < 0 || yy >= height) break;
      const n = yy * width + xx,
        sample = n * 4;
      const label = labels[n];
      if ((label !== 0 && label !== 1) || image.data[sample + 3]! < 224) continue;
      const bit = 1 << label;
      if (!(missing & bit) || found & bit) continue;
      const k = label * 4,
        weight = 1 / Math.sqrt(distance);
      for (let c = 0; c < 3; c++) colors[k + c]! += linear[image.data[sample + c]!]! * weight;
      colors[k + 3]! += weight;
      const candidate = d * 2 + label;
      candidates[candidate] = n;
      if (guided) {
        candidateDistances[candidate] = Math.hypot(xx - x, yy - y);
        for (let c = 0; c < 3; c++)
          candidateColors[candidate * 3 + c] = linear[image.data[sample + c]!]!;
      }
      found |= bit;
      if (found === missing) break;
    }
  };
  for (let y = 0; y < height; y++) {
    if ((y & 15) === 0) checkV3(options);
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        at = i * 4;
      let alpha = matte[i]!;
      if (alpha > 0 && alpha < 1 && radius > 0) {
        colors.fill(0);
        candidates.fill(-1);
        for (let d = 0; d < MATTE_RAYS.length; d++) {
          let rayDistances = distances;
          if (visibleRays) {
            const slot = visibleRays.slots[i]!;
            const n = visibleRays.samples[(slot - 1) * MATTE_RAYS.length + d]! - 1;
            if (n < 0) continue;
            nearestDistance[0] = Math.max(
              Math.abs((n % width) - x),
              Math.abs(Math.floor(n / width) - y),
            );
            rayDistances = nearestDistance;
          }
          collectRay(x, y, d, rayDistances);
        }
        if (anchors) {
          for (const label of [0, 1] as const) {
            const n = anchors[label][i]!;
            if (n < 0) continue;
            const candidate = 16 + label;
            const color = label * 4;
            candidates[candidate] = n;
            candidateDistances[candidate] = Math.hypot((n % width) - x, Math.floor(n / width) - y);
            for (let c = 0; c < 3; c++) {
              const value = linear[image.data[n * 4 + c]!]!;
              candidateColors[candidate * 3 + c] = value;
              if (!colors[color + 3]) colors[color + c] = value;
            }
            if (!colors[color + 3]) colors[color + 3] = 1;
          }
        }
        if (visibleRays) {
          // A thin hole can have no hard background pixel within its own
          // boundary. Use distant color samples only for the missing class.
          const missing = (colors[3] ? 0 : 1) | (colors[7] ? 0 : 2);
          if (missing)
            for (let d = 0; d < MATTE_RAYS.length; d++) collectRay(x, y, d, distances, missing);
        }
        if (colors[3]! && colors[7]!) {
          if (guided) {
            for (let c = 0; c < 3; c++) observed[c] = linear[image.data[at + c]!]!;
            // Fit actual nearby color pairs instead of averaging across hair,
            // clothing and an occluder. A mean of unrelated colors is not a
            // physically valid foreground/background pair.
            let best = Infinity,
              bestF = -1,
              bestB = -1;
            for (let f = 1; f < candidates.length; f += 2) {
              const fi = candidates[f]!;
              if (fi < 0) continue;
              for (let b = 0; b < candidates.length; b += 2) {
                const bi = candidates[b]!;
                if (bi < 0) continue;
                let dot = 0,
                  contrast = 0;
                for (let c = 0; c < 3; c++) {
                  const bg = candidateColors[b * 3 + c]!,
                    span = candidateColors[f * 3 + c]! - bg;
                  dot += (observed[c]! - bg) * span;
                  contrast += span * span;
                }
                if (contrast < 0.002) continue;
                const value = clamp(dot / contrast);
                let error = 0;
                for (let c = 0; c < 3; c++) {
                  const bg = candidateColors[b * 3 + c]!,
                    fg = candidateColors[f * 3 + c]!;
                  error += (observed[c]! - bg - value * (fg - bg)) ** 2;
                }
                const distance =
                  (candidateDistances[f]! + candidateDistances[b]!) / Math.max(1, radius * 2);
                const score = error / contrast + 0.0002 * (value - alpha) ** 2 + 0.00002 * distance;
                if (score < best) {
                  best = score;
                  bestF = fi;
                  bestB = bi;
                }
              }
            }
            if (bestF >= 0) {
              for (let c = 0; c < 3; c++) {
                colors[c] = linear[image.data[bestB * 4 + c]!]!;
                colors[c + 4] = linear[image.data[bestF * 4 + c]!]!;
              }
              colors[3] = colors[7] = 1;
            }
          }
          let dot = 0,
            contrast = 0;
          for (let c = 0; c < 3; c++) {
            const bg = colors[c]! / colors[3]!,
              fg = colors[4 + c]! / colors[7]!;
            dot += (linear[image.data[at + c]!]! - bg) * (fg - bg);
            contrast += (fg - bg) ** 2;
          }
          // Regularization retains the semantic prior where both sides have similar colors.
          const regularizer = guided ? 0.003 : 0.015;
          const fitted = clamp((dot + regularizer * alpha) / (contrast + regularizer));
          // The continuous matte already models translucent pixels. Color pairs
          // can sharpen its edge, with limited influence in low-contrast areas.
          alpha = continuous
            ? alpha + 0.15 * Math.min(1, contrast / 0.03) * (fitted - alpha)
            : fitted;
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
