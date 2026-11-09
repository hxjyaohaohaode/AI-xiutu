import { checkV3, sampleBilinearV3, clamp01 } from './v3-pixels.js';
import type { OpticsV3 } from './v3-types.js';
import type { RGBAImage, RenderOptions } from './types.js';

/** Separate luminance/chroma edge-aware smoothing. No face/skin detection or learned denoiser. */
export function applyOpticsV3(
  image: RGBAImage,
  optics: OpticsV3,
  options: RenderOptions,
): RGBAImage {
  const ld = optics.denoiseLuminance / 100,
    cd = optics.denoiseChroma / 100;
  const aberration = optics.aberrationRed !== 0 || optics.aberrationBlue !== 0;
  if (ld === 0 && cd === 0 && !aberration) return image;
  let current = image;
  if (ld !== 0 || cd !== 0) {
    const out = new Uint8ClampedArray(image.data),
      kernel = [1, 4, 6, 4, 1];
    for (let y = 0; y < image.height; y++) {
      if ((y & 15) === 0) checkV3(options);
      for (let x = 0; x < image.width; x++) {
        const at = (y * image.width + x) * 4;
        if (image.data[at + 3] === 0) continue;
        const r = image.data[at]! / 255,
          g = image.data[at + 1]! / 255,
          b = image.data[at + 2]! / 255,
          Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        let sum = 0,
          sy = 0,
          sr = 0,
          sb = 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const p =
              (Math.max(0, Math.min(image.height - 1, y + dy)) * image.width +
                Math.max(0, Math.min(image.width - 1, x + dx))) *
              4;
            const a = image.data[p + 3]! / 255;
            if (a === 0) continue;
            const nr = image.data[p]! / 255,
              ng = image.data[p + 1]! / 255,
              nb = image.data[p + 2]! / 255,
              ny = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
            const weight = (kernel[dx + 2]! * kernel[dy + 2]! * a) / (1 + (ny - Y) ** 2 / 0.0025);
            sum += weight;
            sy += weight * ny;
            sr += weight * (nr - ny);
            sb += weight * (nb - ny);
          }
        if (sum === 0) continue;
        const nextY = Y + (sy / sum - Y) * ld,
          nextR = r - Y + (sr / sum - (r - Y)) * cd,
          nextB = b - Y + (sb / sum - (b - Y)) * cd;
        out[at] = clamp01(nextY + nextR) * 255;
        out[at + 2] = clamp01(nextY + nextB) * 255;
        out[at + 1] = clamp01(nextY - (0.2126 * nextR + 0.0722 * nextB) / 0.7152) * 255;
      }
    }
    current = { width: image.width, height: image.height, data: out };
  }
  if (!aberration) return current;
  const data = new Uint8ClampedArray(current.data),
    sample = new Float64Array(4),
    half = Math.min(image.width, image.height) / 2;
  for (let y = 0; y < image.height; y++) {
    if ((y & 31) === 0) checkV3(options);
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      if (current.data[at + 3] === 0) continue;
      const dx = (x + 0.5 - optics.aberrationCenterX * image.width) / half,
        dy = (y + 0.5 - optics.aberrationCenterY * image.height) / half;
      if (optics.aberrationRed !== 0) {
        sampleBilinearV3(
          current,
          x + 0.5 + dx * optics.aberrationRed,
          y + 0.5 + dy * optics.aberrationRed,
          sample,
          'clamp',
        );
        if (sample[3]! > 0) data[at] = sample[0]!;
      }
      if (optics.aberrationBlue !== 0) {
        sampleBilinearV3(
          current,
          x + 0.5 + dx * optics.aberrationBlue,
          y + 0.5 + dy * optics.aberrationBlue,
          sample,
          'clamp',
        );
        if (sample[3]! > 0) data[at + 2] = sample[2]!;
      }
    }
  }
  return { width: image.width, height: image.height, data };
}
