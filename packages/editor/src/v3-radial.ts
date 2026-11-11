import { validateTiledDimensions } from './geometry.js';
import type { Dimensions, Point } from './types.js';
import type { RadialMaskV3 } from './v3-types.js';

/** The mask axes are measured in source pixels and shared by the renderer and canvas handles. */
export function radialMaskFrameV3(mask: RadialMaskV3, dimensions: Dimensions) {
  validateTiledDimensions(dimensions);
  const { width, height } = dimensions;
  const angle = mask.rotationDegrees ?? 0;
  const radians = (angle * Math.PI) / 180;
  const cardinal = angle % 90 === 0;
  const cos = cardinal ? Math.round(Math.cos(radians)) : Math.cos(radians);
  const sin = cardinal ? Math.round(Math.sin(radians)) : Math.sin(radians);
  const xAxis = { x: mask.radiusX * cos, y: (mask.radiusX * width * sin) / height };
  const yAxis = { x: (-mask.radiusY * height * sin) / width, y: mask.radiusY * cos };
  const xx = cos / mask.radiusX,
    xy = (sin * height) / (mask.radiusX * width),
    yx = (-sin * width) / (mask.radiusY * height),
    yy = cos / mask.radiusY;
  const shape = mask.shape ?? 'ellipse';
  const extent = (a: number, b: number) =>
    shape === 'rectangle'
      ? Math.abs(a) + Math.abs(b)
      : shape === 'diamond'
        ? Math.max(Math.abs(a), Math.abs(b))
        : Math.hypot(a, b);
  return {
    point(x: number, y: number): Point {
      return {
        x: mask.centerX + x * xAxis.x + y * yAxis.x,
        y: mask.centerY + x * xAxis.y + y * yAxis.y,
      };
    },
    local(point: Point): Point {
      const x = point.x - mask.centerX,
        y = point.y - mask.centerY;
      return { x: xx * x + xy * y, y: yx * x + yy * y };
    },
    extent: { x: extent(xAxis.x, yAxis.x), y: extent(xAxis.y, yAxis.y) },
    weight(x: number, y: number): number {
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new RangeError('Mask sample coordinates must be finite');
      if (x < 0 || y < 0 || x > 1 || y > 1) return 0;
      const dx = x - mask.centerX,
        dy = y - mask.centerY;
      const u = xx * dx + xy * dy,
        v = yx * dx + yy * dy;
      const distance =
        shape === 'rectangle'
          ? Math.max(Math.abs(u), Math.abs(v))
          : shape === 'diamond'
            ? Math.abs(u) + Math.abs(v)
            : Math.sqrt(u * u + v * v);
      const t =
        distance >= 1
          ? 0
          : mask.feather === 0 || distance <= 1 - mask.feather
            ? 1
            : (1 - distance) / mask.feather;
      const weight = t * t * (3 - 2 * t);
      return mask.invert ? 1 - weight : weight;
    },
  };
}
