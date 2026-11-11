import { validateImage, srgbToLinear, linearToSrgb } from './engine.js';
import { checkV3, clamp01 } from './v3-pixels.js';
import { compileSelectionMaskV3 } from './v3-mask.js';
import { parseSelectionMaskV3 } from './v3-recipe.js';
import type { RGBAImage, RenderOptions } from './types.js';
import type { SelectionMaskV3 } from './v3-types.js';

export interface PhotoRestorationSettings {
  algorithm: 'photo-restore-v1';
  /** Independent signal controls. Zero is an exact no-op. */
  luminanceNoise: number;
  chromaNoise: number;
  /** A measured/selected linear motion PSF in source pixels, not generative detail. */
  motion: { length: number; angle: number; iterations: number; strength: number };
  selection?: SelectionMaskV3;
  protection?: SelectionMaskV3;
}
const maximumWork = 134_217_728;
const maximumPixels = 4_194_304;
const decode = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
type Tap = { dx: number; dy: number; weight: number };

/** Integrate a uniform line PSF into pixel bins, retaining subpixel angle. */
export function motionKernel(length: number, angle: number): Tap[] {
  if (
    !Number.isFinite(length) ||
    length < 0 ||
    length > 31 ||
    !Number.isFinite(angle) ||
    angle < -180 ||
    angle > 180
  )
    throw new RangeError('Motion PSF outside the supported range');
  const weights = new Map<string, Tap>(),
    steps = Math.max(1, Math.ceil(length * 4));
  const radians = (angle * Math.PI) / 180;
  for (let i = 0; i < steps; i++) {
    const offset = ((i + 0.5) / steps - 0.5) * length;
    const px = offset * Math.cos(radians),
      py = offset * Math.sin(radians);
    const x = Math.floor(px),
      y = Math.floor(py),
      fx = px - x,
      fy = py - y;
    for (const [dx, dy, w] of [
      [x, y, (1 - fx) * (1 - fy)],
      [x + 1, y, fx * (1 - fy)],
      [x, y + 1, (1 - fx) * fy],
      [x + 1, y + 1, fx * fy],
    ]) {
      if (w! < 1e-10) continue;
      const key = `${dx},${dy}`,
        tap = weights.get(key) ?? { dx: dx!, dy: dy!, weight: 0 };
      tap.weight += w! / steps;
      weights.set(key, tap);
    }
  }
  return [...weights.values()];
}

export function restorationCost(
  width: number,
  height: number,
  settings: Pick<
    PhotoRestorationSettings,
    'algorithm' | 'luminanceNoise' | 'chromaNoise' | 'motion'
  >,
) {
  const m = settings.motion;
  if (
    settings.algorithm !== 'photo-restore-v1' ||
    ![settings.luminanceNoise, settings.chromaNoise].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 100,
    ) ||
    !m ||
    !Number.isFinite(m.length) ||
    m.length < 0 ||
    m.length > 31 ||
    !Number.isFinite(m.angle) ||
    m.angle < -180 ||
    m.angle > 180 ||
    !Number.isSafeInteger(m.iterations) ||
    m.iterations < 1 ||
    m.iterations > 12 ||
    !Number.isFinite(m.strength) ||
    m.strength < 0 ||
    m.strength > 1
  )
    throw new RangeError('Invalid photo restoration settings');
  const taps = m.length > 0 && m.strength > 0 ? motionKernel(m.length, m.angle).length : 0;
  const pixels = width * height;
  const work =
    pixels *
    ((settings.luminanceNoise || settings.chromaNoise ? 25 : 0) + taps * (2 * m.iterations + 2));
  return {
    pixels,
    taps,
    work,
    maxWork: maximumWork,
    maxPixels: maximumPixels,
    available:
      Number.isSafeInteger(width) &&
      Number.isSafeInteger(height) &&
      width > 0 &&
      height > 0 &&
      width <= 8192 &&
      height <= 8192 &&
      pixels <= maximumPixels &&
      work <= maximumWork,
  };
}

/** Deterministic scene restoration. It cannot reconstruct content erased by
 * clipping/occlusion or estimate an unknown blur kernel from a single image. */
export function renderPhotoRestoration(
  image: RGBAImage,
  settings: PhotoRestorationSettings,
  options: RenderOptions = {},
): RGBAImage {
  validateImage(image, { ...options, maxPixels: maximumPixels });
  const cost = restorationCost(image.width, image.height, settings);
  if (!cost.available) throw new RangeError('Photo restoration working budget exceeded');
  const selected = settings.selection
    ? compileSelectionMaskV3(parseSelectionMaskV3(settings.selection), image, image)
    : () => 1;
  const protectedAt = settings.protection
    ? compileSelectionMaskV3(parseSelectionMaskV3(settings.protection), image, image)
    : () => 0;
  const { width, height } = image,
    n = width * height,
    data = image.data.slice();
  if (!settings.luminanceNoise && !settings.chromaNoise && !cost.taps)
    return { width, height, data };
  const alpha = new Float32Array(n),
    yPlane = new Float32Array(n),
    u = new Float32Array(n),
    v = new Float32Array(n);
  for (let at = 0; at < n; at++) {
    if ((at & 16383) === 0) checkV3(options);
    alpha[at] = image.data[at * 4 + 3]! / 255;
    if (!alpha[at]) continue;
    const r = decode[image.data[at * 4]!]!,
      g = decode[image.data[at * 4 + 1]!]!,
      b = decode[image.data[at * 4 + 2]!]!;
    yPlane[at] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    u[at] = r - yPlane[at]!;
    v[at] = b - yPlane[at]!;
  }
  let luminance = yPlane;
  let outU = u,
    outV = v;
  if (settings.luminanceNoise || settings.chromaNoise) {
    luminance = new Float32Array(n);
    outU = new Float32Array(n);
    outV = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      if ((y & 15) === 0) checkV3(options);
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        if (!alpha[at]) continue;
        let sum = 0,
          l = 0,
          c1 = 0,
          c2 = 0;
        const noise = 0.003 + 0.018 * (1 - Math.sqrt(yPlane[at]!));
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx,
              yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const p = yy * width + xx;
            const delta = yPlane[p]! - yPlane[at]!;
            const w = alpha[p]! / ((1 + (dx * dx + dy * dy) / 2) * (1 + (delta * delta) / noise));
            sum += w;
            l += yPlane[p]! * w;
            c1 += u[p]! * w;
            c2 += v[p]! * w;
          }
        luminance[at] = yPlane[at]! + ((l / sum - yPlane[at]!) * settings.luminanceNoise) / 100;
        outU[at] = u[at]! + ((c1 / sum - u[at]!) * settings.chromaNoise) / 100;
        outV[at] = v[at]! + ((c2 / sum - v[at]!) * settings.chromaNoise) / 100;
      }
    }
  }
  if (cost.taps) {
    const taps = motionKernel(settings.motion.length, settings.motion.angle);
    const normal = new Float32Array(n),
      backNormal = new Float32Array(n);
    const blurred = new Float32Array(n),
      ratio = new Float32Array(n),
      back = new Float32Array(n);
    const estimate = luminance.slice();
    const visit = (run: (at: number, p: number, w: number) => void) => {
      for (let y = 0; y < height; y++) {
        if ((y & 15) === 0) checkV3(options);
        for (let x = 0; x < width; x++) {
          const at = y * width + x;
          if (!alpha[at]) continue;
          for (const tap of taps) {
            const xx = x + tap.dx,
              yy = y + tap.dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            const p = yy * width + xx;
            if (alpha[p]) run(at, p, tap.weight * alpha[p]!);
          }
        }
      }
    };
    visit((at, _p, w) => {
      normal[at]! += w;
    });
    visit((at, p, w) => {
      backNormal[p]! += w / normal[at]!;
    });
    for (let iteration = 0; iteration < settings.motion.iterations; iteration++) {
      blurred.fill(0);
      back.fill(0);
      visit((at, p, w) => {
        blurred[at]! += (estimate[p]! * w) / normal[at]!;
      });
      for (let at = 0; at < n; at++)
        ratio[at] = alpha[at] ? luminance[at]! / Math.max(1e-5, blurred[at]!) : 0;
      visit((at, p, w) => {
        back[p]! += (ratio[at]! * w) / normal[at]!;
      });
      for (let at = 0; at < n; at++)
        if (alpha[at]) {
          // Bounded multiplicative steps damp ringing/noise amplification.
          const correction = Math.max(
            0.5,
            Math.min(2, back[at]! / Math.max(1e-8, backNormal[at]!)),
          );
          estimate[at] = Math.max(0, Math.min(1, estimate[at]! * correction));
        }
    }
    const result = new Float32Array(n);
    for (let at = 0; at < n; at++)
      result[at] = luminance[at]! + (estimate[at]! - luminance[at]!) * settings.motion.strength;
    luminance = result;
  }
  for (let y = 0; y < height; y++) {
    if ((y & 15) === 0) checkV3(options);
    for (let x = 0; x < width; x++) {
      const at = y * width + x,
        src = at * 4;
      if (!alpha[at]) continue;
      const amount =
        selected((x + 0.5) / width, (y + 0.5) / height) *
        (1 - protectedAt((x + 0.5) / width, (y + 0.5) / height));
      if (!amount) continue;
      const r = luminance[at]! + outU[at]!,
        b = luminance[at]! + outV[at]!;
      const g = (luminance[at]! - 0.2126 * r - 0.0722 * b) / 0.7152;
      for (let c = 0; c < 3; c++) {
        const original = decode[data[src + c]!]!;
        data[src + c] = 255 * linearToSrgb(clamp01(original + ([r, g, b][c]! - original) * amount));
      }
    }
  }
  return { width, height, data };
}
