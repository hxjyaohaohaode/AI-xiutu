import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV3,
  createColorBlockV3,
  createAdjustmentRegionV3,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  compileSelectionMaskV3,
  compileWarpFieldV3,
  blendRgbaV3,
  BLEND_MODES_V3,
  type RGBAImage,
  type PaintLayerV3,
  type PaintStrokeV3,
  type ImageLayerV3,
  type WarpStrokeV3,
  type SelectionMaskV3,
} from '../src/index.js';
const fixture = (w = 32, h = 24): RGBAImage => ({
  width: w,
  height: h,
  data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 37 + 5) % 256,
  ),
});
const solid = (r: number, g: number, b: number, a = 255, w = 16, h = 16): RGBAImage => ({
  width: w,
  height: h,
  data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => [r, g, b, a][i % 4]!),
});
const radial = (x = 0.5, y = 0.5, r = 0.25): SelectionMaskV3 => ({
  type: 'radial',
  centerX: x,
  centerY: y,
  radiusX: r,
  radiusY: r,
  feather: 0,
  invert: false,
});
const stroke = (overrides: Partial<PaintStrokeV3> = {}): PaintStrokeV3 => ({
  points: [{ x: 0.5, y: 0.5 }],
  radius: 0.1,
  feather: 0,
  opacity: 1,
  mode: 'paint',
  color: [255, 30, 50, 255],
  source: null,
  ...overrides,
});
const layer = (strokes: PaintStrokeV3[], overrides: Partial<PaintLayerV3> = {}): PaintLayerV3 => ({
  id: 'paint',
  name: '笔触',
  enabled: true,
  opacity: 1,
  blendMode: 'normal',
  mask: null,
  strokes,
  ...overrides,
});
const warp = (overrides: Partial<WarpStrokeV3> = {}): WarpStrokeV3 => ({
  id: 'push',
  mode: 'push',
  from: { x: 0.5, y: 0.5 },
  to: { x: 0.6, y: 0.5 },
  radius: 0.3,
  feather: 0.4,
  strength: 0.5,
  ...overrides,
});
const imageLayer = (overrides: Partial<ImageLayerV3> = {}): ImageLayerV3 => ({
  id: 'composite',
  name: '叠图',
  enabled: true,
  opacity: 1,
  blendMode: 'normal',
  sourceId: 'overlay',
  x: 0.25,
  y: 0.25,
  width: 0.5,
  height: 0.5,
  rotationDegrees: 0,
  flipX: false,
  flipY: false,
  mask: null,
  ...overrides,
});
const pixel = (img: RGBAImage, x: number, y: number) =>
  Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

test('compound union/intersection/subtract/xor combine multiple soft areas with bounded inversion', () => {
  const a = radial(0.3, 0.5, 0.3),
    b = radial(0.7, 0.5, 0.3),
    dim = { width: 100, height: 100 };
  const f = (operation: 'union' | 'intersection' | 'subtract' | 'xor') =>
    compileSelectionMaskV3({ type: 'compound', operation, masks: [a, b], invert: false }, dim);
  assert.equal(f('union')(0.3, 0.5), 1);
  assert.equal(f('union')(0.7, 0.5), 1);
  assert.equal(f('intersection')(0.3, 0.5), 0);
  assert.equal(f('intersection')(0.5, 0.5), 1);
  assert.equal(f('subtract')(0.3, 0.5), 1);
  assert.equal(f('subtract')(0.5, 0.5), 0);
  assert.equal(f('xor')(0.5, 0.5), 0);
  assert.equal(f('xor')(0.7, 0.5), 1);
  const inv = compileSelectionMaskV3(
    { type: 'compound', operation: 'union', masks: [a, b], invert: true },
    dim,
  );
  assert.equal(inv(0.5, 0.1), 1);
  assert.equal(inv(-0.1, 0.5), 0);
});
test('full regional curves, HSL and levels change only selected pixels and leave all exterior bytes untouched', () => {
  const source = fixture(),
    region = createAdjustmentRegionV3({
      id: 'curve',
      mask: radial(),
      color: {
        curves: {
          red: [
            [0, 1],
            [1, 0],
          ],
        },
        hsl: { blue: { saturation: -100 } },
        levels: { gamma: 1.3 },
      },
    });
  const out = renderEditorRecipe(source, createRecipeV3({ regionEdits: [region] })),
    mask = compileSelectionMaskV3(region.mask, source, source);
  let changed = 0;
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      if (mask((x + 0.5) / source.width, (y + 0.5) / source.height) === 0)
        assert.deepEqual(pixel(out, x, y), pixel(source, x, y));
      else if (JSON.stringify(pixel(out, x, y)) !== JSON.stringify(pixel(source, x, y))) changed++;
    }
  assert(changed > 0);
});
test('shared group correction is applied once across overlapping regions, with independent per-region edits afterwards', () => {
  const source = solid(70, 80, 90),
    color = createColorBlockV3({ adjustments: { exposure: 0.5 } }),
    a = createAdjustmentRegionV3({ id: 'a', groupId: 'g', mask: radial(0.4, 0.5, 0.4) }),
    b = createAdjustmentRegionV3({ id: 'b', groupId: 'g', mask: radial(0.6, 0.5, 0.4) });
  const grouped = createRecipeV3({
      regionEdits: [a, b],
      regionGroups: [{ id: 'g', name: '联动', enabled: true, opacity: 1, color }],
    }),
    union = createRecipeV3({
      regionEdits: [
        createAdjustmentRegionV3({
          mask: { type: 'compound', operation: 'union', masks: [a.mask, b.mask], invert: false },
          color,
        }),
      ],
    });
  assert.deepEqual(renderEditorRecipe(source, grouped), renderEditorRecipe(source, union));
  grouped.regionEdits[0]!.color.adjustments.tint = 40;
  assert.notDeepEqual(
    renderEditorRecipe(source, grouped).data,
    renderEditorRecipe(source, union).data,
  );
});
test('region and group enable/opacity controls are independent and zero is exact identity', () => {
  const source = fixture(),
    r = createRecipeV3({
      regionEdits: [
        createAdjustmentRegionV3({
          id: 'one',
          opacity: 0,
          color: { adjustments: { exposure: 2 } },
        }),
      ],
    });
  assert.deepEqual(renderEditorRecipe(source, r).data, source.data);
  r.regionEdits[0]!.opacity = 1;
  r.regionEdits[0]!.enabled = false;
  assert.deepEqual(renderEditorRecipe(source, r).data, source.data);
});
test('source-color selection is fixed to immutable input even after global color adjustments', () => {
  const source = solid(220, 20, 20),
    r = createRecipeV3({
      adjustments: { saturation: -100 },
      regionEdits: [
        createAdjustmentRegionV3({
          mask: {
            type: 'color-range',
            hue: 0,
            hueWidth: 20,
            saturationMin: 0.5,
            saturationMax: 1,
            luminanceMin: 0,
            luminanceMax: 1,
            feather: 0,
            invert: false,
          },
          color: { adjustments: { exposure: 1 } },
        }),
      ],
    });
  const base = renderEditorRecipe(source, createRecipeV3({ adjustments: { saturation: -100 } }));
  assert(renderEditorRecipe(source, r).data[0]! > base.data[0]!);
});
test('every declared blend mode is finite, alpha-correct and distinguishes representative colors', () => {
  const b = [60, 120, 190, 180],
    s = [210, 40, 100, 130],
    seen = new Set<string>();
  for (const mode of BLEND_MODES_V3) {
    const out = blendRgbaV3(b, s, mode, 0.7);
    assert(out.every((v) => Number.isFinite(v) && v >= 0 && v <= 255));
    assert(Math.abs(out[3]! - (130 * 0.7 + 180 * (1 - (130 / 255) * 0.7))) < 1e-10);
    seen.add(Array.from(out).join(','));
    assert.deepEqual(Array.from(blendRgbaV3(b, [10, 20, 30, 0], mode)), b);
  }
  assert(seen.size >= 14);
});
test('normal/multiply/screen/soft-light use their actual distinct equations, with transparent backdrops unaffected by blend choice', () => {
  assert.deepEqual(
    Array.from(blendRgbaV3([100, 100, 100, 255], [200, 200, 200, 255], 'normal')),
    [200, 200, 200, 255],
  );
  assert(
    Math.abs(
      blendRgbaV3([100, 100, 100, 255], [200, 200, 200, 255], 'multiply')[0]! - (100 * 200) / 255,
    ) < 1e-10,
  );
  assert(
    Math.abs(
      blendRgbaV3([100, 100, 100, 255], [200, 200, 200, 255], 'screen')[0]! -
        (100 + 200 - (100 * 200) / 255),
    ) < 1e-10,
  );
  for (const mode of BLEND_MODES_V3)
    assert.deepEqual(
      Array.from(blendRgbaV3([255, 0, 0, 0], [30, 50, 80, 255], mode)),
      [30, 50, 80, 255],
    );
  assert.notEqual(blendRgbaV3([100, 100, 100, 255], [200, 200, 200, 255], 'soft-light')[0], 200);
});
test('a half-pixel paint stroke controls exactly one RGBA pixel and leaves its neighbors byte-identical', () => {
  const source = solid(10, 20, 30, 255, 3, 3),
    r = createRecipeV3({
      paintLayers: [layer([stroke({ radius: 0.5 / 3, color: [100, 120, 140, 255] })])],
    });
  const out = renderEditorRecipe(source, r);
  assert.deepEqual(pixel(out, 1, 1), [100, 120, 140, 255]);
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++)
      if (x !== 1 || y !== 1) assert.deepEqual(pixel(out, x, y), pixel(source, x, y));
});
test('swept stylus coverage is invariant to linear resampling, preserves gaps and agrees across tile boundaries', () => {
  const source = solid(19, 31, 67, 255, 79, 61);
  const x0 = 0.073,
    y0 = 0.317,
    x1 = 0.503,
    y1 = 0.323;
  const separate = [
    { x: 0.781, y: 0.68 },
    { x: 0.934, y: 0.72 },
  ];
  function recipe(segments: number) {
    const points = Array.from({ length: segments + 1 }, (_, i) => ({
      x: x0 + ((x1 - x0) * i) / segments,
      y: y0 + ((y1 - y0) * i) / segments,
    }));
    return createRecipeV3({
      paintLayers: [
        layer([
          stroke({
            points: [...points, ...separate],
            radius: 0.103,
            feather: 0.23,
            opacity: 0.72,
            sampling: {
              algorithm: 'swept-v1',
              antialias: true,
              breaks: [points.length],
              pressure: [...points.map((_, i) => 0.09 + (0.82 * i) / segments), 0.6, 0.6],
            },
          }),
        ]),
      ],
    });
  }
  const sparse = renderEditorRecipe(source, recipe(1));
  assert.deepEqual(renderEditorRecipe(source, recipe(37)), sparse);
  for (const tileSize of [16, 19, 64])
    assert.deepEqual(renderEditorRecipeTiled(source, recipe(1), { tileSize }), sparse);
  for (let y = 0; y < source.height; y++)
    for (let x = 49; x < 55; x++)
      assert.deepEqual(pixel(sparse, x, y), pixel(source, x, y), 'no bridge across the pen gap');
  const count = (x: number) =>
    Array.from({ length: source.height }, (_, y) => y).filter((y) => pixel(sparse, x, y)[0] !== 19)
      .length;
  assert.ok(count(36) >= count(9) + 4, 'pressure changes actual pixel width');
  assert.ok(
    sparse.data.some((channel, i) => i % 4 === 0 && channel > 19 && channel < 189),
    'subpixel samples produce partial edge coverage',
  );
  assert.deepEqual(pixel(sparse, 64, 42)[3], 255);
});
test('paint opacity and isolated erasing do not erase the original image', () => {
  const source = solid(0, 0, 200, 255, 10, 10),
    r = createRecipeV3({
      paintLayers: [
        layer([
          stroke({ radius: 0.4, color: [200, 0, 0, 255] }),
          stroke({ radius: 0.2, mode: 'erase' }),
        ]),
      ],
    });
  const out = renderEditorRecipe(source, r);
  assert.deepEqual(pixel(out, 5, 5), [0, 0, 200, 255]);
  assert.deepEqual(pixel(out, 7, 5), [200, 0, 0, 255]);
  r.paintLayers[0]!.opacity = 0.5;
  const mixed = renderEditorRecipe(source, r);
  assert.deepEqual(pixel(mixed, 7, 5), [100, 0, 100, 255]);
});
test('clone strokes sample a fixed pre-paint source instead of repeatedly sampling already painted pixels', () => {
  const source = fixture(5, 1),
    r = createRecipeV3({
      paintLayers: [
        layer([
          stroke({
            points: [{ x: 0.5, y: 0.5 }],
            radius: 0.5,
            mode: 'clone',
            source: { x: 0.1, y: 0.5 },
            color: [0, 0, 0, 255],
          }),
          stroke({
            points: [{ x: 0.9, y: 0.5 }],
            radius: 0.5,
            mode: 'clone',
            source: { x: 0.5, y: 0.5 },
            color: [0, 0, 0, 255],
          }),
        ]),
      ],
    });
  const out = renderEditorRecipe(source, r);
  assert.deepEqual(pixel(out, 2, 0), pixel(source, 0, 0));
  assert.deepEqual(pixel(out, 4, 0), pixel(source, 2, 0));
});
test('paint mask, visibility and layer order are genuine non-destructive compositing controls', () => {
  const source = solid(50, 50, 50),
    a = layer([stroke({ radius: 0.4, color: [255, 0, 0, 255] })], {
      id: 'a',
      mask: radial(0.4, 0.5, 0.2),
    }),
    b = layer([stroke({ radius: 0.4, color: [0, 255, 0, 255] })], { id: 'b', enabled: false });
  const r = createRecipeV3({ paintLayers: [a, b] }),
    before = renderEditorRecipe(source, r);
  assert.deepEqual(pixel(before, 0, 0), pixel(source, 0, 0));
  assert.deepEqual(pixel(before, 6, 8), [255, 0, 0, 255]);
  r.paintLayers[1]!.enabled = true;
  assert.deepEqual(pixel(renderEditorRecipe(source, r), 6, 8), [0, 255, 0, 255]);
});
test('image layers resolve explicit pixels and perform placement, scale, alpha, masking and rotation', () => {
  const source = solid(0, 0, 200),
    overlay = solid(200, 30, 0, 255, 4, 4),
    images = new Map([['overlay', overlay]]),
    r = createRecipeV3({ imageLayers: [imageLayer()] });
  assert.throws(() => renderEditorRecipe(source, r), /Missing resolved/);
  const out = renderEditorRecipe(source, r, { images });
  assert.deepEqual(pixel(out, 0, 0), pixel(source, 0, 0));
  assert.deepEqual(pixel(out, 8, 8), [200, 30, 0, 255]);
  r.imageLayers[0]!.opacity = 0.5;
  assert.deepEqual(pixel(renderEditorRecipe(source, r, { images }), 8, 8), [100, 15, 100, 255]);
  r.imageLayers[0]!.rotationDegrees = 45;
  assert.notDeepEqual(renderEditorRecipe(source, r, { images }).data, out.data);
});
test('disabled image layers never trigger resolution and can be retained without a fake output', () => {
  const source = fixture(),
    r = createRecipeV3({ imageLayers: [imageLayer({ enabled: false })] });
  assert.deepEqual(renderEditorRecipe(source, r).data, source.data);
});
test('warp has signed compact support and distinct push, pinch, bulge and twirl fields', () => {
  const dimensions = { width: 100, height: 100 },
    w = warp(),
    f = compileWarpFieldV3({ enabled: true, strokes: [w], protection: null }, dimensions);
  assert.deepEqual(f({ x: 0, y: 0 }), { x: 0, y: 0 });
  assert(f({ x: 0.5, y: 0.5 }).x < 0.5);
  const reversed = compileWarpFieldV3(
    { enabled: true, strokes: [{ ...w, strength: -w.strength }], protection: null },
    dimensions,
  );
  assert(reversed({ x: 0.5, y: 0.5 }).x > 0.5);
  const values = ['push', 'pinch', 'bulge', 'twirl'].map((mode) =>
    compileWarpFieldV3(
      { enabled: true, strokes: [warp({ mode: mode as WarpStrokeV3['mode'] })], protection: null },
      dimensions,
    )({ x: 0.6, y: 0.5 }),
  );
  assert.equal(new Set(values.map((v) => JSON.stringify(v))).size, 4);
});
test('warp protection locks selected background pixels exactly, including alpha and hidden RGB', () => {
  const source = fixture(),
    protection = radial(0.5, 0.5, 0.2),
    r = createRecipeV3({ warp: { strokes: [warp({ strength: 1, radius: 0.5 })], protection } }),
    out = renderEditorRecipe(source, r),
    mask = compileSelectionMaskV3(protection, source);
  let changed = 0;
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      if (mask((x + 0.5) / source.width, (y + 0.5) / source.height) === 1)
        assert.deepEqual(pixel(out, x, y), pixel(source, x, y));
      else if (JSON.stringify(pixel(out, x, y)) !== JSON.stringify(pixel(source, x, y))) changed++;
    }
  assert(changed > 0);
});
test('zero or disabled warp remains byte-identical and off-region pixels are not resampled', () => {
  const source = fixture(),
    r = createRecipeV3({ warp: { strokes: [warp({ strength: 0 })] } });
  assert.deepEqual(renderEditorRecipe(source, r).data, source.data);
  r.warp.strokes[0]!.strength = 1;
  r.warp.enabled = false;
  assert.deepEqual(renderEditorRecipe(source, r).data, source.data);
});
test('luminance and chroma denoising operate independently, preserve flat fields and alpha', () => {
  for (const optics of [{ denoiseLuminance: 100 }, { denoiseChroma: 100 }]) {
    const source = solid(100, 120, 150, 180);
    assert.deepEqual(renderEditorRecipe(source, createRecipeV3({ optics })).data, source.data);
  }
  const source = solid(128, 128, 128, 255, 9, 9),
    at = (4 * 9 + 4) * 4;
  source.data[at] = source.data[at + 1] = source.data[at + 2] = 170;
  const lum = renderEditorRecipe(source, createRecipeV3({ optics: { denoiseLuminance: 100 } })),
    chroma = renderEditorRecipe(source, createRecipeV3({ optics: { denoiseChroma: 100 } }));
  assert(lum.data[at]! < 170);
  assert.equal(chroma.data[at], 170);
});
test('signed chromatic aberration shifts the chosen channel without changing alpha or other channels', () => {
  const source = fixture(20, 10),
    r = createRecipeV3({ optics: { aberrationRed: 3 } }),
    out = renderEditorRecipe(source, r),
    reverse = renderEditorRecipe(source, createRecipeV3({ optics: { aberrationRed: -3 } }));
  assert.notDeepEqual(out.data, source.data);
  assert.notDeepEqual(out.data, reverse.data);
  for (let i = 0; i < source.data.length; i++)
    if (i % 4 !== 0) assert.equal(out.data[i], source.data[i]);
});
test('all new source-space stages have identical full/tiled output across non-dividing tile edges and preserve input ownership', () => {
  const source = fixture(53, 37),
    copy = new Uint8ClampedArray(source.data),
    overlay = solid(70, 110, 160, 150, 10, 6),
    images = new Map([['overlay', overlay]]);
  const r = createRecipeV3({
    adjustments: { exposure: 0.2 },
    optics: { denoiseChroma: 17, aberrationBlue: -1.4 },
    regionEdits: [
      createAdjustmentRegionV3({
        color: {
          curves: {
            red: [
              [0, 0],
              [0.45, 0.6],
              [1, 1],
            ],
          },
          detail: { texture: 20, clarity: -12 },
        },
        mask: {
          type: 'compound',
          operation: 'subtract',
          masks: [radial(0.5, 0.5, 0.45), radial(0.5, 0.5, 0.1)],
          invert: false,
        },
      }),
    ],
    paintLayers: [
      layer(
        [
          stroke({
            points: [
              { x: 0.1, y: 0.2 },
              { x: 0.8, y: 0.6 },
            ],
            feather: 0.7,
            opacity: 0.4,
          }),
        ],
        { blendMode: 'soft-light' },
      ),
    ],
    imageLayers: [imageLayer({ rotationDegrees: 22, opacity: 0.3 })],
    warp: { strokes: [warp()] },
    transform: { rotationDegrees: 17.25, perspectiveY: 9 },
    geometry: { crop: { x: 0.1, y: 0.05, width: 0.8, height: 0.9 }, rotation: 90, flipX: true },
  });
  const frozen = JSON.stringify(r),
    expected = renderEditorRecipe(source, r, { images });
  for (const tileSize of [16, 23, 32])
    assert.deepEqual(renderEditorRecipeTiled(source, r, { tileSize, images }), expected);
  assert.deepEqual(source.data, copy);
  assert.equal(JSON.stringify(r), frozen);
});

test('spatial brush indexing preserves continuous capsules and does not build up opacity from denser samples', () => {
  const source = fixture(80, 60),
    points = Array.from({ length: 101 }, (_, i) => ({
      x: 0.1 + (0.8 * i) / 100,
      y: 0.2 + (0.6 * i) / 100,
    }));
  const a = createRecipeV3({
    paintLayers: [
      layer([
        stroke({ points: [points[0]!, points.at(-1)!], radius: 0.017, opacity: 0.6, feather: 0.5 }),
      ]),
    ],
  });
  const b = createRecipeV3({
    paintLayers: [layer([stroke({ points, radius: 0.017, opacity: 0.6, feather: 0.5 })])],
  });
  assert.deepEqual(renderEditorRecipe(source, a), renderEditorRecipe(source, b));
});
test('paint workload admission rejects excessive paths before any image-sized byte allocation', () => {
  const source = fixture(800, 800),
    recipe = createRecipeV3({
      paintLayers: [
        layer([
          stroke({
            radius: 0.5,
            points: Array.from({ length: 1024 }, (_, i) => ({ x: i % 2 ? 0.8 : 0.2, y: 0.5 })),
          }),
        ]),
      ],
    });
  const Original = globalThis.Uint8ClampedArray;
  let byteAllocations = 0;
  globalThis.Uint8ClampedArray = new Proxy(Original, {
    construct(target, args) {
      byteAllocations++;
      return Reflect.construct(target, args);
    },
  });
  try {
    assert.throws(() => renderEditorRecipe(source, recipe), /Paint workload budget/);
    assert.equal(byteAllocations, 0);
  } finally {
    globalThis.Uint8ClampedArray = Original;
  }
});
test('reusing one immutable image source in several layers counts its pixels once', () => {
  const source = fixture(3, 2),
    asset = { width: 4096, height: 2048, data: new Uint8ClampedArray(4096 * 2048 * 4) },
    recipe = createRecipeV3({
      imageLayers: Array.from({ length: 8 }, (_, i) => imageLayer({ id: `instance-${i}` })),
    });
  const rendered = renderEditorRecipe(source, recipe, {
    maxPixels: 16_777_216,
    images: new Map([['overlay', asset]]),
  });
  assert.deepEqual(rendered.data, source.data);
});
test('tiled v3 allocates only tile-sized Float32 buffers even across local color and paint layers', () => {
  const source = fixture(150, 100),
    r = createRecipeV3({
      regionEdits: [createAdjustmentRegionV3({ color: { detail: { clarity: 20 } } })],
      paintLayers: [layer([stroke()])],
    });
  const Original = globalThis.Float32Array,
    allocations: number[] = [];
  globalThis.Float32Array = new Proxy(Original, {
    construct(target, args) {
      if (typeof args[0] === 'number') allocations.push(args[0]);
      return Reflect.construct(target, args);
    },
  });
  try {
    renderEditorRecipeTiled(source, r, { tileSize: 16 });
  } finally {
    globalThis.Float32Array = Original;
  }
  assert(allocations.length >= 5);
  assert(allocations.every((n) => n < source.width * source.height * 3));
});
test('a real worker exports v3 source layers, regional edits and geometry byte-identically to the main-thread reference', async () => {
  const { Worker } = await import('node:worker_threads');
  const source = fixture(45, 31),
    overlay = solid(100, 40, 210, 170, 9, 7),
    r = createRecipeV3({
      imageLayers: [imageLayer({ rotationDegrees: 32 })],
      regionEdits: [createAdjustmentRegionV3({ color: { adjustments: { exposure: 0.4 } } })],
      paintLayers: [layer([stroke({ feather: 0.7 })])],
      warp: { strokes: [warp()] },
      transform: { rotationDegrees: -14.9 },
    }),
    images = new Map([['overlay', overlay]]),
    expected = renderEditorRecipe(source, r, { images });
  const worker = new Worker(new URL('./v3-worker.mjs', import.meta.url), {
    execArgv: ['--import', 'tsx'],
  });
  try {
    const result = new Promise<RGBAImage>((resolve, reject) => {
      worker.once('error', reject);
      worker.once(
        'message',
        (m: { error?: string; width: number; height: number; buffer: ArrayBuffer }) =>
          m.error
            ? reject(new Error(m.error))
            : resolve({ width: m.width, height: m.height, data: new Uint8ClampedArray(m.buffer) }),
      );
    });
    const buffer = source.data.slice().buffer;
    worker.postMessage(
      {
        width: source.width,
        height: source.height,
        buffer,
        recipe: r,
        images: [
          [
            'overlay',
            { width: overlay.width, height: overlay.height, buffer: overlay.data.slice().buffer },
          ],
        ],
      },
      [buffer],
    );
    assert.deepEqual(await result, expected);
  } finally {
    await worker.terminate();
  }
});
