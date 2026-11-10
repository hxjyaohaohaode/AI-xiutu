import { compileSelectionMaskV3, getSelectionBoundsV3 } from './v3-mask.js';
import { checkV3, clamp01 } from './v3-pixels.js';
import {
  MAX_V4_HEAL_ROI_PIXELS,
  MAX_V4_HEAL_TARGET_PIXELS,
  MAX_V4_HEAL_WORK,
  type HealingOperationV4,
  type RetouchRegionV4,
} from './v4-types.js';
import type { SelectionMaskV3 } from './v3-types.js';
import type { RGBAImage, RenderOptions } from './types.js';
import { exemplarFill } from './exemplar.js';
import { guidedRetouch } from './guided-retouch.js';

export interface SpatialRegionV4 {
  left: number;
  top: number;
  width: number;
  height: number;
  weights: Float32Array;
  targetPixels: number;
}
export const MAX_V4_RETOUCH_PIXELS = 4_194_304;
/** Scan before allocating an ROI; transparent and fully protected pixels are never targets. */
function region(
  image: RGBAImage,
  mask: SelectionMaskV3,
  protection: SelectionMaskV3 | null,
  original: RGBAImage,
  options: RenderOptions,
  maxTarget: number,
  maxRoi: number,
): SpatialRegionV4 | null {
  const support = getSelectionBoundsV3(mask, image);
  // Expand by one source pixel to cover exact boundaries and floating-point
  // rounding; the original sampler still determines every individual weight.
  const scanLeft = Math.max(0, Math.floor(support.x * image.width) - 1);
  const scanTop = Math.max(0, Math.floor(support.y * image.height) - 1);
  const scanRight = Math.min(image.width, Math.ceil((support.x + support.width) * image.width) + 1);
  const scanBottom = Math.min(
    image.height,
    Math.ceil((support.y + support.height) * image.height) + 1,
  );
  const selected = compileSelectionMaskV3(mask, image, original),
    protectedAt = protection ? compileSelectionMaskV3(protection, image, original) : null;
  const weight = (x: number, y: number) => {
    if (image.data[(y * image.width + x) * 4 + 3] === 0) return 0;
    const u = (x + 0.5) / image.width,
      v = (y + 0.5) / image.height;
    return selected(u, v) * (1 - (protectedAt?.(u, v) ?? 0));
  };
  let left = image.width,
    top = image.height,
    right = -1,
    bottom = -1,
    count = 0;
  for (let y = scanTop; y < scanBottom; y++) {
    if (((y - scanTop) & 15) === 0) checkV3(options);
    for (let x = scanLeft; x < scanRight; x++) {
      if (weight(x, y) <= 1 / 65535) continue;
      if (++count > maxTarget)
        throw new RangeError(
          'Local repair/retouch target budget exceeded; split into smaller operations',
        );
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return null;
  left = Math.max(0, left - 1);
  top = Math.max(0, top - 1);
  right = Math.min(image.width - 1, right + 1);
  bottom = Math.min(image.height - 1, bottom + 1);
  const width = right - left + 1,
    height = bottom - top + 1;
  if (width * height > maxRoi)
    throw new RangeError(
      'Local repair/retouch bounding-box budget exceeded; separate distant selections',
    );
  const weights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    if ((y & 31) === 0) checkV3(options);
    for (let x = 0; x < width; x++) weights[y * width + x] = weight(left + x, top + y);
  }
  return { left, top, width, height, weights, targetPixels: count };
}

interface Donor {
  dx: number;
  dy: number;
}
function donorFor(
  image: RGBAImage,
  roi: SpatialRegionV4,
  operation: HealingOperationV4,
  options: RenderOptions,
): Donor {
  const { left, top, width, height, weights } = roi;
  const boundary: number[] = [];
  const targets: number[] = [];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      if (weights[at]! > 1 / 65535) targets.push(at);
      else if (
        (x > 0 && weights[at - 1]! > 0) ||
        (x + 1 < width && weights[at + 1]! > 0) ||
        (y > 0 && weights[at - width]! > 0) ||
        (y + 1 < height && weights[at + width]! > 0)
      )
        boundary.push(at);
    }
  if (!boundary.length) throw new RangeError('Healing needs a visible unselected boundary');
  const probes = boundary.filter(
      (_, i) => i % Math.max(1, Math.floor(boundary.length / 256)) === 0,
    ),
    targetProbes = targets.filter(
      (_, i) => i % Math.max(1, Math.floor(targets.length / 256)) === 0,
    );
  function admissible(dx: number, dy: number) {
    if (dx === 0 && dy === 0) return false;
    if (
      left + dx < 0 ||
      top + dy < 0 ||
      left + width + dx > image.width ||
      top + height + dy > image.height
    )
      return false;
    // No unknown pixel may be copied back into the repair. Check the whole target, not just search probes.
    for (const at of targets) {
      const x = (at % width) + dx,
        y = Math.floor(at / width) + dy;
      if (x >= 0 && x < width && y >= 0 && y < height && weights[y * width + x]! > 1 / 65535)
        return false;
    }
    // Gradients and boundary scoring read neighbours too. Checking only target
    // alpha would let hidden RGB from a transparent donor edge affect the fill.
    for (let y = -1; y <= height; y++) {
      if ((y & 31) === 0) checkV3(options);
      for (let x = -1; x <= width; x++) {
        const gx = Math.max(0, Math.min(image.width - 1, left + x + dx)),
          gy = Math.max(0, Math.min(image.height - 1, top + y + dy));
        if (image.data[(gy * image.width + gx) * 4 + 3]! !== 255) return false;
      }
    }
    return true;
  }
  const score = (dx: number, dy: number) => {
    const mean = [0, 0, 0];
    for (const at of probes) {
      const x = left + (at % width),
        y = top + Math.floor(at / width),
        a = (y * image.width + x) * 4,
        b = ((y + dy) * image.width + x + dx) * 4;
      for (let c = 0; c < 3; c++) mean[c]! += image.data[a + c]! - image.data[b + c]!;
    }
    for (let c = 0; c < 3; c++) mean[c]! /= probes.length;
    let sum = 0;
    for (const at of probes) {
      const x = left + (at % width),
        y = top + Math.floor(at / width),
        a = (y * image.width + x) * 4,
        b = ((y + dy) * image.width + x + dx) * 4;
      for (let c = 0; c < 3; c++) sum += (image.data[a + c]! - image.data[b + c]! - mean[c]!) ** 2;
    }
    // A weak absolute-color penalty avoids unrelated color patches with coincidentally flat texture.
    return (
      sum / probes.length + mean.reduce((n, v) => n + v * v, 0) * 0.08 + Math.hypot(dx, dy) * 0.001
    );
  };
  if (operation.source) {
    const dx = Math.round(operation.source.x * image.width - (left + width / 2)),
      dy = Math.round(operation.source.y * image.height - (top + height / 2));
    if (!admissible(dx, dy))
      throw new RangeError(
        'Healing donor overlaps the target, transparency, or image boundary; choose another source',
      );
    return { dx, dy };
  }
  const radius = Math.max(2, operation.searchRadius * Math.min(image.width, image.height));
  let best: Donor | null = null,
    bestScore = Infinity;
  const visited = new Set<string>();
  for (const fraction of [0.25, 0.5, 0.75, 1])
    for (let direction = 0; direction < 24; direction++) {
      checkV3(options);
      const angle = (direction * Math.PI) / 12,
        dx = Math.round(Math.cos(angle) * radius * fraction),
        dy = Math.round(Math.sin(angle) * radius * fraction),
        key = `${dx},${dy}`;
      if (visited.has(key)) continue;
      visited.add(key);
      // Fast opaque test before the bounded full-target admissibility check.
      if (
        targetProbes.some((at) => {
          const x = left + (at % width) + dx,
            y = top + Math.floor(at / width) + dy;
          return (
            x < 0 ||
            y < 0 ||
            x >= image.width ||
            y >= image.height ||
            image.data[(y * image.width + x) * 4 + 3]! < 255
          );
        }) ||
        !admissible(dx, dy)
      )
        continue;
      const value = score(dx, dy);
      if (value < bestScore) {
        bestScore = value;
        best = { dx, dy };
      }
    }
  if (!best)
    throw new RangeError(
      'No valid surrounding donor in the chosen search radius; select a source or use diffusion',
    );
  return best;
}

/** Encoded-sRGB harmonic fill or donor-gradient Poisson blending with fixed visible boundaries.
 * This repairs small defects; it is not semantic object reconstruction or a neural model. */
export function applyHealingV4(
  image: RGBAImage,
  operations: HealingOperationV4[],
  original: RGBAImage,
  options: RenderOptions,
): RGBAImage {
  let current = image,
    totalWork = 0;
  const exemplarBudget = { used: 0 };
  for (const op of operations) {
    if (!op.enabled || op.opacity === 0) continue;
    const roi = region(
      current,
      op.mask,
      op.protection,
      original,
      options,
      MAX_V4_HEAL_TARGET_PIXELS,
      MAX_V4_HEAL_ROI_PIXELS,
    );
    if (!roi) continue;
    if (op.method === 'exemplar-v1') {
      current = exemplarFill(current, roi, op, options, exemplarBudget);
      continue;
    }
    const { width, height, left, top, weights } = roi,
      size = width * height;
    totalWork += size * op.iterations;
    if (totalWork > MAX_V4_HEAL_WORK)
      throw new RangeError(
        'Healing iteration budget exceeded; reduce selection or solver iterations',
      );
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (current.data[((top + y) * current.width + left + x) * 4 + 3] !== 255)
          throw new RangeError(
            'Healing currently needs an opaque target neighbourhood; move the selection away from transparent edges',
          );
    const donor = op.method === 'patch-poisson' ? donorFor(current, roi, op, options) : null;
    const work = new Float32Array(size * 3),
      guidance = donor ? new Float32Array(size * 3) : null,
      means = [0, 0, 0];
    let known = 0;
    const byte = (x: number, y: number, c: number) =>
      current.data[
        (Math.max(0, Math.min(current.height - 1, y)) * current.width +
          Math.max(0, Math.min(current.width - 1, x))) *
          4 +
          c
      ]! / 255;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = y * width + x,
          globalX = left + x,
          globalY = top + y;
        if (weights[at]! <= 1 / 65535) known++;
        for (let c = 0; c < 3; c++) {
          const value = byte(globalX, globalY, c);
          work[at * 3 + c] = value;
          if (weights[at]! <= 1 / 65535) means[c]! += value;
          if (guidance && donor) {
            const sx = globalX + donor.dx,
              sy = globalY + donor.dy;
            guidance[at * 3 + c] =
              op.texture *
              (4 * byte(sx, sy, c) -
                byte(sx - 1, sy, c) -
                byte(sx + 1, sy, c) -
                byte(sx, sy - 1, c) -
                byte(sx, sy + 1, c));
          }
        }
      }
    if (!known)
      throw new RangeError(
        'Healing needs an unselected boundary; the whole image cannot be a repair hole',
      );
    for (let at = 0; at < size; at++)
      if (weights[at]! > 1 / 65535)
        for (let c = 0; c < 3; c++) work[at * 3 + c] = means[c]! / known;
    for (let iteration = 0; iteration < op.iterations; iteration++) {
      checkV3(options);
      for (let parity = 0; parity < 2; parity++)
        for (let y = 0; y < height; y++) {
          if ((y & 31) === 0) checkV3(options);
          for (let x = (y + parity) & 1; x < width; x += 2) {
            const at = y * width + x;
            if (weights[at]! <= 1 / 65535) continue;
            const l = (y * width + Math.max(0, x - 1)) * 3,
              r = (y * width + Math.min(width - 1, x + 1)) * 3,
              t = (Math.max(0, y - 1) * width + x) * 3,
              b = (Math.min(height - 1, y + 1) * width + x) * 3;
            for (let c = 0; c < 3; c++)
              work[at * 3 + c] =
                (work[l + c]! +
                  work[r + c]! +
                  work[t + c]! +
                  work[b + c]! +
                  (guidance?.[at * 3 + c] ?? 0)) /
                4;
          }
        }
    }
    const data = new Uint8ClampedArray(current.data);
    for (let y = 0; y < height; y++) {
      if ((y & 31) === 0) checkV3(options);
      for (let x = 0; x < width; x++) {
        const local = y * width + x,
          amount = weights[local]! * op.opacity;
        if (amount <= 1 / 65535) continue;
        const at = ((top + y) * current.width + left + x) * 4;
        for (let c = 0; c < 3; c++)
          data[at + c] =
            current.data[at + c]! +
            (clamp01(work[local * 3 + c]!) * 255 - current.data[at + c]!) * amount;
      }
    }
    current = { width: image.width, height: image.height, data };
  }
  checkV3(options);
  return current;
}

export const retouchActiveV4 = (r: RetouchRegionV4) =>
  r.enabled &&
  r.opacity > 0 &&
  [r.smoothing, r.texture, r.uniformity, r.shine, r.speckle, r.fineLines, r.chromaSpots ?? 0].some((v) => v !== 0);

/** Separate edge-aware luminance, signed detail, chroma, highlight and impulse operators.
 * The 5x5 spatial sampling is deterministic and bounded, not a trained skin detector. */
export function applyRetouchV4(
  image: RGBAImage,
  operations: RetouchRegionV4[],
  original: RGBAImage,
  options: RenderOptions,
): RGBAImage {
  let current = image,
    processed = 0;
  for (const op of operations) {
    if (!retouchActiveV4(op)) continue;
    const roi = region(
      current,
      op.mask,
      op.protection,
      original,
      options,
      MAX_V4_RETOUCH_PIXELS,
      MAX_V4_RETOUCH_PIXELS,
    );
    if (!roi) continue;
    processed += roi.targetPixels;
    if (processed > MAX_V4_RETOUCH_PIXELS)
      throw new RangeError(
        'Retouch combined target budget exceeded; split this edit into versions',
      );
    if (op.algorithm) {
      current = guidedRetouch(current, roi, op, options);
      continue;
    }
    const data = new Uint8ClampedArray(current.data),
      radius = Math.max(1, Math.round(op.radius * Math.min(image.width, image.height))),
      rgb = [0, 0, 0],
      localValues = new Float64Array(9);
    const yAt = (at: number) =>
      (0.2126 * current.data[at]! +
        0.7152 * current.data[at + 1]! +
        0.0722 * current.data[at + 2]!) /
      255;
    const atXY = (x: number, y: number) =>
      (Math.max(0, Math.min(image.height - 1, y)) * image.width +
        Math.max(0, Math.min(image.width - 1, x))) *
      4;
    for (let y = 0; y < roi.height; y++) {
      if ((y & 15) === 0) checkV3(options);
      for (let x = 0; x < roi.width; x++) {
        const amount = roi.weights[y * roi.width + x]! * op.opacity;
        if (amount <= 1 / 65535) continue;
        const gx = roi.left + x,
          gy = roi.top + y,
          at = atXY(gx, gy),
          lum = yAt(at);
        let sum = 0,
          meanY = 0,
          broadY = 0,
          broadWeight = 0;
        rgb.fill(0);
        for (let sy = -2; sy <= 2; sy++)
          for (let sx = -2; sx <= 2; sx++) {
            const n = atXY(gx + Math.round((sx * radius) / 2), gy + Math.round((sy * radius) / 2)),
              ny = yAt(n),
              spatial = (Math.exp(-(sx * sx + sy * sy) / 4) * current.data[n + 3]!) / 255,
              edgeWeight = spatial / (1 + ((ny - lum) / 0.08) ** 2);
            sum += edgeWeight;
            meanY += ny * edgeWeight;
            broadY += ny * spatial;
            broadWeight += spatial;
            for (let c = 0; c < 3; c++) rgb[c]! += (current.data[n + c]! / 255) * edgeWeight;
          }
        if (sum <= 0) continue;
        meanY /= sum;
        broadY /= Math.max(1e-12, broadWeight);
        for (let c = 0; c < 3; c++) rgb[c]! /= sum;
        let index = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const n = atXY(gx + dx, gy + dy);
            localValues[index++] = current.data[n + 3]! > 0 ? yAt(n) : lum;
          }
        localValues.sort();
        const median = localValues[4]!,
          residual = lum - meanY,
          impulse = Math.abs(lum - median) > 0.055 ? median - lum : 0,
          darkLine = Math.max(0, median - lum - 0.01),
          shine = Math.max(0, lum - Math.max(0.58, broadY + 0.045)),
          lumDelta =
            (((meanY - lum) * op.smoothing) / 100) * 0.85 +
            ((residual * op.texture) / 100) * 1.5 +
            (impulse * op.speckle) / 100 +
            ((darkLine * op.fineLines) / 100) * 0.8 -
            ((shine * op.shine) / 100) * 0.85;
        for (let c = 0; c < 3; c++) {
          const before = current.data[at + c]! / 255,
            chromaDelta = ((rgb[c]! - meanY - (before - lum)) * op.uniformity) / 100;
          data[at + c] = (before + (lumDelta + chromaDelta) * amount) * 255;
        }
      }
    }
    current = { width: image.width, height: image.height, data };
  }
  checkV3(options);
  return current;
}
