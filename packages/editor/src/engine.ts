import { compileCurveFunction, isIdentityCurve } from './curves.js';
import { getOutputDimensions, pixelCrop, sourcePixel, validateDimensions } from './geometry.js';
import { radialMaskWeight } from './mask.js';
import { parseRecipe } from './recipe.js';
import { ADJUSTMENT_IDS } from './registry.js';
import { encodeFloat32Byte } from './linear-byte.js';
import { srgbToLinear, linearToSrgb } from './transfer.js';
export { srgbToLinear, linearToSrgb } from './transfer.js';
import type {
  Adjustments,
  CurveChannel,
  Curves,
  Histogram,
  RecipeV1,
  RenderOptions,
  RGBAImage,
} from './types.js';

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const DECODE = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
const channels: CurveChannel[] = ['rgb', 'red', 'green', 'blue'];
type CompiledCurves = Record<CurveChannel, ((value: number) => number) | null>;

export class RenderAbortedError extends Error {
  constructor() {
    super('Image rendering was canceled');
    this.name = 'RenderAbortedError';
  }
}

function checkAbort(options: RenderOptions): void {
  if (options.signal?.aborted) throw new RenderAbortedError();
}

export function validateImage(image: RGBAImage, options: RenderOptions = {}): void {
  if (!image || typeof image !== 'object') throw new TypeError('Expected an RGBA image');
  validateDimensions(image, options.maxPixels);
  if (
    !(image.data instanceof Uint8ClampedArray) ||
    image.data.length !== image.width * image.height * 4
  )
    throw new TypeError('Image data must contain exactly width × height × 4 RGBA8 bytes');
  checkAbort(options);
}

const neutral = (a: Adjustments): boolean => ADJUSTMENT_IDS.every((id) => a[id] === 0);

function compileCurves(curves: Curves): CompiledCurves {
  return Object.fromEntries(
    channels.map((channel) => [
      channel,
      isIdentityCurve(curves[channel])
        ? null
        : compileCurveFunction(curves[channel], curves.interpolation?.[channel] ?? 'linear'),
    ]),
  ) as CompiledCurves;
}

export const NO_CURVES: CompiledCurves = { rgb: null, red: null, green: null, blue: null };

export interface Tone {
  gains: [number, number, number];
  brightness: number;
  contrast: number;
  shadowKnot: number;
  highlightKnot: number;
  whites: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  active: boolean;
}

export function tone(a: Adjustments): Tone {
  const temperature = a.temperature / 100;
  const tint = a.tint / 100;
  return {
    gains: [
      2 ** (a.exposure + 0.35 * temperature + 0.12 * tint),
      2 ** (a.exposure - 0.18 * tint),
      2 ** (a.exposure - 0.35 * temperature + 0.12 * tint),
    ],
    brightness: 2 ** (-a.brightness / 100),
    contrast: 2 ** (a.contrast / 100),
    shadowKnot: 0.25 + (0.16 * a.shadows) / 100,
    highlightKnot: 0.75 + (0.16 * a.highlights) / 100,
    whites: (0.2 * a.whites) / 100,
    blacks: (0.2 * a.blacks) / 100,
    saturation: 1 + a.saturation / 100,
    vibrance: (0.75 * a.vibrance) / 100,
    active: ADJUSTMENT_IDS.some((id) => id !== 'sharpness' && id !== 'soften' && a[id] !== 0),
  };
}

/** Map linear RGB through declared linear and display-encoded stages, then back to linear. */
export function mapPoint(
  r: number,
  g: number,
  b: number,
  t: Tone,
  curves: CompiledCurves,
  output: Float32Array,
  index: number,
): void {
  if (
    !t.active &&
    curves.rgb === null &&
    curves.red === null &&
    curves.green === null &&
    curves.blue === null
  ) {
    output[index] = r;
    output[index + 1] = g;
    output[index + 2] = b;
    return;
  }
  r = clamp(linearToSrgb(clamp(r * t.gains[0])));
  g = clamp(linearToSrgb(clamp(g * t.gains[1])));
  b = clamp(linearToSrgb(clamp(b * t.gains[2])));
  mapEncodedPoint(r, g, b, t, curves, output, index);
}

function mapEncodedPoint(
  r: number,
  g: number,
  b: number,
  t: Tone,
  curves: CompiledCurves,
  output: Float32Array,
  index: number,
): void {
  if (t.active) {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let changed = t.brightness === 1 ? y : y ** t.brightness;
    if (t.contrast !== 1)
      changed =
        changed < 0.5
          ? 0.5 * (2 * changed) ** t.contrast
          : 1 - 0.5 * (2 * (1 - changed)) ** t.contrast;
    if (changed < 0.25) changed = (changed * t.shadowKnot) / 0.25;
    else if (changed < 0.75)
      changed = t.shadowKnot + ((changed - 0.25) * (t.highlightKnot - t.shadowKnot)) / 0.5;
    else changed = t.highlightKnot + ((changed - 0.75) * (1 - t.highlightKnot)) / 0.25;
    changed = clamp(changed + t.blacks * (1 - changed) + t.whites * changed);
    const delta = changed - y;
    r = clamp(r + delta);
    g = clamp(g + delta);
    b = clamp(b + delta);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    const amount = t.saturation * (1 + t.vibrance * (1 - spread));
    r = clamp(luminance + (r - luminance) * amount);
    g = clamp(luminance + (g - luminance) * amount);
    b = clamp(luminance + (b - luminance) * amount);
  }
  if (curves.rgb) {
    r = curves.rgb(r);
    g = curves.rgb(g);
    b = curves.rgb(b);
  }
  if (curves.red) r = curves.red(r);
  if (curves.green) g = curves.green(g);
  if (curves.blue) b = curves.blue(b);
  output[index] = srgbToLinear(r);
  output[index + 1] = srgbToLinear(g);
  output[index + 2] = srgbToLinear(b);
}

/**
 * Both controls read the same immutable stage input. Soften is alpha-weighted
 * bilateral smoothing; sharpness adds a thresholded Gaussian high-pass.
 * Alpha is never blurred. Transparent RGB cannot bleed into visible neighbors.
 */
function detailValue(
  value: number,
  gaussian: number,
  bilateral: number,
  gaussianWeight: number,
  bilateralWeight: number,
  soften: number,
  sharpen: number,
): number {
  const smooth = bilateralWeight > 0 ? bilateral / bilateralWeight : value;
  const blur = gaussianWeight > 0 ? gaussian / gaussianWeight : value;
  const high = value - blur;
  const thresholded = Math.sign(high) * Math.max(0, Math.abs(high) - 0.003);
  return clamp(value + soften * (smooth - value) + sharpen * thresholded);
}

export function detailPoint(
  source: Float32Array,
  image: RGBAImage,
  x: number,
  y: number,
  a: Adjustments,
  result: Float64Array,
): void {
  const center = (y * image.width + x) * 3;
  const cr = source[center]!;
  const cg = source[center + 1]!;
  const cb = source[center + 2]!;
  let gaussianWeight = 0;
  let gr = 0;
  let gg = 0;
  let gb = 0;
  let bilateralWeight = 0;
  let br = 0;
  let bg = 0;
  let bb = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    const sy = Math.min(image.height - 1, Math.max(0, y + dy));
    for (let dx = -1; dx <= 1; dx += 1) {
      const sx = Math.min(image.width - 1, Math.max(0, x + dx));
      const p = sy * image.width + sx;
      const alpha = image.data[p * 4 + 3]! / 255;
      if (alpha === 0) continue;
      const i = p * 3;
      const r = source[i]!;
      const g = source[i + 1]!;
      const b = source[i + 2]!;
      const weight = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1) * alpha;
      gaussianWeight += weight;
      gr += r * weight;
      gg += g * weight;
      gb += b * weight;
      const difference = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
      const edgeWeight = weight / (1 + difference / 0.004);
      bilateralWeight += edgeWeight;
      br += r * edgeWeight;
      bg += g * edgeWeight;
      bb += b * edgeWeight;
    }
  }
  const soften = (a.soften / 100) * 0.8;
  const sharpen = (a.sharpness / 100) * 1.5;
  result[0] = detailValue(cr, gr, br, gaussianWeight, bilateralWeight, soften, sharpen);
  result[1] = detailValue(cg, gg, bg, gaussianWeight, bilateralWeight, soften, sharpen);
  result[2] = detailValue(cb, gb, bb, gaussianWeight, bilateralWeight, soften, sharpen);
}

/** Internal session is shared by the full-image and bounded-tile callers. */
export interface ReferenceRenderSession {
  recipe: RecipeV1;
  globalNeutral: boolean;
  localActive: boolean;
  globalTone: Tone;
  localTone: Tone;
  curves: CompiledCurves;
  encoded: [Float64Array, Float64Array, Float64Array] | null;
  pointBytes: Int16Array[] | null;
}

export interface ImageCoordinateContext {
  width: number;
  height: number;
  originX: number;
  originY: number;
}

/** Preallocated tile buffers, reused across every tile rather than left to GC. */
export interface ReferenceRenderWorkspace {
  working: Float32Array;
  scratch: Float32Array;
  output: Uint8ClampedArray;
}

/** Internal versioned extension point. v1 never supplies it or changes its order. */
export interface LinearRegionExtension {
  active: boolean;
  apply(
    working: Float32Array,
    scratch: Float32Array,
    image: RGBAImage,
    coordinates: ImageCoordinateContext | undefined,
    options: RenderOptions,
  ): Float32Array;
}

export function createRenderSession(inputRecipe: RecipeV1): ReferenceRenderSession {
  const recipe = parseRecipe(inputRecipe);
  const globalTone = tone(recipe.adjustments);
  const globalNeutral =
    neutral(recipe.adjustments) &&
    channels.every((channel) => isIdentityCurve(recipe.curves[channel]));
  const mapped =
    globalTone.active || channels.some((channel) => !isIdentityCurve(recipe.curves[channel]));
  const encoded = mapped
    ? (globalTone.gains.map((gain) =>
        Float64Array.from(DECODE, (v) => clamp(linearToSrgb(clamp(v * gain)))),
      ) as [Float64Array, Float64Array, Float64Array])
    : null;
  const curves = compileCurves(recipe.curves);
  const gainOnly =
    globalTone.active &&
    !Object.values(curves).some(Boolean) &&
    globalTone.brightness === 1 &&
    globalTone.contrast === 1 &&
    globalTone.shadowKnot === 0.25 &&
    globalTone.highlightKnot === 0.75 &&
    globalTone.whites === 0 &&
    globalTone.blacks === 0 &&
    globalTone.saturation === 1 &&
    globalTone.vibrance === 0;
  const byte = (value: number) => encodeFloat32Byte(Math.fround(srgbToLinear(value)));
  const pointBytes =
    encoded && (gainOnly || !globalTone.active)
      ? encoded.map((samples, index) =>
          Int16Array.from(samples, (sample) => {
            if (gainOnly) {
              // The neutral luma algebra can move the encoded value by floating-point
              // round-off. Fall back for any input near a reference quantization boundary.
              const lower = byte(clamp(sample - 1e-10));
              return lower === byte(clamp(sample + 1e-10)) ? lower : -1;
            }
            const global = curves.rgb ? curves.rgb(sample) : sample;
            const channel = curves[channels[index + 1]!]!;
            return byte(channel ? channel(global) : global);
          }),
        )
      : null;
  return {
    recipe,
    globalNeutral,
    localActive: recipe.local.enabled && !neutral(recipe.local.adjustments),
    globalTone,
    localTone: tone(recipe.local.adjustments),
    curves,
    encoded,
    pointBytes,
  };
}

/** Synchronous pure CPU reference. Run in a worker for interactive UI. */
export function renderRecipe(
  image: RGBAImage,
  inputRecipe: RecipeV1,
  options: RenderOptions = {},
): RGBAImage {
  validateImage(image, options);
  return renderValidatedRegion(image, createRenderSession(inputRecipe), options);
}

/** Internal only: caller has validated image/session and supplied adequate buffers. */
export function renderValidatedRegion(
  image: RGBAImage,
  session: ReferenceRenderSession,
  options: RenderOptions,
  coordinates?: ImageCoordinateContext,
  workspace?: ReferenceRenderWorkspace,
  extension?: LinearRegionExtension,
): RGBAImage {
  const recipe = session.recipe;
  const crop = pixelCrop(image, recipe.geometry);
  const dimensions = getOutputDimensions(image, recipe.geometry);
  const globalNeutral = session.globalNeutral;
  const localActive = session.localActive;
  const maps = session.pointBytes;
  if (
    maps &&
    !localActive &&
    !extension?.active &&
    recipe.adjustments.sharpness === 0 &&
    recipe.adjustments.soften === 0
  ) {
    const length = dimensions.width * dimensions.height * 4;
    const data = workspace?.output.subarray(0, length) ?? new Uint8ClampedArray(length);
    const fallback = new Float32Array(3),
      encoded = session.encoded!;
    const identity =
      !recipe.geometry.crop &&
      recipe.geometry.rotation === 0 &&
      !recipe.geometry.flipX &&
      !recipe.geometry.flipY;
    for (let y = 0; y < dimensions.height; y++) {
      if ((y & 31) === 0) checkAbort(options);
      for (let x = 0; x < dimensions.width; x++) {
        const out = (y * dimensions.width + x) * 4;
        const at = identity
          ? out
          : sourcePixel(x, y, dimensions, crop, recipe.geometry, image.width) * 4;
        const r = image.data[at]!,
          g = image.data[at + 1]!,
          b = image.data[at + 2]!,
          a = image.data[at + 3]!;
        if (a === 0) {
          data[out] = r;
          data[out + 1] = g;
          data[out + 2] = b;
        } else {
          const red = maps[0]![r]!,
            green = maps[1]![g]!,
            blue = maps[2]![b]!;
          if (red >= 0 && green >= 0 && blue >= 0) {
            data[out] = red;
            data[out + 1] = green;
            data[out + 2] = blue;
          } else {
            mapEncodedPoint(
              encoded[0][r]!,
              encoded[1][g]!,
              encoded[2][b]!,
              session.globalTone,
              session.curves,
              fallback,
              0,
            );
            data[out] = encodeFloat32Byte(fallback[0]!);
            data[out + 1] = encodeFloat32Byte(fallback[1]!);
            data[out + 2] = encodeFloat32Byte(fallback[2]!);
          }
        }
        data[out + 3] = a;
      }
    }
    checkAbort(options);
    return { ...dimensions, data };
  }
  let working: Float32Array | null = null;
  let scratch: Float32Array | null = null;
  if (!globalNeutral || localActive || extension?.active) {
    const n = image.width * image.height;
    working = workspace ? workspace.working.subarray(0, n * 3) : new Float32Array(n * 3);
    const t = session.globalTone;
    const curves = session.curves;
    for (let y = 0; y < image.height; y += 1) {
      if ((y & 31) === 0) checkAbort(options);
      for (let x = 0; x < image.width; x += 1) {
        const p = y * image.width + x;
        const i = p * 4;
        const o = p * 3;
        const r = DECODE[image.data[i]!]!;
        const g = DECODE[image.data[i + 1]!]!;
        const b = DECODE[image.data[i + 2]!]!;
        if (image.data[i + 3] === 0) {
          working[o] = r;
          working[o + 1] = g;
          working[o + 2] = b;
        } else if (session.encoded) {
          mapEncodedPoint(
            session.encoded[0][image.data[i]!]!,
            session.encoded[1][image.data[i + 1]!]!,
            session.encoded[2][image.data[i + 2]!]!,
            t,
            curves,
            working,
            o,
          );
        } else {
          working[o] = r;
          working[o + 1] = g;
          working[o + 2] = b;
        }
      }
    }
    const globalDetail = recipe.adjustments.sharpness > 0 || recipe.adjustments.soften > 0;
    // At most two float RGB buffers, reused across global and local stages.
    scratch =
      globalDetail || localActive || extension?.active
        ? workspace
          ? workspace.scratch.subarray(0, n * 3)
          : new Float32Array(n * 3)
        : null;
    const detail = new Float64Array(3);
    if (globalDetail && scratch) {
      for (let y = 0; y < image.height; y += 1) {
        if ((y & 31) === 0) checkAbort(options);
        for (let x = 0; x < image.width; x += 1) {
          const p = y * image.width + x;
          const o = p * 3;
          if (image.data[p * 4 + 3] === 0) {
            scratch[o] = working[o]!;
            scratch[o + 1] = working[o + 1]!;
            scratch[o + 2] = working[o + 2]!;
            continue;
          }
          detailPoint(working, image, x, y, recipe.adjustments, detail);
          scratch[o] = detail[0]!;
          scratch[o + 1] = detail[1]!;
          scratch[o + 2] = detail[2]!;
        }
      }
      const previous = working;
      working = scratch;
      scratch = previous;
    }
    if (localActive && scratch) {
      const localTone = session.localTone;
      for (let y = 0; y < image.height; y += 1) {
        if ((y & 31) === 0) checkAbort(options);
        for (let x = 0; x < image.width; x += 1) {
          const p = y * image.width + x;
          const o = p * 3;
          if (image.data[p * 4 + 3] === 0) {
            scratch[o] = working[o]!;
            scratch[o + 1] = working[o + 1]!;
            scratch[o + 2] = working[o + 2]!;
          } else
            mapPoint(
              working[o]!,
              working[o + 1]!,
              working[o + 2]!,
              localTone,
              NO_CURVES,
              scratch,
              o,
            );
        }
      }
      const localDetail =
        recipe.local.adjustments.sharpness > 0 || recipe.local.adjustments.soften > 0;
      for (let y = 0; y < image.height; y += 1) {
        if ((y & 31) === 0) checkAbort(options);
        for (let x = 0; x < image.width; x += 1) {
          const p = y * image.width + x;
          const o = p * 3;
          if (image.data[p * 4 + 3] === 0) continue;
          const weight = radialMaskWeight(
            recipe.local.mask,
            (x + (coordinates?.originX ?? 0) + 0.5) / (coordinates?.width ?? image.width),
            (y + (coordinates?.originY ?? 0) + 0.5) / (coordinates?.height ?? image.height),
          );
          if (weight === 0) continue; // exact outside preservation, not a near-zero blend
          if (localDetail) detailPoint(scratch, image, x, y, recipe.local.adjustments, detail);
          for (let c = 0; c < 3; c += 1) {
            const candidate = localDetail ? detail[c]! : scratch[o + c]!;
            working[o + c] = working[o + c]! + (candidate - working[o + c]!) * weight;
          }
        }
      }
    }
  }
  if (extension?.active && working && scratch) {
    working = extension.apply(working, scratch, image, coordinates, options);
  }
  checkAbort(options);
  const data = workspace
    ? workspace.output.subarray(0, dimensions.width * dimensions.height * 4)
    : new Uint8ClampedArray(dimensions.width * dimensions.height * 4);
  for (let y = 0; y < dimensions.height; y += 1) {
    if ((y & 31) === 0) checkAbort(options);
    for (let x = 0; x < dimensions.width; x += 1) {
      const p = sourcePixel(x, y, dimensions, crop, recipe.geometry, image.width);
      const i = p * 4;
      const o = (y * dimensions.width + x) * 4;
      if (working && image.data[i + 3] !== 0) {
        data[o] = encodeFloat32Byte(working[p * 3]!);
        data[o + 1] = encodeFloat32Byte(working[p * 3 + 1]!);
        data[o + 2] = encodeFloat32Byte(working[p * 3 + 2]!);
      } else {
        data[o] = image.data[i]!;
        data[o + 1] = image.data[i + 1]!;
        data[o + 2] = image.data[i + 2]!;
      }
      data[o + 3] = image.data[i + 3]!;
    }
  }
  return { ...dimensions, data };
}

export function computeHistogram(image: RGBAImage, options: RenderOptions = {}): Histogram {
  validateImage(image, options);
  const histogram: Histogram = {
    red: new Uint32Array(256),
    green: new Uint32Array(256),
    blue: new Uint32Array(256),
    luminance: new Uint32Array(256),
    pixelCount: 0,
  };
  for (let i = 0; i < image.data.length; i += 4) {
    if ((i & 131071) === 0) checkAbort(options);
    if (image.data[i + 3] === 0) continue;
    const r = image.data[i]!;
    const g = image.data[i + 1]!;
    const b = image.data[i + 2]!;
    histogram.red[r] = histogram.red[r]! + 1;
    histogram.green[g] = histogram.green[g]! + 1;
    histogram.blue[b] = histogram.blue[b]! + 1;
    const luminance = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    histogram.luminance[luminance] = histogram.luminance[luminance]! + 1;
    histogram.pixelCount += 1;
  }
  return histogram;
}
