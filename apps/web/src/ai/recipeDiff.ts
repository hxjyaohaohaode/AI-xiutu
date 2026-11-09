import { TOOLS, V2_TOOLS, type EditorRecipe } from '@ai-xiutu/editor';

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
    ...(before.schemaVersion === 2 && after.schemaVersion === 2 ? V2_TOOLS : []),
  ];
  return definitions.flatMap((tool) => {
    const from = readNumber(before, tool.path),
      to = readNumber(after, tool.path);
    return from !== undefined && to !== undefined && from !== to
      ? [{ path: tool.path, label: tool.label, before: from, after: to, unit: tool.unit }]
      : [];
  });
}
export function additionalRecipeChanges(before: EditorRecipe, after: EditorRecipe): string[] {
  const labels = {
    curves: '曲线',
    geometry: '构图',
    local: '旧版局部调整',
    regions: '独立选区与蒙版',
  };
  const changes = Object.entries(labels).flatMap(([key, label]) => {
    const from = (before as unknown as Record<string, unknown>)[key];
    const to = (after as unknown as Record<string, unknown>)[key];
    return JSON.stringify(from) !== JSON.stringify(to) ? [label] : [];
  });
  if (before.schemaVersion !== after.schemaVersion) changes.push('配方版本');
  if (
    before.schemaVersion === 2 &&
    after.schemaVersion === 2 &&
    before.effects.grain.colored !== after.effects.grain.colored
  )
    changes.push('颗粒颜色模式');
  return changes;
}
