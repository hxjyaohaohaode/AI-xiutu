import { RecipeValidationError, record, number, boolean, arrayData } from './recipe.js';
import { parseEditorRecipe } from './v2-recipe.js';
import {
  createRecipeV3,
  parseRecipeV3,
  migrateRecipeToV3,
  parseSelectionMaskV3,
  cloneRecipeDataV3,
  mergeRecipeDataV3,
  readOperationOriginV3,
} from './v3-recipe.js';
import { validateProjectiveQuadV4 } from './v4-geometry.js';
import {
  MAX_V4_HEALING_OPERATIONS,
  MAX_V4_RETOUCH_REGIONS,
  MAX_V4_NEW_MASK_NODES,
  type ProjectiveTransformV4,
  type HealingOperationV4,
  type RetouchRegionV4,
  type RecipeV4,
  type RecipeV4Overrides,
  type RecipeV4ValidationResult,
} from './v4-types.js';
import type { SelectionMaskV3, RecipeV3 } from './v3-types.js';
import type { EditorRecipe } from './v2-types.js';
import type { Point } from './types.js';

export const SCHEMA_VERSION_V4 = 4 as const;
export const ENGINE_VERSION_V4 = '4.0.0' as const;
const NEW_KEYS = ['projective', 'healing', 'retouch'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const identifier = (v: unknown, path: string, errors: string[]): string => {
  if (typeof v !== 'string' || !ID.test(v)) errors.push(`${path}: invalid identifier`);
  return typeof v === 'string' ? v : '';
};
const name = (v: unknown, path: string, errors: string[]): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > 120)
    errors.push(`${path}: expected 1–120 characters`);
  return typeof v === 'string' ? v : '';
};
function point(v: unknown, min: number, max: number, path: string, errors: string[]): Point {
  const p = record(v, ['x', 'y'], path, errors);
  return {
    x: number(p.x, min, max, `${path}.x`, errors),
    y: number(p.y, min, max, `${path}.y`, errors),
  };
}
function operationRecord(v: unknown, keys: string[], path: string, errors: string[]) {
  return record(
    v,
    [...keys, ...(v && typeof v === 'object' && Object.hasOwn(v, 'origin') ? ['origin'] : [])],
    path,
    errors,
  );
}
function originField(r: Record<string, unknown>, path: string, errors: string[]) {
  const origin = readOperationOriginV3(r.origin, `${path}.origin`, errors);
  return origin ? { origin } : {};
}
export function createProjectiveTransformV4(): ProjectiveTransformV4 {
  return {
    enabled: false,
    corners: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    fit: 'contain',
  };
}
function readProjective(v: unknown, errors: string[]): ProjectiveTransformV4 {
  const p = record(v, ['enabled', 'corners', 'fit'], 'projective', errors);
  const corners = arrayData(p.corners, 4, 4, 'projective.corners', errors).map((v, i) =>
    point(v, -2, 3, `projective.corners.${i}`, errors),
  );
  if (p.fit !== 'contain' && p.fit !== 'crop')
    errors.push('projective.fit: expected contain or crop');
  try {
    validateProjectiveQuadV4(corners);
  } catch (e) {
    errors.push(...(e instanceof RecipeValidationError ? e.errors : ['projective: invalid quad']));
  }
  return {
    enabled: boolean(p.enabled, 'projective.enabled', errors),
    corners: corners as ProjectiveTransformV4['corners'],
    fit: p.fit === 'crop' ? 'crop' : 'contain',
  };
}
const maskNodes = (m: SelectionMaskV3): number =>
  m.type === 'compound' ? 1 + m.masks.reduce((n, x) => n + maskNodes(x), 0) : 1;

/** Strip only the explicitly versioned additions, never use this helper as a persisted downgrade. */
export function recipeV3Stage(input: RecipeV4): RecipeV3 {
  const { projective: _p, healing: _h, retouch: _r, ...base } = input;
  return parseRecipeV3({ ...base, schemaVersion: 3, engineVersion: '3.0.0' });
}
export function parseRecipeV4(input: unknown): RecipeV4 {
  const errors: string[] = [];
  const copied = cloneRecipeDataV3(input);
  const root = record(copied, [...Object.keys(createRecipeV3()), ...NEW_KEYS], 'recipe', errors);
  if (root.schemaVersion !== 4) errors.push('recipe.schemaVersion: expected 4');
  if (root.engineVersion !== '4.0.0') errors.push('recipe.engineVersion: expected 4.0.0');
  const baseObject = { ...root, schemaVersion: 3, engineVersion: '3.0.0' } as Record<
    string,
    unknown
  >;
  for (const key of NEW_KEYS) delete baseObject[key];
  const base = parseRecipeV3(baseObject);
  let nodes = 0;
  const readMask = (v: unknown) => {
    const parsed = parseSelectionMaskV3(v);
    nodes += maskNodes(parsed);
    if (nodes > MAX_V4_NEW_MASK_NODES)
      throw new RecipeValidationError(['v4: combined new mask node budget exceeded']);
    return parsed;
  };
  const ids = new Set<string>();
  const unique = (id: string) => {
    if (ids.has(id)) errors.push(`v4: duplicate operation id ${id}`);
    ids.add(id);
    return id;
  };
  const healing: HealingOperationV4[] = arrayData(
    root.healing,
    0,
    MAX_V4_HEALING_OPERATIONS,
    'healing',
    errors,
  ).map((v, i) => {
    const path = `healing.${i}`;
    const r = operationRecord(
      v,
      [
        'id',
        'name',
        'enabled',
        'opacity',
        'mask',
        'protection',
        'method',
        'source',
        'searchRadius',
        'iterations',
        'texture',
        ...(v && typeof v === 'object' && Object.hasOwn(v, 'patchRadius') ? ['patchRadius'] : []),
      ],
      path,
      errors,
    );
    if (!['diffusion', 'patch-poisson', 'exemplar-v1'].includes(r.method as string))
      errors.push(`${path}.method: unknown repair method`);
    const iterations = number(r.iterations, 1, 512, `${path}.iterations`, errors);
    if (!Number.isSafeInteger(iterations)) errors.push(`${path}.iterations: expected integer`);
    const patchRadius =
      r.patchRadius === undefined
        ? undefined
        : number(r.patchRadius, 1, 8, `${path}.patchRadius`, errors);
    if (patchRadius !== undefined && (!Number.isInteger(patchRadius) || r.method !== 'exemplar-v1'))
      errors.push(`${path}.patchRadius: integer radius is only valid for exemplar-v1`);
    if (r.method === 'exemplar-v1' && iterations < 16)
      errors.push(`${path}.iterations: exemplar search requires at least 16 candidates`);
    return {
      ...originField(r, path, errors),
      id: unique(identifier(r.id, `${path}.id`, errors)),
      name: name(r.name, `${path}.name`, errors),
      enabled: boolean(r.enabled, `${path}.enabled`, errors),
      opacity: number(r.opacity, 0, 1, `${path}.opacity`, errors),
      mask: readMask(r.mask),
      protection: r.protection === null ? null : readMask(r.protection),
      method:
        r.method === 'exemplar-v1'
          ? 'exemplar-v1'
          : r.method === 'diffusion'
            ? 'diffusion'
            : 'patch-poisson',
      ...(patchRadius === undefined ? {} : { patchRadius }),
      source: r.source === null ? null : point(r.source, 0, 1, `${path}.source`, errors),
      searchRadius: number(r.searchRadius, 0.001, 2, `${path}.searchRadius`, errors),
      iterations,
      texture: number(r.texture, 0, 1, `${path}.texture`, errors),
    };
  });
  const retouch: RetouchRegionV4[] = arrayData(
    root.retouch,
    0,
    MAX_V4_RETOUCH_REGIONS,
    'retouch',
    errors,
  ).map((v, i) => {
    const path = `retouch.${i}`;
    const r = operationRecord(
      v,
      [
        'id',
        'name',
        'enabled',
        'opacity',
        'mask',
        'protection',
        'radius',
        'smoothing',
        'texture',
        'uniformity',
        'shine',
        'speckle',
        'fineLines',
        ...(v && typeof v === 'object' && Object.hasOwn(v, 'chromaSpots') ? ['chromaSpots'] : []),
        ...(v && typeof v === 'object' && Object.hasOwn(v, 'algorithm') ? ['algorithm'] : []),
      ],
      path,
      errors,
    );
    const algorithm =
      r.algorithm === 'guided-v1' ||
      r.algorithm === 'guided-v2' ||
      r.algorithm === 'guided-v3' ||
      r.algorithm === 'guided-v4' ||
      r.algorithm === 'guided-v5'
        ? r.algorithm
        : undefined;
    if (r.algorithm !== undefined && !algorithm)
      errors.push(`${path}.algorithm: unsupported retouch algorithm`);
    if (r.chromaSpots !== undefined && algorithm !== 'guided-v4' && algorithm !== 'guided-v5')
      errors.push(`${path}.chromaSpots: requires guided-v4 or guided-v5`);
    return {
      ...originField(r, path, errors),
      ...(algorithm ? { algorithm } : {}),
      id: unique(identifier(r.id, `${path}.id`, errors)),
      name: name(r.name, `${path}.name`, errors),
      enabled: boolean(r.enabled, `${path}.enabled`, errors),
      opacity: number(r.opacity, 0, 1, `${path}.opacity`, errors),
      mask: readMask(r.mask),
      protection: r.protection === null ? null : readMask(r.protection),
      radius: number(r.radius, 0.000001, 0.1, `${path}.radius`, errors),
      smoothing: number(r.smoothing, 0, 100, `${path}.smoothing`, errors),
      texture: number(r.texture, -100, 100, `${path}.texture`, errors),
      uniformity: number(r.uniformity, 0, 100, `${path}.uniformity`, errors),
      shine: number(r.shine, 0, 100, `${path}.shine`, errors),
      speckle: number(r.speckle, 0, 100, `${path}.speckle`, errors),
      fineLines: number(r.fineLines, 0, 100, `${path}.fineLines`, errors),
      ...(r.chromaSpots === undefined
        ? {}
        : { chromaSpots: number(r.chromaSpots, 0, 100, `${path}.chromaSpots`, errors) }),
    };
  });
  const projective = readProjective(root.projective, errors);
  if (errors.length) throw new RecipeValidationError(errors);
  return { ...base, schemaVersion: 4, engineVersion: '4.0.0', projective, healing, retouch };
}
export function validateRecipeV4(input: unknown): RecipeV4ValidationResult {
  try {
    return { valid: true, recipe: parseRecipeV4(input), errors: [] };
  } catch (e) {
    return {
      valid: false,
      errors: e instanceof RecipeValidationError ? e.errors : ['recipe: unreadable v4 data'],
    };
  }
}
export function createRecipeV4(overrides?: RecipeV4Overrides): RecipeV4 {
  const base: RecipeV4 = {
    ...createRecipeV3(),
    schemaVersion: 4,
    engineVersion: '4.0.0',
    projective: createProjectiveTransformV4(),
    healing: [],
    retouch: [],
  };
  return parseRecipeV4(
    overrides === undefined ? base : mergeRecipeDataV3(base, cloneRecipeDataV3(overrides)),
  );
}
export function migrateRecipeToV4(input: EditorRecipe): RecipeV4 {
  const recipe = parseEditorRecipe(input);
  if (recipe.schemaVersion === 4) return recipe;
  return createRecipeV4({ ...migrateRecipeToV3(recipe), schemaVersion: 4, engineVersion: '4.0.0' });
}
const defaultMask = (): SelectionMaskV3 => ({
  type: 'radial',
  centerX: 0.5,
  centerY: 0.5,
  radiusX: 0.04,
  radiusY: 0.04,
  feather: 0.25,
  invert: false,
});
export function createHealingOperationV4(
  overrides: Partial<HealingOperationV4> = {},
): HealingOperationV4 {
  const base: HealingOperationV4 = {
    id: 'healing',
    name: '局部修复',
    enabled: true,
    opacity: 1,
    mask: defaultMask(),
    protection: null,
    method: 'patch-poisson',
    source: null,
    searchRadius: 0.2,
    iterations: 96,
    texture: 1,
  };
  return createRecipeV4({
    healing: [{ ...base, ...(cloneRecipeDataV3(overrides) as Partial<HealingOperationV4>) }],
  }).healing[0]!;
}
export function createRetouchRegionV4(overrides: Partial<RetouchRegionV4> = {}): RetouchRegionV4 {
  const base: RetouchRegionV4 = {
    id: 'retouch',
    name: '局部质感',
    enabled: true,
    opacity: 1,
    mask: defaultMask(),
    protection: null,
    radius: 0.006,
    smoothing: 0,
    texture: 0,
    uniformity: 0,
    shine: 0,
    speckle: 0,
    fineLines: 0,
  };
  return createRecipeV4({
    retouch: [{ ...base, ...(cloneRecipeDataV3(overrides) as Partial<RetouchRegionV4>) }],
  }).retouch[0]!;
}
