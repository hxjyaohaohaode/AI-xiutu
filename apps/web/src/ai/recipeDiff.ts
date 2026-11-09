import { TOOLS, V2_TOOLS, V3_TOOLS, type EditorRecipe } from '@ai-xiutu/editor';

export type RecipeDifference = {
  path: string;
  label: string;
  before: number;
  after: number;
  unit: string;
};
function readNumber(recipe: EditorRecipe, path: string): number | undefined {
  let value: unknown = recipe;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
/** Display only: mutation remains a complete parseEditorRecipe + one history commit. */
export function recipeDifferences(before: EditorRecipe, after: EditorRecipe): RecipeDifference[] {
  const definitions = [
    ...TOOLS.map((tool) => ({
      path: `adjustments.${tool.id}`,
      label: tool.label,
      unit: tool.unit ?? '',
    })),
    // V3 retains the complete V2 color/effects block. A V3 proposal must not
    // appear unchanged simply because its version number is no longer 2.
    ...(before.schemaVersion >= 2 && after.schemaVersion >= 2 ? V2_TOOLS : []),
    ...(before.schemaVersion === 3 && after.schemaVersion === 3 ? V3_TOOLS : []),
  ];
  return definitions.flatMap((tool) => {
    const from = readNumber(before, tool.path),
      to = readNumber(after, tool.path);
    return from !== undefined && to !== undefined && from !== to
      ? [{ path: tool.path, label: tool.label, before: from, after: to, unit: tool.unit }]
      : [];
  });
}

/** JSONB can return object keys in a different order. Array order remains
 * meaningful for curves, masks, layers and warp strokes. This is display-only;
 * it neither mutates the recipes nor grants AI any additional writable path. */
function sameData(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return false;
  if (Array.isArray(before) || Array.isArray(after))
    return (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.length === after.length &&
      before.every((value, index) => sameData(value, after[index]))
    );
  const left = before as Record<string, unknown>,
    right = after as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameData(left[key], right[key]))
  );
}

export function additionalRecipeChanges(before: EditorRecipe, after: EditorRecipe): string[] {
  const labels = {
    curves: '曲线',
    geometry: '构图',
    local: '旧版局部调整',
    regions: '独立选区与蒙版',
    regionEdits: '新版局部参数与蒙版',
    regionGroups: '局部分组与共享参数',
    imageLayers: '合成素材、图层顺序与混合',
    paintLayers: '绘制、妆容与克隆图层',
    warp: '液化笔触与背景保护',
  };
  const changes = Object.entries(labels).flatMap(([key, label]) => {
    const from = (before as unknown as Record<string, unknown>)[key];
    const to = (after as unknown as Record<string, unknown>)[key];
    return !sameData(from, to) ? [label] : [];
  });
  if (before.schemaVersion !== after.schemaVersion) changes.push('配方版本');
  if (
    before.schemaVersion >= 2 &&
    after.schemaVersion >= 2 &&
    'effects' in before &&
    'effects' in after &&
    before.effects.grain.colored !== after.effects.grain.colored
  )
    changes.push('颗粒颜色模式');
  if (
    before.schemaVersion === 3 &&
    after.schemaVersion === 3 &&
    before.transform.fit !== after.transform.fit
  )
    changes.push('自由变换画幅模式');
  return changes;
}
