import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RECIPE_V2,
  V2_TOOLS,
  HSL_BANDS,
  RecipeValidationError,
  createRecipe,
  createRecipeV2,
  parseRecipe,
  parseRecipeV2,
  parseEditorRecipe,
  validateEditorRecipe,
  validateRecipeV2,
  migrateRecipeToV2,
  patchEditorAdjustments,
  createAdjustmentRegionV2,
  parseSelectionMask,
  getRecipeV2Parameter,
  setRecipeV2Parameter,
} from '../src/index.js';
import type { EditorRecipe, RecipeV2, SelectionMaskV2 } from '../src/index.js';

test('version dispatch is explicit and never drops unknown version fields', () => {
  const old = createRecipe(),
    current = createRecipeV2();
  assert.equal(parseEditorRecipe(old).schemaVersion, 1);
  assert.equal(parseEditorRecipe(current).schemaVersion, 2);
  assert.throws(() => parseRecipe(current), RecipeValidationError);
  assert.throws(() => parseRecipeV2(old), RecipeValidationError);
  for (const input of [
    { ...current, schemaVersion: 3 },
    { ...current, engineVersion: '2.0.1' },
    { ...old, levels: current.levels },
  ])
    assert.equal(validateEditorRecipe(input).valid, false);
  const incomplete = structuredClone(current) as unknown as Record<string, unknown>;
  delete incomplete.regions;
  assert.equal(validateRecipeV2(incomplete).valid, false);
});

test('explicit v1 migration preserves all common fields and owns every nested value', () => {
  const old = createRecipe({
    adjustments: { exposure: 0.75, soften: 33 },
    curves: {
      red: [
        [0, 0.1],
        [0.4, 0.2],
        [1, 1],
      ],
    },
    geometry: { crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }, rotation: 270, flipY: true },
    local: { enabled: true, mask: { invert: true }, adjustments: { brightness: -21 } },
  });
  const migrated = migrateRecipeToV2(old);
  for (const key of ['adjustments', 'curves', 'geometry', 'local'] as const)
    assert.deepEqual(migrated[key], old[key]);
  assert.deepEqual(migrated.regions, []);
  assert.deepEqual(migrated.levels, DEFAULT_RECIPE_V2.levels);
  migrated.curves.red[1]![1] = 0.8;
  assert.equal(old.curves.red[1]![1], 0.2);
  const copied = migrateRecipeToV2(migrated);
  copied.effects.grain.amount = 20;
  assert.equal(migrated.effects.grain.amount, 0);
  assert.ok(Object.isFrozen(DEFAULT_RECIPE_V2.hsl.red));
  assert.ok(Object.isFrozen(DEFAULT_RECIPE_V2.regions));
});

test('AI-safe base adjustment patch preserves version, masks and every v2 control', () => {
  const base = createRecipeV2({
    hsl: { blue: { hue: 20 } },
    levels: { gamma: 1.3 },
    effects: { grain: { seed: 19, amount: 20 } },
    regions: [
      createAdjustmentRegionV2({
        id: 'portrait-left',
        mask: {
          type: 'polygon',
          points: [
            { x: 0.1, y: 0.1 },
            { x: 0.8, y: 0.1 },
            { x: 0.4, y: 0.9 },
          ],
          feather: 0.02,
          invert: false,
        },
      }),
    ],
  });
  const changed = patchEditorAdjustments(base, { exposure: -1.1, soften: 40 }) as RecipeV2;
  assert.equal(changed.schemaVersion, 2);
  assert.equal(changed.adjustments.exposure, -1.1);
  for (const key of [
    'levels',
    'hsl',
    'grading',
    'detail',
    'effects',
    'regions',
    'local',
    'geometry',
    'curves',
  ] as const)
    assert.deepEqual(changed[key], base[key]);
  assert.notEqual(changed.regions, base.regions);
  assert.equal(patchEditorAdjustments(createRecipe(), { exposure: 1 }).schemaVersion, 1);
  assert.throws(
    () => patchEditorAdjustments(base, { imaginaryBeauty: 99 } as never),
    RecipeValidationError,
  );
  assert.throws(() => patchEditorAdjustments(base, { exposure: NaN }), RecipeValidationError);
});

test('the v2 registry exactly addresses implemented bounded controls and canonical defaults', () => {
  const recipe = createRecipeV2();
  assert.equal(HSL_BANDS.length, 8);
  assert.equal(new Set(V2_TOOLS.map((tool) => tool.path)).size, V2_TOOLS.length);
  for (const tool of V2_TOOLS) {
    assert.equal(getRecipeV2Parameter(recipe, tool.path), tool.neutral, tool.path);
    assert.ok(tool.min <= tool.neutral && tool.max >= tool.neutral && tool.step > 0);
    for (const value of [tool.min, tool.max])
      assert.equal(
        getRecipeV2Parameter(setRecipeV2Parameter(recipe, tool.path, value), tool.path),
        value,
      );
    assert.throws(() => setRecipeV2Parameter(recipe, tool.path, NaN), RecipeValidationError);
    assert.ok(Object.isFrozen(tool));
  }
  assert.throws(() => setRecipeV2Parameter(recipe, '__proto__.polluted', 1), RecipeValidationError);
  assert.throws(() => getRecipeV2Parameter(recipe, 'schemaVersion'), RecipeValidationError);
});

test('v2 rejects invalid coupled ranges, integer seeds, incomplete masks and unsupported fields', () => {
  const base = createRecipeV2();
  const cases = [
    { ...base, levels: { ...base.levels, inputBlack: 0.7, inputWhite: 0.6 } },
    { ...base, levels: { ...base.levels, outputBlack: 0.8, outputWhite: 0.2 } },
    { ...base, levels: { ...base.levels, gamma: 0 } },
    { ...base, effects: { ...base.effects, grain: { ...base.effects.grain, seed: 1.5 } } },
    { ...base, effects: { ...base.effects, grain: { ...base.effects.grain, size: 2.1 } } },
    { ...base, hsl: { ...base.hsl, skin: { hue: 1, saturation: 1, lightness: 1 } } },
    { ...base, detail: { ...base.detail, faceDetector: true } },
    {
      ...base,
      regions: [{ ...createAdjustmentRegionV2(), enabled: false, mask: { type: 'linear' } }],
    },
  ];
  for (const input of cases) assert.equal(validateRecipeV2(input).valid, false);
});

test('new nested validators do not execute accessors or accept prototype payloads', () => {
  let executed = 0;
  const base = createRecipeV2();
  const evil = structuredClone(base);
  Object.defineProperty(evil.levels, 'gamma', {
    enumerable: true,
    get() {
      executed += 1;
      return 1;
    },
  });
  assert.equal(validateRecipeV2(evil).valid, false);
  assert.equal(executed, 0);
  const version = Object.defineProperty({}, 'schemaVersion', {
    get() {
      executed += 1;
      return 2;
    },
  });
  assert.equal(validateEditorRecipe(version).valid, false);
  assert.equal(executed, 0);
  const inherited = Object.create(base) as EditorRecipe;
  assert.equal(validateEditorRecipe(inherited).valid, false);
  const mask = Object.defineProperty({}, 'type', {
    get() {
      executed += 1;
      return 'brush';
    },
  });
  assert.throws(() => parseSelectionMask(mask), RecipeValidationError);
  assert.equal(executed, 0);
  assert.throws(
    () =>
      createRecipeV2({
        levels: Object.defineProperty({}, 'gamma', {
          enumerable: true,
          get() {
            executed += 1;
            return 1;
          },
        }),
      }),
    RecipeValidationError,
  );
  assert.equal(executed, 0);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => createRecipeV2(cycle as never), RecipeValidationError);
  assert.throws(
    () => createRecipeV2(JSON.parse('{"__proto__":{"polluted":true}}')),
    RecipeValidationError,
  );
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('discriminated region builders replace masks without leaking radial fields', () => {
  const masks: SelectionMaskV2[] = [
    { type: 'linear', start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 }, smooth: true, invert: false },
    {
      type: 'brush',
      strokes: [
        { points: [{ x: 0.5, y: 0.5 }], radius: 0.1, feather: 0.5, opacity: 1, mode: 'add' },
      ],
      invert: false,
    },
    { type: 'raster', width: 2, height: 2, runs: [3, 0, 1, 255], invert: false },
    {
      type: 'color-range',
      hue: 13,
      hueWidth: 22,
      saturationMin: 0.2,
      saturationMax: 1,
      luminanceMin: 0.1,
      luminanceMax: 0.9,
      feather: 0.2,
      invert: false,
    },
  ];
  for (const mask of masks) assert.deepEqual(createAdjustmentRegionV2({ mask }).mask, mask);
  assert.throws(
    () => createRecipeV2({ regions: [createAdjustmentRegionV2(), createAdjustmentRegionV2()] }),
    /unique/,
  );
  assert.throws(
    () =>
      createRecipeV2({
        regions: Array.from({ length: 9 }, (_, i) => createAdjustmentRegionV2({ id: `r${i}` })),
      }),
    RecipeValidationError,
  );
});

test('mask validation enforces finite geometry, nondegeneracy, RLE coverage and complexity caps', () => {
  const bad = [
    {
      type: 'linear',
      start: { x: 0.5, y: 0.5 },
      end: { x: 0.5, y: 0.5 },
      smooth: true,
      invert: false,
    },
    {
      type: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ],
      feather: 0,
      invert: false,
    },
    { type: 'raster', width: 2, height: 2, runs: [3, 255], invert: false },
    { type: 'raster', width: 2, height: 2, runs: [4, 256], invert: false },
    { type: 'raster', width: 2, height: 2, runs: [0, 255, 4, 0], invert: false },
    {
      type: 'color-range',
      hue: 0,
      hueWidth: 181,
      saturationMin: 0.8,
      saturationMax: 0.2,
      luminanceMin: 0,
      luminanceMax: 1,
      feather: 0.2,
      invert: false,
    },
  ];
  for (const mask of bad) assert.throws(() => parseSelectionMask(mask), RecipeValidationError);
  const stroke = {
    points: Array.from({ length: 256 }, (_, i) => ({ x: i / 256, y: 0.5 })),
    radius: 0.01,
    feather: 0.5,
    opacity: 1,
    mode: 'add' as const,
  };
  assert.throws(
    () => parseSelectionMask({ type: 'brush', strokes: Array(5).fill(stroke), invert: false }),
    /budget/,
  );
  const mask = { type: 'brush' as const, strokes: Array(4).fill(stroke), invert: false };
  assert.throws(
    () =>
      createRecipeV2({
        regions: Array.from({ length: 3 }, (_, i) =>
          createAdjustmentRegionV2({ id: `r${i}`, mask }),
        ),
      }),
    /total brush/,
  );
  const raster = {
    type: 'raster' as const,
    width: 4096,
    height: 1,
    runs: Array.from({ length: 4096 }, (_, i) => [1, i % 2 ? 255 : 0]).flat(),
    invert: false,
  };
  assert.throws(
    () =>
      createRecipeV2({
        regions: Array.from({ length: 3 }, (_, i) =>
          createAdjustmentRegionV2({ id: `m${i}`, mask: raster }),
        ),
      }),
    /total raster/,
  );
});
