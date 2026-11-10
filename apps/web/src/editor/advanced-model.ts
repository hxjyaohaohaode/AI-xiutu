import {
  TOOLS,
  V2_TOOLS,
  V3_TOOLS,
  createColorBlockV3,
  parseRecipeV3,
  parseRecipeV4,
  getEditorOutputDimensions,
  type ColorBlockV3,
  type LayeredRecipe,
  type SelectionMaskV3,
  type Dimensions,
} from '@ai-xiutu/editor';
import type { EditorState } from './useEditor';

export type EditScope = { kind: 'global' } | { kind: 'region' | 'group'; id: string };
export type NumericDefinition = {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  neutral: number;
  unit: string;
  description?: string;
};
export const NUMERIC_CONTROLS: readonly NumericDefinition[] = [
  ...TOOLS.map((tool) => ({
    ...tool,
    path: 'adjustments.' + tool.id,
    step: tool.unit === 'EV' ? 0.01 : 0.1,
  })),
  ...V2_TOOLS.map((tool) => ({
    ...tool,
    step: tool.unit === 'seed' ? tool.step : Math.min(tool.step, 0.1),
  })),
  ...V3_TOOLS,
];
export type InspectorController = {
  editor: EditorState;
  apply: (next: LayeredRecipe, label: string, commit?: boolean) => boolean;
  report: (message: string | null) => void;
};
export const currentV3 = (editor: EditorState): LayeredRecipe => {
  const recipe = editor.getRecipe();
  if (recipe.schemaVersion !== 3 && recipe.schemaVersion !== 4)
    throw new Error('当前配方版本已经改变，请重新打开工具。');
  return recipe;
};
export const scopeKey = (scope: EditScope) =>
  scope.kind === 'global' ? 'global' : scope.kind + ':' + scope.id;
export function scopeColor(recipe: LayeredRecipe, scope: EditScope): ColorBlockV3 {
  if (scope.kind === 'global')
    return {
      adjustments: recipe.adjustments,
      curves: recipe.curves,
      levels: recipe.levels,
      hsl: recipe.hsl,
      grading: recipe.grading,
      detail: recipe.detail,
      effects: recipe.effects,
      optics: recipe.optics,
    };
  const value =
    scope.kind === 'region'
      ? recipe.regionEdits.find((r) => r.id === scope.id)
      : recipe.regionGroups.find((r) => r.id === scope.id);
  if (!value) throw new Error('作用范围已不存在，请重新选择。');
  return value.color;
}
export function withScopeColor(
  recipe: LayeredRecipe,
  scope: EditScope,
  color: ColorBlockV3,
): LayeredRecipe {
  if (scope.kind === 'global') return { ...recipe, ...color };
  scopeColor(recipe, scope); // fail closed on a deleted scope
  return scope.kind === 'region'
    ? {
        ...recipe,
        regionEdits: recipe.regionEdits.map((r) => (r.id === scope.id ? { ...r, color } : r)),
      }
    : {
        ...recipe,
        regionGroups: recipe.regionGroups.map((r) => (r.id === scope.id ? { ...r, color } : r)),
      };
}
export function numericAt(value: object, path: string): number {
  let current: unknown = value;
  for (const key of path.split('.')) current = (current as Record<string, unknown>)[key];
  if (typeof current !== 'number' || !Number.isFinite(current)) throw new Error('参数路径未注册。');
  return current;
}
export function withNumeric<T extends object>(
  value: T,
  definition: NumericDefinition,
  amount: number,
): T {
  if (
    !NUMERIC_CONTROLS.includes(definition) ||
    !Number.isFinite(amount) ||
    amount < definition.min ||
    amount > definition.max
  )
    throw new Error('参数不在已注册范围内。');
  const keys = definition.path.split('.');
  if (keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key)))
    throw new Error('无效参数路径。');
  const next = structuredClone(value);
  let target = next as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[keys.at(-1)!] = amount;
  return next;
}
export function checkedRecipe(
  next: LayeredRecipe,
  dimensions: Dimensions | null,
  budget = 16_777_216,
): LayeredRecipe {
  const recipe = next.schemaVersion === 4 ? parseRecipeV4(next) : parseRecipeV3(next);
  if (dimensions) {
    const result = getEditorOutputDimensions(dimensions, recipe);
    if (result.width * result.height > Math.min(16_777_216, budget))
      throw new Error('这组变换的输出超过当前设备处理预算，请降低缩放或选择保留画幅。');
  }
  return recipe;
}
export function newMask(
  type: 'radial' | 'linear' | 'polygon' | 'brush' | 'color-range',
): SelectionMaskV3 {
  switch (type) {
    case 'radial':
      return {
        type,
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.25,
        radiusY: 0.25,
        feather: 0.65,
        invert: false,
      };
    case 'linear':
      return {
        type,
        start: { x: 0.5, y: 0.25 },
        end: { x: 0.5, y: 0.75 },
        smooth: true,
        invert: false,
      };
    case 'polygon':
      return {
        type,
        points: [
          { x: 0.25, y: 0.25 },
          { x: 0.75, y: 0.25 },
          { x: 0.75, y: 0.75 },
          { x: 0.25, y: 0.75 },
        ],
        feather: 0.02,
        invert: false,
      };
    case 'brush':
      return { type, strokes: [], invert: false };
    case 'color-range':
      return {
        type,
        hue: 0,
        hueWidth: 30,
        saturationMin: 0,
        saturationMax: 1,
        luminanceMin: 0,
        luminanceMax: 1,
        feather: 0.1,
        invert: false,
      };
  }
}
export const rgbaHex = (color: readonly number[]) =>
  '#' + color.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('');
export const hexRgba = (value: string): [number, number, number, number] => {
  const text = value.replace('#', '');
  if (!/^[a-f0-9]{6}([a-f0-9]{2})?$/i.test(text)) throw new Error('颜色格式无效。');
  return [0, 2, 4, 6].map((offset) =>
    offset === 6 && text.length === 6 ? 255 : parseInt(text.slice(offset, offset + 2), 16),
  ) as [number, number, number, number];
};
export const blankColor = () => createColorBlockV3();
