import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import {
  HSL_BANDS,
  RenderAbortedError,
  createRecipe,
  createRecipeV2,
  createAdjustmentRegionV2,
  createRasterMask,
  migrateRecipeToV2,
  renderRecipe,
  renderRecipeTiled,
  renderRecipeV2,
  renderRecipeV2Tiled,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  recipeV2Halo,
  getOutputDimensions,
  V2_TOOLS,
  setRecipeV2Parameter,
} from '../src/index.js';
import type { Geometry, RecipeV2, RGBAImage, SelectionMaskV2 } from '../src/index.js';

function image(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly number[],
): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const grey = (values: number[]) =>
  image(values.length, 1, (x) => [values[x]!, values[x]!, values[x]!, 255]);
const red = (value: RGBAImage) =>
  Array.from({ length: value.width * value.height }, (_, i) => value.data[i * 4]!);
const close = (actual: number, expected: number, tolerance = 1) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
const equal = (a: RGBAImage, b: RGBAImage, label = '') => {
  assert.equal(a.width, b.width, label);
  assert.equal(a.height, b.height, label);
  assert.deepEqual(a.data, b.data, label);
};
const pattern = (width: number, height: number) =>
  image(width, height, (x, y) => [
    (x * 13 + y * 7) % 256,
    (x * 43 + y * 5 + 21) % 256,
    (x * 3 + y * 37 + 45) % 256,
    (x + y) % 13 === 0 ? 0 : (x * 3 + y) % 7 === 0 ? 97 : 255,
  ]);
const all: SelectionMaskV2 = { type: 'brush', strokes: [], invert: true };

function rich(): RecipeV2 {
  return createRecipeV2({
    adjustments: {
      exposure: 0.2,
      temperature: -8,
      contrast: 13,
      saturation: 10,
      sharpness: 22,
      soften: 14,
    },
    curves: {
      rgb: [
        [0, 0],
        [0.22, 0.16],
        [0.7, 0.78],
        [1, 1],
      ],
      green: [
        [0, 0.03],
        [1, 0.98],
      ],
    },
    local: {
      enabled: true,
      mask: { centerX: 0.4, radiusX: 0.3, feather: 0.8 },
      adjustments: { exposure: -0.3, soften: 28 },
    },
    levels: {
      inputBlack: 0.02,
      inputWhite: 0.97,
      gamma: 1.15,
      outputBlack: 0.01,
      outputWhite: 0.99,
    },
    hsl: {
      red: { hue: 11, saturation: -15 },
      blue: { hue: -17, lightness: 13 },
      magenta: { saturation: 12 },
    },
    grading: {
      shadows: { hue: 215, saturation: 18, luminance: 3 },
      midtones: { hue: 31, saturation: 9 },
      highlights: { hue: 49, saturation: 11, luminance: -4 },
      balance: 12,
    },
    detail: { texture: 29, clarity: -19 },
    effects: {
      monochrome: 6,
      fade: 8,
      vignette: { amount: 17, centerX: 0.43, radiusX: 0.61, feather: 0.6 },
      grain: { amount: 17, size: 3, seed: 123456, colored: true },
    },
    regions: [
      createAdjustmentRegionV2({
        id: 'linear',
        opacity: 0.7,
        mask: {
          type: 'linear',
          start: { x: 0.1, y: 0.2 },
          end: { x: 0.8, y: 0.9 },
          smooth: true,
          invert: false,
        },
        adjustments: { exposure: 0.15, sharpness: 30 },
      }),
      createAdjustmentRegionV2({
        id: 'polygon',
        mask: {
          type: 'polygon',
          points: [
            { x: 0.1, y: 0.3 },
            { x: 0.8, y: 0.2 },
            { x: 0.6, y: 0.9 },
          ],
          feather: 0.04,
          invert: false,
        },
        adjustments: { temperature: 11, soften: 36 },
      }),
      createAdjustmentRegionV2({
        id: 'brush',
        mask: {
          type: 'brush',
          strokes: [
            {
              points: [
                { x: 0.15, y: 0.7 },
                { x: 0.75, y: 0.4 },
              ],
              radius: 0.15,
              feather: 0.7,
              opacity: 0.8,
              mode: 'add',
            },
          ],
          invert: false,
        },
        adjustments: { brightness: 13, sharpness: 20 },
      }),
      createAdjustmentRegionV2({
        id: 'raster',
        mask: createRasterMask(3, 2, Uint8Array.of(0, 127, 255, 255, 0, 64)),
        adjustments: { tint: -12, soften: 19 },
      }),
      createAdjustmentRegionV2({
        id: 'color',
        mask: {
          type: 'color-range',
          hue: 17,
          hueWidth: 55,
          saturationMin: 0.05,
          saturationMax: 1,
          luminanceMin: 0.1,
          luminanceMax: 0.9,
          feather: 0.2,
          invert: false,
        },
        adjustments: { brightness: 9 },
      }),
    ],
  });
}

test('default v2 is an exact RGBA identity and migrated v1 replays byte-for-byte in both renderers', () => {
  const bytes = image(256, 2, (x, y) => [x, 255 - x, (x * 19) % 256, y === 0 ? x : 255]);
  equal(renderRecipeV2(bytes, createRecipeV2()), bytes);
  const old = createRecipe({
    adjustments: {
      exposure: 0.45,
      brightness: -9,
      contrast: 17,
      saturation: 18,
      soften: 22,
      sharpness: 34,
    },
    curves: {
      red: [
        [0, 0.03],
        [0.5, 0.6],
        [1, 1],
      ],
    },
    geometry: { crop: { x: 0.13, y: 0, width: 0.72, height: 1 }, rotation: 270, flipX: true },
    local: {
      enabled: true,
      mask: { feather: 0.8, invert: true },
      adjustments: { exposure: -0.2, soften: 41 },
    },
  });
  const migrated = migrateRecipeToV2(old);
  const expected = renderRecipe(bytes, old);
  equal(renderRecipeV2(bytes, migrated), expected);
  equal(renderRecipeV2Tiled(bytes, migrated, { tileSize: 17 }), expected);
  equal(renderEditorRecipe(bytes, old), expected);
  equal(
    renderEditorRecipeTiled(bytes, old, { tileSize: 17 }),
    renderRecipeTiled(bytes, old, { tileSize: 17 }),
  );
});

test('levels independently set input endpoints, gamma direction and output endpoints', () => {
  const source = grey([0, 51, 102, 153, 204, 255]);
  const changed = renderRecipeV2(
    source,
    createRecipeV2({ levels: { inputBlack: 0.2, inputWhite: 0.8 } }),
  );
  red(changed).forEach((value, i) => close(value, [0, 0, 85, 170, 255, 255][i]!));
  close(red(renderRecipeV2(grey([64]), createRecipeV2({ levels: { gamma: 2 } })))[0]!, 128);
  close(red(renderRecipeV2(grey([128]), createRecipeV2({ levels: { gamma: 0.5 } })))[0]!, 64);
  const output = red(
    renderRecipeV2(
      grey([0, 255]),
      createRecipeV2({ levels: { outputBlack: 0.1, outputWhite: 0.9 } }),
    ),
  );
  close(output[0]!, 26);
  close(output[1]!, 230);
  assert.deepEqual(
    red(renderRecipeV2(source, createRecipeV2({ levels: { outputBlack: 0.4, outputWhite: 0.4 } }))),
    [102, 102, 102, 102, 102, 102],
  );
});

test('each of eight HSL bands has real signed hue, saturation and lightness behavior without recoloring grey', () => {
  const colors = [
    [255, 0, 0],
    [255, 128, 0],
    [255, 255, 0],
    [0, 255, 0],
    [0, 255, 255],
    [0, 0, 255],
    [128, 0, 255],
    [255, 0, 255],
  ];
  for (let i = 0; i < HSL_BANDS.length; i += 1) {
    const band = HSL_BANDS[i]!.id,
      source = image(2, 1, (x) => (x === 0 ? [...colors[i]!, 255] : [128, 128, 128, 255]));
    for (const field of ['hue', 'saturation', 'lightness'] as const) {
      const amount = field === 'hue' ? 20 : 50;
      const plus = renderRecipeV2(
        source,
        setRecipeV2Parameter(createRecipeV2(), `hsl.${band}.${field}`, amount),
      );
      const minus = renderRecipeV2(
        source,
        setRecipeV2Parameter(createRecipeV2(), `hsl.${band}.${field}`, -amount),
      );
      // Fully saturated primary colors cannot become more saturated, but the
      // negative setting still changes them and both directions remain distinct.
      assert.notDeepEqual(plus.data.subarray(0, 3), minus.data.subarray(0, 3), `${band}.${field}`);
      assert.deepEqual(plus.data.subarray(4), source.data.subarray(4));
      assert.deepEqual(minus.data.subarray(4), source.data.subarray(4));
    }
  }
  const redBlue = image(2, 1, (x) => (x ? [0, 0, 255, 255] : [255, 0, 0, 255]));
  assert.deepEqual(
    Array.from(renderRecipeV2(redBlue, createRecipeV2({ hsl: { red: { hue: 60 } } })).data),
    [255, 255, 0, 255, 0, 0, 255, 255],
  );
  assert.deepEqual(
    Array.from(
      renderRecipeV2(redBlue, createRecipeV2({ hsl: { red: { hue: -60 } } })).data.subarray(0, 4),
    ),
    [255, 0, 255, 255],
  );
});

test('HSL interpolation is continuous across hue zero and stable at extreme dark levels', () => {
  const edge = image(2, 1, (x) => (x ? [255, 4, 0, 255] : [255, 0, 4, 255]));
  const output = renderRecipeV2(edge, createRecipeV2({ hsl: { red: { saturation: -50 } } }));
  close(output.data[0]!, output.data[4]!, 2);
  close(output.data[1]!, output.data[6]!, 2);
  close(output.data[2]!, output.data[5]!, 2);
  const tiny = renderRecipeV2(
    image(1, 1, () => [1, 0, 0, 255]),
    createRecipeV2({
      levels: { gamma: 0.1 },
      hsl: { red: { hue: 60, saturation: 100, lightness: 100 } },
    }),
  );
  assert.deepEqual(Array.from(tiny.data), [0, 0, 0, 255]);
});

test('three-way color grading and split-tone settings affect the intended tonal weights', () => {
  const source = grey([32, 128, 224]);
  const blueShadows = renderRecipeV2(
    source,
    createRecipeV2({ grading: { shadows: { hue: 240, saturation: 80 } } }),
  );
  assert.ok(blueShadows.data[2]! > blueShadows.data[0]!);
  assert.deepEqual(blueShadows.data.subarray(8), source.data.subarray(8));
  const greenMids = renderRecipeV2(
    source,
    createRecipeV2({ grading: { midtones: { hue: 120, saturation: 80 } } }),
  );
  assert.ok(greenMids.data[5]! > greenMids.data[4]!);
  const warmHighlights = renderRecipeV2(
    source,
    createRecipeV2({ grading: { highlights: { hue: 30, saturation: 80 } } }),
  );
  assert.ok(warmHighlights.data[8]! > warmHighlights.data[10]!);
  const bright = renderRecipeV2(
    source,
    createRecipeV2({ grading: { midtones: { luminance: 30 } } }),
  );
  const dark = renderRecipeV2(
    source,
    createRecipeV2({ grading: { midtones: { luminance: -30 } } }),
  );
  assert.ok(bright.data[4]! > source.data[4]! && dark.data[4]! < source.data[4]!);
  const shifted = renderRecipeV2(
    source,
    createRecipeV2({ grading: { shadows: { hue: 240, saturation: 80 }, balance: 100 } }),
  );
  assert.notDeepEqual(shifted.data, blueShadows.data);
  equal(
    renderRecipeV2(source, createRecipeV2({ grading: { balance: 100, shadows: { hue: 280 } } })),
    source,
  );
});

test('monochrome and fade have separate linear-luminance and encoded-range semantics', () => {
  const color = image(1, 1, () => [255, 0, 0, 191]);
  const output = renderRecipeV2(color, createRecipeV2({ effects: { monochrome: 100 } }));
  assert.equal(output.data[0], output.data[1]);
  assert.equal(output.data[1], output.data[2]);
  close(output.data[0]!, 127);
  assert.equal(output.data[3], 191);
  assert.deepEqual(
    red(renderRecipeV2(grey([0, 255]), createRecipeV2({ effects: { fade: 100 } }))),
    [31, 224],
  );
});

test('vignette has signed exposure, adjustable source-space center/radii and a neutral interior', () => {
  const source = image(9, 9, () => [128, 128, 128, 255]);
  const base = createRecipeV2({
    effects: { vignette: { radiusX: 0.4, radiusY: 0.4, feather: 0.5, amount: 70 } },
  });
  const dark = renderRecipeV2(source, base),
    bright = renderRecipeV2(
      source,
      createRecipeV2({
        ...base,
        effects: { ...base.effects, vignette: { ...base.effects.vignette, amount: -70 } },
      }),
    );
  assert.ok(dark.data[0]! < 128 && bright.data[0]! > 128);
  assert.equal(dark.data[(4 * 9 + 4) * 4], 128);
  const shifted = renderRecipeV2(
    source,
    createRecipeV2({
      ...base,
      effects: { ...base.effects, vignette: { ...base.effects.vignette, centerX: 0.1 } },
    }),
  );
  assert.notDeepEqual(shifted.data, dark.data);
});

test('grain is deterministic by source coordinate and seed, has real size/color modes and leaves alpha intact', () => {
  const source = image(23, 17, (x, y) => [128, 128, 128, (x + y) % 5 ? 255 : 0]);
  const recipe = createRecipeV2({ effects: { grain: { amount: 65, seed: 11, size: 2 } } });
  const first = renderRecipeV2(source, recipe);
  equal(first, renderRecipeV2(source, recipe));
  assert.notDeepEqual(
    first.data,
    renderRecipeV2(
      source,
      createRecipeV2({
        ...recipe,
        effects: { ...recipe.effects, grain: { ...recipe.effects.grain, seed: 12 } },
      }),
    ).data,
  );
  assert.notDeepEqual(
    first.data,
    renderRecipeV2(
      source,
      createRecipeV2({
        ...recipe,
        effects: { ...recipe.effects, grain: { ...recipe.effects.grain, size: 5 } },
      }),
    ).data,
  );
  const colored = renderRecipeV2(
    source,
    createRecipeV2({
      ...recipe,
      effects: { ...recipe.effects, grain: { ...recipe.effects.grain, colored: true } },
    }),
  );
  let differentChannels = false;
  for (let i = 0; i < first.data.length; i += 4) {
    assert.equal(first.data[i + 3], source.data[i + 3]);
    assert.equal(first.data[i], first.data[i + 1]);
    assert.equal(first.data[i + 1], first.data[i + 2]);
    if (source.data[i + 3] === 0)
      assert.deepEqual(first.data.subarray(i, i + 4), source.data.subarray(i, i + 4));
    else if (colored.data[i] !== colored.data[i + 1]) differentChannels = true;
  }
  assert.ok(differentChannels);
  equal(
    renderRecipeV2(
      source,
      createRecipeV2({
        effects: { grain: { amount: 0, seed: 4294967295, size: 32, colored: true } },
      }),
    ),
    source,
  );
});

test('texture and clarity are signed, spatially distinct, flat-preserving and alpha-weighted', () => {
  const source = image(7, 7, (x, y) => [
    x === 3 && y === 3 ? 144 : 128,
    x === 3 && y === 3 ? 144 : 128,
    x === 3 && y === 3 ? 144 : 128,
    255,
  ]);
  const at = (3 * 7 + 3) * 4;
  for (const field of ['texture', 'clarity'] as const) {
    assert.ok(
      renderRecipeV2(source, createRecipeV2({ detail: { [field]: 80 } })).data[at]! >
        source.data[at]!,
    );
    assert.ok(
      renderRecipeV2(source, createRecipeV2({ detail: { [field]: -80 } })).data[at]! <
        source.data[at]!,
    );
    const flat = image(7, 7, () => [128, 128, 128, 255]);
    equal(renderRecipeV2(flat, createRecipeV2({ detail: { [field]: 100 } })), flat);
  }
  const offset = image(7, 7, (x, y) =>
    x === 5 && y === 3 ? [230, 230, 230, 255] : [128, 128, 128, 255],
  );
  assert.equal(renderRecipeV2(offset, createRecipeV2({ detail: { texture: 100 } })).data[at], 128);
  assert.ok(renderRecipeV2(offset, createRecipeV2({ detail: { clarity: 100 } })).data[at]! < 128);
  const hidden = image(7, 7, (x, y) =>
    x === 5 && y === 3 ? [255, 0, 255, 0] : [128, 128, 128, 255],
  );
  equal(renderRecipeV2(hidden, createRecipeV2({ detail: { texture: 100, clarity: 100 } })), hidden);
});

test('every manual mask type produces a real local edit with exact zero-weight outside preservation', () => {
  const source = image(11, 9, () => [100, 110, 120, 255]);
  const masks: SelectionMaskV2[] = [
    {
      type: 'radial',
      centerX: 0.5,
      centerY: 0.5,
      radiusX: 0.2,
      radiusY: 0.2,
      feather: 0.3,
      invert: false,
    },
    { type: 'linear', start: { x: 0.3, y: 0 }, end: { x: 0.7, y: 0 }, smooth: true, invert: false },
    {
      type: 'polygon',
      points: [
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.3 },
        { x: 0.5, y: 0.8 },
      ],
      feather: 0,
      invert: false,
    },
    {
      type: 'brush',
      strokes: [
        {
          points: [
            { x: 0.4, y: 0.5 },
            { x: 0.6, y: 0.5 },
          ],
          radius: 0.15,
          feather: 0.5,
          opacity: 1,
          mode: 'add',
        },
      ],
      invert: false,
    },
    createRasterMask(
      11,
      9,
      Uint8Array.from({ length: 99 }, (_, index) => (index === 49 ? 255 : 0)),
    ),
  ];
  for (const mask of masks) {
    const recipe = createRecipeV2({
      regions: [createAdjustmentRegionV2({ mask, adjustments: { exposure: 1, soften: 40 } })],
    });
    const result = renderRecipeV2(source, recipe);
    assert.deepEqual(result.data.subarray(0, 4), source.data.subarray(0, 4), mask.type);
    assert.ok(result.data[49 * 4]! > source.data[49 * 4]!, mask.type);
  }
});

test('ordered regions, opacity, disabled state and invert retain real independent semantics', () => {
  const source = grey([80, 128, 192]);
  const a = createAdjustmentRegionV2({ id: 'a', mask: all, adjustments: { exposure: 1 } });
  const b = createAdjustmentRegionV2({ id: 'b', mask: all, adjustments: { brightness: 40 } });
  assert.notDeepEqual(
    renderRecipeV2(source, createRecipeV2({ regions: [a, b] })).data,
    renderRecipeV2(source, createRecipeV2({ regions: [b, a] })).data,
  );
  equal(
    renderRecipeV2(
      source,
      createRecipeV2({
        regions: [
          { ...a, enabled: false },
          { ...b, opacity: 0 },
        ],
      }),
    ),
    source,
  );
  const half = renderRecipeV2(source, createRecipeV2({ regions: [{ ...a, opacity: 0.5 }] }));
  const full = renderRecipeV2(source, createRecipeV2({ regions: [a] }));
  assert.ok(half.data[0]! > source.data[0]! && half.data[0]! < full.data[0]!);
});

test('a real one-pixel edit preserves every exterior RGBA byte and ignores transparent neighbor colors', () => {
  const source = image(13, 9, (x, y) =>
    x === 7 && y === 4
      ? [255, 0, 255, 0]
      : [70 + (x % 3) * 7, 80 + (y % 2) * 9, 93, x === 6 && y === 4 ? 127 : 255],
  );
  const mask: SelectionMaskV2 = {
    type: 'brush',
    strokes: [
      {
        points: [{ x: 6.5 / 13, y: 4.5 / 9 }],
        radius: 0.5 / 9,
        feather: 0,
        opacity: 1,
        mode: 'add',
      },
    ],
    invert: false,
  };
  const recipe = createRecipeV2({
    regions: [
      createAdjustmentRegionV2({ mask, adjustments: { exposure: 0.7, soften: 70, sharpness: 15 } }),
    ],
  });
  const output = renderRecipeV2(source, recipe),
    at = (4 * 13 + 6) * 4;
  assert.notDeepEqual(output.data.subarray(at, at + 3), source.data.subarray(at, at + 3));
  assert.equal(output.data[at + 3], 127);
  for (let index = 0; index < output.data.length; index += 1) {
    if (index < at || index >= at + 3)
      assert.equal(output.data[index], source.data[index], `exterior byte ${index}`);
  }
  const alternate = { ...source, data: source.data.slice() };
  alternate.data.set([0, 255, 0], (4 * 13 + 7) * 4);
  const other = renderRecipeV2(alternate, recipe);
  assert.deepEqual(other.data.subarray(at, at + 4), output.data.subarray(at, at + 4));
  equal(renderRecipeV2Tiled(source, recipe, { tileSize: 16 }), output);
});

test('continuous color-range remains bound to unmodified source pixels after global and prior regional edits', () => {
  const source = image(2, 1, (x) => (x ? [20, 20, 180, 255] : [180, 20, 20, 255]));
  const mask: SelectionMaskV2 = {
    type: 'color-range',
    hue: 0,
    hueWidth: 10,
    saturationMin: 0.2,
    saturationMax: 1,
    luminanceMin: 0,
    luminanceMax: 1,
    feather: 0,
    invert: false,
  };
  const base = createRecipeV2({ hsl: { red: { hue: 60 } } });
  const result = renderRecipeV2(
    source,
    createRecipeV2({
      ...base,
      regions: [createAdjustmentRegionV2({ mask, adjustments: { exposure: 1 } })],
    }),
  );
  const global = renderRecipeV2(source, base);
  assert.ok(result.data[0]! > global.data[0]! && result.data[1]! > global.data[1]!);
  assert.deepEqual(result.data.subarray(4), global.data.subarray(4));
  const twice = renderRecipeV2(
    source,
    createRecipeV2({
      regions: [
        createAdjustmentRegionV2({ id: 'first', mask, adjustments: { saturation: -100 } }),
        createAdjustmentRegionV2({ id: 'second', mask, adjustments: { exposure: 1 } }),
      ],
    }),
  );
  const once = renderRecipeV2(
    source,
    createRecipeV2({
      regions: [createAdjustmentRegionV2({ mask, adjustments: { saturation: -100 } })],
    }),
  );
  assert.ok(twice.data[0]! > once.data[0]!);
  assert.deepEqual(twice.data.subarray(4), once.data.subarray(4));
});

test('all v2 stages preserve alpha and hidden RGB without mutating source or recipe', () => {
  const source = pattern(31, 23),
    recipe = rich(),
    before = source.data.slice(),
    serialized = JSON.stringify(recipe);
  const result = renderRecipeV2(source, recipe);
  for (let i = 0; i < source.data.length; i += 4) {
    assert.equal(result.data[i + 3], source.data[i + 3]);
    if (source.data[i + 3] === 0)
      assert.deepEqual(result.data.subarray(i, i + 4), source.data.subarray(i, i + 4));
  }
  assert.deepEqual(source.data, before);
  assert.equal(JSON.stringify(recipe), serialized);
});

test('full/tiled v2 share exact pixels for all stages, masks, geometry and nondividing tile edges', () => {
  const source = pattern(73, 59),
    recipe = rich();
  const reference = renderRecipeV2(source, recipe);
  for (const tileSize of [16, 17, 31, 64])
    equal(renderRecipeV2Tiled(source, recipe, { tileSize }), reference, `tile ${tileSize}`);
  const geometryBase = { crop: { x: 0.13, y: 0.19, width: 0.66, height: 0.71 } };
  for (const rotation of [0, 90, 180, 270] as const)
    for (const flipX of [false, true])
      for (const flipY of [false, true]) {
        const geometry: Geometry = { ...geometryBase, rotation, flipX, flipY };
        const value = createRecipeV2({ ...recipe, geometry });
        const expected = renderRecipe(reference, createRecipe({ geometry }));
        equal(renderRecipeV2(source, value), expected);
        equal(renderRecipeV2Tiled(source, value, { tileSize: 17 }), expected);
        assert.deepEqual(getOutputDimensions(source, geometry), {
          width: expected.width,
          height: expected.height,
        });
      }
});

test('maximum ordered detail dependency uses the complete twelve-pixel halo', () => {
  const source = pattern(67, 53);
  const recipe = createRecipeV2({
    adjustments: { sharpness: 25, soften: 20 },
    local: { enabled: true, adjustments: { soften: 30 } },
    detail: { texture: 40, clarity: 50 },
    regions: Array.from({ length: 8 }, (_, i) =>
      createAdjustmentRegionV2({
        id: `step-${i}`,
        mask: all,
        opacity: 0.7,
        adjustments: { exposure: 0.02, sharpness: 15 + i, soften: 25 },
      }),
    ),
  });
  assert.equal(recipeV2Halo(recipe), 12);
  equal(renderRecipeV2Tiled(source, recipe, { tileSize: 16 }), renderRecipeV2(source, recipe));
});

test('v2 default tile size crosses a real 512 boundary without seams, including source-anchored noise', () => {
  const source = pattern(521, 43),
    recipe = createRecipeV2({
      detail: { clarity: 31 },
      effects: { grain: { amount: 35, seed: 87, size: 7 }, vignette: { amount: 25 } },
      regions: [createAdjustmentRegionV2({ adjustments: { soften: 40 } })],
    });
  equal(renderRecipeV2Tiled(source, recipe), renderRecipeV2(source, recipe));
});

test('v2 full/tiled handle real image edges, singleton axes, budgets and cancellation', () => {
  const recipe = rich();
  for (const [width, height] of [
    [1, 1],
    [1, 31],
    [53, 1],
    [2, 3],
  ]) {
    const source = pattern(width!, height!);
    equal(renderRecipeV2Tiled(source, recipe, { tileSize: 16 }), renderRecipeV2(source, recipe));
  }
  assert.throws(() => renderRecipeV2(pattern(3, 2), recipe, { maxPixels: 5 }), RangeError);
  assert.throws(() => renderRecipeV2Tiled(pattern(3, 2), recipe, { tileSize: 15 }), RangeError);
  assert.throws(
    () => renderEditorRecipe(pattern(3, 2), recipe, { signal: { aborted: true } }),
    RenderAbortedError,
  );
  let reads = 0;
  assert.throws(
    () =>
      renderRecipeV2Tiled(pattern(31, 23), recipe, {
        tileSize: 16,
        signal: {
          get aborted() {
            return ++reads > 6;
          },
        },
      }),
    RenderAbortedError,
  );
});

test('v2 tiled rendering allocates only two reusable tile-sized Float32 work buffers', () => {
  const source = pattern(160, 112),
    recipe = createRecipeV2({
      detail: { clarity: 22 },
      effects: { fade: 10 },
      regions: [createAdjustmentRegionV2({ mask: all, adjustments: { soften: 33 } })],
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
    renderRecipeV2Tiled(source, recipe, { tileSize: 32 });
  } finally {
    globalThis.Float32Array = Original;
  }
  const maximum = (32 + 2 * recipeV2Halo(recipe)) ** 2 * 3;
  assert.equal(allocations.length, 2);
  assert.ok(
    allocations.every((value) => value <= maximum && value < source.width * source.height * 3),
  );
});

test('every registered extreme remains a bounded real rendering parameter with stable alpha', () => {
  const source = pattern(7, 5);
  for (const tool of V2_TOOLS)
    for (const amount of [tool.min, tool.max]) {
      const result = renderRecipeV2(
        source,
        setRecipeV2Parameter(createRecipeV2(), tool.path, amount),
      );
      for (let i = 3; i < source.data.length; i += 4)
        assert.equal(result.data[i], source.data[i], tool.path);
    }
});

test('a real worker v2 tile export equals the main-thread reference for the same frozen input', async () => {
  const source = pattern(59, 47),
    recipe = rich(),
    expected = renderRecipeV2(source, recipe);
  const worker = new Worker(new URL('./v2-worker.mjs', import.meta.url), {
    execArgv: ['--import', 'tsx'],
  });
  try {
    const buffer = source.data.slice().buffer;
    const output = new Promise<RGBAImage>((resolve, reject) => {
      worker.once(
        'message',
        (message: { width: number; height: number; buffer: ArrayBuffer; error?: string }) => {
          if (message.error) reject(new Error(message.error));
          else
            resolve({
              width: message.width,
              height: message.height,
              data: new Uint8ClampedArray(message.buffer),
            });
        },
      );
      worker.once('error', reject);
    });
    worker.postMessage({ width: source.width, height: source.height, buffer, recipe }, [buffer]);
    equal(await output, expected);
  } finally {
    await worker.terminate();
  }
});
