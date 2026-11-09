import { readGeometry, RecipeValidationError } from './recipe.js';
import type { Dimensions, Geometry, Point } from './types.js';

export const MAX_DIMENSION = 8192;
export const MAX_INPUT_PIXELS = 4_194_304;
export const MAX_EXPLICIT_PIXELS = 16_777_216;
export const MAX_TILED_DIMENSION = 16384;
export const MAX_TILED_PIXELS = 67_108_864;

export function validateDimensions(image: Dimensions, maxPixels = MAX_INPUT_PIXELS): void {
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > MAX_EXPLICIT_PIXELS)
    throw new RangeError(`maxPixels must be an integer from 1 to ${MAX_EXPLICIT_PIXELS}`);
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > MAX_DIMENSION ||
    image.height > MAX_DIMENSION
  )
    throw new RangeError(`Image dimensions must be integers from 1 to ${MAX_DIMENSION}`);
  if (image.width * image.height > maxPixels)
    throw new RangeError(`Image exceeds the explicit render budget of ${maxPixels} pixels`);
}

/** A separate explicit budget; never relaxes the monolithic reference renderer. */
export function validateTiledDimensions(image: Dimensions, maxPixels = MAX_TILED_PIXELS): void {
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > MAX_TILED_PIXELS)
    throw new RangeError(`maxPixels must be an integer from 1 to ${MAX_TILED_PIXELS}`);
  if (
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > MAX_TILED_DIMENSION ||
    image.height > MAX_TILED_DIMENSION
  )
    throw new RangeError(`Image dimensions must be integers from 1 to ${MAX_TILED_DIMENSION}`);
  if (image.width * image.height > maxPixels)
    throw new RangeError(`Image exceeds the explicit tiled render budget of ${maxPixels} pixels`);
}

export interface PixelCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Internal, already validated recipe. Include every pixel touched by the normalized crop. */
export function pixelCrop(image: Dimensions, geometry: Geometry): PixelCrop {
  const c = geometry.crop;
  if (!c) return { left: 0, top: 0, width: image.width, height: image.height };
  const left = Math.min(image.width - 1, Math.floor(c.x * image.width));
  const top = Math.min(image.height - 1, Math.floor(c.y * image.height));
  const right = Math.min(image.width, Math.max(left + 1, Math.ceil((c.x + c.width) * image.width)));
  const bottom = Math.min(
    image.height,
    Math.max(top + 1, Math.ceil((c.y + c.height) * image.height)),
  );
  return { left, top, width: right - left, height: bottom - top };
}

function geometryContext(
  image: Dimensions,
  input: Geometry,
): { geometry: Geometry; crop: PixelCrop } {
  // These metadata/coordinate helpers allocate no image buffers. Rendering paths
  // apply their own (different) limits before calling them.
  validateTiledDimensions(image);
  const errors: string[] = [];
  const geometry = readGeometry(input, errors);
  if (errors.length) throw new RecipeValidationError(errors);
  return { geometry, crop: pixelCrop(image, geometry) };
}

export function getOutputDimensions(image: Dimensions, geometry: Geometry): Dimensions {
  const { crop, geometry: g } = geometryContext(image, geometry);
  return g.rotation === 90 || g.rotation === 270
    ? { width: crop.height, height: crop.width }
    : { width: crop.width, height: crop.height };
}

function validatePoint(point: Point): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new RangeError('Point coordinates must be finite');
}

/** Normalized edge coordinates. A source point outside the crop can map outside [0,1]. */
export function mapSourceToOutput(point: Point, image: Dimensions, geometry: Geometry): Point {
  validatePoint(point);
  const { crop, geometry: g } = geometryContext(image, geometry);
  const u = (point.x * image.width - crop.left) / crop.width;
  const v = (point.y * image.height - crop.top) / crop.height;
  let x: number;
  let y: number;
  switch (g.rotation) {
    case 90:
      x = 1 - v;
      y = u;
      break;
    case 180:
      x = 1 - u;
      y = 1 - v;
      break;
    case 270:
      x = v;
      y = 1 - u;
      break;
    default:
      x = u;
      y = v;
  }
  return { x: g.flipX ? 1 - x : x, y: g.flipY ? 1 - y : y };
}

/** Reverse of mapSourceToOutput, including the renderer's integer crop rounding. */
export function mapOutputToSource(point: Point, image: Dimensions, geometry: Geometry): Point {
  validatePoint(point);
  const { crop, geometry: g } = geometryContext(image, geometry);
  const x = g.flipX ? 1 - point.x : point.x;
  const y = g.flipY ? 1 - point.y : point.y;
  let u: number;
  let v: number;
  switch (g.rotation) {
    case 90:
      u = y;
      v = 1 - x;
      break;
    case 180:
      u = 1 - x;
      v = 1 - y;
      break;
    case 270:
      u = 1 - y;
      v = x;
      break;
    default:
      u = x;
      v = y;
  }
  return {
    x: (crop.left + u * crop.width) / image.width,
    y: (crop.top + v * crop.height) / image.height,
  };
}

/** Output pixel index to input pixel index; exact pixel permutations, no interpolation. */
export function sourcePixel(
  x: number,
  y: number,
  output: Dimensions,
  crop: PixelCrop,
  geometry: Geometry,
  sourceWidth: number,
): number {
  const ox = geometry.flipX ? output.width - 1 - x : x;
  const oy = geometry.flipY ? output.height - 1 - y : y;
  let sx: number;
  let sy: number;
  switch (geometry.rotation) {
    case 90:
      sx = oy;
      sy = crop.height - 1 - ox;
      break;
    case 180:
      sx = crop.width - 1 - ox;
      sy = crop.height - 1 - oy;
      break;
    case 270:
      sx = crop.width - 1 - oy;
      sy = ox;
      break;
    default:
      sx = ox;
      sy = oy;
  }
  return (crop.top + sy) * sourceWidth + crop.left + sx;
}

/** Exact inverse pixel permutation, for stitching source-space tiles into output. */
export function outputPixel(
  sourceX: number,
  sourceY: number,
  output: Dimensions,
  crop: PixelCrop,
  geometry: Geometry,
): number {
  const sx = sourceX - crop.left;
  const sy = sourceY - crop.top;
  let x: number;
  let y: number;
  switch (geometry.rotation) {
    case 90:
      x = crop.height - 1 - sy;
      y = sx;
      break;
    case 180:
      x = crop.width - 1 - sx;
      y = crop.height - 1 - sy;
      break;
    case 270:
      x = sy;
      y = crop.width - 1 - sx;
      break;
    default:
      x = sx;
      y = sy;
  }
  if (geometry.flipX) x = output.width - 1 - x;
  if (geometry.flipY) y = output.height - 1 - y;
  return y * output.width + x;
}
