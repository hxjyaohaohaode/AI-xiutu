import { parseRecipeV2, type SelectionMaskV3, type Point, type RGBAImage } from '@ai-xiutu/editor';
import type {
  CropRect,
  Dimensions,
  EditorRecipe,
  RecipeV2,
  V2ToolDefinition,
} from '@ai-xiutu/editor';

export const clamp = (n: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

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
