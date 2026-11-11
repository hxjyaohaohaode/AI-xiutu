import {
  getEditorParameter,
  parseEditorRecipe,
  setEditorParameter,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import type { CollaborationOperation, CollaborationTarget } from '@ai-xiutu/contracts';
import { t } from '../i18n';

/** PostgreSQL JSONB and browser objects do not share key insertion order. Array order
 * remains significant: it carries layer stacking, brush strokes and curve points. */
export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => same(value, b[index]))
    );
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && same(left[key], right[key]))
  );
}
const collections = [
  'regions',
  'regionEdits',
  'regionGroups',
  'imageLayers',
  'paintLayers',
] as const;
type Node = Record<string, unknown> & { id: string };
const object = (recipe: EditorRecipe) => recipe as unknown as Record<string, unknown>;
const nodes = (recipe: EditorRecipe, key: string) => (object(recipe)[key] ?? []) as Node[];
function changedLeaves(a: unknown, b: unknown, path = ''): string[] {
  if (same(a, b)) return [];
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) ||
    Array.isArray(b)
  )
    return [path];
  const aa = a as Record<string, unknown>,
    bb = b as Record<string, unknown>;
  return [...new Set([...Object.keys(aa), ...Object.keys(bb)])].flatMap((key) =>
    changedLeaves(aa[key], bb[key], path ? `${path}.${key}` : key),
  );
}
/** Choose a narrow authoritative operation only when it explains the entire change. */
export function operationBetween(
  base: EditorRecipe,
  next: EditorRecipe,
): CollaborationOperation | null {
  if (same(base, next)) return null;
  if (base.schemaVersion !== next.schemaVersion) return { type: 'replace-recipe', recipe: next };
  for (const collection of collections) {
    const before = nodes(base, collection),
      after = nodes(next, collection);
    if (
      !same(
        before.map((n) => n.id),
        after.map((n) => n.id),
      )
    )
      continue;
    const changes = after.filter((n, i) => !same(n, before[i]));
    if (changes.length !== 1) continue;
    const value = changes[0]!;
    if (
      collection === 'regionEdits' &&
      value.groupId !== before.find((n) => n.id === value.id)?.groupId
    )
      continue;
    const candidate = { ...base, [collection]: after };
    if (same(candidate, next)) return { type: 'replace-node', collection, id: value.id, value };
  }
  for (const channel of ['rgb', 'red', 'green', 'blue'] as const) {
    if (same({ ...base, curves: { ...base.curves, [channel]: next.curves[channel] } }, next))
      return { type: 'set-curve', channel, points: next.curves[channel] };
  }
  const paths = changedLeaves(base, next);
  if (
    paths.length === 1 &&
    !/^(geometry|transform|projective|warp|healing|retouch)\./.test(paths[0]!)
  ) {
    try {
      const path = paths[0]!,
        value = getEditorParameter(next, path);
      if (same(setEditorParameter(base, path, value), next))
        return { type: 'set-parameter', path, value };
    } catch {
      /* A boolean, unregistered field or topology change requires the document lease. */
    }
  }
  return { type: 'replace-recipe', recipe: next };
}
export function operationTarget(operation: CollaborationOperation): CollaborationTarget {
  switch (operation.type) {
    case 'replace-recipe':
      return { kind: 'document' };
    case 'set-parameter':
      return { kind: 'parameter', id: operation.path };
    case 'set-curve':
      return { kind: 'curve', id: operation.channel };
    case 'replace-node':
      return operation.collection === 'regions' || operation.collection === 'regionEdits'
        ? { kind: 'region', collection: operation.collection, id: operation.id }
        : {
            kind:
              operation.collection === 'regionGroups'
                ? 'region-group'
                : operation.collection === 'imageLayers'
                  ? 'image-layer'
                  : 'paint-layer',
            id: operation.id,
          };
  }
}
export function targetValue(recipe: EditorRecipe, operation: CollaborationOperation): unknown {
  switch (operation.type) {
    case 'replace-recipe':
      return recipe;
    case 'set-parameter':
      return getEditorParameter(recipe, operation.path);
    case 'set-curve':
      return recipe.curves[operation.channel];
    case 'replace-node':
      return nodes(recipe, operation.collection).find((node) => node.id === operation.id);
  }
}
export function applyOperation(
  recipe: EditorRecipe,
  operation: CollaborationOperation,
): EditorRecipe {
  if (operation.type === 'replace-recipe') return parseEditorRecipe(operation.recipe);
  if (operation.type === 'set-parameter')
    return setEditorParameter(recipe, operation.path, operation.value);
  if (operation.type === 'set-curve')
    return parseEditorRecipe({
      ...recipe,
      curves: { ...recipe.curves, [operation.channel]: operation.points },
    });
  if (!nodes(recipe, operation.collection).some((node) => node.id === operation.id))
    throw new Error('这个编辑对象已不存在，请重新选择。');
  return parseEditorRecipe({
    ...recipe,
    [operation.collection]: nodes(recipe, operation.collection).map((node) =>
      node.id === operation.id ? operation.value : node,
    ),
  });
}
export function mergeOwnDraft(
  base: EditorRecipe,
  local: EditorRecipe,
  latest: EditorRecipe,
): EditorRecipe {
  const operation = operationBetween(base, local);
  if (!operation) return latest;
  if (same(base, latest)) return local;
  if (
    base.schemaVersion !== latest.schemaVersion ||
    operation.type === 'replace-recipe' ||
    !same(targetValue(base, operation), targetValue(latest, operation))
  )
    throw new Error('同一编辑对象已更新，本地草稿已保留，请比较后再继续。');
  for (const key of ['geometry', 'transform', 'warp', 'projective', 'healing', 'retouch'])
    if (!same(object(base)[key], object(latest)[key]))
      throw new Error('画幅或形变已改变，请先载入最新版本。');
  return applyOperation(latest, operation);
}
/** Undo changes only our last target and refuses to erase a newer change by a teammate. */
export function inverseOnLatest(
  before: EditorRecipe,
  after: EditorRecipe,
  latest: EditorRecipe,
): EditorRecipe {
  const operation = operationBetween(before, after);
  if (!operation) return latest;
  if (!same(targetValue(after, operation), targetValue(latest, operation)))
    throw new Error('队员已继续编辑这一对象，不能直接撤销；可另存草稿或在最新版本重新调整。');
  return mergeOwnDraft(after, before, latest);
}
export function targetLabel(target: CollaborationTarget) {
  if (target.kind === 'document') return t('整幅作品');
  if (target.kind === 'parameter') return target.id;
  if (target.kind === 'curve') return t('{channel} 曲线', { channel: target.id.toUpperCase() });
  return t(
    (
      {
        region: '局部',
        'region-group': '局部分组',
        'image-layer': '合成图层',
        'paint-layer': '绘制图层',
      } as const
    )[target.kind],
  );
}
