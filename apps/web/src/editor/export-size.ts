import type { Dimensions, RGBAImage } from '@ai-xiutu/editor';

export function fitExportDimensions(source: Dimensions, maxLongEdge?: number): Dimensions {
  if (maxLongEdge === undefined) return { width: source.width, height: source.height };
  if (!Number.isSafeInteger(maxLongEdge) || maxLongEdge < 1) throw new RangeError('Invalid export size');
  const scale = Math.min(1, maxLongEdge / Math.max(source.width, source.height));
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/** Average the area covered by each output pixel in premultiplied-alpha space.
 * Work on the finished crop/composite so local adjustments retain their coordinates. */
export function resizeForExport(source: RGBAImage, maxLongEdge?: number): RGBAImage {
  const { width, height } = fitExportDimensions(source, maxLongEdge);
  if (source.width === width && source.height === height) return source;
  const data = new Uint8ClampedArray(width * height * 4);
  const sx = source.width / width, sy = source.height / height;
  for (let y = 0; y < height; y++) {
    const top = y * sy, bottom = Math.min(source.height, (y + 1) * sy);
    for (let x = 0; x < width; x++) {
      const left = x * sx, right = Math.min(source.width, (x + 1) * sx);
      let alpha = 0, red = 0, green = 0, blue = 0;
      for (let iy = Math.floor(top); iy < bottom; iy++) {
        const vertical = Math.min(iy + 1, bottom) - Math.max(iy, top);
        for (let ix = Math.floor(left); ix < right; ix++) {
          const index = (iy * source.width + ix) * 4;
          const coverage = vertical * (Math.min(ix + 1, right) - Math.max(ix, left));
          const weight = coverage * source.data[index + 3]!;
          alpha += weight;
          red += weight * source.data[index]!;
          green += weight * source.data[index + 1]!;
          blue += weight * source.data[index + 2]!;
        }
      }
      const offset = (y * width + x) * 4;
      if (alpha > 0) {
        data[offset] = Math.round(red / alpha);
        data[offset + 1] = Math.round(green / alpha);
        data[offset + 2] = Math.round(blue / alpha);
        data[offset + 3] = Math.round(alpha / ((right - left) * (bottom - top)));
      }
    }
  }
  return { width, height, data };
}
