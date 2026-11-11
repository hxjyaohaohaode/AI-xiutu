import { neutralAdjustments, TOOLS } from './registry.js';
import type {
  Adjustments,
  CropRect,
  CurvePoint,
  Curves,
  Geometry,
  RadialMask,
  RecipeOverrides,
  RecipeV1,
  RecipeValidationResult,
} from './types.js';

export const ENGINE_VERSION = '1.0.0' as const;
export const SCHEMA_VERSION = 1 as const;
const ROOT_KEYS = ['schemaVersion', 'engineVersion', 'adjustments', 'curves', 'geometry', 'local'];
const MASK_KEYS = ['type', 'centerX', 'centerY', 'radiusX', 'radiusY', 'feather', 'invert'];

function defaults(): RecipeV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    engineVersion: ENGINE_VERSION,
    adjustments: neutralAdjustments(),
    curves: {
      rgb: [
        [0, 0],
        [1, 1],
      ],
      red: [
        [0, 0],
        [1, 1],
      ],
      green: [
        [0, 0],
        [1, 1],
      ],
      blue: [
        [0, 0],
        [1, 1],
      ],
    },
    geometry: { crop: null, rotation: 0, flipX: false, flipY: false },
    local: {
      enabled: false,
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
    },
  };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** Treat as immutable. Use createRecipe() for a separately owned editable value. */
export const DEFAULT_RECIPE: RecipeV1 = freezeDeep(defaults());

export class RecipeValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Invalid recipe: ${errors.join('; ')}`);
    this.name = 'RecipeValidationError';
    this.errors = [...errors];
  }
}

type RecordValue = Record<string, unknown>;

/** Read only own data properties: never call recipe getters or accept class instances. */
export function record(
  value: unknown,
  keys: readonly string[],
  path: string,
  errors: string[],
  optionalKeys: readonly string[] = [],
): RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${path}: expected a plain object`);
    return Object.create(null) as RecordValue;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    errors.push(`${path}: non-plain prototype is not allowed`);
  const result: RecordValue = Object.create(null) as RecordValue;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (!keys.includes(key) && !optionalKeys.includes(key))) {
      errors.push(`${path}: unknown property ${String(key)}`);
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      errors.push(`${path}.${key}: accessors are not allowed`);
      continue;
    }
    result[key] = descriptor.value;
  }
  for (const key of keys) if (!Object.hasOwn(result, key)) errors.push(`${path}.${key}: required`);
  return result;
}

export function number(
  value: unknown,
  min: number,
  max: number,
  path: string,
  errors: string[],
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${path}: expected a finite number from ${min} to ${max}`);
    return min;
  }
  return Object.is(value, -0) ? 0 : value;
}

export function boolean(value: unknown, path: string, errors: string[]): boolean {
  if (typeof value !== 'boolean') errors.push(`${path}: expected a boolean`);
  return value === true;
}

export function adjustments(value: unknown, path: string, errors: string[]): Adjustments {
  const values = record(
    value,
    TOOLS.map((tool) => tool.id),
    path,
    errors,
  );
  const out = neutralAdjustments();
  for (const tool of TOOLS)
    out[tool.id] = number(values[tool.id], tool.min, tool.max, `${path}.${tool.id}`, errors);
  return out;
}

export function arrayData(
  value: unknown,
  min: number,
  max: number,
  path: string,
  errors: string[],
): unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length < min ||
    value.length > max
  ) {
    errors.push(`${path}: expected an ordinary array of ${min}–${max} items`);
    return [];
  }
  const out: unknown[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (
      key !== 'length' &&
      (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)
    )
      errors.push(`${path}: extra array property is not allowed`);
  }
  for (let i = 0; i < value.length; i += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !('value' in descriptor)) {
      errors.push(`${path}[${i}]: sparse entries and accessors are not allowed`);
      out.push(undefined);
    } else out.push(descriptor.value);
  }
  return out;
}

function curve(value: unknown, path: string, errors: string[]): CurvePoint[] {
  const values = arrayData(value, 2, 16, path, errors);
  const out = values.map((entry, index): CurvePoint => {
    const p = arrayData(entry, 2, 2, `${path}[${index}]`, errors);
    return [
      number(p[0], 0, 1, `${path}[${index}].x`, errors),
      number(p[1], 0, 1, `${path}[${index}].y`, errors),
    ];
  });
  if (out[0]?.[0] !== 0 || out[out.length - 1]?.[0] !== 1)
    errors.push(`${path}: first/last x must be 0 and 1`);
  for (let i = 1; i < out.length; i += 1)
    if (out[i]![0] <= out[i - 1]![0])
      errors.push(`${path}: x coordinates must be strictly increasing`);
  return out;
}

export function readGeometry(value: unknown, errors: string[]): Geometry {
  const values = record(value, ['crop', 'rotation', 'flipX', 'flipY'], 'geometry', errors);
  let crop: CropRect | null = null;
  if (values.crop !== null) {
    const c = record(values.crop, ['x', 'y', 'width', 'height'], 'geometry.crop', errors);
    crop = {
      x: number(c.x, 0, 1, 'geometry.crop.x', errors),
      y: number(c.y, 0, 1, 'geometry.crop.y', errors),
      width: number(c.width, 0.000001, 1, 'geometry.crop.width', errors),
      height: number(c.height, 0.000001, 1, 'geometry.crop.height', errors),
    };
    if (crop.x + crop.width > 1 + 1e-12 || crop.y + crop.height > 1 + 1e-12)
      errors.push('geometry.crop: rectangle exceeds the source');
  }
  if (![0, 90, 180, 270].includes(values.rotation as number))
    errors.push('geometry.rotation: expected 0, 90, 180, or 270');
  return {
    crop,
    rotation: values.rotation as Geometry['rotation'],
    flipX: boolean(values.flipX, 'geometry.flipX', errors),
    flipY: boolean(values.flipY, 'geometry.flipY', errors),
  };
}

export function readMask(value: unknown, errors: string[]): RadialMask {
  const v = record(value, MASK_KEYS, 'local.mask', errors);
  if (v.type !== 'radial') errors.push('local.mask.type: only radial is supported');
  return {
    type: 'radial',
    centerX: number(v.centerX, 0, 1, 'local.mask.centerX', errors),
    centerY: number(v.centerY, 0, 1, 'local.mask.centerY', errors),
    radiusX: number(v.radiusX, 0.0001, 1, 'local.mask.radiusX', errors),
    radiusY: number(v.radiusY, 0.0001, 1, 'local.mask.radiusY', errors),
    feather: number(v.feather, 0, 1, 'local.mask.feather', errors),
    invert: boolean(v.invert, 'local.mask.invert', errors),
  };
}

export function validateRecipe(input: unknown): RecipeValidationResult {
  const errors: string[] = [];
  try {
    const v = record(input, ROOT_KEYS, 'recipe', errors);
    if (v.schemaVersion !== SCHEMA_VERSION)
      errors.push('recipe.schemaVersion: unsupported version');
    if (v.engineVersion !== ENGINE_VERSION)
      errors.push('recipe.engineVersion: unsupported engine; explicit migration required');
    const channels = ['rgb', 'red', 'green', 'blue'] as const;
    const c = record(v.curves, channels, 'curves', errors, ['interpolation']);
    const curves: Curves = {
      rgb: curve(c.rgb, 'curves.rgb', errors),
      red: curve(c.red, 'curves.red', errors),
      green: curve(c.green, 'curves.green', errors),
      blue: curve(c.blue, 'curves.blue', errors),
    };
    if (Object.hasOwn(c, 'interpolation')) {
      const modes = record(c.interpolation, [], 'curves.interpolation', errors, channels);
      for (const channel of channels) {
        if (!Object.hasOwn(modes, channel)) continue;
        if (modes[channel] !== 'pchip-v1')
          errors.push(`curves.interpolation.${channel}: unsupported algorithm`);
        else (curves.interpolation ??= {})[channel] = 'pchip-v1';
      }
    }
    const l = record(v.local, ['enabled', 'mask', 'adjustments'], 'local', errors);
    const recipe: RecipeV1 = {
      schemaVersion: SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      adjustments: adjustments(v.adjustments, 'adjustments', errors),
      curves,
      geometry: readGeometry(v.geometry, errors),
      local: {
        enabled: boolean(l.enabled, 'local.enabled', errors),
        mask: readMask(l.mask, errors),
        adjustments: adjustments(l.adjustments, 'local.adjustments', errors),
      },
    };
    return errors.length ? { valid: false, errors } : { valid: true, recipe, errors: [] };
  } catch {
    return {
      valid: false,
      errors: [...errors, 'recipe: unreadable or unsupported data structure'],
    };
  }
}

export function parseRecipe(input: unknown): RecipeV1 {
  const result = validateRecipe(input);
  if (!result.valid) throw new RecipeValidationError(result.errors);
  return result.recipe;
}

function copyPlain(value: unknown, depth = 0, seen = new Set<object>()): unknown {
  if (depth > 12) throw new RecipeValidationError(['override: too deeply nested']);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object')
    throw new RecipeValidationError(['override: expected finite JSON data']);
  if (seen.has(value)) throw new RecipeValidationError(['override: cycles are not allowed']);
  seen.add(value);
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    const errors: string[] = [];
    const items = arrayData(value, 0, 64, 'override', errors);
    if (errors.length) throw new RecipeValidationError(errors);
    const result = items.map((item) => copyPlain(item, depth + 1, seen));
    seen.delete(value);
    return result;
  }
  if (proto !== Object.prototype && proto !== null)
    throw new RecipeValidationError(['override: non-plain prototype']);
  if (Reflect.ownKeys(value).length > 32)
    throw new RecipeValidationError(['override: too many properties']);
  const result: RecordValue = Object.create(null) as RecordValue;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))
      throw new RecipeValidationError(['override: unsafe property']);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor))
      throw new RecipeValidationError(['override: accessors are not allowed']);
    result[key] = copyPlain(descriptor.value, depth + 1, seen);
  }
  seen.delete(value);
  return result;
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
  const result: RecordValue = Object.create(null) as RecordValue;
  for (const [key, value] of Object.entries(base)) result[key] = value;
  for (const [key, value] of Object.entries(override))
    result[key] = Object.hasOwn(result, key) ? merge(result[key], value) : value;
  return result;
}

/** Partial builder only; import/API persistence must use parseRecipe on full recipes. */
export function createRecipe(overrides?: RecipeOverrides): RecipeV1 {
  return parseRecipe(
    overrides === undefined ? defaults() : merge(defaults(), copyPlain(overrides)),
  );
}
