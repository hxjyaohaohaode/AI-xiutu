import { linearToSrgb, srgbToLinear, RenderAbortedError } from './engine.js';
import type { RGBAImage, RenderOptions } from './types.js';

export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const decode = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));
export function checkV3(options: RenderOptions): void {
  if (options.signal?.aborted) throw new RenderAbortedError();
}
/** Pixel-edge coordinates, linear-light premultiplied-alpha bilinear reconstruction. */
export function sampleBilinearV3(
  image: RGBAImage,
  edgeX: number,
  edgeY: number,
  out: Float64Array,
  border: 'transparent' | 'clamp' = 'transparent',
): void {
  let x = edgeX - 0.5,
    y = edgeY - 0.5;
  if (border === 'clamp') {
    x = Math.max(0, Math.min(image.width - 1, x));
    y = Math.max(0, Math.min(image.height - 1, y));
  }
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x <= -1 ||
    y <= -1 ||
    x >= image.width ||
    y >= image.height
  ) {
    out.fill(0, 0, 4);
    return;
  }
  const nearestX = Math.round(x),
    nearestY = Math.round(y);
  if (
    Math.abs(x - nearestX) < 1e-10 &&
    Math.abs(y - nearestY) < 1e-10 &&
    nearestX >= 0 &&
    nearestY >= 0 &&
    nearestX < image.width &&
    nearestY < image.height
  ) {
    const at = (nearestY * image.width + nearestX) * 4;
    for (let c = 0; c < 4; c++) out[c] = image.data[at + c]!;
    return;
  }
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  let alpha = 0,
    r = 0,
    g = 0,
    b = 0;
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const sx = ix + dx,
        sy = iy + dy;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const at = (sy * image.width + sx) * 4,
        w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (image.data[at + 3]! / 255);
      alpha += w;
      r += decode[image.data[at]!]! * w;
      g += decode[image.data[at + 1]!]! * w;
      b += decode[image.data[at + 2]!]! * w;
    }
  out[3] = alpha * 255;
  if (alpha <= 0) {
    out[0] = out[1] = out[2] = 0;
    return;
  }
  out[0] = clamp01(linearToSrgb(r / alpha)) * 255;
  out[1] = clamp01(linearToSrgb(g / alpha)) * 255;
  out[2] = clamp01(linearToSrgb(b / alpha)) * 255;
}

/** Interpolating cubic with a 2×2 envelope. Work in linear light with associated alpha. */
export function sampleBoundedCubicV3(
  image: RGBAImage,
  edgeX: number,
  edgeY: number,
  out: Float64Array,
  weights: Float64Array,
): void {
  const x = Math.max(0, Math.min(image.width - 1, edgeX - 0.5)),
    y = Math.max(0, Math.min(image.height - 1, edgeY - 0.5));
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  if (Math.abs(x - Math.round(x)) < 1e-10 && Math.abs(y - Math.round(y)) < 1e-10) {
    const at = (Math.round(y) * image.width + Math.round(x)) * 4;
    for (let channel = 0; channel < 4; channel++) out[channel] = image.data[at + channel]!;
    return;
  }
  for (let axis = 0; axis < 2; axis++) {
    const t = axis === 0 ? fx : fy,
      t2 = t * t,
      t3 = t2 * t,
      offset = axis * 4;
    weights[offset] = (-t + 2 * t2 - t3) * 0.5;
    weights[offset + 1] = 1 - 2.5 * t2 + 1.5 * t3;
    weights[offset + 2] = 0.5 * t + 2 * t2 - 1.5 * t3;
    weights[offset + 3] = (t3 - t2) * 0.5;
  }
  let alpha = 0,
    r = 0,
    g = 0,
    b = 0;
  let minA = 1,
    maxA = 0,
    minR = 1,
    maxR = 0,
    minG = 1,
    maxG = 0,
    minB = 1,
    maxB = 0;
  for (let dy = 0; dy < 4; dy++) {
    const sy = Math.max(0, Math.min(image.height - 1, iy + dy - 1));
    for (let dx = 0; dx < 4; dx++) {
      const sx = Math.max(0, Math.min(image.width - 1, ix + dx - 1));
      const at = (sy * image.width + sx) * 4;
      const a = image.data[at + 3]! / 255;
      const w = weights[dx]! * weights[4 + dy]! * a;
      const red = decode[image.data[at]!]!,
        green = decode[image.data[at + 1]!]!,
        blue = decode[image.data[at + 2]!]!;
      alpha += w;
      r += red * w;
      g += green * w;
      b += blue * w;
      if (dx !== 0 && dx !== 3 && dy !== 0 && dy !== 3) {
        minA = Math.min(minA, a);
        maxA = Math.max(maxA, a);
        if (a > 0) {
          minR = Math.min(minR, red);
          maxR = Math.max(maxR, red);
          minG = Math.min(minG, green);
          maxG = Math.max(maxG, green);
          minB = Math.min(minB, blue);
          maxB = Math.max(maxB, blue);
        }
      }
    }
  }
  if (maxA === 0) {
    out.fill(0, 0, 4);
    return;
  }
  if (alpha <= 1e-10) {
    sampleBilinearV3(image, edgeX, edgeY, out, 'clamp');
    return;
  }
  out[3] = Math.max(minA, Math.min(maxA, alpha)) * 255;
  out[0] = linearToSrgb(Math.max(minR, Math.min(maxR, r / alpha))) * 255;
  out[1] = linearToSrgb(Math.max(minG, Math.min(maxG, g / alpha))) * 255;
  out[2] = linearToSrgb(Math.max(minB, Math.min(maxB, b / alpha))) * 255;
}
