import { RecipeValidationError, record, number, boolean, arrayData } from './recipe.js';
import {
  createRecipeV2,
  parseRecipeV2,
  parseSelectionMask,
  parseEditorRecipe,
  migrateRecipeToV2,
} from './v2-recipe.js';
import { TOOLS } from './registry.js';
import { V2_TOOLS } from './v2-registry.js';
import {
  BLEND_MODES_V3,
  MAX_V3_REGION_EDITS,
  MAX_V3_REGION_GROUPS,
  MAX_V3_PAINT_LAYERS,
  MAX_V3_IMAGE_LAYERS,
  MAX_V3_PAINT_STROKES,
  MAX_V3_PAINT_POINTS,
  MAX_V3_STROKE_POINTS,
  MAX_V3_WARP_STROKES,
  MAX_V3_MASK_DEPTH,
  MAX_V3_MASK_NODES,
  V3_TOOLS,
} from './v3-registry.js';
import type { Point } from './types.js';
import type { RecipeV2, EditorRecipe } from './v2-types.js';
import type {
  RecipeV3,
  RecipeV3Overrides,
  ColorBlockV3,
  ColorBlockV3Overrides,
  AdjustmentRegionV3,
  AdjustmentRegionV3Overrides,
  RegionGroupV3,
  FineTransformV3,
  OpticsV3,
  SelectionMaskV3,
  PaintLayerV3,
  PaintStrokeV3,
  WarpStrokeV3,
  ImageLayerV3,
  BlendModeV3,
  OperationOriginV3,
  RecipeV3ValidationResult,
} from './v3-types.js';

export const SCHEMA_VERSION_V3 = 3 as const;
export const ENGINE_VERSION_V3 = '3.0.0' as const;
const BASE_KEYS = [
  'adjustments',
  'curves',
  'geometry',
  'local',
  'levels',
  'hsl',
  'grading',
  'detail',
  'effects',
  'regions',
] as const;
const COLOR_KEYS = [
  'adjustments',
  'curves',
  'levels',
  'hsl',
  'grading',
  'detail',
  'effects',
] as const;
const ROOT_KEYS = [
  'schemaVersion',
  'engineVersion',
  ...BASE_KEYS,
  'transform',
  'optics',
  'regionEdits',
  'regionGroups',
  'imageLayers',
  'paintLayers',
  'warp',
];
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const own = (v: unknown, key: string): unknown =>
  v && typeof v === 'object' ? Object.getOwnPropertyDescriptor(v, key)?.value : undefined;

/** Bounded JSON data clone, never invokes accessors, accepts executable values or shares mutable references. */
function cloneData(input: unknown): unknown {
  let nodes = 0;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): unknown => {
    if (++nodes > 160000 || depth > 20)
      throw new RecipeValidationError(['recipe: structure budget exceeded']);
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string' && v.length <= 4096) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return Object.is(v, -0) ? 0 : v;
    if (!v || typeof v !== 'object' || seen.has(v))
      throw new RecipeValidationError(['recipe: expected finite acyclic JSON data']);
    seen.add(v);
    let out: unknown;
    if (Array.isArray(v)) {
      const errors: string[] = [];
      const values = arrayData(v, 0, 16384, 'recipe', errors);
      if (errors.length) throw new RecipeValidationError(errors);
      out = values.map((x) => visit(x, depth + 1));
    } else {
      const p = Object.getPrototypeOf(v);
      if ((p !== Object.prototype && p !== null) || Reflect.ownKeys(v).length > 64)
        throw new RecipeValidationError(['recipe: invalid object']);
      const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Reflect.ownKeys(v)) {
        const d = Object.getOwnPropertyDescriptor(v, key);
        if (
          typeof key !== 'string' ||
          ['__proto__', 'prototype', 'constructor'].includes(key) ||
          !d ||
          !('value' in d)
        )
          throw new RecipeValidationError(['recipe: unsafe property/accessor']);
        copy[key] = visit(d.value, depth + 1);
      }
      out = copy;
    }
    seen.delete(v);
    return out;
  };
  return visit(input, 0);
}
function merge(base: unknown, patch: unknown): unknown {
  if (
    !base ||
    !patch ||
    typeof base !== 'object' ||
    typeof patch !== 'object' ||
    Array.isArray(base) ||
    Array.isArray(patch)
  )
    return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [key, v] of Object.entries(patch))
    out[key] = Object.hasOwn(out, key) ? merge(out[key], v) : v;
  return out;
}
function identifier(v: unknown, path: string, errors: string[]): string {
  const s = typeof v === 'string' ? v : '';
  if (!ID.test(s)) errors.push(`${path}: expected a 1–128 character identifier`);
  return s;
}
function name(v: unknown, path: string, errors: string[]): string {
  const s = typeof v === 'string' ? v : '';
  if (!s.trim() || s.length > 120) errors.push(`${path}: expected 1–120 characters`);
  return s;
}
export function integer(
  v: unknown,
  min: number,
  max: number,
  path: string,
  errors: string[],
): number {
  const n = number(v, min, max, path, errors);
  if (!Number.isSafeInteger(n)) errors.push(`${path}: expected integer`);
  return n;
}
function point(v: unknown, path: string, errors: string[]): Point {
  const r = record(v, ['x', 'y'], path, errors);
  return { x: number(r.x, 0, 1, `${path}.x`, errors), y: number(r.y, 0, 1, `${path}.y`, errors) };
}
function recordOrigin(
  v: unknown,
  keys: string[],
  path: string,
  errors: string[],
): Record<string, unknown> {
  return record(
    v,
    [...keys, ...(v && typeof v === 'object' && Object.hasOwn(v, 'origin') ? ['origin'] : [])],
    path,
    errors,
  );
}
function origin(v: unknown, path: string, errors: string[]): OperationOriginV3 | undefined {
  if (v === undefined) return undefined;
  const o = record(
    v,
    [
      'moduleId',
      'instanceId',
      'parameterId',
      'value',
      ...(v && typeof v === 'object' && Object.hasOwn(v, 'parameters') ? ['parameters'] : []),
    ],
    path,
    errors,
  );
  let parameters: Record<string, number> | undefined;
  if (Object.hasOwn(o, 'parameters')) {
    const p = o.parameters;
    if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).length > 64)
      errors.push(`${path}.parameters: expected at most 64 values`);
    else {
      parameters = {};
      for (const [key, value] of Object.entries(p)) {
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key)) errors.push(`${path}.parameters: invalid key`);
        parameters[key] = number(value, -1e6, 1e6, `${path}.parameters.${key}`, errors);
      }
    }
  }
  return {
    ...(parameters ? { parameters } : {}),
    moduleId: identifier(o.moduleId, `${path}.moduleId`, errors),
    instanceId: identifier(o.instanceId, `${path}.instanceId`, errors),
    parameterId: identifier(o.parameterId, `${path}.parameterId`, errors),
    value: number(o.value, -1e9, 1e9, `${path}.value`, errors),
  };
}
const originField = (r: Record<string, unknown>, path: string, errors: string[]) => {
  const result = origin(r.origin, `${path}.origin`, errors);
  return result ? { origin: result } : {};
};
export function createFineTransformV3(): FineTransformV3 {
  return {
    rotationDegrees: 0,
    perspectiveX: 0,
    perspectiveY: 0,
    skewX: 0,
    skewY: 0,
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0,
    fit: 'contain',
  };
}
export function createOpticsV3(): OpticsV3 {
  return {
    denoiseLuminance: 0,
    denoiseChroma: 0,
    aberrationRed: 0,
    aberrationBlue: 0,
    aberrationCenterX: 0.5,
    aberrationCenterY: 0.5,
  };
}
function readOptics(v: unknown, path: string, errors: string[]): OpticsV3 {
  const defs = V3_TOOLS.filter((t) => t.group === 'optics');
  const r = record(
    v,
    defs.map((t) => t.path.split('.')[1]!),
    path,
    errors,
  );
  return Object.fromEntries(
    defs.map((t) => {
      const k = t.path.split('.')[1]!;
      return [k, number(r[k], t.min, t.max, `${path}.${k}`, errors)];
    }),
  ) as unknown as OpticsV3;
}
function readTransform(v: unknown, errors: string[]): FineTransformV3 {
  const defs = V3_TOOLS.filter((t) => t.group === 'transform');
  const r = record(v, [...defs.map((t) => t.path.split('.')[1]!), 'fit'], 'transform', errors);
  const n = Object.fromEntries(
    defs.map((t) => {
      const k = t.path.split('.')[1]!;
      return [k, number(r[k], t.min, t.max, t.path, errors)];
    }),
  );
  if (r.fit !== 'contain' && r.fit !== 'crop')
    errors.push('transform.fit: expected contain or crop');
  const rad = Math.PI / 180;
  if (Math.abs(1 - Math.tan(n.skewX! * rad) * Math.tan(n.skewY! * rad)) < 0.05)
    errors.push('transform: shear combination is nearly singular');
  return { ...n, fit: r.fit === 'crop' ? 'crop' : 'contain' } as FineTransformV3;
}
interface MaskBudget {
  nodes: number;
  brushPoints: number;
  rasterRuns: number;
}
function readMask(
  v: unknown,
  path: string,
  errors: string[],
  budget: MaskBudget,
  depth = 0,
): SelectionMaskV3 {
  if (++budget.nodes > MAX_V3_MASK_NODES || depth > MAX_V3_MASK_DEPTH) {
    errors.push(`${path}: compound mask budget exceeded`);
    return { type: 'brush', strokes: [], invert: false };
  }
  if (own(v, 'type') === 'compound') {
    const r = record(v, ['type', 'operation', 'masks', 'invert'], path, errors);
    if (!['union', 'intersection', 'subtract', 'xor'].includes(String(r.operation)))
      errors.push(`${path}.operation: unsupported combination`);
    return {
      type: 'compound',
      operation: r.operation as 'union',
      masks: arrayData(r.masks, 2, 8, `${path}.masks`, errors).map((m, i) =>
        readMask(m, `${path}.masks[${i}]`, errors, budget, depth + 1),
      ),
      invert: boolean(r.invert, `${path}.invert`, errors),
    };
  }
  const hasAngle = own(v, 'rotationDegrees') !== undefined;
  const hasProfile = own(v, 'shape') !== undefined;
  if (own(v, 'type') === 'radial' && (hasAngle || hasProfile)) {
    const r = record(
      v,
      [
        'type',
        'centerX',
        'centerY',
        'radiusX',
        'radiusY',
        'feather',
        'invert',
        ...(hasAngle ? ['rotationDegrees'] : []),
        ...(hasProfile ? ['shape'] : []),
      ],
      path,
      errors,
    );
    const { rotationDegrees, shape, ...ordinary } = r;
    if (hasProfile && shape !== 'ellipse' && shape !== 'rectangle' && shape !== 'diamond')
      errors.push(`${path}.shape: unsupported radial profile`);
    try {
      const mask = parseSelectionMask(ordinary);
      if (mask.type !== 'radial')
        throw new RecipeValidationError([`${path}: expected a radial mask`]);
      return {
        ...mask,
        ...(rotationDegrees !== undefined
          ? {
              rotationDegrees: number(
                rotationDegrees,
                -180,
                180,
                `${path}.rotationDegrees`,
                errors,
              ),
            }
          : {}),
        ...(shape !== undefined ? { shape: shape as 'ellipse' | 'rectangle' | 'diamond' } : {}),
      };
    } catch (error) {
      errors.push(
        ...(error instanceof RecipeValidationError
          ? error.errors
          : [`${path}: invalid radial mask`]),
      );
      return { type: 'brush', strokes: [], invert: false };
    }
  }
  try {
    const mask = parseSelectionMask(v);
    if (mask.type === 'brush')
      budget.brushPoints += mask.strokes.reduce((n, s) => n + s.points.length, 0);
    if (mask.type === 'raster') budget.rasterRuns += mask.runs.length / 2;
    if (budget.brushPoints > 8192) errors.push(`${path}: total mask brush point budget exceeded`);
    if (budget.rasterRuns > 16384) errors.push(`${path}: total raster run budget exceeded`);
    return mask;
  } catch (e) {
    errors.push(...(e instanceof RecipeValidationError ? e.errors : [`${path}: invalid mask`]));
    return { type: 'brush', strokes: [], invert: false };
  }
}
export function parseSelectionMaskV3(input: unknown): SelectionMaskV3 {
  const errors: string[] = [];
  const mask = readMask(cloneData(input), 'mask', errors, {
    nodes: 0,
    brushPoints: 0,
    rasterRuns: 0,
  });
  if (errors.length) throw new RecipeValidationError(errors);
  return mask;
}
function defaultColor(): ColorBlockV3 {
  const r = createRecipeV2();
  return {
    ...Object.fromEntries(COLOR_KEYS.map((k) => [k, r[k]])),
    optics: createOpticsV3(),
  } as unknown as ColorBlockV3;
}
function readColor(v: unknown, path: string, errors: string[]): ColorBlockV3 {
  const r = record(v, [...COLOR_KEYS, 'optics'], path, errors);
  let base = createRecipeV2();
  try {
    base = parseRecipeV2({ ...base, ...Object.fromEntries(COLOR_KEYS.map((k) => [k, r[k]])) });
  } catch (e) {
    errors.push(
      ...(e instanceof RecipeValidationError
        ? e.errors.map((s) => `${path}.${s}`)
        : [`${path}: invalid color block`]),
    );
  }
  return {
    ...Object.fromEntries(COLOR_KEYS.map((k) => [k, base[k]])),
    optics: readOptics(r.optics, `${path}.optics`, errors),
  } as unknown as ColorBlockV3;
}
export function createColorBlockV3(overrides?: ColorBlockV3Overrides): ColorBlockV3 {
  const errors: string[] = [];
  const c = readColor(
    overrides ? merge(defaultColor(), cloneData(overrides)) : defaultColor(),
    'color',
    errors,
  );
  if (errors.length) throw new RecipeValidationError(errors);
  return c;
}
export function parseColorBlockV3(input: unknown, path = 'color'): ColorBlockV3 {
  const errors: string[] = [];
  const color = readColor(cloneData(input), path, errors);
  if (errors.length) throw new RecipeValidationError(errors);
  return color;
}
function blend(v: unknown, path: string, errors: string[]): BlendModeV3 {
  if (!BLEND_MODES_V3.includes(v as BlendModeV3)) errors.push(`${path}: unsupported blend mode`);
  return v as BlendModeV3;
}
export function parseRecipeV3(input: unknown): RecipeV3 {
  const errors: string[] = [];
  // Clone first bounds cycles/depth/total primitive count before recursive readers run.
  const root = record(cloneData(input), ROOT_KEYS, 'recipe', errors);
  if (root.schemaVersion !== 3 || root.engineVersion !== '3.0.0')
    errors.push('recipe: expected schemaVersion 3 and engineVersion 3.0.0');
  let base = createRecipeV2();
  try {
    base = parseRecipeV2({
      schemaVersion: 2,
      engineVersion: '2.0.0',
      ...Object.fromEntries(BASE_KEYS.map((k) => [k, root[k]])),
    });
  } catch (e) {
    errors.push(
      ...(e instanceof RecipeValidationError ? e.errors : ['recipe: invalid legacy stage']),
    );
  }
  const budget: MaskBudget = { nodes: 0, brushPoints: 0, rasterRuns: 0 };
  const regionIds = new Set<string>(),
    groupIds = new Set<string>(),
    layerIds = new Set<string>();
  const unique = (id: string, set: Set<string>, path: string) => {
    if (set.has(id)) errors.push(`${path}: duplicate identifier`);
    set.add(id);
  };
  const groups = arrayData(root.regionGroups, 0, MAX_V3_REGION_GROUPS, 'regionGroups', errors).map(
    (v, i): RegionGroupV3 => {
      const p = `regionGroups[${i}]`,
        r = record(v, ['id', 'name', 'enabled', 'opacity', 'color'], p, errors),
        id = identifier(r.id, `${p}.id`, errors);
      unique(id, groupIds, p);
      return {
        id,
        name: name(r.name, `${p}.name`, errors),
        enabled: boolean(r.enabled, `${p}.enabled`, errors),
        opacity: number(r.opacity, 0, 1, `${p}.opacity`, errors),
        color: readColor(r.color, `${p}.color`, errors),
      };
    },
  );
  const regions = arrayData(root.regionEdits, 0, MAX_V3_REGION_EDITS, 'regionEdits', errors).map(
    (v, i): AdjustmentRegionV3 => {
      const p = `regionEdits[${i}]`,
        r = recordOrigin(
          v,
          ['id', 'name', 'enabled', 'opacity', 'mask', 'color', 'groupId'],
          p,
          errors,
        ),
        id = identifier(r.id, `${p}.id`, errors);
      unique(id, regionIds, p);
      const groupId = r.groupId === null ? null : identifier(r.groupId, `${p}.groupId`, errors);
      if (groupId !== null && !groupIds.has(groupId)) errors.push(`${p}.groupId: unknown group`);
      return {
        id,
        name: name(r.name, `${p}.name`, errors),
        enabled: boolean(r.enabled, `${p}.enabled`, errors),
        opacity: number(r.opacity, 0, 1, `${p}.opacity`, errors),
        mask: readMask(r.mask, `${p}.mask`, errors, budget),
        color: readColor(r.color, `${p}.color`, errors),
        groupId,
        ...originField(r, p, errors),
      };
    },
  );
  let paintPoints = 0,
    paintStrokes = 0;
  const layers = arrayData(root.paintLayers, 0, MAX_V3_PAINT_LAYERS, 'paintLayers', errors).map(
    (v, i): PaintLayerV3 => {
      const p = `paintLayers[${i}]`,
        r = recordOrigin(
          v,
          ['id', 'name', 'enabled', 'opacity', 'blendMode', 'mask', 'strokes'],
          p,
          errors,
        ),
        id = identifier(r.id, `${p}.id`, errors);
      unique(id, layerIds, p);
      const strokes = arrayData(r.strokes, 0, MAX_V3_PAINT_STROKES, `${p}.strokes`, errors).map(
        (v, j): PaintStrokeV3 => {
          paintStrokes++;
          const q = `${p}.strokes[${j}]`,
            s = record(
              v,
              [
                'points',
                'radius',
                'feather',
                'opacity',
                'mode',
                'color',
                'source',
                ...(v && typeof v === 'object' && Object.hasOwn(v, 'sampling') ? ['sampling'] : []),
                ...(v && typeof v === 'object' && Object.hasOwn(v, 'material') ? ['material'] : []),
              ],
              q,
              errors,
            );
          const pts = arrayData(s.points, 1, MAX_V3_STROKE_POINTS, `${q}.points`, errors).map(
            (p, k) => point(p, `${q}.points[${k}]`, errors),
          );
          paintPoints += pts.length;
          if (!['paint', 'erase', 'clone'].includes(String(s.mode)))
            errors.push(`${q}.mode: invalid`);
          const source = s.source === null ? null : point(s.source, `${q}.source`, errors);
          if (s.mode === 'clone' && source === null) errors.push(`${q}.source: required for clone`);
          const color = arrayData(s.color, 4, 4, `${q}.color`, errors).map((n, k) =>
            integer(n, 0, 255, `${q}.color[${k}]`, errors),
          ) as PaintStrokeV3['color'];
          let sampling: PaintStrokeV3['sampling'];
          let material: PaintStrokeV3['material'];
          if (Object.hasOwn(s, 'material')) {
            const data = record(s.material, ['algorithm', 'finish', 'saturation', 'blendMode'], `${q}.material`, errors);
            if (s.mode !== 'paint') errors.push(`${q}.material: requires paint mode`);
            if (data.algorithm !== 'pigment-v1') errors.push(`${q}.material.algorithm: unsupported`);
            if (!['matte', 'satin', 'shimmer', 'metallic'].includes(String(data.finish)))
              errors.push(`${q}.material.finish: invalid`);
            material = {
              algorithm: 'pigment-v1',
              finish: data.finish as NonNullable<PaintStrokeV3['material']>['finish'],
              saturation: number(data.saturation, 0, 2, `${q}.material.saturation`, errors),
              blendMode: blend(data.blendMode, `${q}.material.blendMode`, errors),
            };
          }
          if (Object.hasOwn(s, 'sampling')) {
            const data = record(
              s.sampling,
              ['algorithm', 'pressure', 'breaks', 'antialias'],
              `${q}.sampling`,
              errors,
            );
            if (data.algorithm !== 'swept-v1') errors.push(`${q}.sampling.algorithm: unsupported`);
            const pressure = arrayData(
              data.pressure,
              pts.length,
              pts.length,
              `${q}.sampling.pressure`,
              errors,
            ).map((value, k) => number(value, 0, 1, `${q}.sampling.pressure[${k}]`, errors));
            const breaks = arrayData(
              data.breaks,
              0,
              Math.max(0, pts.length - 1),
              `${q}.sampling.breaks`,
              errors,
            ).map((value, k) =>
              integer(value, 1, pts.length - 1, `${q}.sampling.breaks[${k}]`, errors),
            );
            if (breaks.some((value, k) => k > 0 && value <= breaks[k - 1]!))
              errors.push(`${q}.sampling.breaks: expected strictly increasing indices`);
            sampling = {
              algorithm: 'swept-v1',
              pressure,
              breaks,
              antialias: boolean(data.antialias, `${q}.sampling.antialias`, errors),
            };
          }
          return {
            points: pts,
            ...(sampling ? { sampling } : {}),
            ...(material ? { material } : {}),
            radius: number(s.radius, 0.000001, 0.5, `${q}.radius`, errors),
            feather: number(s.feather, 0, 1, `${q}.feather`, errors),
            opacity: number(s.opacity, 0, 1, `${q}.opacity`, errors),
            mode: s.mode as 'paint',
            color,
            source,
          };
        },
      );
      return {
        id,
        name: name(r.name, `${p}.name`, errors),
        enabled: boolean(r.enabled, `${p}.enabled`, errors),
        opacity: number(r.opacity, 0, 1, `${p}.opacity`, errors),
        blendMode: blend(r.blendMode, `${p}.blendMode`, errors),
        mask: r.mask === null ? null : readMask(r.mask, `${p}.mask`, errors, budget),
        strokes,
        ...originField(r, p, errors),
      };
    },
  );
  if (paintPoints > MAX_V3_PAINT_POINTS) errors.push('paintLayers: total point budget exceeded');
  if (paintStrokes > MAX_V3_PAINT_STROKES) errors.push('paintLayers: total stroke budget exceeded');
  const imageLayers = arrayData(
    root.imageLayers,
    0,
    MAX_V3_IMAGE_LAYERS,
    'imageLayers',
    errors,
  ).map((v, i): ImageLayerV3 => {
    const p = `imageLayers[${i}]`,
      r = recordOrigin(
        v,
        [
          'id',
          'name',
          'enabled',
          'opacity',
          'blendMode',
          'sourceId',
          'x',
          'y',
          'width',
          'height',
          'rotationDegrees',
          'flipX',
          'flipY',
          'mask',
        ],
        p,
        errors,
      ),
      id = identifier(r.id, `${p}.id`, errors);
    unique(id, layerIds, p);
    return {
      id,
      name: name(r.name, `${p}.name`, errors),
      enabled: boolean(r.enabled, `${p}.enabled`, errors),
      opacity: number(r.opacity, 0, 1, `${p}.opacity`, errors),
      blendMode: blend(r.blendMode, `${p}.blendMode`, errors),
      sourceId: identifier(r.sourceId, `${p}.sourceId`, errors),
      x: number(r.x, -4, 4, `${p}.x`, errors),
      y: number(r.y, -4, 4, `${p}.y`, errors),
      width: number(r.width, 0.000001, 8, `${p}.width`, errors),
      height: number(r.height, 0.000001, 8, `${p}.height`, errors),
      rotationDegrees: number(r.rotationDegrees, -180, 180, `${p}.rotationDegrees`, errors),
      flipX: boolean(r.flipX, `${p}.flipX`, errors),
      flipY: boolean(r.flipY, `${p}.flipY`, errors),
      mask: r.mask === null ? null : readMask(r.mask, `${p}.mask`, errors, budget),
      ...originField(r, p, errors),
    };
  });
  const w = record(root.warp, ['enabled', 'strokes', 'protection'], 'warp', errors, ['guards']),
    warpIds = new Set<string>();
  const guardIds = new Set<string>();
  const guards = !Object.hasOwn(w, 'guards')
    ? []
    : arrayData(w.guards, 0, 8, 'warp.guards', errors).map((entry, index) => {
        const path = `warp.guards[${index}]`;
        const row = record(entry, ['id', 'mask'], path, errors);
        const id = identifier(row.id, `${path}.id`, errors);
        unique(id, guardIds, path);
        return { id, mask: readMask(row.mask, `${path}.mask`, errors, budget) };
      });
  const warpStrokes = arrayData(w.strokes, 0, MAX_V3_WARP_STROKES, 'warp.strokes', errors).map(
    (v, i): WarpStrokeV3 => {
      const p = `warp.strokes[${i}]`,
        r = recordOrigin(
          v,
          [
            'id',
            'mode',
            'from',
            'to',
            'radius',
            'feather',
            'strength',
            ...(v && typeof v === 'object' && Object.hasOwn(v, 'algorithm') ? ['algorithm'] : []),
            ...(v && typeof v === 'object' && Object.hasOwn(v, 'resampling') ? ['resampling'] : []),
            ...(v && typeof v === 'object' && Object.hasOwn(v, 'guardId') ? ['guardId'] : []),
          ],
          p,
          errors,
        ),
        id = identifier(r.id, `${p}.id`, errors);
      unique(id, warpIds, p);
      if (!['push', 'pinch', 'bulge', 'twirl', 'restore'].includes(String(r.mode)))
        errors.push(`${p}.mode: unsupported warp`);
      const restoring = r.mode === 'restore';
      if (
        restoring
          ? r.algorithm !== 'restore-v1'
          : Object.hasOwn(r, 'algorithm') && r.algorithm !== 'flow-v1' && r.algorithm !== 'flow-v2'
      )
        errors.push(`${p}.algorithm: unsupported warp algorithm`);
      if (Object.hasOwn(r, 'resampling') && r.resampling !== 'bounded-cubic-v1')
        errors.push(`${p}.resampling: unsupported warp resampling`);
      const guardId = Object.hasOwn(r, 'guardId')
        ? identifier(r.guardId, `${p}.guardId`, errors)
        : undefined;
      if (guardId && !guardIds.has(guardId)) errors.push(`${p}.guardId: unknown warp guard`);
      return {
        id,
        ...(r.algorithm === 'flow-v1' || r.algorithm === 'flow-v2' || r.algorithm === 'restore-v1'
          ? { algorithm: r.algorithm }
          : {}),
        ...(Object.hasOwn(r, 'resampling') ? { resampling: 'bounded-cubic-v1' as const } : {}),
        ...(guardId ? { guardId } : {}),
        mode: r.mode as WarpStrokeV3['mode'],
        from: point(r.from, `${p}.from`, errors),
        to: point(r.to, `${p}.to`, errors),
        radius: number(r.radius, 0.000001, 1, `${p}.radius`, errors),
        feather: number(r.feather, 0, 1, `${p}.feather`, errors),
        strength: number(r.strength, restoring ? 0 : -1, 1, `${p}.strength`, errors),
        ...originField(r, p, errors),
      };
    },
  );
  // Extra compact strokes support multiple faces within the old maximum aggregate brush support.
  if (
    warpStrokes.length > 64 &&
    warpStrokes.reduce(
      (work, stroke) =>
        work +
        stroke.radius ** 2 +
        (stroke.mode === 'restore'
          ? 2 * stroke.radius * Math.hypot(stroke.to.x - stroke.from.x, stroke.to.y - stroke.from.y)
          : 0),
      0,
    ) > 64
  )
    errors.push('warp.strokes: combined brush support exceeds the rendering budget');
  const result: RecipeV3 = {
    ...base,
    schemaVersion: 3,
    engineVersion: '3.0.0',
    transform: readTransform(root.transform, errors),
    optics: readOptics(root.optics, 'optics', errors),
    regionEdits: regions,
    regionGroups: groups,
    paintLayers: layers,
    imageLayers,
    warp: {
      enabled: boolean(w.enabled, 'warp.enabled', errors),
      strokes: warpStrokes,
      protection:
        w.protection === null ? null : readMask(w.protection, 'warp.protection', errors, budget),
      ...(guards.length ? { guards } : {}),
    },
  };
  if (errors.length) throw new RecipeValidationError(errors);
  return result;
}
export function validateRecipeV3(input: unknown): RecipeV3ValidationResult {
  try {
    return { valid: true, recipe: parseRecipeV3(input), errors: [] };
  } catch (e) {
    return {
      valid: false,
      errors: e instanceof RecipeValidationError ? e.errors : ['recipe: unreadable v3 data'],
    };
  }
}
function defaults(): RecipeV3 {
  return {
    ...createRecipeV2(),
    schemaVersion: 3,
    engineVersion: '3.0.0',
    transform: createFineTransformV3(),
    optics: createOpticsV3(),
    regionEdits: [],
    regionGroups: [],
    imageLayers: [],
    paintLayers: [],
    warp: { enabled: true, strokes: [], protection: null },
  };
}
export function createRecipeV3(overrides?: RecipeV3Overrides): RecipeV3 {
  return parseRecipeV3(
    overrides === undefined ? defaults() : merge(defaults(), cloneData(overrides)),
  );
}
export function migrateRecipeToV3(input: EditorRecipe): RecipeV3 {
  const r = parseEditorRecipe(input);
  if (r.schemaVersion === 4)
    throw new RecipeValidationError(['migration: v4 cannot be silently downgraded to v3']);
  if (r.schemaVersion === 3) return r;
  const base = r.schemaVersion === 2 ? r : migrateRecipeToV2(r);
  return createRecipeV3({ ...base, schemaVersion: 3, engineVersion: '3.0.0' });
}
export function createAdjustmentRegionV3(
  overrides: AdjustmentRegionV3Overrides = {},
): AdjustmentRegionV3 {
  const base: AdjustmentRegionV3 = {
    id: 'region',
    name: '局部调整',
    enabled: true,
    opacity: 1,
    groupId: null,
    mask: {
      type: 'radial',
      centerX: 0.5,
      centerY: 0.5,
      radiusX: 0.25,
      radiusY: 0.25,
      feather: 0.5,
      invert: false,
    },
    color: defaultColor(),
  };
  const copied = cloneData(overrides) as Record<string, unknown>,
    r = merge(base, copied) as AdjustmentRegionV3;
  if (Object.hasOwn(copied, 'mask')) r.mask = copied.mask as SelectionMaskV3;
  const groups = r.groupId
    ? [{ id: r.groupId, name: '校验分组', enabled: true, opacity: 1, color: defaultColor() }]
    : [];
  return createRecipeV3({ regionEdits: [r], regionGroups: groups }).regionEdits[0]!;
}
/** A structural bridge; callers must preserve the surrounding V3 object when changing old controls. */
export function recipeV2Stage(recipe: RecipeV3): RecipeV2 {
  return {
    schemaVersion: 2,
    engineVersion: '2.0.0',
    ...Object.fromEntries(BASE_KEYS.map((k) => [k, recipe[k]])),
  } as RecipeV2;
}
const allowedPaths = new Set([
  ...TOOLS.map((t) => `adjustments.${t.id}`),
  ...V2_TOOLS.map((t) => t.path),
  ...V3_TOOLS.map((t) => t.path),
]);
export function getEditorParameter(input: EditorRecipe, path: string): number {
  if (!allowedPaths.has(path)) throw new RecipeValidationError(['parameter: unknown path']);
  let value: unknown = parseEditorRecipe(input);
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part))
      throw new RecipeValidationError(['parameter: unavailable in this version']);
    value = (value as Record<string, unknown>)[part];
  }
  if (typeof value !== 'number') throw new RecipeValidationError(['parameter: not numeric']);
  return value;
}
export function setEditorParameter(input: EditorRecipe, path: string, value: number): EditorRecipe {
  getEditorParameter(input, path);
  const r = parseEditorRecipe(input),
    keys = path.split('.');
  let parent: unknown = r;
  for (const key of keys.slice(0, -1)) parent = (parent as Record<string, unknown>)[key];
  (parent as Record<string, unknown>)[keys.at(-1)!] = value;
  return parseEditorRecipe(r);
}

// Shared bounded readers for the explicit v4 protocol. Existing v3 semantics stay unchanged.
export {
  cloneData as cloneRecipeDataV3,
  merge as mergeRecipeDataV3,
  origin as readOperationOriginV3,
};
