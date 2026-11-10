import { compileSelectionMaskV3 } from './v3-mask.js';
import { checkV3, sampleBilinearV3, clamp01 } from './v3-pixels.js';
import type { WarpV3 } from './v3-types.js';
import type { RGBAImage, RenderOptions, Point, Dimensions } from './types.js';
import { flowWarpPoint } from './v3-flow.js';

/** Reverse sampling field. A drag defines a smooth compactly-supported displacement, not scene geometry. */
export function compileWarpFieldV3(
  warp: WarpV3,
  dimensions: Dimensions,
  original?: RGBAImage,
): (point: Point) => Point {
  const short = Math.min(dimensions.width, dimensions.height);
  const strokes = warp.enabled
    ? warp.strokes
        .filter((s) => s.strength !== 0)
        .map((s) => ({
          ...s,
          cx: s.from.x * dimensions.width,
          cy: s.from.y * dimensions.height,
          r: s.radius * short,
          dx: (s.to.x - s.from.x) * dimensions.width,
          dy: (s.to.y - s.from.y) * dimensions.height,
        }))
    : [];
  const protectedAt =
    strokes.length && warp.protection
      ? compileSelectionMaskV3(warp.protection, dimensions, original)
      : null;
  return (point) => {
    if (!strokes.length) return { x: point.x, y: point.y };
    let x = point.x * dimensions.width,
      y = point.y * dimensions.height;
    const protection = protectedAt?.(point.x, point.y) ?? 0;
    if (protection >= 1) return { ...point };
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i]!,
        dx = x - stroke.cx,
        dy = y - stroke.cy;
      if (Math.abs(dx) >= stroke.r || Math.abs(dy) >= stroke.r) continue;
      const d = Math.hypot(dx, dy) / stroke.r;
      if (d >= 1) continue;
      if (stroke.algorithm === 'flow-v1') {
        const mapped = flowWarpPoint(
          dx / stroke.r,
          dy / stroke.r,
          stroke.dx / stroke.r,
          stroke.dy / stroke.r,
          stroke.mode,
          stroke.strength * (1 - protection),
          stroke.feather,
        );
        x = stroke.cx + mapped.x * stroke.r;
        y = stroke.cy + mapped.y * stroke.r;
        continue;
      }
      // Smooth compact support remains continuous even at requested hard brush falloff.
      const base = (1 - d * d) ** 2,
        soft = stroke.feather === 0 ? 1 : clamp01((1 - d) / stroke.feather),
        falloff = base * soft * soft * (3 - 2 * soft);
      const amount = stroke.strength * falloff * (1 - protection);
      if (stroke.mode === 'push') {
        // Limiting displacement per operation prevents huge pointer leaps from creating a discontinuous tear.
        const factor = Math.min(
          1,
          (stroke.r * 0.8) / Math.max(1e-12, Math.hypot(stroke.dx, stroke.dy)),
        );
        x -= stroke.dx * factor * amount;
        y -= stroke.dy * factor * amount;
      } else if (stroke.mode === 'twirl') {
        const angle = (-amount * Math.PI) / 2,
          c = Math.cos(angle),
          s = Math.sin(angle);
        x = stroke.cx + c * dx - s * dy;
        y = stroke.cy + s * dx + c * dy;
      } else {
        const factor = Math.exp((stroke.mode === 'pinch' ? 1 : -1) * amount * 0.55);
        x = stroke.cx + dx * factor;
        y = stroke.cy + dy * factor;
      }
    }
    return { x: x / dimensions.width, y: y / dimensions.height };
  };
}
export function applyWarpV3(
  image: RGBAImage,
  warp: WarpV3,
  original: RGBAImage,
  options: RenderOptions,
): RGBAImage {
  if (!warp.enabled || !warp.strokes.some((s) => s.strength !== 0)) return image;
  const mapping = compileWarpFieldV3(warp, image, original),
    data = new Uint8ClampedArray(image.data.length),
    sample = new Float64Array(4);
  for (let y = 0; y < image.height; y++) {
    if ((y & 15) === 0) checkV3(options);
    for (let x = 0; x < image.width; x++) {
      const p = { x: (x + 0.5) / image.width, y: (y + 0.5) / image.height },
        mapped = mapping(p),
        at = (y * image.width + x) * 4;
      if (Math.abs(mapped.x - p.x) < 1e-15 && Math.abs(mapped.y - p.y) < 1e-15) {
        data.set(image.data.subarray(at, at + 4), at);
        continue;
      }
      sampleBilinearV3(image, mapped.x * image.width, mapped.y * image.height, sample, 'clamp');
      for (let c = 0; c < 4; c++) data[at + c] = sample[c]!;
    }
  }
  return { width: image.width, height: image.height, data };
}
