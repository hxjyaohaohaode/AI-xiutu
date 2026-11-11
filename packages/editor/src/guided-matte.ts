import type { RGBAImage, RenderOptions } from './types.js';
import { srgbToLinear } from './transfer.js';
import { boxSum } from './guided-retouch.js';
import { checkV3, clamp01 } from './v3-pixels.js';

const decode = Float32Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

/** Fast RGB guided filtering (He/Sun/Tang). Coefficients are estimated on an
 * area-reduced image, then evaluated against every original linear RGB sample.
 * This refines an existing semantic selection; it does not detect new subjects. */
export function refineGuidedMatte(
  image: RGBAImage,
  prior: Float32Array,
  radius: number,
  options: RenderOptions,
): Float32Array {
  const scale = Math.max(1, Math.ceil(Math.sqrt((image.width * image.height) / 262144)));
  const width = Math.ceil(image.width / scale),
    height = Math.ceil(image.height / scale);
  const count = width * height,
    r = Math.max(1, Math.ceil(radius / scale));
  const planes = Array.from({ length: 4 }, () => new Float32Array(count));
  const weights = new Float32Array(count),
    workspace = new Float64Array(count);
  for (let y = 0; y < image.height; y++) {
    if ((y & 31) === 0) checkV3(options);
    for (let x = 0; x < image.width; x++) {
      const at = y * image.width + x,
        src = at * 4,
        a = image.data[src + 3]! / 255;
      if (!a) continue;
      const cell = Math.floor(y / scale) * width + Math.floor(x / scale);
      weights[cell]! += a;
      for (let c = 0; c < 3; c++) planes[c]![cell]! += decode[image.data[src + c]!]! * a;
      planes[3]![cell]! += prior[at]! * a;
    }
  }
  for (let at = 0; at < count; at++) {
    const weight = weights[at]!;
    if (weight) for (const plane of planes) plane[at] = plane[at]! / weight;
    // Coverage, not number of pixels in the last partial area cell.
    const x = at % width,
      y = Math.floor(at / width);
    weights[at] =
      weight /
      (Math.min(scale, image.width - x * scale) * Math.min(scale, image.height - y * scale));
  }
  const norm = boxSum(weights, width, height, r, options, workspace);
  const field = new Float32Array(count);
  const mean = (values: Float32Array) => {
    for (let i = 0; i < count; i++) field[i] = values[i]! * weights[i]!;
    const result = boxSum(field, width, height, r, options, workspace);
    for (let i = 0; i < count; i++) result[i] = result[i]! / Math.max(1e-8, norm[i]!);
    return result;
  };
  const means = planes.map(mean);
  const covariance = (a: number, b: number) => {
    const product = new Float32Array(count);
    for (let i = 0; i < count; i++) product[i] = planes[a]![i]! * planes[b]![i]!;
    const result = mean(product);
    for (let i = 0; i < count; i++) result[i]! -= means[a]![i]! * means[b]![i]!;
    return result;
  };
  const rr = covariance(0, 0),
    rg = covariance(0, 1),
    rb = covariance(0, 2);
  const gg = covariance(1, 1),
    gb = covariance(1, 2),
    bb = covariance(2, 2);
  const cp = [covariance(0, 3), covariance(1, 3), covariance(2, 3)];
  const coefficients = Array.from({ length: 4 }, () => new Float32Array(count));
  // Cholesky solves a regularized positive covariance matrix without an unstable
  // explicit determinant. Float32 moment roundoff is bounded by epsilon.
  const epsilon = 0.0004;
  for (let i = 0; i < count; i++) {
    if ((i & 16383) === 0) checkV3(options);
    const l00 = Math.sqrt(Math.max(0, rr[i]!) + epsilon),
      l10 = rg[i]! / l00,
      l20 = rb[i]! / l00;
    const l11 = Math.sqrt(Math.max(epsilon * 0.25, gg[i]! + epsilon - l10 * l10));
    const l21 = (gb[i]! - l20 * l10) / l11;
    const l22 = Math.sqrt(Math.max(epsilon * 0.25, bb[i]! + epsilon - l20 * l20 - l21 * l21));
    const y0 = cp[0]![i]! / l00,
      y1 = (cp[1]![i]! - l10 * y0) / l11;
    const y2 = (cp[2]![i]! - l20 * y0 - l21 * y1) / l22;
    const a2 = y2 / l22,
      a1 = (y1 - l21 * a2) / l11,
      a0 = (y0 - l10 * a1 - l20 * a2) / l00;
    coefficients[0]![i] = a0;
    coefficients[1]![i] = a1;
    coefficients[2]![i] = a2;
    coefficients[3]![i] =
      means[3]![i]! - a0 * means[0]![i]! - a1 * means[1]![i]! - a2 * means[2]![i]!;
  }
  const averaged = coefficients.map(mean);
  // Cell centers at the partial final area require their actual positions.
  const coordinate = (p: number, length: number, cells: number) => {
    const cell = Math.min(cells - 1, Math.floor(p / scale));
    const center = (cell * scale + Math.min(length, (cell + 1) * scale)) / 2;
    const other = Math.max(0, Math.min(cells - 1, cell + (p < center ? -1 : 1)));
    const otherCenter = (other * scale + Math.min(length, (other + 1) * scale)) / 2;
    const t = other === cell ? 0 : Math.max(0, Math.min(1, (p - center) / (otherCenter - center)));
    return [cell, other, t] as const;
  };
  const xs = Array.from({ length: image.width }, (_, x) => coordinate(x + 0.5, image.width, width));
  const result = new Float32Array(prior.length);
  const sample = (
    plane: Float32Array,
    x0: number,
    x1: number,
    tx: number,
    y0: number,
    y1: number,
    ty: number,
  ) =>
    (plane[y0 * width + x0]! * (1 - tx) + plane[y0 * width + x1]! * tx) * (1 - ty) +
    (plane[y1 * width + x0]! * (1 - tx) + plane[y1 * width + x1]! * tx) * ty;
  for (let y = 0; y < image.height; y++) {
    if ((y & 15) === 0) checkV3(options);
    const [y0, y1, ty] = coordinate(y + 0.5, image.height, height);
    for (let x = 0; x < image.width; x++) {
      const at = y * image.width + x,
        src = at * 4;
      if (!image.data[src + 3]) continue;
      const [x0, x1, tx] = xs[x]!;
      let q = sample(averaged[3]!, x0, x1, tx, y0, y1, ty);
      for (let c = 0; c < 3; c++)
        q += sample(averaged[c]!, x0, x1, tx, y0, y1, ty) * decode[image.data[src + c]!]!;
      result[at] = clamp01(q);
    }
  }
  return result;
}
