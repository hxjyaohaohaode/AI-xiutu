import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import {
  ADJUSTMENT_IDS,
  DEFAULT_RECIPE,
  MAX_EXPLICIT_PIXELS,
  MAX_INPUT_PIXELS,
  TOOLS,
  RenderAbortedError,
  RecipeValidationError,
  compileCurveLut,
  computeHistogram,
  createRecipe,
  getOutputDimensions,
  mapOutputToSource,
  mapSourceToOutput,
  parseRecipe,
  radialMaskWeight,
  renderRecipe,
  sampleCurveLut,
  validateImage,
  validateRecipe,
} from '../src/index.js';
import type { AdjustmentId, Geometry, RecipeV1, RGBAImage } from '../src/index.js';

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
const grey = (values: number[]): RGBAImage =>
  image(values.length, 1, (x) => [values[x]!, values[x]!, values[x]!, 255]);
const redValues = (frame: RGBAImage): number[] =>
  Array.from({ length: frame.width * frame.height }, (_, i) => frame.data[i * 4]!);
const close = (actual: number, expected: number, tolerance = 1): void =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} should be within ${tolerance} of ${expected}`,
  );

test('recipe construction owns its arrays and the shared default is deeply frozen', () => {
  const first = createRecipe({
    adjustments: { exposure: 0.5 },
    local: { mask: { feather: 0.75 } },
  });
  const second = createRecipe();
  first.adjustments.exposure = 2;
  first.curves.rgb[0]![1] = 0.2;
  assert.equal(second.adjustments.exposure, 0);
  assert.deepEqual(second.curves.rgb, [
    [0, 0],
    [1, 1],
  ]);
  assert.ok(Object.isFrozen(DEFAULT_RECIPE.local.mask));
  assert.ok(Object.isFrozen(DEFAULT_RECIPE.curves.rgb[0]));
  assert.equal(first.local.mask.feather, 0.75);
  assert.equal(TOOLS.length, 13);
  assert.equal(new Set(ADJUSTMENT_IDS).size, 13);
});

test('full-recipe validation rejects malformed versions, unknown params, NaN and negative detail', () => {
  const base = createRecipe();
  for (const bad of [
    {},
    { ...base, schemaVersion: 2 },
    { ...base, engineVersion: 'future' },
    { ...base, arbitraryScript: 'run' },
    { ...base, adjustments: { ...base.adjustments, faceSlimming: 50 } },
    { ...base, adjustments: { ...base.adjustments, exposure: NaN } },
    { ...base, adjustments: { ...base.adjustments, saturation: Infinity } },
    { ...base, adjustments: { ...base.adjustments, sharpness: -1 } },
    { ...base, geometry: { ...base.geometry, rotation: 45 } },
    { ...base, local: { ...base.local, mask: { ...base.local.mask, radiusX: 0 } } },
  ]) {
    assert.equal(validateRecipe(bad).valid, false);
    assert.throws(() => parseRecipe(bad), RecipeValidationError);
  }
});

test('validation does not invoke getters and rejects inherited/prototype payloads', () => {
  let getterCalls = 0;
  const getterRecipe = Object.defineProperty(createRecipe(), 'adjustments', {
    get() {
      getterCalls += 1;
      throw new Error('must not run');
    },
  });
  assert.equal(validateRecipe(getterRecipe).valid, false);
  assert.equal(getterCalls, 0);
  const inherited = Object.assign(Object.create({ malicious: true }) as object, createRecipe());
  assert.equal(validateRecipe(inherited).valid, false);
  const pollution = JSON.parse(
    JSON.stringify(createRecipe()).replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"__proto__":{"polluted":true}',
    ),
  ) as unknown;
  assert.equal(validateRecipe(pollution).valid, false);
  assert.throws(
    () => createRecipe(JSON.parse('{"__proto__":{"polluted":true}}') as never),
    RecipeValidationError,
  );
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('JSON round trip has deterministic versioned data and no references to the input', () => {
  const recipe = createRecipe({
    adjustments: { exposure: 1.15, shadows: 40 },
    curves: {
      red: [
        [0, 0.1],
        [0.4, 0.6],
        [1, 0.95],
      ],
    },
  });
  const parsed = parseRecipe(JSON.parse(JSON.stringify(recipe)) as unknown);
  assert.deepEqual(parsed, recipe);
  parsed.curves.red[0]![1] = 0;
  assert.equal(recipe.curves.red[0]![1], 0.1);
});

test('neutral recipe is byte-identical for all byte values and alpha, but never mutates input', () => {
  const source = image(256, 5, (x, y) => [x, 255 - x, (x * 37) % 256, [0, 1, 64, 128, 255][y]!]);
  const original = source.data.slice();
  const result = renderRecipe(source, createRecipe());
  assert.deepEqual(result.data, original);
  assert.deepEqual(source.data, original);
  assert.notEqual(result.data, source.data);
  const disabled = createRecipe({
    local: { enabled: false, adjustments: { exposure: 3, soften: 100, sharpness: 100 } },
  });
  assert.deepEqual(renderRecipe(source, disabled).data, original);
});

test('exposure performs linear-light EV rather than multiplying encoded bytes', () => {
  const source = grey([64, 128]);
  const positive = redValues(renderRecipe(source, createRecipe({ adjustments: { exposure: 1 } })));
  close(positive[0]!, 90);
  close(positive[1]!, 176);
  const negative = redValues(renderRecipe(source, createRecipe({ adjustments: { exposure: -1 } })));
  close(negative[0]!, 44);
  close(negative[1]!, 92);
  assert.notDeepEqual(positive, [128, 255]);
});

test('signed light tools move in both directions, and brightness is not exposure', () => {
  const source = grey([32, 64, 128, 192, 224]);
  for (const id of ['brightness', 'highlights', 'shadows', 'whites', 'blacks'] as AdjustmentId[]) {
    const up = redValues(renderRecipe(source, createRecipe({ adjustments: { [id]: 60 } })));
    const down = redValues(renderRecipe(source, createRecipe({ adjustments: { [id]: -60 } })));
    const baseline = redValues(source);
    assert.ok(up.every((v, i) => v >= baseline[i]!));
    assert.ok(down.every((v, i) => v <= baseline[i]!));
    assert.ok(up.some((v, i) => v > baseline[i]!));
    assert.ok(down.some((v, i) => v < baseline[i]!));
  }
  assert.notDeepEqual(
    renderRecipe(source, createRecipe({ adjustments: { brightness: 50 } })).data,
    renderRecipe(source, createRecipe({ adjustments: { exposure: 1 } })).data,
  );
  assert.deepEqual(
    redValues(renderRecipe(grey([0, 255]), createRecipe({ adjustments: { brightness: 100 } }))),
    [0, 255],
  );
});

test('contrast has a midtone pivot and highlight/shadow controls target different tonal ranges', () => {
  const source = grey([64, 192]);
  const positive = redValues(renderRecipe(source, createRecipe({ adjustments: { contrast: 80 } })));
  const negative = redValues(
    renderRecipe(source, createRecipe({ adjustments: { contrast: -80 } })),
  );
  assert.ok(positive[0]! < 64 && positive[1]! > 192);
  assert.ok(negative[0]! > 64 && negative[1]! < 192);
  const highs = redValues(renderRecipe(source, createRecipe({ adjustments: { highlights: 80 } })));
  const lows = redValues(renderRecipe(source, createRecipe({ adjustments: { shadows: 80 } })));
  assert.ok(highs[1]! - 192 > highs[0]! - 64);
  assert.ok(lows[0]! - 64 > lows[1]! - 192);
});

test('saturation -100 is grayscale and vibrance leaves neutral gray neutral', () => {
  const source = image(1, 1, () => [200, 100, 50, 128]);
  const desaturated = renderRecipe(
    source,
    createRecipe({ adjustments: { saturation: -100 } }),
  ).data;
  assert.deepEqual(Array.from(desaturated), [118, 118, 118, 128]);
  for (const value of [-100, 100]) {
    assert.deepEqual(
      renderRecipe(grey([0, 48, 128, 192, 255]), createRecipe({ adjustments: { vibrance: value } }))
        .data,
      grey([0, 48, 128, 192, 255]).data,
    );
  }
  const up = renderRecipe(source, createRecipe({ adjustments: { vibrance: 75 } })).data;
  const down = renderRecipe(source, createRecipe({ adjustments: { vibrance: -75 } })).data;
  assert.ok(up[0]! - up[2]! > 150);
  assert.ok(down[0]! - down[2]! < 150);
});

test('temperature and tint have signed, distinct relative color semantics', () => {
  const source = grey([128]);
  const warm = renderRecipe(source, createRecipe({ adjustments: { temperature: 80 } })).data;
  const cool = renderRecipe(source, createRecipe({ adjustments: { temperature: -80 } })).data;
  const magenta = renderRecipe(source, createRecipe({ adjustments: { tint: 80 } })).data;
  const green = renderRecipe(source, createRecipe({ adjustments: { tint: -80 } })).data;
  assert.ok(warm[0]! > warm[2]! && cool[0]! < cool[2]!);
  assert.ok(magenta[1]! < magenta[0]! && green[1]! > green[0]!);
});

test('curve endpoints, channel isolation and RGB-then-channel order are explicit', () => {
  const source = image(2, 1, (x) => (x === 0 ? [64, 64, 64, 255] : [200, 120, 25, 64]));
  const identity = createRecipe({
    curves: {
      rgb: [
        [0, 0],
        [0.3, 0.3],
        [0.8, 0.8],
        [1, 1],
      ],
    },
  });
  assert.deepEqual(renderRecipe(source, identity).data, source.data);
  const red = renderRecipe(
    source,
    createRecipe({
      curves: {
        red: [
          [0, 0],
          [1, 0.5],
        ],
      },
    }),
  ).data;
  assert.equal(red[1], 64);
  assert.equal(red[2], 64);
  assert.equal(red[3], 255);
  close(red[0]!, 32);
  const combined = renderRecipe(
    source,
    createRecipe({
      curves: {
        rgb: [
          [0, 0],
          [1, 0.5],
        ],
        red: [
          [0, 0.2],
          [1, 1],
        ],
      },
    }),
  ).data;
  close(combined[0]!, 77);
  close(combined[1]!, 32);
  assert.deepEqual(
    redValues(
      renderRecipe(
        grey([0, 255]),
        createRecipe({
          curves: {
            rgb: [
              [0, 1],
              [1, 0],
            ],
          },
        }),
      ),
    ),
    [255, 0],
  );
  const lut = compileCurveLut([
    [0, 0],
    [0.5, 0.8],
    [1, 1],
  ]);
  close(sampleCurveLut(lut, 0.25), 0.4, 0.001);
  assert.ok(Array.from(lut).every((v) => v >= 0 && v <= 1));
});

test('bad curve ordering, duplicate x, missing endpoints and accessors are rejected', () => {
  for (const points of [
    [
      [0, 0],
      [0, 1],
      [1, 1],
    ],
    [
      [0.1, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [0.8, 1],
      [0.5, 0],
      [1, 1],
    ],
  ] as [number, number][][]) {
    assert.throws(() => createRecipe({ curves: { rgb: points } }), RecipeValidationError);
  }
  let called = false;
  const points: unknown[] = [
    [0, 0],
    [1, 1],
  ];
  Object.defineProperty(points, '0', {
    get() {
      called = true;
      return [0, 0];
    },
  });
  assert.equal(
    validateRecipe({ ...createRecipe(), curves: { ...createRecipe().curves, rgb: points } }).valid,
    false,
  );
  assert.equal(called, false);
});

test('crop, all clockwise rotations and output-axis flips are exact RGBA permutations', () => {
  const source = image(2, 3, (x, y) => [y * 2 + x + 1, 30 + y, 80 + x, 50 + y * 2 + x]);
  assert.deepEqual(
    redValues(renderRecipe(source, createRecipe({ geometry: { rotation: 90 } }))),
    [5, 3, 1, 6, 4, 2],
  );
  assert.deepEqual(
    redValues(renderRecipe(source, createRecipe({ geometry: { rotation: 180 } }))),
    [6, 5, 4, 3, 2, 1],
  );
  assert.deepEqual(
    redValues(renderRecipe(source, createRecipe({ geometry: { rotation: 270 } }))),
    [2, 4, 6, 1, 3, 5],
  );
  assert.deepEqual(
    redValues(renderRecipe(source, createRecipe({ geometry: { flipX: true } }))),
    [2, 1, 4, 3, 6, 5],
  );
  assert.deepEqual(
    redValues(renderRecipe(source, createRecipe({ geometry: { flipY: true } }))),
    [5, 6, 3, 4, 1, 2],
  );
  assert.deepEqual(
    redValues(renderRecipe(source, createRecipe({ geometry: { rotation: 90, flipX: true } }))),
    [1, 3, 5, 2, 4, 6],
  );
  const cropped = renderRecipe(
    source,
    createRecipe({ geometry: { crop: { x: 0.5, y: 0, width: 0.5, height: 1 } } }),
  );
  assert.deepEqual([cropped.width, cropped.height], [1, 3]);
  assert.deepEqual(redValues(cropped), [2, 4, 6]);
  assert.deepEqual(Array.from(cropped.data), [2, 30, 81, 51, 4, 31, 81, 53, 6, 32, 81, 55]);
});

test('geometry helpers use actual crop quantization and invert across all rotations/flips', () => {
  const dimensions = { width: 10, height: 8 };
  for (const rotation of [0, 90, 180, 270] as const)
    for (const flipX of [false, true])
      for (const flipY of [false, true]) {
        const geometry: Geometry = {
          crop: { x: 0.13, y: 0.2, width: 0.41, height: 0.45 },
          rotation,
          flipX,
          flipY,
        };
        assert.deepEqual(getOutputDimensions(dimensions, geometry), { width: 5, height: 5 });
        for (const point of [
          { x: 0, y: 0 },
          { x: 0.31, y: 0.72 },
          { x: 1, y: 1 },
        ]) {
          const source = mapOutputToSource(point, dimensions, geometry);
          const restored = mapSourceToOutput(source, dimensions, geometry);
          close(restored.x, point.x, 1e-12);
          close(restored.y, point.y, 1e-12);
        }
      }
  assert.throws(
    () => createRecipe({ geometry: { crop: { x: 0.8, y: 0, width: 0.3, height: 1 } } }),
    RecipeValidationError,
  );
});

test('alpha survives every adjustment and transparent color cannot bleed through detail filters', () => {
  const source = image(3, 1, (x) =>
    x === 0 ? [255, 0, 0, 0] : x === 2 ? [0, 0, 255, 0] : [100, 100, 100, 128],
  );
  for (const id of ADJUSTMENT_IDS) {
    const result = renderRecipe(
      source,
      createRecipe({ adjustments: { [id]: id === 'exposure' ? 1 : 50 } }),
    );
    assert.deepEqual([result.data[3], result.data[7], result.data[11]], [0, 128, 0]);
    assert.deepEqual(Array.from(result.data.slice(0, 4)), [255, 0, 0, 0]);
    assert.deepEqual(Array.from(result.data.slice(8)), [0, 0, 255, 0]);
  }
  for (const id of ['soften', 'sharpness'] as const) {
    assert.deepEqual(
      renderRecipe(source, createRecipe({ adjustments: { [id]: 100 } })).data,
      source.data,
    );
  }
});

test('soften reduces a small local fluctuation and sharpening increases it without changing flat fields', () => {
  const source = image(3, 3, (x, y) => {
    const v = x === 1 && y === 1 ? 140 : 128;
    return [v, v, v, 255];
  });
  const softened = renderRecipe(source, createRecipe({ adjustments: { soften: 100 } }));
  const sharpened = renderRecipe(source, createRecipe({ adjustments: { sharpness: 100 } }));
  assert.ok(softened.data[16]! < 140 && softened.data[16]! > 128);
  assert.ok(sharpened.data[16]! > 140);
  const uniform = image(5, 4, () => [10, 75, 225, 234]);
  assert.deepEqual(
    renderRecipe(uniform, createRecipe({ adjustments: { soften: 100, sharpness: 100 } })).data,
    uniform.data,
  );
});

test('radial feather and inverse have bounded complementary weights', () => {
  const mask = createRecipe().local.mask;
  assert.equal(radialMaskWeight(mask, 0.5, 0.5), 1);
  assert.equal(radialMaskWeight(mask, 1, 1), 0);
  close(radialMaskWeight(mask, 0.5 + 0.25 * 0.75, 0.5), 0.5, 1e-12);
  for (let x = 0; x <= 1; x += 0.03125) {
    const normal = radialMaskWeight(mask, x, 0.5);
    const inverse = radialMaskWeight({ ...mask, invert: true }, x, 0.5);
    assert.ok(normal >= 0 && normal <= 1);
    close(normal + inverse, 1, 1e-12);
  }
});

test('enabled local tone and smoothing leave every outside pixel byte-identical to the global baseline', () => {
  const source = image(17, 13, (x, y) => [70 + ((x + y) % 5) * 8, 90 + y * 2, 60 + x * 3, 150 + x]);
  const baselineRecipe = createRecipe({
    adjustments: { exposure: 0.3, contrast: -20 },
    curves: {
      blue: [
        [0, 0],
        [1, 0.9],
      ],
    },
  });
  const baseline = renderRecipe(source, baselineRecipe);
  const recipe = createRecipe({
    ...baselineRecipe,
    local: {
      enabled: true,
      mask: { centerX: 0.5, centerY: 0.5, radiusX: 0.25, radiusY: 0.3, feather: 0.4 },
      adjustments: { brightness: 35, soften: 70, sharpness: 10 },
    },
  });
  const result = renderRecipe(source, recipe);
  let changed = 0;
  let preserved = 0;
  for (let y = 0; y < source.height; y += 1)
    for (let x = 0; x < source.width; x += 1) {
      const i = (y * source.width + x) * 4;
      if (
        radialMaskWeight(recipe.local.mask, (x + 0.5) / source.width, (y + 0.5) / source.height) ===
        0
      ) {
        assert.deepEqual(result.data.slice(i, i + 4), baseline.data.slice(i, i + 4));
        preserved += 1;
      } else if (result.data[i] !== baseline.data[i]) changed += 1;
      assert.equal(result.data[i + 3], source.data[i + 3]);
    }
  assert.ok(changed > 5 && preserved > 100);
});

test('inverted local mask protects its center and local detail does not become a global effect', () => {
  const source = image(9, 9, (x, y) => {
    const v = 100 + ((x + y) % 2) * 30;
    return [v, v, v, 255];
  });
  const recipe = createRecipe({
    local: {
      enabled: true,
      mask: { radiusX: 0.3, radiusY: 0.3, invert: true, feather: 0 },
      adjustments: { sharpness: 80 },
    },
  });
  const result = renderRecipe(source, recipe);
  const center = (4 * 9 + 4) * 4;
  assert.deepEqual(result.data.slice(center, center + 4), source.data.slice(center, center + 4));
  assert.notDeepEqual(result.data.slice(0, 4), source.data.slice(0, 4));
});

test('histograms count visible pixels, preserve channel bins and ignore hidden RGB', () => {
  const source = image(
    3,
    1,
    (x) =>
      [
        [255, 0, 0, 255],
        [0, 255, 0, 128],
        [0, 0, 255, 0],
      ][x]!,
  );
  const histogram = computeHistogram(source);
  assert.equal(histogram.pixelCount, 2);
  assert.equal(histogram.red[255], 1);
  assert.equal(histogram.green[255], 1);
  assert.equal(histogram.blue[255], 0);
  assert.equal(
    Array.from(histogram.luminance).reduce((a, b) => a + b, 0),
    2,
  );
});

test('bounds reject excessive dimensions, incomplete buffers and unauthorized budget enlargement', () => {
  assert.throws(
    () => validateImage({ width: 2049, height: 2048, data: new Uint8ClampedArray() }),
    /budget/,
  );
  assert.throws(
    () => validateImage({ width: 8193, height: 1, data: new Uint8ClampedArray() }),
    /dimensions/,
  );
  assert.throws(
    () => validateImage({ width: 2, height: 2, data: new Uint8ClampedArray(15) }),
    /exactly/,
  );
  assert.throws(
    () => renderRecipe(grey([128]), createRecipe(), { maxPixels: MAX_EXPLICIT_PIXELS + 1 }),
    /maxPixels/,
  );
  assert.throws(
    () =>
      validateImage(
        { width: 2049, height: 2048, data: new Uint8ClampedArray() },
        { maxPixels: MAX_EXPLICIT_PIXELS },
      ),
    /exactly/,
  );
  assert.equal(MAX_INPUT_PIXELS, 4_194_304);
  assert.throws(
    () => renderRecipe(grey([128]), createRecipe(), { signal: { aborted: true } }),
    RenderAbortedError,
  );
});

test('extreme valid settings remain bounded, keep alpha, and do not mutate recipes', () => {
  const source = image(7, 5, (x, y) => [
    (x * 53 + y * 37) % 256,
    (x * 19 + y * 79) % 256,
    (x * 103 + y * 11) % 256,
    20 + x * 30,
  ]);
  for (const tool of TOOLS)
    for (const value of [tool.min, tool.max]) {
      const recipe = createRecipe({ adjustments: { [tool.id]: value } });
      const snapshot = JSON.stringify(recipe);
      const out = renderRecipe(source, recipe);
      assert.equal(JSON.stringify(recipe), snapshot);
      for (let i = 3; i < out.data.length; i += 4) assert.equal(out.data[i], source.data[i]);
    }
});

test('worker-rendered preview and main-thread export use identical canonical pixels for the same input', async () => {
  const source = image(23, 19, (x, y) => [
    (x * 11) % 256,
    (y * 17) % 256,
    ((x + y) * 23) % 256,
    (x * 7 + y * 13) % 256,
  ]);
  const recipe = createRecipe({
    adjustments: { exposure: -0.5, shadows: 25, sharpness: 30 },
    curves: {
      green: [
        [0, 0],
        [0.5, 0.6],
        [1, 1],
      ],
    },
    local: { enabled: true, adjustments: { soften: 35, temperature: 20 } },
    geometry: { crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }, rotation: 90, flipY: true },
  });
  const main = renderRecipe(source, recipe);
  const pixels = source.data.slice();
  const worker = new Worker(new URL('./render-worker.mjs', import.meta.url), {
    workerData: {
      image: { width: source.width, height: source.height, data: pixels },
      recipe: JSON.parse(JSON.stringify(recipe)) as RecipeV1,
    },
    transferList: [pixels.buffer],
    execArgv: ['--import', 'tsx'],
  });
  const result = await new Promise<RGBAImage>((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker exited ${code}`));
    });
  });
  assert.equal(result.width, main.width);
  assert.equal(result.height, main.height);
  assert.deepEqual(result.data, main.data);
});
