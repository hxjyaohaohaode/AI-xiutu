import { validateTiledDimensions } from './geometry.js';
import { radialMaskWeight } from './mask.js';
import { parseSelectionMask } from './v2-recipe.js';
import { MAX_RASTER_RUNS_PER_MASK } from './v2-registry.js';
import { RecipeValidationError } from './recipe.js';
import type { Dimensions, Point, RGBAImage } from './types.js';
import type { RasterMaskV2, SelectionMaskV2 } from './v2-types.js';

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (x: number) => x * x * (3 - 2 * x);
const distanceSquared = (x: number, y: number, a: Point, b: Point): number => {
  const vx = b.x - a.x,
    vy = b.y - a.y;
  const denominator = vx * vx + vy * vy;
  const t = denominator === 0 ? 0 : clamp(((x - a.x) * vx + (y - a.y) * vy) / denominator);
  return (x - a.x - t * vx) ** 2 + (y - a.y - t * vy) ** 2;
};
const boundsOf = (points: readonly Point[]) => ({
  left: Math.min(...points.map((point) => point.x)),
  right: Math.max(...points.map((point) => point.x)),
  top: Math.min(...points.map((point) => point.y)),
  bottom: Math.max(...points.map((point) => point.y)),
});
const edge = (distance: number, radius: number, feather: number): number => {
  if (distance >= radius) return 0;
  if (feather === 0 || distance <= radius * (1 - feather)) return 1;
  return smoothstep((radius - distance) / (radius * feather));
};

export type SelectionMaskSampler = (x: number, y: number) => number;

/**
 * Compile once, sample normalized source coordinates many times. Dimensions are
 * the full oriented original image, even when drawing a small UI mask overlay.
 * A sample outside that image is 0; invert applies within the image domain only.
 */
export function compileSelectionMask(
  input: SelectionMaskV2,
  dimensions: Dimensions,
  source?: RGBAImage,
): SelectionMaskSampler {
  validateTiledDimensions(dimensions);
  const mask = parseSelectionMask(input);
  const short = Math.min(dimensions.width, dimensions.height);
  const aspectX = dimensions.width / short,
    aspectY = dimensions.height / short;
  let sample: SelectionMaskSampler;
  let visible: SelectionMaskSampler | null = null;
  if (mask.type === 'radial') {
    // Invert is applied once by the outer sampler.
    const ordinary = { ...mask, invert: false };
    sample = (x, y) => radialMaskWeight(ordinary, x, y);
  } else if (mask.type === 'linear') {
    const startX = mask.start.x * aspectX,
      startY = mask.start.y * aspectY;
    const vx = (mask.end.x - mask.start.x) * aspectX,
      vy = (mask.end.y - mask.start.y) * aspectY;
    const norm = vx * vx + vy * vy;
    sample = (x, y) => {
      const t = clamp(((x * aspectX - startX) * vx + (y * aspectY - startY) * vy) / norm);
      return mask.smooth ? smoothstep(t) : t;
    };
  } else if (mask.type === 'polygon') {
    const vertices = mask.points.map((point) => ({ x: point.x * aspectX, y: point.y * aspectY }));
    const bounds = boundsOf(vertices);
    sample = (x, y) => {
      x *= aspectX;
      y *= aspectY;
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return 0;
      let inside = false,
        distance = Infinity;
      for (let i = 0; i < vertices.length; i += 1) {
        const a = vertices[i]!,
          b = vertices[(i + 1) % vertices.length]!;
        distance = Math.min(distance, distanceSquared(x, y, a, b));
        if (a.y > y !== b.y > y && x < a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
          inside = !inside;
      }
      if (distance <= 1e-24) inside = true;
      if (!inside) return 0;
      if (mask.feather === 0) return 1;
      return smoothstep(clamp(Math.sqrt(distance) / mask.feather));
    };
  } else if (mask.type === 'brush') {
    const strokes = mask.strokes.map((stroke) => {
      const points = stroke.points.map((point) => ({ x: point.x * aspectX, y: point.y * aspectY }));
      const bounds = boundsOf(points);
      return {
        ...stroke,
        points,
        left: bounds.left - stroke.radius,
        right: bounds.right + stroke.radius,
        top: bounds.top - stroke.radius,
        bottom: bounds.bottom + stroke.radius,
      };
    });
    sample = (x, y) => {
      x *= aspectX;
      y *= aspectY;
      let weight = 0;
      for (const stroke of strokes) {
        if (
          stroke.opacity === 0 ||
          x < stroke.left ||
          x > stroke.right ||
          y < stroke.top ||
          y > stroke.bottom
        )
          continue;
        let distance = Infinity;
        if (stroke.points.length === 1)
          distance = distanceSquared(x, y, stroke.points[0]!, stroke.points[0]!);
        else
          for (let p = 1; p < stroke.points.length; p += 1) {
            distance = Math.min(
              distance,
              distanceSquared(x, y, stroke.points[p - 1]!, stroke.points[p]!),
            );
            if (distance <= (stroke.radius * (1 - stroke.feather)) ** 2) break;
          }
        const coverage = edge(Math.sqrt(distance), stroke.radius, stroke.feather) * stroke.opacity;
        weight =
          stroke.mode === 'subtract' ? weight * (1 - coverage) : weight + (1 - weight) * coverage;
      }
      return weight;
    };
  } else if (mask.type === 'raster') {
    const count = mask.runs.length / 2;
    const ends = new Uint32Array(count),
      weights = new Uint8Array(count);
    let end = 0;
    for (let i = 0; i < count; i += 1) {
      end += mask.runs[i * 2]!;
      ends[i] = end;
      weights[i] = mask.runs[i * 2 + 1]!;
    }
    sample = (x, y) => {
      const cellX = Math.min(mask.width - 1, Math.floor(x * mask.width));
      const cellY = Math.min(mask.height - 1, Math.floor(y * mask.height));
      const pixel = cellY * mask.width + cellX;
      let low = 0,
        high = count - 1;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (pixel < ends[middle]!) high = middle;
        else low = middle + 1;
      }
      return weights[low]! / 255;
    };
  } else {
    if (!source) throw new RecipeValidationError(['color-range: original source RGBA is required']);
    validateTiledDimensions(source);
    if (
      !(source.data instanceof Uint8ClampedArray) ||
      source.data.length !== source.width * source.height * 4
    )
      throw new RecipeValidationError(['color-range: invalid original source RGBA']);
    // Smaller explicitly supplied source images are useful for approximate UI
    // overlays. The renderer always supplies its entire unchanged input image.
    const original = source;
    const pixel = (x: number, y: number) =>
      (Math.min(original.height - 1, Math.floor(y * original.height)) * original.width +
        Math.min(original.width - 1, Math.floor(x * original.width))) *
      4;
    visible = (x, y) => (original.data[pixel(x, y) + 3] === 0 ? 0 : 1);
    const range = (value: number, low: number, high: number): number => {
      if (value < low || value > high) return 0;
      if (mask.feather === 0 || low === high) return 1;
      const fade = ((high - low) * mask.feather) / 2;
      const weight = Math.min(
        1,
        low === 0 ? 1 : (value - low) / fade,
        high === 1 ? 1 : (high - value) / fade,
      );
      return smoothstep(clamp(weight));
    };
    sample = (x, y) => {
      const p = pixel(x, y),
        r = original.data[p]! / 255,
        g = original.data[p + 1]! / 255,
        b = original.data[p + 2]! / 255;
      const maximum = Math.max(r, g, b),
        minimum = Math.min(r, g, b),
        chroma = maximum - minimum;
      const saturation = maximum === 0 ? 0 : chroma / maximum;
      let hueWeight = 1;
      if (mask.hueWidth < 180) {
        if (chroma === 0) return 0; // Gray has no reliable hue; use full hue range to select it.
        let hue =
          maximum === r
            ? ((g - b) / chroma) % 6
            : maximum === g
              ? (b - r) / chroma + 2
              : (r - g) / chroma + 4;
        hue = (hue * 60 + 360) % 360;
        const distance = Math.abs(((hue - mask.hue + 540) % 360) - 180);
        hueWeight =
          mask.hueWidth === 0
            ? distance < 1e-9
              ? 1
              : 0
            : mask.feather === 0
              ? distance <= mask.hueWidth
                ? 1
                : 0
              : edge(distance, mask.hueWidth, mask.feather);
      }
      return (
        hueWeight *
        range(saturation, mask.saturationMin, mask.saturationMax) *
        range(0.2126 * r + 0.7152 * g + 0.0722 * b, mask.luminanceMin, mask.luminanceMax)
      );
    };
  }
  return (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new RangeError('Mask sample coordinates must be finite');
    if (x < 0 || x > 1 || y < 0 || y > 1) return 0;
    if (visible && visible(x, y) === 0) return 0;
    const weight = clamp(sample(x, y));
    return mask.invert ? 1 - weight : weight;
  };
}

/** Lossless byte weights; complexity is bounded by run count, not a hidden bitmap allocation. */
export function createRasterMask(
  width: number,
  height: number,
  weights: Uint8Array | Uint8ClampedArray,
  invert = false,
): RasterMaskV2 {
  validateTiledDimensions({ width, height });
  if (!(weights instanceof Uint8Array) && !(weights instanceof Uint8ClampedArray))
    throw new RecipeValidationError(['raster weights: expected a byte array']);
  if (weights.length !== width * height || typeof invert !== 'boolean')
    throw new RecipeValidationError(['raster weights: invalid dimensions or invert']);
  const runs: number[] = [];
  let last = weights[0]!,
    count = 0;
  for (let i = 0; i < weights.length; i += 1) {
    const value = weights[i]!;
    if (value === last) count += 1;
    else {
      runs.push(count, last);
      if (runs.length / 2 >= MAX_RASTER_RUNS_PER_MASK)
        throw new RecipeValidationError([
          'raster mask exceeds the run budget; simplify the explicit selection',
        ]);
      last = value;
      count = 1;
    }
  }
  runs.push(count, last);
  return parseSelectionMask({ type: 'raster', width, height, runs, invert }) as RasterMaskV2;
}
