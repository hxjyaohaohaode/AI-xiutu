import {
  createRecipe,
  parseRecipe,
  validateRecipe,
  RecipeValidationError,
  record,
  number,
  boolean,
  arrayData,
  adjustments as readAdjustments,
} from './recipe.js';
import { neutralAdjustments } from './registry.js';
import {
  HSL_BANDS,
  V2_TOOLS,
  MAX_ADJUSTMENT_REGIONS,
  MAX_POLYGON_POINTS,
  MAX_BRUSH_STROKES,
  MAX_BRUSH_POINTS_PER_STROKE,
  MAX_BRUSH_POINTS_PER_MASK,
  MAX_TOTAL_BRUSH_POINTS,
  MAX_RASTER_RUNS_PER_MASK,
  MAX_TOTAL_RASTER_RUNS,
} from './v2-registry.js';
import type { Adjustments, Point, RecipeV1 } from './types.js';
import type {
  AdjustmentRegionV2,
  AdjustmentRegionV2Overrides,
  BrushStrokeV2,
  EditorRecipe,
  EditorRecipeValidationResult,
  HslMixerV2,
  RecipeV2,
  RecipeV2Overrides,
  RecipeV2ValidationResult,
  SelectionMaskV2,
} from './v2-types.js';

export const SCHEMA_VERSION_V2 = 2 as const;
export const ENGINE_VERSION_V2 = '2.0.0' as const;
const COMMON_KEYS = ['adjustments', 'curves', 'geometry', 'local'] as const;
const ROOT_KEYS = [
  'schemaVersion',
  'engineVersion',
  ...COMMON_KEYS,
  'levels',
  'hsl',
  'grading',
  'detail',
  'effects',
  'regions',
];

const integer = (
  value: unknown,
  min: number,
  max: number,
  path: string,
  errors: string[],
): number => {
  const result = number(value, min, max, path, errors);
  if (!Number.isSafeInteger(result)) errors.push(`${path}: expected an integer`);
  return result;
};
const point = (value: unknown, path: string, errors: string[]): Point => {
  const p = record(value, ['x', 'y'], path, errors);
  return { x: number(p.x, 0, 1, `${path}.x`, errors), y: number(p.y, 0, 1, `${path}.y`, errors) };
};
const points = (
  value: unknown,
  min: number,
  max: number,
  path: string,
  errors: string[],
): Point[] =>
  arrayData(value, min, max, path, errors).map((p, i) => point(p, `${path}[${i}]`, errors));

function maskType(input: unknown): unknown {
  if (!input || typeof input !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'type');
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function readSelectionMask(input: unknown, path: string, errors: string[]): SelectionMaskV2 {
  const type = maskType(input);
  if (type === 'radial') {
    const v = record(
      input,
      ['type', 'centerX', 'centerY', 'radiusX', 'radiusY', 'feather', 'invert'],
      path,
      errors,
    );
    return {
      type,
      centerX: number(v.centerX, 0, 1, `${path}.centerX`, errors),
      centerY: number(v.centerY, 0, 1, `${path}.centerY`, errors),
      radiusX: number(v.radiusX, 0.0001, 1, `${path}.radiusX`, errors),
      radiusY: number(v.radiusY, 0.0001, 1, `${path}.radiusY`, errors),
      feather: number(v.feather, 0, 1, `${path}.feather`, errors),
      invert: boolean(v.invert, `${path}.invert`, errors),
    };
  }
  if (type === 'linear') {
    const v = record(input, ['type', 'start', 'end', 'smooth', 'invert'], path, errors);
    const start = point(v.start, `${path}.start`, errors),
      end = point(v.end, `${path}.end`, errors);
    if ((start.x - end.x) ** 2 + (start.y - end.y) ** 2 < 1e-12)
      errors.push(`${path}: gradient endpoints must be distinct by at least 0.000001`);
    return {
      type,
      start,
      end,
      smooth: boolean(v.smooth, `${path}.smooth`, errors),
      invert: boolean(v.invert, `${path}.invert`, errors),
    };
  }
  if (type === 'polygon') {
    const v = record(input, ['type', 'points', 'feather', 'invert'], path, errors);
    const vertices = points(v.points, 3, MAX_POLYGON_POINTS, `${path}.points`, errors);
    let noncollinear = false;
    const first = vertices[0];
    if (first)
      for (let a = 1; a < vertices.length; a += 1)
        for (let b = a + 1; b < vertices.length; b += 1) {
          if (
            (vertices[a]!.x - first.x) * (vertices[b]!.y - first.y) -
              (vertices[a]!.y - first.y) * (vertices[b]!.x - first.x) !==
            0
          )
            noncollinear = true;
        }
    if (!noncollinear) errors.push(`${path}: polygon needs three non-collinear vertices`);
    return {
      type,
      points: vertices,
      feather: number(v.feather, 0, 0.5, `${path}.feather`, errors),
      invert: boolean(v.invert, `${path}.invert`, errors),
    };
  }
  if (type === 'brush') {
    const v = record(input, ['type', 'strokes', 'invert'], path, errors);
    const strokes = arrayData(v.strokes, 0, MAX_BRUSH_STROKES, `${path}.strokes`, errors).map(
      (value, index): BrushStrokeV2 => {
        const prefix = `${path}.strokes[${index}]`;
        const s = record(value, ['points', 'radius', 'feather', 'opacity', 'mode'], prefix, errors);
        if (s.mode !== 'add' && s.mode !== 'subtract')
          errors.push(`${prefix}.mode: expected add or subtract`);
        return {
          points: points(s.points, 1, MAX_BRUSH_POINTS_PER_STROKE, `${prefix}.points`, errors),
          radius: number(s.radius, 0.000001, 0.5, `${prefix}.radius`, errors),
          feather: number(s.feather, 0, 1, `${prefix}.feather`, errors),
          opacity: number(s.opacity, 0, 1, `${prefix}.opacity`, errors),
          mode: s.mode === 'subtract' ? 'subtract' : 'add',
        };
      },
    );
    if (strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) > MAX_BRUSH_POINTS_PER_MASK)
      errors.push(`${path}: brush point budget exceeded`);
    return { type, strokes, invert: boolean(v.invert, `${path}.invert`, errors) };
  }
  if (type === 'raster') {
    const v = record(input, ['type', 'width', 'height', 'runs', 'invert'], path, errors);
    const width = integer(v.width, 1, 16384, `${path}.width`, errors),
      height = integer(v.height, 1, 16384, `${path}.height`, errors);
    if (width * height > 67_108_864) errors.push(`${path}: raster pixel budget exceeded`);
    const inputRuns = arrayData(v.runs, 2, MAX_RASTER_RUNS_PER_MASK * 2, `${path}.runs`, errors);
    if (inputRuns.length % 2 !== 0) errors.push(`${path}.runs: expected length/weight pairs`);
    let sum = 0;
    const runs = inputRuns.map((value, i) => {
      const result = integer(
        value,
        i % 2 === 0 ? 1 : 0,
        i % 2 === 0 ? 67_108_864 : 255,
        `${path}.runs[${i}]`,
        errors,
      );
      if (i % 2 === 0) sum += result;
      return result;
    });
    if (sum !== width * height)
      errors.push(`${path}.runs: run lengths must cover exactly width × height`);
    return { type, width, height, runs, invert: boolean(v.invert, `${path}.invert`, errors) };
  }
  if (type === 'color-range') {
    const v = record(
      input,
      [
        'type',
        'hue',
        'hueWidth',
        'saturationMin',
        'saturationMax',
        'luminanceMin',
        'luminanceMax',
        'feather',
        'invert',
      ],
      path,
      errors,
    );
    const saturationMin = number(v.saturationMin, 0, 1, `${path}.saturationMin`, errors),
      saturationMax = number(v.saturationMax, 0, 1, `${path}.saturationMax`, errors);
    const luminanceMin = number(v.luminanceMin, 0, 1, `${path}.luminanceMin`, errors),
      luminanceMax = number(v.luminanceMax, 0, 1, `${path}.luminanceMax`, errors);
    if (saturationMin > saturationMax || luminanceMin > luminanceMax)
      errors.push(`${path}: range minimum must not exceed maximum`);
    return {
      type,
      hue: number(v.hue, 0, 360, `${path}.hue`, errors),
      hueWidth: number(v.hueWidth, 0, 180, `${path}.hueWidth`, errors),
      saturationMin,
      saturationMax,
      luminanceMin,
      luminanceMax,
      feather: number(v.feather, 0, 1, `${path}.feather`, errors),
      invert: boolean(v.invert, `${path}.invert`, errors),
    };
  }
  errors.push(`${path}.type: unsupported selection mask`);
  return { type: 'brush', strokes: [], invert: false };
}

export function parseSelectionMask(input: unknown): SelectionMaskV2 {
  const errors: string[] = [];
  try {
    const mask = readSelectionMask(input, 'mask', errors);
    if (errors.length) throw new RecipeValidationError(errors);
    return mask;
  } catch (error) {
    if (error instanceof RecipeValidationError) throw error;
    throw new RecipeValidationError(['mask: unreadable or unsupported data structure']);
  }
}

function defaultsV2(): RecipeV2 {
  const v1 = createRecipe();
  return {
    ...v1,
    schemaVersion: SCHEMA_VERSION_V2,
    engineVersion: ENGINE_VERSION_V2,
    levels: { inputBlack: 0, inputWhite: 1, gamma: 1, outputBlack: 0, outputWhite: 1 },
    hsl: Object.fromEntries(
      HSL_BANDS.map((band) => [band.id, { hue: 0, saturation: 0, lightness: 0 }]),
    ) as HslMixerV2,
    grading: {
      shadows: { hue: 0, saturation: 0, luminance: 0 },
      midtones: { hue: 0, saturation: 0, luminance: 0 },
      highlights: { hue: 0, saturation: 0, luminance: 0 },
      balance: 0,
    },
    detail: { texture: 0, clarity: 0 },
    effects: {
      monochrome: 0,
      fade: 0,
      vignette: {
        amount: 0,
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.75,
        radiusY: 0.75,
        feather: 0.75,
      },
      grain: { amount: 0, size: 1, seed: 1, colored: false },
    },
    regions: [],
  };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
export const DEFAULT_RECIPE_V2 = freezeDeep(defaultsV2());

export function validateRecipeV2(input: unknown): RecipeV2ValidationResult {
  const errors: string[] = [];
  try {
    const v = record(input, ROOT_KEYS, 'recipe', errors);
    if (v.schemaVersion !== SCHEMA_VERSION_V2) errors.push('recipe.schemaVersion: expected 2');
    if (v.engineVersion !== ENGINE_VERSION_V2)
      errors.push('recipe.engineVersion: expected 2.0.0; migration must be explicit');
    const base = validateRecipe({
      schemaVersion: 1,
      engineVersion: '1.0.0',
      adjustments: v.adjustments,
      curves: v.curves,
      geometry: v.geometry,
      local: v.local,
    });
    if (!base.valid) errors.push(...base.errors);
    const original = base.valid ? base.recipe : createRecipe();
    const l = record(
      v.levels,
      ['inputBlack', 'inputWhite', 'gamma', 'outputBlack', 'outputWhite'],
      'levels',
      errors,
    );
    const levels = {
      inputBlack: number(l.inputBlack, 0, 0.999, 'levels.inputBlack', errors),
      inputWhite: number(l.inputWhite, 0.001, 1, 'levels.inputWhite', errors),
      gamma: number(l.gamma, 0.1, 5, 'levels.gamma', errors),
      outputBlack: number(l.outputBlack, 0, 1, 'levels.outputBlack', errors),
      outputWhite: number(l.outputWhite, 0, 1, 'levels.outputWhite', errors),
    };
    if (levels.inputWhite - levels.inputBlack < 0.0001)
      errors.push('levels: inputWhite must exceed inputBlack by at least 0.0001');
    if (levels.outputBlack > levels.outputWhite)
      errors.push('levels: outputBlack must not exceed outputWhite');
    const h = record(
      v.hsl,
      HSL_BANDS.map((band) => band.id),
      'hsl',
      errors,
    );
    const hsl = Object.fromEntries(
      HSL_BANDS.map((band) => {
        const prefix = `hsl.${band.id}`,
          b = record(h[band.id], ['hue', 'saturation', 'lightness'], prefix, errors);
        return [
          band.id,
          {
            hue: number(b.hue, -60, 60, `${prefix}.hue`, errors),
            saturation: number(b.saturation, -100, 100, `${prefix}.saturation`, errors),
            lightness: number(b.lightness, -100, 100, `${prefix}.lightness`, errors),
          },
        ];
      }),
    ) as HslMixerV2;
    const g = record(
      v.grading,
      ['shadows', 'midtones', 'highlights', 'balance'],
      'grading',
      errors,
    );
    const readTone = (zone: 'shadows' | 'midtones' | 'highlights') => {
      const prefix = `grading.${zone}`,
        t = record(g[zone], ['hue', 'saturation', 'luminance'], prefix, errors);
      return {
        hue: number(t.hue, 0, 360, `${prefix}.hue`, errors),
        saturation: number(t.saturation, 0, 100, `${prefix}.saturation`, errors),
        luminance: number(t.luminance, -100, 100, `${prefix}.luminance`, errors),
      };
    };
    const grading = {
      shadows: readTone('shadows'),
      midtones: readTone('midtones'),
      highlights: readTone('highlights'),
      balance: number(g.balance, -100, 100, 'grading.balance', errors),
    };
    const d = record(v.detail, ['texture', 'clarity'], 'detail', errors);
    const detail = {
      texture: number(d.texture, -100, 100, 'detail.texture', errors),
      clarity: number(d.clarity, -100, 100, 'detail.clarity', errors),
    };
    const e = record(v.effects, ['monochrome', 'fade', 'vignette', 'grain'], 'effects', errors);
    const vi = record(
      e.vignette,
      ['amount', 'centerX', 'centerY', 'radiusX', 'radiusY', 'feather'],
      'effects.vignette',
      errors,
    );
    const grain = record(e.grain, ['amount', 'size', 'seed', 'colored'], 'effects.grain', errors);
    const effects = {
      monochrome: number(e.monochrome, 0, 100, 'effects.monochrome', errors),
      fade: number(e.fade, 0, 100, 'effects.fade', errors),
      vignette: {
        amount: number(vi.amount, -100, 100, 'effects.vignette.amount', errors),
        centerX: number(vi.centerX, 0, 1, 'effects.vignette.centerX', errors),
        centerY: number(vi.centerY, 0, 1, 'effects.vignette.centerY', errors),
        radiusX: number(vi.radiusX, 0.0001, 2, 'effects.vignette.radiusX', errors),
        radiusY: number(vi.radiusY, 0.0001, 2, 'effects.vignette.radiusY', errors),
        feather: number(vi.feather, 0, 1, 'effects.vignette.feather', errors),
      },
      grain: {
        amount: number(grain.amount, 0, 100, 'effects.grain.amount', errors),
        size: integer(grain.size, 1, 32, 'effects.grain.size', errors),
        seed: integer(grain.seed, 0, 4294967295, 'effects.grain.seed', errors),
        colored: boolean(grain.colored, 'effects.grain.colored', errors),
      },
    };
    const ids = new Set<string>();
    let brushPoints = 0;
    let rasterRuns = 0;
    const regions = arrayData(v.regions, 0, MAX_ADJUSTMENT_REGIONS, 'regions', errors).map(
      (value, index): AdjustmentRegionV2 => {
        const prefix = `regions[${index}]`,
          r = record(
            value,
            ['id', 'name', 'enabled', 'opacity', 'mask', 'adjustments'],
            prefix,
            errors,
          );
        const id = typeof r.id === 'string' ? r.id : '';
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || ids.has(id))
          errors.push(`${prefix}.id: expected a unique 1–64 character identifier`);
        ids.add(id);
        const name = typeof r.name === 'string' ? r.name : '';
        if (!name.trim() || name.length > 80)
          errors.push(`${prefix}.name: expected 1–80 characters`);
        const mask = readSelectionMask(r.mask, `${prefix}.mask`, errors);
        if (mask.type === 'brush')
          brushPoints += mask.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
        if (mask.type === 'raster') rasterRuns += mask.runs.length / 2;
        return {
          id,
          name,
          enabled: boolean(r.enabled, `${prefix}.enabled`, errors),
          opacity: number(r.opacity, 0, 1, `${prefix}.opacity`, errors),
          mask,
          adjustments: readAdjustments(r.adjustments, `${prefix}.adjustments`, errors),
        };
      },
    );
    if (brushPoints > MAX_TOTAL_BRUSH_POINTS)
      errors.push('regions: total brush point budget exceeded');
    if (rasterRuns > MAX_TOTAL_RASTER_RUNS)
      errors.push('regions: total raster run budget exceeded');
    const recipe: RecipeV2 = {
      ...original,
      schemaVersion: SCHEMA_VERSION_V2,
      engineVersion: ENGINE_VERSION_V2,
      levels,
      hsl,
      grading,
      detail,
      effects,
      regions,
    };
    return errors.length ? { valid: false, errors } : { valid: true, recipe, errors: [] };
  } catch {
    return {
      valid: false,
      errors: [...errors, 'recipe: unreadable or unsupported v2 data structure'],
    };
  }
}

export function parseRecipeV2(input: unknown): RecipeV2 {
  const result = validateRecipeV2(input);
  if (!result.valid) throw new RecipeValidationError(result.errors);
  return result.recipe;
}

/** Bounded override clone. Never invokes input accessors or accepts executable values. */
function copyOverrides(value: unknown): unknown {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (input: unknown, depth: number): unknown => {
    if (++nodes > 40000 || depth > 12)
      throw new RecipeValidationError(['override: structure budget exceeded']);
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (!input || typeof input !== 'object' || seen.has(input))
      throw new RecipeValidationError(['override: expected finite acyclic JSON data']);
    seen.add(input);
    let result: unknown;
    if (Array.isArray(input)) {
      const errors: string[] = [];
      const values = arrayData(input, 0, 16384, 'override', errors);
      if (errors.length) throw new RecipeValidationError(errors);
      result = values.map((child) => visit(child, depth + 1));
    } else {
      const prototype = Object.getPrototypeOf(input);
      if (
        (prototype !== Object.prototype && prototype !== null) ||
        Reflect.ownKeys(input).length > 32
      )
        throw new RecipeValidationError(['override: non-plain or oversized object']);
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Reflect.ownKeys(input)) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (
          typeof key !== 'string' ||
          ['__proto__', 'constructor', 'prototype'].includes(key) ||
          !descriptor ||
          !('value' in descriptor)
        )
          throw new RecipeValidationError(['override: unsafe property or accessor']);
        out[key] = visit(descriptor.value, depth + 1);
      }
      result = out;
    }
    seen.delete(input);
    return result;
  };
  return visit(value, 0);
}

function merge(base: unknown, override: unknown): unknown {
  if (
    !base ||
    !override ||
    typeof base !== 'object' ||
    typeof override !== 'object' ||
    Array.isArray(base) ||
    Array.isArray(override)
  )
    return override;
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(base)) out[key] = value;
  for (const [key, value] of Object.entries(override))
    out[key] = Object.hasOwn(out, key) ? merge(out[key], value) : value;
  return out;
}
export function createRecipeV2(overrides?: RecipeV2Overrides): RecipeV2 {
  return parseRecipeV2(
    overrides === undefined ? defaultsV2() : merge(defaultsV2(), copyOverrides(overrides)),
  );
}
export function createAdjustmentRegionV2(
  overrides: AdjustmentRegionV2Overrides = {},
): AdjustmentRegionV2 {
  const region: AdjustmentRegionV2 = {
    id: 'default-region',
    name: '局部调整',
    enabled: true,
    opacity: 1,
    mask: {
      type: 'radial',
      centerX: 0.5,
      centerY: 0.5,
      radiusX: 0.25,
      radiusY: 0.25,
      feather: 0.5,
      invert: false,
    },
    adjustments: neutralAdjustments(),
  };
  const copied = copyOverrides(overrides) as Record<string, unknown>;
  const merged = merge(region, copied) as AdjustmentRegionV2;
  // A discriminated mask is replaced as a whole, never merged with radial keys.
  if (Object.hasOwn(copied, 'mask')) merged.mask = copied.mask as SelectionMaskV2;
  return createRecipeV2({ regions: [merged] }).regions[0]!;
}
function versionOf(input: unknown): unknown {
  if (!input || typeof input !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(input, 'schemaVersion');
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
export function parseEditorRecipe(input: unknown): EditorRecipe {
  try {
    const version = versionOf(input);
    if (version === 1) return parseRecipe(input);
    if (version === 2) return parseRecipeV2(input);
    throw new RecipeValidationError([
      'recipe.schemaVersion: unsupported; migration must be explicit',
    ]);
  } catch (error) {
    if (error instanceof RecipeValidationError) throw error;
    throw new RecipeValidationError(['recipe: unreadable or unsupported data structure']);
  }
}
export function validateEditorRecipe(input: unknown): EditorRecipeValidationResult {
  try {
    return { valid: true, recipe: parseEditorRecipe(input), errors: [] };
  } catch (error) {
    return {
      valid: false,
      errors: error instanceof RecipeValidationError ? error.errors : ['recipe: invalid'],
    };
  }
}
export function migrateRecipeToV2(input: EditorRecipe): RecipeV2 {
  const recipe = parseEditorRecipe(input);
  if (recipe.schemaVersion === 2) return recipe;
  return createRecipeV2(
    Object.fromEntries(COMMON_KEYS.map((key) => [key, recipe[key]])) as RecipeV2Overrides,
  );
}
export function patchEditorAdjustments(
  input: EditorRecipe,
  patch: Partial<Adjustments>,
): EditorRecipe {
  const recipe = parseEditorRecipe(input);
  const safe = copyOverrides(patch);
  if (!safe || typeof safe !== 'object' || Array.isArray(safe))
    throw new RecipeValidationError(['adjustments patch: expected an object']);
  return parseEditorRecipe({ ...recipe, adjustments: { ...recipe.adjustments, ...safe } });
}

const toolPaths = new Set(V2_TOOLS.map((tool) => tool.path));
export function getRecipeV2Parameter(input: RecipeV2, path: string): number {
  if (!toolPaths.has(path)) throw new RecipeValidationError(['parameter: unknown v2 path']);
  let value: unknown = parseRecipeV2(input);
  for (const key of path.split('.')) value = (value as Record<string, unknown>)[key];
  return value as number;
}
export function setRecipeV2Parameter(input: RecipeV2, path: string, value: number): RecipeV2 {
  if (!toolPaths.has(path)) throw new RecipeValidationError(['parameter: unknown v2 path']);
  const recipe = parseRecipeV2(input),
    keys = path.split('.');
  let parent: unknown = recipe;
  for (const key of keys.slice(0, -1)) parent = (parent as Record<string, unknown>)[key];
  (parent as Record<string, unknown>)[keys[keys.length - 1]!] = value;
  return parseRecipeV2(recipe);
}

/** Internal bridge: no v2 extras may be silently supplied to the v1 interpreter. */
export function recipeV1Stage(recipe: RecipeV2): RecipeV1 {
  return {
    schemaVersion: 1,
    engineVersion: '1.0.0',
    adjustments: recipe.adjustments,
    curves: recipe.curves,
    geometry: recipe.geometry,
    local: recipe.local,
  };
}
