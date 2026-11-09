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
