import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  parseEditorRecipe,
  type EditorRecipe,
  type RecipeV4,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';

/** A spatial proposal uses a real source-space selection. Model coordinates from
 * a cropped/warped preview must never be guessed to be original-image coordinates. */
const selection = z
  .object({
    collection: z.enum(['regions', 'regionEdits', 'healing', 'retouch']),
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/),
  })
  .strict();
const common = {
  summary: z.string().trim().min(1).max(800),
  name: z.string().trim().min(1).max(100),
  operationId: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
    .nullable(),
  selection,
  protectedSelection: selection.nullable(),
  opacity: z.number().positive().max(1),
};
export const retouchProposalSchema = z
  .object({
    ...common,
    radius: z.number().min(0.000001).max(0.1),
    smoothing: z.number().min(0).max(100),
    texture: z.number().min(-100).max(100),
    uniformity: z.number().min(0).max(100),
    shine: z.number().min(0).max(100),
    speckle: z.number().min(0).max(100),
    fineLines: z.number().min(0).max(100),
  })
  .strict();
export const healingProposalSchema = z
  .object({
    ...common,
    method: z.enum(['diffusion', 'patch-poisson', 'exemplar-v1']),
    searchRadius: z.number().min(0.001).max(2),
    iterations: z.number().int().min(1).max(512),
    texture: z.number().min(0).max(1),
    patchRadius: z.number().int().min(1).max(8).nullable(),
  })
  .strict();

type SelectionReference = z.infer<typeof selection>;
const retouchKeys = [
  'smoothing',
  'texture',
  'uniformity',
  'shine',
  'speckle',
  'fineLines',
] as const;
const retouchLabels = [
  '边缘感知平滑',
  '肌理',
  '色度均匀',
  '高光抑制',
  '脉冲瑕疵抑制',
  '方向细纹抑制',
];
function readSelection(recipe: RecipeV4, reference: SelectionReference) {
  const found = recipe[reference.collection].find((item) => item.id === reference.id);
  if (!found) throw new Error('SPATIAL_SELECTION_NOT_FOUND');
  return {
    mask: found.mask as SelectionMaskV3,
    protection: 'protection' in found ? found.protection : null,
  };
}
function masks(
  recipe: RecipeV4,
  selected: SelectionReference,
  protectedSelection: SelectionReference | null,
  existingProtection: SelectionMaskV3 | null = null,
) {
  const source = readSelection(recipe, selected);
  const protections: SelectionMaskV3[] = [];
  if (existingProtection) protections.push(existingProtection);
  // Copy the selected operation's protection automatically: an agent cannot
  // accidentally remove the user's existing protected eyes, edges or background.
  if (
    source.protection &&
    !protections.some((mask) => JSON.stringify(mask) === JSON.stringify(source.protection))
  )
    protections.push(source.protection);
  if (protectedSelection) {
    const extra = readSelection(recipe, protectedSelection);
    // A protection reference means its whole selected support, including any
    // inner protection. This deliberately never weakens an existing exclusion.
    protections.push(extra.mask);
  }
  return {
    mask: source.mask,
    protection:
      protections.length === 0
        ? null
        : protections.length === 1
          ? protections[0]!
          : ({ type: 'compound', operation: 'union', invert: false, masks: protections } as const),
  };
}
function baseV4(base: EditorRecipe): RecipeV4 {
  const recipe = parseEditorRecipe(base);
  if (recipe.schemaVersion !== 4) throw new Error('SPATIAL_REQUIRES_V4');
  return recipe;
}
function identifier(recipe: RecipeV4, kind: string, proposal: unknown) {
  return `ai-${kind}-${createHash('sha256')
    .update(JSON.stringify([recipe, proposal]))
    .digest('hex')
    .slice(0, 24)}`;
}
/** Independent ordinary operations preserve all manual and portrait-owned work.
 * The recipe parser still owns aggregate mask, operation and algorithm limits;
 * the real renderer owns pixel/work budgets. Neither proposal performs a render. */
export function applyAssistantRetouch(base: EditorRecipe, raw: unknown) {
  const proposal = retouchProposalSchema.parse(raw),
    recipe = baseV4(base);
  const existing =
    proposal.operationId === null
      ? undefined
      : recipe.retouch.find((item) => item.id === proposal.operationId);
  if (proposal.operationId !== null && !existing) throw new Error('SPATIAL_OPERATION_NOT_FOUND');
  if (existing?.origin) throw new Error('SPATIAL_AUTOMATIC_OPERATION_OWNED');
  if (!existing && retouchKeys.every((key) => proposal[key] === 0))
    throw new Error('SPATIAL_NO_EFFECT');
  const id = existing?.id ?? identifier(recipe, 'retouch', proposal);
  const operation = {
    id,
    name: `AI · ${proposal.name}`,
    enabled: true,
    ...(!existing
      ? { algorithm: 'guided-v3' as const }
      : existing.algorithm
        ? { algorithm: existing.algorithm }
        : {}),
    opacity: proposal.opacity,
    ...masks(recipe, proposal.selection, proposal.protectedSelection, existing?.protection),
    radius: proposal.radius,
    smoothing: proposal.smoothing,
    texture: proposal.texture,
    uniformity: proposal.uniformity,
    shine: proposal.shine,
    speckle: proposal.speckle,
    fineLines: proposal.fineLines,
  };
  if (existing) recipe.retouch[recipe.retouch.indexOf(existing)] = operation;
  else recipe.retouch.push(operation);
  return {
    summary: proposal.summary,
    recipe: parseEditorRecipe(recipe),
    changes: retouchKeys
      .map((key, index) => ({
        path: `retouch:${id}:${key}`,
        before: existing?.[key] ?? 0,
        after: proposal[key],
        label: `${proposal.name} · ${retouchLabels[index]}`,
      }))
      .filter((item) => item.after !== item.before),
  };
}
export function applyAssistantHealing(base: EditorRecipe, raw: unknown) {
  const proposal = healingProposalSchema.parse(raw),
    recipe = baseV4(base);
  if (proposal.method !== 'exemplar-v1' && proposal.patchRadius !== null)
    throw new Error('SPATIAL_PATCH_RADIUS_NOT_APPLICABLE');
  const existing =
    proposal.operationId === null
      ? undefined
      : recipe.healing.find((item) => item.id === proposal.operationId);
  if (proposal.operationId !== null && !existing) throw new Error('SPATIAL_OPERATION_NOT_FOUND');
  if (existing?.origin) throw new Error('SPATIAL_AUTOMATIC_OPERATION_OWNED');
  const id = existing?.id ?? identifier(recipe, 'healing', proposal);
  const operation = {
    id,
    name: `AI · ${proposal.name}`,
    enabled: true,
    opacity: proposal.opacity,
    ...masks(recipe, proposal.selection, proposal.protectedSelection, existing?.protection),
    method: proposal.method,
    source: existing?.source ?? null,
    searchRadius: proposal.searchRadius,
    iterations: proposal.iterations,
    texture: proposal.texture,
    ...(proposal.patchRadius === null ? {} : { patchRadius: proposal.patchRadius }),
  };
  if (existing) recipe.healing[recipe.healing.indexOf(existing)] = operation;
  else recipe.healing.push(operation);
  return {
    summary: proposal.summary,
    recipe: parseEditorRecipe(recipe),
    changes: [
      {
        path: `healing:${id}:opacity`,
        before: existing?.opacity ?? 0,
        after: proposal.opacity,
        label: `${proposal.name} · 修复叠加`,
      },
      {
        path: `healing:${id}:texture`,
        before: existing?.texture ?? 0,
        after: proposal.texture,
        label: `${proposal.name} · 纹理保持`,
      },
      {
        path: `healing:${id}:iterations`,
        before: existing?.iterations ?? 0,
        after: proposal.iterations,
        label: `${proposal.name} · 搜索/迭代预算`,
      },
    ],
  };
}
export function describeSpatialSelections(recipe?: EditorRecipe) {
  if (recipe?.schemaVersion !== 4) return [];
  return (['regions', 'regionEdits', 'healing', 'retouch'] as const).flatMap((collection) =>
    recipe[collection].map((item) => ({
      collection,
      id: item.id,
      name: item.name,
      maskType: item.mask.type,
      inverted: item.mask.invert,
      hasProtection: 'protection' in item && item.protection !== null,
      enabled: item.enabled,
      opacity: item.opacity,
      canUpdateOperation:
        (collection === 'healing' || collection === 'retouch') &&
        !('origin' in item && item.origin),
      values:
        collection === 'retouch' || collection === 'healing'
          ? Object.fromEntries(
              Object.entries(item).filter(
                ([key, value]) =>
                  [
                    'smoothing',
                    'texture',
                    'uniformity',
                    'shine',
                    'speckle',
                    'fineLines',
                    'radius',
                    'searchRadius',
                    'iterations',
                    'method',
                    'patchRadius',
                    'algorithm',
                  ].includes(key) && ['number', 'string'].includes(typeof value),
              ),
            )
          : null,
    })),
  );
}

/** Pixel-neighbourhood and donor budgets depend on ORIGINAL resolution. A new
 * spatial stage cannot be declared executable from a downsampled proxy alone. */
export function needsNativeSpatialCheck(base: EditorRecipe, candidate: EditorRecipe): boolean {
  const previous = base.schemaVersion === 4 ? base : { healing: [], retouch: [] };
  const next = candidate.schemaVersion === 4 ? candidate : { healing: [], retouch: [] };
  return (
    JSON.stringify(previous.healing) !== JSON.stringify(next.healing) ||
    JSON.stringify(previous.retouch) !== JSON.stringify(next.retouch) ||
    // Earlier tone/color changes can alter what the existing repair uses as
    // neighbours or a donor, even if the spatial node itself did not change.
    ((next.healing.some((item) => item.enabled && item.opacity > 0) ||
      next.retouch.some(
        (item) =>
          item.enabled &&
          item.opacity > 0 &&
          [
            item.smoothing,
            item.texture,
            item.uniformity,
            item.shine,
            item.speckle,
            item.fineLines,
          ].some((value) => value !== 0),
      )) &&
      JSON.stringify(base) !== JSON.stringify(candidate))
  );
}
