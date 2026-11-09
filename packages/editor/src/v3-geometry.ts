import {
  getOutputDimensions,
  mapSourceToOutput,
  mapOutputToSource,
  validateTiledDimensions,
  pixelCrop,
} from './geometry.js';
import { RecipeValidationError } from './recipe.js';
import { parseEditorRecipe } from './v2-recipe.js';
import { MAX_V3_PIXELS } from './v3-registry.js';
import { compileWarpFieldV3 } from './v3-warp.js';
import type { RGBAImage, Dimensions, Point } from './types.js';
import type { EditorRecipe } from './v2-types.js';
import type { FineTransformV3 } from './v3-types.js';

export type Matrix3V3 = [number, number, number, number, number, number, number, number, number];
const identity = (): Matrix3V3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
function multiply(a: Matrix3V3, b: Matrix3V3): Matrix3V3 {
  const out = Array<number>(9).fill(0) as Matrix3V3;
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      for (let k = 0; k < 3; k++) out[row * 3 + col]! += a[row * 3 + k]! * b[k * 3 + col]!;
  return out;
}
function invert(m: Matrix3V3): Matrix3V3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = f * g - d * i,
    C = d * h - e * g,
    det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-10)
    throw new RecipeValidationError(['transform: singular matrix']);
  return [
    A,
    c * h - b * i,
    b * f - c * e,
    B,
    a * i - c * g,
    c * d - a * f,
    C,
    b * g - a * h,
    a * e - b * d,
  ].map((v) => v / det) as Matrix3V3;
}
export function applyMatrixV3(m: Matrix3V3, p: Point): Point {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y))
    throw new RangeError('Point coordinates must be finite');
  const z = m[6] * p.x + m[7] * p.y + m[8];
  if (!Number.isFinite(z) || Math.abs(z) < 1e-10)
    throw new RangeError('Point lies on the projective horizon');
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / z, y: (m[3] * p.x + m[4] * p.y + m[5]) / z };
}
export interface TransformContextV3 {
  matrix: Matrix3V3;
  inverse: Matrix3V3;
  dimensions: Dimensions;
  identity: boolean;
}
/** Exact edge-coordinate matrix shared by resampling and UI hit testing. */
export function compileFineTransformV3(
  dimensions: Dimensions,
  t: FineTransformV3,
): TransformContextV3 {
  validateTiledDimensions(dimensions);
  const { width: w, height: h } = dimensions,
    rad = Math.PI / 180;
  const cx = w / 2,
    cy = h / 2,
    angle = t.rotationDegrees * rad,
    px = t.perspectiveX * rad,
    py = t.perspectiveY * rad;
  const c = Math.cos(angle),
    s = Math.sin(angle),
    distance = 2 * Math.max(w, h);
  const translate = (x: number, y: number): Matrix3V3 => [1, 0, x, 0, 1, y, 0, 0, 1];
  const scale: Matrix3V3 = [t.scaleX, 0, 0, 0, t.scaleY, 0, 0, 0, 1];
  const skew: Matrix3V3 = [1, Math.tan(t.skewX * rad), 0, Math.tan(t.skewY * rad), 1, 0, 0, 0, 1];
  const projection: Matrix3V3 = [
    Math.cos(px),
    Math.sin(px) * Math.sin(py),
    0,
    0,
    Math.cos(py),
    0,
    -Math.sin(px) / distance,
    (Math.cos(px) * Math.sin(py)) / distance,
    1,
  ];
  const rotation: Matrix3V3 = [c, -s, 0, s, c, 0, 0, 0, 1];
  let matrix = identity();
  for (const part of [
    translate(-cx, -cy),
    scale,
    skew,
    projection,
    rotation,
    translate(cx + t.translateX * w, cy + t.translateY * h),
  ])
    matrix = multiply(part, matrix);
  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  if (corners.some((p) => matrix[6] * p.x + matrix[7] * p.y + matrix[8] < 0.05))
    throw new RecipeValidationError(['transform: perspective crosses the visible horizon']);
  const projected = corners.map((p) => applyMatrixV3(matrix, p));
  let width = w,
    height = h;
  if (t.fit === 'contain') {
    const snap = (n: number) => (Math.abs(n - Math.round(n)) < 1e-8 ? Math.round(n) : n);
    const left = snap(Math.min(...projected.map((p) => p.x))),
      top = snap(Math.min(...projected.map((p) => p.y)));
    width = Math.ceil(snap(Math.max(...projected.map((p) => p.x)) - left));
    height = Math.ceil(snap(Math.max(...projected.map((p) => p.y)) - top));
    matrix = multiply(translate(-left, -top), matrix);
  }
  validateTiledDimensions({ width, height }, MAX_V3_PIXELS);
  const inverse = invert(matrix);
  const unit = identity();
  return {
    matrix,
    inverse,
    dimensions: { width, height },
    identity: width === w && height === h && matrix.every((v, i) => Math.abs(v - unit[i]!) < 1e-12),
  };
}
export function getEditorOutputDimensions(image: Dimensions, input: EditorRecipe): Dimensions {
  const recipe = parseEditorRecipe(input),
    base = getOutputDimensions(image, recipe.geometry);
  return recipe.schemaVersion === 3
    ? compileFineTransformV3(base, recipe.transform).dimensions
    : base;
}
/** Coordinate-frame mapping only. Artistic displacement fields are intentionally separate from frame geometry. */
export function mapEditorSourceToOutput(
  point: Point,
  image: Dimensions,
  input: EditorRecipe,
): Point {
  const recipe = parseEditorRecipe(input),
    base = getOutputDimensions(image, recipe.geometry),
    p = mapSourceToOutput(point, image, recipe.geometry);
  if (recipe.schemaVersion !== 3) return p;
  const fine = compileFineTransformV3(base, recipe.transform),
    q = applyMatrixV3(fine.matrix, { x: p.x * base.width, y: p.y * base.height });
  return { x: q.x / fine.dimensions.width, y: q.y / fine.dimensions.height };
}
export function mapEditorOutputToSource(
  point: Point,
  image: Dimensions,
  input: EditorRecipe,
): Point {
  const recipe = parseEditorRecipe(input);
  if (recipe.schemaVersion !== 3) return mapOutputToSource(point, image, recipe.geometry);
  const base = getOutputDimensions(image, recipe.geometry),
    fine = compileFineTransformV3(base, recipe.transform);
  const q = applyMatrixV3(fine.inverse, {
    x: point.x * fine.dimensions.width,
    y: point.y * fine.dimensions.height,
  });
  return mapOutputToSource({ x: q.x / base.width, y: q.y / base.height }, image, recipe.geometry);
}

export interface EditorCoordinateMap {
  dimensions: Dimensions;
  /** Source coordinate frame to the displayed output frame; does not deform the control geometry. */
  toOutput(point: Point): Point;
  toSource(point: Point): Point;
  /** Displayed output to original image content, including the inverse displacement field. */
  toContent(point: Point): Point;
}

/** Compile once per recipe/source and reuse during gestures; no JSON parsing in the returned callbacks. */
export function compileEditorCoordinateMap(
  image: Dimensions,
  input: EditorRecipe,
  original?: RGBAImage,
): EditorCoordinateMap {
  const recipe = parseEditorRecipe(input),
    base = getOutputDimensions(image, recipe.geometry);
  const fine = recipe.schemaVersion === 3 ? compileFineTransformV3(base, recipe.transform) : null;
  const warp = recipe.schemaVersion === 3 ? compileWarpFieldV3(recipe.warp, image, original) : null;
  const dimensions = fine?.dimensions ?? base;
  const crop = pixelCrop(image, recipe.geometry),
    geometry = recipe.geometry;
  const assertPoint = (point: Point) => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
      throw new RangeError('Point coordinates must be finite');
  };
  const sourceToBase = (point: Point): Point => {
    assertPoint(point);
    const u = (point.x * image.width - crop.left) / crop.width,
      v = (point.y * image.height - crop.top) / crop.height;
    const p =
      geometry.rotation === 90
        ? { x: 1 - v, y: u }
        : geometry.rotation === 180
          ? { x: 1 - u, y: 1 - v }
          : geometry.rotation === 270
            ? { x: v, y: 1 - u }
            : { x: u, y: v };
    return { x: geometry.flipX ? 1 - p.x : p.x, y: geometry.flipY ? 1 - p.y : p.y };
  };
  const baseToSource = (point: Point): Point => {
    assertPoint(point);
    const x = geometry.flipX ? 1 - point.x : point.x,
      y = geometry.flipY ? 1 - point.y : point.y;
    const p =
      geometry.rotation === 90
        ? { x: y, y: 1 - x }
        : geometry.rotation === 180
          ? { x: 1 - x, y: 1 - y }
          : geometry.rotation === 270
            ? { x: 1 - y, y: x }
            : { x, y };
    return {
      x: (crop.left + p.x * crop.width) / image.width,
      y: (crop.top + p.y * crop.height) / image.height,
    };
  };
  const toSource = (point: Point): Point => {
    const p = fine
      ? applyMatrixV3(fine.inverse, {
          x: point.x * dimensions.width,
          y: point.y * dimensions.height,
        })
      : { x: point.x * base.width, y: point.y * base.height };
    return baseToSource({ x: p.x / base.width, y: p.y / base.height });
  };
  return {
    dimensions,
    toSource,
    toOutput(point) {
      const p = sourceToBase(point);
      if (!fine) return p;
      const q = applyMatrixV3(fine.matrix, { x: p.x * base.width, y: p.y * base.height });
      return { x: q.x / dimensions.width, y: q.y / dimensions.height };
    },
    toContent(point) {
      const source = toSource(point);
      return warp ? warp(source) : source;
    },
  };
}
export function mapEditorOutputToContent(
  point: Point,
  image: Dimensions,
  input: EditorRecipe,
  original?: RGBAImage,
): Point {
  return compileEditorCoordinateMap(image, input, original).toContent(point);
}
