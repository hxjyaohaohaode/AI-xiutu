import { RecipeValidationError } from './recipe.js';
import { validateTiledDimensions } from './geometry.js';
import { applyMatrixV3, type Matrix3V3 } from './v3-geometry.js';
import { MAX_V4_PIXELS, type ProjectiveTransformV4 } from './v4-types.js';
import type { Dimensions, Point } from './types.js';

export interface ProjectiveContextV4 {
  matrix: Matrix3V3;
  inverse: Matrix3V3;
  dimensions: Dimensions;
  /** Pixel offset removed by contain fitting, in the pre-projective frame. */
  origin: Point;
  identity: boolean;
}

const UNIT: Matrix3V3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function multiplyMatrixV4(a: Matrix3V3, b: Matrix3V3): Matrix3V3 {
  const out = Array<number>(9).fill(0) as Matrix3V3;
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) out[3 * r + c]! += a[3 * r + k]! * b[3 * k + c]!;
  return out;
}

export function invertMatrixV4(m: Matrix3V3): Matrix3V3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12)
    throw new RecipeValidationError(['projective: singular matrix']);
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ].map((v) => v / det) as Matrix3V3;
}

/** Reject concave, crossed, mirrored and effectively collapsed quadrilaterals. */
export function validateProjectiveQuadV4(corners: readonly Point[]): void {
  if (corners.length !== 4)
    throw new RecipeValidationError(['projective.corners: expected four points']);
  for (const p of corners)
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      p.x < -2 ||
      p.x > 3 ||
      p.y < -2 ||
      p.y > 3
    )
      throw new RecipeValidationError(['projective.corners: coordinates must be finite in [-2,3]']);
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!,
      b = corners[(i + 1) % 4]!,
      c = corners[(i + 2) % 4]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross <= 1e-6 || Math.hypot(b.x - a.x, b.y - a.y) < 1e-4)
      throw new RecipeValidationError([
        'projective.corners: keep a convex clockwise quad without crossing or collapse',
      ]);
  }
}

/** Unit square to convex quad. Uses the exact 8-DOF homography, not affine corner approximation. */
function unitToQuad(points: readonly Point[]): Matrix3V3 {
  validateProjectiveQuadV4(points);
  const [p0, p1, p2, p3] = points as [Point, Point, Point, Point];
  const sx = p0.x - p1.x + p2.x - p3.x,
    sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0,
    h = 0;
  if (Math.abs(sx) + Math.abs(sy) > 1e-14) {
    const dx1 = p1.x - p2.x,
      dx2 = p3.x - p2.x,
      dy1 = p1.y - p2.y,
      dy2 = p3.y - p2.y,
      determinant = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(determinant) < 1e-12)
      throw new RecipeValidationError(['projective.corners: unstable quadrilateral']);
    g = (sx * dy2 - dx2 * sy) / determinant;
    h = (dx1 * sy - sx * dy1) / determinant;
  }
  if ([1, 1 + g, 1 + g + h, 1 + h].some((z) => !Number.isFinite(z) || z < 1e-5))
    throw new RecipeValidationError(['projective.corners: projective horizon crosses the image']);
  return [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
}

export function compileProjectiveTransformV4(
  dimensions: Dimensions,
  transform: ProjectiveTransformV4,
): ProjectiveContextV4 {
  validateTiledDimensions(dimensions, MAX_V4_PIXELS);
  const normalized = unitToQuad(transform.corners);
  if (transform.fit !== 'contain' && transform.fit !== 'crop')
    throw new RecipeValidationError(['projective.fit: expected contain or crop']);
  if (!transform.enabled)
    return {
      matrix: [...UNIT],
      inverse: [...UNIT],
      dimensions: { ...dimensions },
      origin: { x: 0, y: 0 },
      identity: true,
    };
  const { width: w, height: h } = dimensions;
  let matrix = multiplyMatrixV4(
    [w, 0, 0, 0, h, 0, 0, 0, 1],
    multiplyMatrixV4(normalized, [1 / w, 0, 0, 0, 1 / h, 0, 0, 0, 1]),
  );
  let width = w,
    height = h;
  const origin = { x: 0, y: 0 };
  if (transform.fit === 'contain') {
    const snap = (n: number) => (Math.abs(n - Math.round(n)) < 1e-8 ? Math.round(n) : n);
    const points = transform.corners.map((p) => ({ x: p.x * w, y: p.y * h }));
    origin.x = snap(Math.min(...points.map((p) => p.x)));
    origin.y = snap(Math.min(...points.map((p) => p.y)));
    width = Math.ceil(snap(Math.max(...points.map((p) => p.x)) - origin.x));
    height = Math.ceil(snap(Math.max(...points.map((p) => p.y)) - origin.y));
    matrix = multiplyMatrixV4([1, 0, -origin.x, 0, 1, -origin.y, 0, 0, 1], matrix);
  }
  validateTiledDimensions({ width, height }, MAX_V4_PIXELS);
  return {
    matrix,
    inverse: invertMatrixV4(matrix),
    dimensions: { width, height },
    origin,
    identity: width === w && height === h && matrix.every((v, i) => Math.abs(v - UNIT[i]!) < 1e-12),
  };
}

/** A dragged handle is a destination location, not an inverse-warp content pixel. */
export function mapProjectiveOutputToCornerFrame(
  point: Point,
  preProjective: Dimensions,
  transform: ProjectiveTransformV4,
): Point {
  const context = compileProjectiveTransformV4(preProjective, transform);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new RangeError('Point must be finite');
  return {
    x: (point.x * context.dimensions.width + context.origin.x) / preProjective.width,
    y: (point.y * context.dimensions.height + context.origin.y) / preProjective.height,
  };
}

export function mapProjectiveCornerFrameToOutput(
  point: Point,
  preProjective: Dimensions,
  transform: ProjectiveTransformV4,
): Point {
  const context = compileProjectiveTransformV4(preProjective, transform);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new RangeError('Point must be finite');
  return {
    x: (point.x * preProjective.width - context.origin.x) / context.dimensions.width,
    y: (point.y * preProjective.height - context.origin.y) / context.dimensions.height,
  };
}

export { applyMatrixV3 as applyProjectiveMatrixV4 };
