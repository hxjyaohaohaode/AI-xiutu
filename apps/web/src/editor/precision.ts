import { parseRecipeV2, orientedCropSpace, pixelCrop, type SelectionMaskV3, type Point, type RGBAImage } from '@ai-xiutu/editor';
import type {
  CropRect,
  Dimensions,
  EditorRecipe,
  RecipeV2,
  V2ToolDefinition,
} from '@ai-xiutu/editor';

export const clamp = (n: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

/** A ratio is a UI constraint, not recipe metadata. Undo/import/remote replay
 * must release a stale constraint when it no longer matches the visible crop. */
export function cropRatioForGeometry(
  ratio: number | null,
  dimensions: Dimensions | null,
  geometry: EditorRecipe['geometry'],
): number | null {
  if (ratio === null || !dimensions || !Number.isFinite(ratio) || ratio <= 0) return null;
  const { width, height } = orientedCropSpace(dimensions, geometry).crop;
  const pixelTolerance = .5 * (1 + ratio) + 1e-6;
  return Math.abs(width - height * ratio) <= pixelTolerance ? ratio : null;
}

/** Radius is measured against the original short edge, never the preview size. */
export function brushPointAtSource(point: Point, dimensions: Dimensions, radius: number): Point {
  if (radius * Math.min(dimensions.width, dimensions.height) > 0.5 + 1e-8) return point;
  return {
    x:
      (clamp(Math.floor(point.x * dimensions.width), 0, dimensions.width - 1) + 0.5) /
      dimensions.width,
    y:
      (clamp(Math.floor(point.y * dimensions.height), 0, dimensions.height - 1) + 0.5) /
      dimensions.height,
  };
}

/** Source color selection deliberately ignores the adjusted display pixels. */
export function sampleSourcePreview(image: RGBAImage, point: Point) {
  const x = clamp(Math.floor(point.x * image.width), 0, image.width - 1);
  const y = clamp(Math.floor(point.y * image.height), 0, image.height - 1);
  const index = (y * image.width + x) * 4;
  return { x, y, rgba: Array.from(image.data.subarray(index, index + 4)) };
}

export function duplicateRegionForEditor(
  recipe: RecipeV2,
  regionId: string,
  newId: string,
): RecipeV2 {
  const region = recipe.regions.find((item) => item.id === regionId);
  if (!region) throw new Error('Selection no longer exists');
  const copy = { ...structuredClone(region), id: newId, name: `${region.name.slice(0, 40)} 副本` };
  // Full validation includes global brush / RLE budgets, not just the region count.
  return parseRecipeV2({ ...recipe, regions: [...recipe.regions, copy] });
}

/** The tiny inward offset avoids a floating point floor/ceil adding a whole pixel. */
export function cropFromPixels(
  dimensions: Dimensions,
  rect: { x: number; y: number; width: number; height: number },
): CropRect {
  const x = Math.round(clamp(rect.x, 0, dimensions.width - 1));
  const y = Math.round(clamp(rect.y, 0, dimensions.height - 1));
  const w = Math.round(clamp(rect.width, 1, dimensions.width - x));
  const h = Math.round(clamp(rect.height, 1, dimensions.height - y));
  const left = x === 0 ? 0 : (x + 1e-7) / dimensions.width;
  const top = y === 0 ? 0 : (y + 1e-7) / dimensions.height;
  const right = x + w === dimensions.width ? 1 : (x + w - 1e-7) / dimensions.width;
  const bottom = y + h === dimensions.height ? 1 : (y + h - 1e-7) / dimensions.height;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function changeOrientedCropPixel(
  dimensions: Dimensions,
  geometry: EditorRecipe['geometry'],
  field: 'x' | 'y' | 'width' | 'height',
  value: number,
  ratio: number | null,
): CropRect {
  const space = orientedCropSpace(dimensions, geometry);
  const { left: x, top: y, width, height } = space.crop;
  const rect = { x, y, width, height };
  const delta = value - rect[field];
  const moving = field === 'x' || field === 'y';
  const crop = moveCropHandle(
    space.dimensions,
    rect,
    moving ? 'move' : field === 'width' ? 'e' : 's',
    { x: field === 'x' || field === 'width' ? delta : 0, y: field === 'y' || field === 'height' ? delta : 0 },
    moving ? null : ratio,
  );
  const source = space.toSource(pixelCrop(space.dimensions, { ...geometry, crop }));
  return cropFromPixels(dimensions, { ...source, x: source.left, y: source.top });
}

/** Resize against the opposite edge/corner. A locked edge grows around its orthogonal center. */
export function moveCropHandle(
  dimensions: Dimensions,
  rect: { x: number; y: number; width: number; height: number },
  handle: string,
  delta: Point,
  ratio: number | null,
): CropRect {
  if (handle === 'move')
    return cropFromPixels(dimensions, {
      ...rect,
      x: clamp(rect.x + delta.x, 0, dimensions.width - rect.width),
      y: clamp(rect.y + delta.y, 0, dimensions.height - rect.height),
    });
  const horizontal = handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0;
  const vertical = handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0;
  const ax = rect.x + ((1 - horizontal) / 2) * rect.width;
  const ay = rect.y + ((1 - vertical) / 2) * rect.height;
  const width = Math.max(1, rect.width + delta.x * horizontal);
  const height = Math.max(1, rect.height + delta.y * vertical);
  const maxWidth =
    horizontal < 0
      ? ax
      : horizontal > 0
        ? dimensions.width - ax
        : 2 * Math.min(ax, dimensions.width - ax);
  const maxHeight =
    vertical < 0
      ? ay
      : vertical > 0
        ? dimensions.height - ay
        : 2 * Math.min(ay, dimensions.height - ay);
  let w = Math.min(maxWidth, width),
    h = Math.min(maxHeight, height);
  if (ratio && Number.isFinite(ratio) && ratio > 0) {
    const projected =
      horizontal && vertical
        ? (width + height / ratio) / (1 + 1 / (ratio * ratio))
        : horizontal
          ? width
          : height * ratio;
    w = Math.min(maxWidth, maxHeight * ratio, Math.max(1, ratio, projected));
    h = w / ratio;
  }
  const roundedWidth = Math.max(1, Math.round(w)),
    roundedHeight = Math.max(1, Math.round(h));
  return cropFromPixels(dimensions, {
    x: ax - ((1 - horizontal) / 2) * roundedWidth,
    y: ay - ((1 - vertical) / 2) * roundedHeight,
    width: roundedWidth,
    height: roundedHeight,
  });
}

export function numericRecipeValue(recipe: RecipeV2, tool: V2ToolDefinition): number {
  let current: unknown = recipe;
  for (const part of tool.path.split('.')) current = (current as Record<string, unknown>)[part];
  if (typeof current !== 'number' || !Number.isFinite(current))
    throw new Error('Invalid numeric recipe field');
  return current;
}

/** No path from a file or an AI response is passed to this helper. Registry identity is required. */
export function setNumericRecipeValue(
  recipe: RecipeV2,
  tool: V2ToolDefinition,
  value: number,
  registry: readonly Readonly<V2ToolDefinition>[],
): RecipeV2 {
  if (!registry.includes(tool) || !Number.isFinite(value) || value < tool.min || value > tool.max)
    throw new RangeError('Control is outside the registered range');
  const parts = tool.path.split('.');
  if (parts.some((part) => ['__proto__', 'prototype', 'constructor'].includes(part)))
    throw new Error('Unsafe recipe path');
  const next = structuredClone(recipe);
  let target: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = value;
  return next;
}

export function replaceSelectionMask(
  recipe: EditorRecipe,
  activeId: string | null,
  mask: SelectionMaskV3,
  path: readonly number[] = [],
  protection = false,
): EditorRecipe {
  if (recipe.schemaVersion === 3 || recipe.schemaVersion === 4) {
    if (protection)
      return {
        ...recipe,
        warp: {
          ...recipe.warp,
          protection: replaceMaskAtPath(recipe.warp.protection ?? mask, path, mask),
        },
      };
    if (activeId)
      return {
        ...recipe,
        regionEdits: recipe.regionEdits.map((region) =>
          region.id === activeId
            ? { ...region, enabled: true, mask: replaceMaskAtPath(region.mask, path, mask) }
            : region,
        ),
      };
  }
  if (activeId && recipe.schemaVersion === 2 && mask.type !== 'compound')
    return {
      ...recipe,
      regions: recipe.regions.map((region) =>
        region.id === activeId ? { ...region, enabled: true, mask } : region,
      ),
    };
  if (mask.type !== 'radial') return recipe;
  return { ...recipe, local: { ...recipe.local, enabled: true, mask } };
}

export function maskAtPath(mask: SelectionMaskV3, path: readonly number[]): SelectionMaskV3 {
  let current = mask;
  for (const index of path) {
    if (current.type !== 'compound' || !current.masks[index]) return current;
    current = current.masks[index]!;
  }
  return current;
}
export function replaceMaskAtPath(
  mask: SelectionMaskV3,
  path: readonly number[],
  next: SelectionMaskV3,
): SelectionMaskV3 {
  if (!path.length) return next;
  if (mask.type !== 'compound' || !mask.masks[path[0]!])
    throw new Error('选区结构已改变，请重新选择子区域。');
  return {
    ...mask,
    masks: mask.masks.map((child, i) =>
      i === path[0] ? replaceMaskAtPath(child, path.slice(1), next) : child,
    ),
  };
}
