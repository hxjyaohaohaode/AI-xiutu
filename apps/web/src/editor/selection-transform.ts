import type { Dimensions, Point, SelectionMaskV3 } from '@ai-xiutu/editor';

export type PolygonSelection = Extract<SelectionMaskV3, { type: 'polygon' }>;

export function polygonCenter(points: readonly Point[]): Point {
  if (!points.length) return { x: 0.5, y: 0.5 };
  return points.reduce(
    (center, point) => ({
      x: center.x + point.x / points.length,
      y: center.y + point.y / points.length,
    }),
    { x: 0, y: 0 },
  );
}

/** Translate as one object. At an edge, stop the whole shape instead of crushing vertices. */
export function translatePolygon(mask: PolygonSelection, dx: number, dy: number): PolygonSelection {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !mask.points.length) return mask;
  const x = Math.max(
    -Math.min(...mask.points.map((p) => p.x)),
    Math.min(dx, 1 - Math.max(...mask.points.map((p) => p.x))),
  );
  const y = Math.max(
    -Math.min(...mask.points.map((p) => p.y)),
    Math.min(dy, 1 - Math.max(...mask.points.map((p) => p.y))),
  );
  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) return mask;
  return { ...mask, points: mask.points.map((point) => ({ x: point.x + x, y: point.y + y })) };
}

/** Rotation is in source pixels, so a non-square source never shears the selection. */
export function rotatePolygon(
  mask: PolygonSelection,
  degrees: number,
  dimensions: Dimensions,
): PolygonSelection | null {
  if (
    !Number.isFinite(degrees) ||
    !Number.isFinite(dimensions.width) ||
    !Number.isFinite(dimensions.height) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  )
    return null;
  if (Math.abs(degrees % 360) < 1e-10) return mask;
  const center = polygonCenter(mask.points);
  const angle = (degrees * Math.PI) / 180;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const points = mask.points.map((point) => {
    const x = (point.x - center.x) * dimensions.width;
    const y = (point.y - center.y) * dimensions.height;
    return {
      x: center.x + (x * cosine - y * sine) / dimensions.width,
      y: center.y + (x * sine + y * cosine) / dimensions.height,
    };
  });
  if (
    points.some(
      (point) => point.x < -1e-10 || point.x > 1 + 1e-10 || point.y < -1e-10 || point.y > 1 + 1e-10,
    )
  )
    return null;
  return {
    ...mask,
    points: points.map((point) => ({
      x: Math.max(0, Math.min(1, point.x)),
      y: Math.max(0, Math.min(1, point.y)),
    })),
  };
}

export function polygonRotationDelta(
  start: Point,
  end: Point,
  center: Point,
  dimensions: Dimensions,
): number {
  const angle = (point: Point) =>
    Math.atan2((point.y - center.y) * dimensions.height, (point.x - center.x) * dimensions.width);
  return ((angle(end) - angle(start)) * 180) / Math.PI;
}
