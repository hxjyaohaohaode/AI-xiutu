import type { Point } from './types.js';

/** Stationary compact velocity, integrated in radius-normalized coordinates.
 * RK4 (16 steps) avoids the foldovers of a single large displacement update.
 * It is a numerical flow, not a guarantee for arbitrary discontinuous protection masks.
 * Old saved strokes do not enter this path. The source image is still sampled once. */
export function flowWarpPoint(
  x: number,
  y: number,
  tx: number,
  ty: number,
  mode: 'push' | 'pinch' | 'bulge' | 'twirl',
  strength: number,
  feather: number,
): Point {
  const falloff = (qx: number, qy: number) => {
    const d = Math.hypot(qx, qy);
    if (d >= 1) return 0;
    const soft = feather === 0 ? 1 : Math.min(1, (1 - d) / feather);
    return (1 - d * d) ** 2 * soft * soft * (3 - 2 * soft);
  };
  // A rotational flow keeps radius constant, so this case has an exact solution.
  if (mode === 'twirl') {
    const angle = (-strength * falloff(x, y) * Math.PI) / 2;
    return {
      x: Math.cos(angle) * x - Math.sin(angle) * y,
      y: Math.sin(angle) * x + Math.cos(angle) * y,
    };
  }
  const scale = Math.min(1, 0.8 / Math.max(1e-12, Math.hypot(tx, ty))),
    ux = -tx * scale * strength,
    uy = -ty * scale * strength,
    radial = (mode === 'pinch' ? 1 : -1) * strength * 0.55,
    dt = 1 / 16;
  for (let i = 0; i < 16; i++) {
    const a = falloff(x, y),
      ax = (mode === 'push' ? ux : x * radial) * a,
      ay = (mode === 'push' ? uy : y * radial) * a,
      bx0 = x + (ax * dt) / 2,
      by0 = y + (ay * dt) / 2,
      b = falloff(bx0, by0),
      bx = (mode === 'push' ? ux : bx0 * radial) * b,
      by = (mode === 'push' ? uy : by0 * radial) * b,
      cx0 = x + (bx * dt) / 2,
      cy0 = y + (by * dt) / 2,
      c = falloff(cx0, cy0),
      cx = (mode === 'push' ? ux : cx0 * radial) * c,
      cy = (mode === 'push' ? uy : cy0 * radial) * c,
      dx0 = x + cx * dt,
      dy0 = y + cy * dt,
      d = falloff(dx0, dy0),
      dx = (mode === 'push' ? ux : dx0 * radial) * d,
      dy = (mode === 'push' ? uy : dy0 * radial) * d;
    x += (dt * (ax + 2 * bx + 2 * cx + dx)) / 6;
    y += (dt * (ay + 2 * by + 2 * cy + dy)) / 6;
  }
  return { x, y };
}
