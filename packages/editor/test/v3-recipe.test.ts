import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV3,
  createRecipeV2,
  createRecipe,
  parseRecipeV3,
  parseEditorRecipe,
  validateRecipeV3,
  migrateRecipeToV3,
  migrateRecipeToV2,
  createColorBlockV3,
  createAdjustmentRegionV3,
  parseSelectionMaskV3,
  getEditorParameter,
  setEditorParameter,
  V3_TOOLS,
  V2_TOOLS,
  RecipeValidationError,
  MAX_V3_PAINT_POINTS,
  type PaintLayerV3,
  type PaintStrokeV3,
} from '../src/index.js';
const stroke = (): PaintStrokeV3 => ({
  points: [{ x: 0.5, y: 0.5 }],
  radius: 0.05,
  feather: 0.5,
  opacity: 1,
  mode: 'paint',
  color: [20, 40, 60, 255],
  source: null,
});
const layer = (): PaintLayerV3 => ({
  id: 'paint',
  name: '绘制',
  enabled: true,
  opacity: 1,
  blendMode: 'soft-light',
  mask: null,
  strokes: [stroke()],
});

test('v3 creation owns defaults, round-trips strict JSON and never silently downgrades', () => {
  const r = createRecipeV3();
  r.transform.rotationDegrees = 12.34;
  r.regionEdits.push(createAdjustmentRegionV3({ id: 'local' }));
  assert.equal(createRecipeV3().transform.rotationDegrees, 0);
  assert.deepEqual(parseEditorRecipe(JSON.parse(JSON.stringify(r))), r);
  assert.throws(() => migrateRecipeToV2(r), /cannot be silently downgraded/);
  for (const old of [
    createRecipe({ adjustments: { exposure: 1.2 } }),
    createRecipeV2({ hsl: { blue: { hue: 12 } } }),
  ]) {
    const migrated = migrateRecipeToV3(old);
    assert.equal(migrated.schemaVersion, 3);
    assert.deepEqual(migrated.geometry, old.geometry);
    assert.deepEqual(migrated.adjustments, old.adjustments);
  }
});
test('v3 global registry exposes exact defaults and generic setters retain all extension data', () => {
  let r = createRecipeV3({
    paintLayers: [layer()],
    regionEdits: [createAdjustmentRegionV3({ id: 'one' })],
  });
  for (const t of V3_TOOLS) assert.equal(getEditorParameter(r, t.path), t.neutral);
  for (const path of [
    'adjustments.exposure',
    'hsl.blue.hue',
    'transform.rotationDegrees',
    'optics.aberrationRed',
  ]) {
    const next = setEditorParameter(r, path, 1);
    assert.equal(getEditorParameter(next, path), 1);
    assert.deepEqual(next.schemaVersion === 3 && next.paintLayers, r.paintLayers);
  }
  for (const t of V2_TOOLS) assert.equal(typeof getEditorParameter(r, t.path), 'number');
  assert.throws(() => setEditorParameter(r, '__proto__.polluted', 1), /unknown path/);
  assert.throws(
    () => getEditorParameter(createRecipe(), 'transform.rotationDegrees'),
    /unavailable/,
  );
});
test('v3 validation rejects unknown keys, invalid versions and incomplete color blocks', () => {
  const r = createRecipeV3();
  assert.throws(() => parseRecipeV3({ ...r, engineVersion: '3.0.1' }), /expected schemaVersion/);
  assert.throws(() => parseRecipeV3({ ...r, extra: 1 }), /unknown property/);
  const bad = structuredClone(r);
  bad.regionEdits = [createAdjustmentRegionV3()];
  delete (bad.regionEdits[0]!.color as unknown as Record<string, unknown>).optics;
  assert.equal(validateRecipeV3(bad).valid, false);
  assert.throws(() => createRecipeV3({ transform: { skewX: 45, skewY: 45 } }), /singular/);
  assert.throws(() => createRecipeV3({ optics: { denoiseChroma: NaN } }), RecipeValidationError);
});
test('v3 parser never executes accessors and rejects cycles, symbols, exotic prototypes and sparse arrays', () => {
  let calls = 0;
  const r = createRecipeV3(),
    bad = { ...r };
  Object.defineProperty(bad, 'transform', {
    get() {
      calls++;
      return r.transform;
    },
  });
  assert.throws(() => parseRecipeV3(bad));
  assert.equal(calls, 0);
  const cycle: any = { ...r };
  cycle.warp = cycle;
  assert.throws(() => parseRecipeV3(cycle), /acyclic/);
  assert.throws(() => parseRecipeV3({ ...r, transform: Object.create(r.transform) }));
  assert.throws(() => parseRecipeV3({ ...r, [Symbol('x')]: 1 }));
  const sparse = createRecipeV3();
  sparse.paintLayers = Array(1);
  assert.throws(() => parseRecipeV3(sparse), /sparse/);
});
test('groups reference unique explicit identities and have independent validated complete color blocks', () => {
  const c = createColorBlockV3({
    curves: {
      blue: [
        [0, 0.1],
        [1, 0.9],
      ],
    },
    hsl: { red: { saturation: -30 } },
    optics: { denoiseChroma: 22.5 },
  });
  const region = createAdjustmentRegionV3({ id: 'one', groupId: 'shared' });
  assert.throws(() => createRecipeV3({ regionEdits: [region] }), /unknown group/);
  const r = createRecipeV3({
    regionEdits: [region],
    regionGroups: [{ id: 'shared', name: '人物', enabled: true, opacity: 0.4, color: c }],
  });
  assert.equal(r.regionGroups[0]!.color.optics.denoiseChroma, 22.5);
  assert.throws(
    () =>
      createRecipeV3({
        regionEdits: [
          { ...region, groupId: null },
          { ...region, groupId: null },
        ],
      }),
    /duplicate/,
  );
});
test('operation provenance is bounded inert data and can carry a complete person control vector', () => {
  const full = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`value${i}`, i]));
  assert.deepEqual(
    createAdjustmentRegionV3({
      origin: { moduleId: 'm', instanceId: 'i', parameterId: 'p', value: 0, parameters: full },
    }).origin?.parameters,
    full,
  );
  assert.throws(() =>
    createAdjustmentRegionV3({
      origin: {
        moduleId: 'm',
        instanceId: 'i',
        parameterId: 'p',
        value: 0,
        parameters: { ...full, excess: 1 },
      },
    }),
  );
  const r = createAdjustmentRegionV3({
    origin: {
      moduleId: 'portrait',
      instanceId: 'face-1',
      parameterId: 'skin',
      value: 0,
      parameters: { soften: 42, temperature: -13 },
    },
  });
  assert.equal(r.origin?.parameters?.soften, 42);
  assert.throws(() =>
    createAdjustmentRegionV3({
      origin: {
        moduleId: 'a',
        instanceId: 'b',
        parameterId: 'c',
        value: 0,
        parameters: { x: Infinity },
      },
    }),
  );
  assert.throws(() =>
    createAdjustmentRegionV3({
      origin: {
        moduleId: 'a',
        instanceId: 'b',
        parameterId: 'c',
        value: 0,
        parameters: { x: 1e7 },
      },
    }),
  );
  assert.throws(() =>
    createAdjustmentRegionV3({
      origin: {
        moduleId: 'a',
        instanceId: 'b',
        parameterId: 'c',
        value: 0,
        parameters: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`p${i}`, 0])),
      },
    }),
  );
});
test('compound masks preserve discriminants and enforce depth, node and shape budgets', () => {
  const base = {
    type: 'radial' as const,
    centerX: 0.5,
    centerY: 0.5,
    radiusX: 0.2,
    radiusY: 0.3,
    feather: 0.5,
    invert: false,
  };
  const c = parseSelectionMaskV3({
    type: 'compound',
    operation: 'subtract',
    masks: [base, { type: 'brush', strokes: [], invert: false }],
    invert: false,
  });
  assert.equal(c.type, 'compound');
  let nested: any = base;
  for (let i = 0; i < 6; i++)
    nested = { type: 'compound', operation: 'union', masks: [base, nested], invert: false };
  assert.throws(() => parseSelectionMaskV3(nested), /budget/);
  assert.throws(
    () =>
      parseSelectionMaskV3({ type: 'compound', operation: 'xor', masks: [base], invert: false }),
    /2–8/,
  );
});
test('paint validation enforces alpha/channel, finite coordinates and clone origins before any rendering', () => {
  assert.throws(
    () =>
      createRecipeV3({
        paintLayers: [{ ...layer(), strokes: [{ ...stroke(), color: [1, 2, 3, 256] }] }],
      }),
    /color/,
  );
  assert.throws(
    () =>
      createRecipeV3({ paintLayers: [{ ...layer(), strokes: [{ ...stroke(), mode: 'clone' }] }] }),
    /required for clone/,
  );
  assert.throws(
    () => createRecipeV3({ paintLayers: [{ ...layer(), blendMode: 'made-up' as any }] }),
    /blend mode/,
  );
  const strokes = Array.from({ length: 9 }, () => ({
    ...stroke(),
    points: Array.from({ length: 1024 }, () => ({ x: 0.5, y: 0.5 })),
  }));
  assert(strokes.length * 1024 > MAX_V3_PAINT_POINTS);
  assert.throws(() => createRecipeV3({ paintLayers: [{ ...layer(), strokes }] }), /point budget/);
});
test('image layers use bounded resource identities and reject URL payloads and illegal dimensions', () => {
  const image = {
    id: 'overlay',
    name: '叠图',
    enabled: true,
    opacity: 1,
    blendMode: 'normal' as const,
    sourceId: 'asset-1',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotationDegrees: 0,
    flipX: false,
    flipY: false,
    mask: null,
  };
  assert.equal(createRecipeV3({ imageLayers: [image] }).imageLayers[0]!.sourceId, 'asset-1');
  assert.throws(
    () => createRecipeV3({ imageLayers: [{ ...image, sourceId: 'https://private.invalid/a' }] }),
    /identifier/,
  );
  assert.throws(() => createRecipeV3({ imageLayers: [{ ...image, width: 0 }] }), /width/);
  assert.throws(
    () => createRecipeV3({ imageLayers: [image], paintLayers: [{ ...layer(), id: 'overlay' }] }),
    /duplicate/,
  );
});
