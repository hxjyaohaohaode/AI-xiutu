import { compileSelectionMaskV3 } from './v3-mask.js';
import { checkV3, sampleBilinearV3, sampleBoundedCubicV3, clamp01 } from './v3-pixels.js';
import type { WarpV3 } from './v3-types.js';
import type { RGBAImage, RenderOptions, Point, Dimensions } from './types.js';
import { flowWarpPoint, flowWarpPointV2 } from './v3-flow.js';

/** Reverse sampling field. A drag defines a smooth compactly-supported displacement, not scene geometry. */
export function compileWarpFieldV3(
  warp: WarpV3,
  dimensions: Dimensions,
  original?: RGBAImage,
): (point: Point) => Point {
  return compileWarpMapping(warp, dimensions, original);
}

function compileWarpMapping(warp: WarpV3, dimensions: Dimensions, original?: RGBAImage) {
  const short = Math.min(dimensions.width, dimensions.height);
  const strokes = warp.enabled
    ? warp.strokes
        .filter((s) => s.strength !== 0)
        .map((s) => {
          const r = s.radius * short,
            dx = (s.to.x - s.from.x) * dimensions.width,
            dy = (s.to.y - s.from.y) * dimensions.height;
          return {
            ...s,
            cx: s.from.x * dimensions.width,
            cy: s.from.y * dimensions.height,
            r,
            dx,
            dy,
            dragLimit: Math.min(1, (r * 0.8) / Math.max(1e-12, Math.hypot(dx, dy))),
          };
        })
    : [];
  const protectedAt =
    strokes.length && warp.protection
      ? compileSelectionMaskV3(warp.protection, dimensions, original)
      : null;
  const all = strokes.map((_, index) => index);
  const grid = strokes.length > 8 ? new Map<number, number[]>() : null;
  const cell = Math.max(8, short / 12);
  const stride = Math.ceil((dimensions.width + 2 * short) / cell) + 3;
  if (grid) {
    for (const [index, stroke] of strokes.entries()) {
      for (
        let y = Math.floor((stroke.cy - stroke.r) / cell);
        y <= Math.floor((stroke.cy + stroke.r) / cell);
        y++
      )
        for (
          let x = Math.floor((stroke.cx - stroke.r) / cell);
          x <= Math.floor((stroke.cx + stroke.r) / cell);
          x++
        ) {
          const key = y * stride + x;
          const bucket = grid.get(key);
          if (bucket) bucket.push(index);
          else grid.set(key, [index]);
        }
    }
  }
  const empty: number[] = [];
  const candidatesAt = (x: number, y: number) => {
    if (!grid) return all;
    if (x < -short || x > dimensions.width + short || y < -short || y > dimensions.height + short)
      return empty;
    return grid.get(Math.floor(y / cell) * stride + Math.floor(x / cell)) ?? empty;
  };
  return (point: Point, reconstruction?: { detail: boolean }): Point => {
    if (!strokes.length) return { x: point.x, y: point.y };
    let x = point.x * dimensions.width,
      y = point.y * dimensions.height;
    const protection = protectedAt?.(point.x, point.y) ?? 0;
    if (protection >= 1) return { ...point };
    let candidates = candidatesAt(x, y),
      position = candidates.length - 1;
    while (position >= 0) {
      const i = candidates[position--]!;
      const stroke = strokes[i]!,
        dx = x - stroke.cx,
        dy = y - stroke.cy;
      if (Math.abs(dx) >= stroke.r || Math.abs(dy) >= stroke.r) continue;
      const d = Math.hypot(dx, dy) / stroke.r;
      if (d >= 1) continue;
      const oldX = x,
        oldY = y;
      if (stroke.algorithm) {
        const flow = stroke.algorithm === 'flow-v2' ? flowWarpPointV2 : flowWarpPoint;
        const mapped = flow(
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
      } else {
        // Smooth compact support remains continuous even at requested hard brush falloff.
        const base = (1 - d * d) ** 2,
          soft = stroke.feather === 0 ? 1 : clamp01((1 - d) / stroke.feather),
          falloff = base * soft * soft * (3 - 2 * soft);
        const amount = stroke.strength * falloff * (1 - protection);
        if (stroke.mode === 'push') {
          // Limiting displacement per operation prevents huge pointer leaps from creating a discontinuous tear.
          x -= stroke.dx * stroke.dragLimit * amount;
          y -= stroke.dy * stroke.dragLimit * amount;
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
      if (
        reconstruction &&
        stroke.resampling === 'bounded-cubic-v1' &&
        (Math.abs(x - oldX) > 1e-10 || Math.abs(y - oldY) > 1e-10)
      )
        reconstruction.detail = true;
      // A later stroke can move the sample into the support of an earlier one.
      const next = candidatesAt(x, y);
      if (next !== candidates) {
        candidates = next;
        position = next.length - 1;
        while (position >= 0 && next[position]! >= i) position--;
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
  const active = warp.enabled ? warp.strokes.filter((s) => s.strength !== 0) : [];
  if (!active.length) return image;
  checkV3(options);
  const short = Math.min(image.width, image.height);
  // Outside the union of stroke supports the reverse mapping is identity, even for a composed field.
  const bounds = active
    .map((stroke) => {
      const cx = stroke.from.x * image.width,
        cy = stroke.from.y * image.height,
        radius = stroke.radius * short;
      return {
        left: Math.max(0, Math.floor(cx - radius - 0.5)),
        right: Math.min(image.width, Math.ceil(cx + radius + 0.5)),
        top: Math.max(0, Math.floor(cy - radius - 0.5)),
        bottom: Math.min(image.height, Math.ceil(cy + radius + 0.5)),
      };
    })
    .sort((a, b) => a.left - b.left);
  const top = Math.min(...bounds.map((box) => box.top));
  const bottom = Math.max(...bounds.map((box) => box.bottom));
  const mapping = compileWarpMapping(warp, image, original),
    data = image.data.slice(),
    sample = new Float64Array(4),
    weights = new Float64Array(8),
    reconstruction = active.some((s) => s.resampling) ? { detail: false } : undefined;
  const p: Point = { x: 0, y: 0 };
  for (let y = top; y < bottom; y++) {
    if ((y & 15) === 0) checkV3(options);
    p.y = (y + 0.5) / image.height;
    let coveredUntil = 0;
    for (const box of bounds) {
      if (y < box.top || y >= box.bottom || box.right <= coveredUntil) continue;
      for (let x = Math.max(box.left, coveredUntil); x < box.right; x++) {
        p.x = (x + 0.5) / image.width;
        if (reconstruction) reconstruction.detail = false;
        const mapped = mapping(p, reconstruction);
        if (Math.abs(mapped.x - p.x) < 1e-15 && Math.abs(mapped.y - p.y) < 1e-15) continue;
        const edgeX = mapped.x * image.width,
          edgeY = mapped.y * image.height;
        if (reconstruction?.detail) sampleBoundedCubicV3(image, edgeX, edgeY, sample, weights);
        else sampleBilinearV3(image, edgeX, edgeY, sample, 'clamp');
        const at = (y * image.width + x) * 4;
        for (let c = 0; c < 4; c++) data[at + c] = sample[c]!;
      }
      coveredUntil = box.right;
    }
  }
  return { width: image.width, height: image.height, data };
}
