import { compileSelectionMask, type SelectionMaskSampler } from './v2-mask.js';
import { parseSelectionMaskV3 } from './v3-recipe.js';
import type { CropRect, Dimensions, Point, RGBAImage } from './types.js';
import type { SelectionMaskV3 } from './v3-types.js';

/** Soft Boolean masks: max union, min intersection, a*(1-b) subtract, probabilistic xor. */
export function compileSelectionMaskV3(
  input: SelectionMaskV3,
  dimensions: Dimensions,
  source?: RGBAImage,
): SelectionMaskSampler {
  const mask = parseSelectionMaskV3(input);
  const compile = (m: SelectionMaskV3): SelectionMaskSampler => {
    if (m.type !== 'compound') return compileSelectionMask(m, dimensions, source);
    const children = m.masks.map(compile),
      first = children[0]!,
      rest = children.slice(1);
    return (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new RangeError('Mask sample coordinates must be finite');
      if (x < 0 || y < 0 || x > 1 || y > 1) return 0;
      let value = first(x, y);
      for (const sample of rest) {
        if (
          (m.operation === 'union' && value === 1) ||
          ((m.operation === 'intersection' || m.operation === 'subtract') && value === 0)
        )
          break;
        const b = sample(x, y);
        switch (m.operation) {
          case 'union':
            value = Math.max(value, b);
            break;
          case 'intersection':
            value = Math.min(value, b);
            break;
          case 'subtract':
            value *= 1 - b;
            break;
          case 'xor':
            value = value + b - 2 * value * b;
            break;
        }
      }
      return m.invert ? 1 - value : value;
    };
  };
  return compile(mask);
}

const full: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const empty: CropRect = { x: 0, y: 0, width: 0, height: 0 };
const clamp = (value: number) => Math.max(0, Math.min(1, value));
function box(left: number, top: number, right: number, bottom: number): CropRect {
  const x = clamp(left),
    y = clamp(top);
  return { x, y, width: Math.max(0, clamp(right) - x), height: Math.max(0, clamp(bottom) - y) };
}
function pointsBox(points: readonly Point[], rx = 0, ry = 0): CropRect {
  if (!points.length) return empty;
  return box(
    Math.min(...points.map((point) => point.x)) - rx,
    Math.min(...points.map((point) => point.y)) - ry,
    Math.max(...points.map((point) => point.x)) + rx,
    Math.max(...points.map((point) => point.y)) + ry,
  );
}
function union(items: CropRect[]): CropRect {
  const boxes = items.filter((item) => item.width > 0 && item.height > 0);
  if (!boxes.length) return empty;
  return box(
    Math.min(...boxes.map((item) => item.x)),
    Math.min(...boxes.map((item) => item.y)),
    Math.max(...boxes.map((item) => item.x + item.width)),
    Math.max(...boxes.map((item) => item.y + item.height)),
  );
}

/** Conservative support of an already parsed mask in the oriented source frame.
 * Raster support is computed directly from runs, independent of source resolution. */
export function getSelectionBoundsV3(mask: SelectionMaskV3, dimensions: Dimensions): CropRect {
  if (mask.invert) return full;
  switch (mask.type) {
    case 'radial':
      return pointsBox([{ x: mask.centerX, y: mask.centerY }], mask.radiusX, mask.radiusY);
    case 'polygon':
      return pointsBox(mask.points);
    case 'brush': {
      const short = Math.min(dimensions.width, dimensions.height);
      return union(
        mask.strokes
          .filter((stroke) => stroke.mode === 'add' && stroke.opacity > 0)
          .map((stroke) =>
            pointsBox(
              stroke.points,
              (stroke.radius * short) / dimensions.width,
              (stroke.radius * short) / dimensions.height,
            ),
          ),
      );
    }
    case 'raster': {
      let at = 0,
        left = mask.width,
        top = mask.height,
        right = 0,
        bottom = 0;
      for (let i = 0; i < mask.runs.length; i += 2) {
        const end = at + mask.runs[i]!;
        if (mask.runs[i + 1]! > 0) {
          const firstRow = Math.floor(at / mask.width),
            lastRow = Math.floor((end - 1) / mask.width);
          left = Math.min(left, firstRow === lastRow ? at % mask.width : 0);
          right = Math.max(right, firstRow === lastRow ? ((end - 1) % mask.width) + 1 : mask.width);
          top = Math.min(top, firstRow);
          bottom = Math.max(bottom, lastRow + 1);
        }
        at = end;
      }
      return bottom
        ? box(left / mask.width, top / mask.height, right / mask.width, bottom / mask.height)
        : empty;
    }
    case 'compound': {
      if (mask.operation === 'subtract') return getSelectionBoundsV3(mask.masks[0]!, dimensions);
      const boxes = mask.masks.map((item) => getSelectionBoundsV3(item, dimensions));
      if (mask.operation !== 'intersection') return union(boxes);
      return box(
        Math.max(...boxes.map((item) => item.x)),
        Math.max(...boxes.map((item) => item.y)),
        Math.min(...boxes.map((item) => item.x + item.width)),
        Math.min(...boxes.map((item) => item.y + item.height)),
      );
    }
    default:
      return full;
  }
}
