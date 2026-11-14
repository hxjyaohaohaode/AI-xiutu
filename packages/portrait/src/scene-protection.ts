import {
  createRasterMask,
  MAX_RASTER_RUNS_PER_MASK,
  type Point,
  type RGBAImage,
} from '@ai-xiutu/editor';
import type { PortraitTarget } from './types.js';

/** Protect straight high-contrast scene edges near a person's silhouette.
 * Samples have to agree along the line, outside the same person's matte.
 * Detection is bounded to the source crop and serialized as an ordinary mask. */
export function protectBackgroundLines(
  image: RGBAImage,
  box: PortraitTarget['bounds'],
  foreground: (point: Point) => number,
) {
  const { width, height, data } = image;
  const bw = box.width * width,
    bh = box.height * height;
  if (bw < 48 || bh < 62) return;
  const left = Math.max(0, Math.floor((box.x - box.width * 0.24) * width));
  const top = Math.max(0, Math.floor((box.y - box.height * 0.13) * height));
  const right = Math.min(width - 1, Math.ceil((box.x + box.width * 1.24) * width));
  const bottom = Math.min(height - 1, Math.ceil((box.y + box.height * 1.14) * height));
  const scale = Math.min(1, 120 / Math.max(right - left, bottom - top));
  const cols = Math.max(8, Math.round((right - left) * scale));
  const rows = Math.max(8, Math.round((bottom - top) * scale));
  const sx = (right - left) / cols,
    sy = (bottom - top) / rows;
  const matte = new Float32Array(cols * rows);
  const luma = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const px = left + (x + 0.5) * sx,
        py = top + (y + 0.5) * sy;
      const at = (Math.floor(px) + Math.floor(py) * width) * 4;
      const i = y * cols + x;
      matte[i] = foreground({ x: px / width, y: py / height });
      luma[i] =
        data[at + 3]! < 230
          ? NaN
          : 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
    }
  const mask = new Uint8Array(cols * rows);
  const inspect = (
    lineCount: number,
    lineLength: number,
    at: (line: number, along: number) => number,
  ) => {
    const minimum = Math.max(8, Math.round(lineLength * 0.11));
    for (let line = 2; line < lineCount - 2; line++) {
      let start = 0,
        direction = 0;
      for (let along = 0; along <= lineLength; along++) {
        const before = at(line - 1, along),
          after = at(line + 1, along);
        const delta = luma[after]! - luma[before]!;
        const sign =
          along < lineLength &&
          Math.max(matte[before]!, matte[after]!) < 0.26 &&
          Math.abs(delta) > 23
            ? Math.sign(delta)
            : 0;
        if (sign && sign === direction) continue;
        if (direction && along - start >= minimum) {
          for (let p = start; p < along; p++)
            for (const offset of [-1, 0, 1]) {
              const i = at(line + offset, p);
              if (matte[i]! < 0.26) mask[i] = Math.max(mask[i]!, offset ? 171 : 255);
            }
        }
        start = along;
        direction = sign;
      }
    }
  };
  inspect(cols, rows, (x, y) => y * cols + x);
  inspect(rows, cols, (y, x) => y * cols + x);
  if (
    !mask.some(Boolean) ||
    mask.reduce((n, v, i) => n + Number(!i || v !== mask[i - 1]), 0) > MAX_RASTER_RUNS_PER_MASK / 4
  )
    return;
  return createRasterMask(cols, rows, mask, false, {
    sampling: 'bilinear-v1',
    bounds: {
      x: left / width,
      y: top / height,
      width: (right - left) / width,
      height: (bottom - top) / height,
    },
  });
}
