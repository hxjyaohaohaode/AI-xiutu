import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import {
  DEFAULT_TILE_SIZE,
  MAX_EXPLICIT_PIXELS,
  MAX_INPUT_PIXELS,
  MAX_TILED_DIMENSION,
  MAX_TILED_PIXELS,
  RenderAbortedError,
  TILE_HALO,
  createRecipe,
  getOutputDimensions,
  mapOutputToSource,
  mapSourceToOutput,
  renderRecipe,
  renderRecipeTiled,
  validateTiledImage,
} from '../src/index.js';
import type { Geometry, RecipeV1, RGBAImage } from '../src/index.js';

function patterned(width: number, height: number): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = (x * 13 + y * 7 + (x ^ y) * 11) % 256;
      data[i + 1] = (x * 5 + y * 29 + 91) % 256;
      data[i + 2] = (x * 41 + y * 17 + 157) % 256;
      data[i + 3] = (x + y) % 11 === 0 ? 0 : (x * 3 + y) % 5 === 0 ? 64 : 255;
    }
  return { width, height, data };
}

function richRecipe(): RecipeV1 {
  return createRecipe({
    adjustments: {
      exposure: 0.4,
      brightness: 7,
      contrast: 16,
      shadows: 21,
      highlights: -14,
      whites: -4,
      blacks: 5,
      saturation: 17,
      vibrance: -8,
      temperature: 12,
      tint: -9,
      sharpness: 46,
      soften: 32,
    },
    curves: {
      rgb: [
        [0, 0],
        [0.23, 0.15],
        [0.62, 0.79],
        [1, 0.98],
      ],
      red: [
        [0, 0.05],
        [0.42, 0.52],
        [1, 0.94],
      ],
      blue: [
        [0, 0.01],
        [0.3, 0.24],
        [0.76, 0.9],
        [1, 1],
      ],
    },
    local: {
      enabled: true,
      mask: { centerX: 0.61, centerY: 0.44, radiusX: 0.36, radiusY: 0.42, feather: 0.62 },
      adjustments: {
        exposure: -0.3,
        brightness: -11,
        contrast: -13,
        highlights: 18,
        shadows: 10,
        whites: -8,
        blacks: 6,
        saturation: -14,
        vibrance: 13,
        temperature: -22,
        tint: 17,
        sharpness: 36,
        soften: 70,
      },
    },
  });
}

function identical(actual: RGBAImage, expected: RGBAImage, label = ''): void {
  assert.equal(actual.width, expected.width, `${label}: width`);
  assert.equal(actual.height, expected.height, `${label}: height`);
  assert.equal(actual.data.length, expected.data.length, `${label}: length`);
  for (let i = 0; i < actual.data.length; i += 1) {
    if (actual.data[i] !== expected.data[i]) {
      const pixel = Math.floor(i / 4);
      assert.fail(
        `${label}: pixel (${pixel % actual.width},${Math.floor(pixel / actual.width)}), channel ${i % 4}: tiled ${actual.data[i]}, reference ${expected.data[i]}`,
      );
    }
  }
}

test('tiled neutral rendering preserves all RGBA byte values and disabled local state', () => {
  const source = patterned(256, 5);
  for (let y = 0; y < 5; y += 1)
    for (let x = 0; x < 256; x += 1) {
      const i = (y * 256 + x) * 4;
      source.data[i] = x;
      source.data[i + 3] = [0, 1, 64, 128, 255][y]!;
    }
  const before = source.data.slice();
  const recipe = createRecipe({
    local: { enabled: false, adjustments: { exposure: 3, soften: 100, sharpness: 100 } },
  });
  identical(renderRecipeTiled(source, recipe, { tileSize: 16 }), source);
  assert.deepEqual(source.data, before);
});

test('all stages match the reference byte for byte for several non-dividing tile sizes', () => {
  const source = patterned(69, 51);
  const recipe = richRecipe();
  const recipeBefore = JSON.stringify(recipe);
  const expected = renderRecipe(source, recipe);
  for (const tileSize of [16, 17, 31, 64, 128])
    identical(renderRecipeTiled(source, recipe, { tileSize }), expected, `tile=${tileSize}`);
  assert.equal(JSON.stringify(recipe), recipeBefore);
});

test('fractional crop, all rotations and output flips share exact geometry with the reference', () => {
  const source = patterned(69, 51);
  for (const rotation of [0, 90, 180, 270] as Geometry['rotation'][])
    for (const flipX of [false, true])
      for (const flipY of [false, true]) {
        const recipe = richRecipe();
        recipe.geometry = {
          crop: { x: 0.13, y: 0.19, width: 0.71, height: 0.63 },
          rotation,
          flipX,
          flipY,
        };
        identical(
          renderRecipeTiled(source, recipe, { tileSize: 16 }),
          renderRecipe(source, recipe),
          `rotation=${rotation}, flips=${flipX}/${flipY}`,
        );
      }
});

test('default 512-pixel tile boundaries and partial edge tiles have no seams or alpha drift', () => {
  const source = patterned(DEFAULT_TILE_SIZE + 9, DEFAULT_TILE_SIZE + 7);
  const recipe = richRecipe();
  recipe.local.mask.invert = true;
  identical(renderRecipeTiled(source, recipe), renderRecipe(source, recipe));
});

test('two consecutive radius-1 detail stages retain their full two-pixel dependency halo', () => {
  assert.equal(TILE_HALO, 2);
  const source = patterned(35, 33);
  for (const [x, y] of [
    [15, 15],
    [16, 15],
    [15, 16],
    [16, 16],
    [31, 31],
  ])
    source.data.set([240, 20, 180, 255], (y! * source.width + x!) * 4);
  const recipe = createRecipe({
    adjustments: { sharpness: 85, soften: 42 },
    local: {
      enabled: true,
      mask: { centerX: 0.5, centerY: 0.5, radiusX: 1, radiusY: 1, feather: 0 },
      adjustments: { sharpness: 71, soften: 93 },
    },
  });
  identical(renderRecipeTiled(source, recipe, { tileSize: 16 }), renderRecipe(source, recipe));
});

test('radial masks, feather and inversion remain in original whole-image coordinates across tiles', () => {
  const source = patterned(257, 129);
  for (const invert of [false, true]) {
    const recipe = createRecipe({
      adjustments: { exposure: 0.2 },
      local: {
        enabled: true,
        mask: { centerX: 0.73, centerY: 0.29, radiusX: 0.17, radiusY: 0.32, feather: 0.66, invert },
        adjustments: { exposure: 1.1, saturation: -45, soften: 60, sharpness: 25 },
      },
    });
    identical(
      renderRecipeTiled(source, recipe, { tileSize: 32 }),
      renderRecipe(source, recipe),
      `invert=${invert}`,
    );
  }
});

test('crop-border detail samples include neighbors outside the crop just like pre-crop reference processing', () => {
  const source = patterned(65, 41);
  const recipe = richRecipe();
  recipe.geometry = {
    crop: { x: 0.3, y: 0.25, width: 0.05, height: 0.1 },
    rotation: 270,
    flipX: true,
    flipY: false,
  };
  identical(renderRecipeTiled(source, recipe, { tileSize: 16 }), renderRecipe(source, recipe));
});

test('single-pixel, row, column and small transparent images retain correct real-image edge extension', () => {
  for (const [width, height] of [
    [1, 1],
    [1, 53],
    [73, 1],
    [2, 3],
  ]) {
    const source = patterned(width!, height!);
    const recipe = richRecipe();
    recipe.geometry.rotation = 90;
    identical(
      renderRecipeTiled(source, recipe, { tileSize: 16 }),
      renderRecipe(source, recipe),
      `${width}x${height}`,
    );
  }
});

test('Float32 work buffers are tile-sized and allocated twice, then reused for all tiles', () => {
  const source = patterned(173, 135);
  const recipe = richRecipe();
  const lengths: number[] = [];
  const OriginalFloat32Array = globalThis.Float32Array;
  const Instrumented = new Proxy(OriginalFloat32Array, {
    construct(target, args, newTarget) {
      if (typeof args[0] === 'number') lengths.push(args[0]);
      return Reflect.construct(target, args, newTarget);
    },
  });
  let rendered: RGBAImage;
  globalThis.Float32Array = Instrumented;
  try {
    rendered = renderRecipeTiled(source, recipe, { tileSize: 64 });
  } finally {
    globalThis.Float32Array = OriginalFloat32Array;
  }
  const capacity = (64 + 2 * TILE_HALO) ** 2 * 3;
  assert.equal(lengths.filter((length) => length === capacity).length, 2);
  assert.ok(
    lengths.every((length) => length <= Math.max(4096, capacity)),
    `unexpected full-frame float allocation: ${lengths}`,
  );
  assert.ok(!lengths.includes(source.width * source.height * 3));
  identical(rendered, renderRecipe(source, recipe));
});

test('the explicit tiled path supports a 16,384-pixel side without widening reference-renderer admission', () => {
  const source = patterned(MAX_TILED_DIMENSION, 1);
  const recipe = createRecipe({ geometry: { rotation: 90 } });
  assert.throws(() => renderRecipe(source, recipe), RangeError);
  const output = renderRecipeTiled(source, recipe, { tileSize: 128 });
  assert.equal(output.width, 1);
  assert.equal(output.height, MAX_TILED_DIMENSION);
  assert.deepEqual(output.data, source.data);
  assert.equal(MAX_INPUT_PIXELS, 4_194_304);
  assert.equal(MAX_EXPLICIT_PIXELS, 16_777_216);
});

test('a real 20MP input with a small crop uses only cropped tiles and honors an explicitly lower admission budget', () => {
  const source: RGBAImage = {
    width: 10000,
    height: 2000,
    data: new Uint8ClampedArray(20_000_000 * 4),
  };
  const small = patterned(20, 8);
  for (let y = 0; y < small.height; y += 1)
    source.data.set(
      small.data.subarray(y * small.width * 4, (y + 1) * small.width * 4),
      ((800 + y) * source.width + 3000) * 4,
    );
  const recipe = createRecipe({
    adjustments: { exposure: 0.25, saturation: -20 },
    geometry: { crop: { x: 0.3, y: 0.4, width: 0.002, height: 0.004 }, rotation: 90, flipX: true },
  });
  assert.throws(
    () => renderRecipeTiled(source, recipe, { maxPixels: MAX_EXPLICIT_PIXELS }),
    /budget/,
  );
  const expectedRecipe = createRecipe({
    adjustments: recipe.adjustments,
    geometry: { rotation: 90, flipX: true },
  });
  identical(
    renderRecipeTiled(source, recipe, { maxPixels: 20_000_000, tileSize: 16 }),
    renderRecipe(small, expectedRecipe),
  );
  assert.throws(() => renderRecipe(source, recipe, { maxPixels: MAX_EXPLICIT_PIXELS }), RangeError);
});

test('high-resolution geometry helpers map coordinates without requiring a whole-image float allocation', () => {
  const source = { width: MAX_TILED_DIMENSION, height: 4096 };
  const geometry: Geometry = {
    crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    rotation: 90,
    flipX: true,
    flipY: false,
  };
  assert.equal(source.width * source.height, MAX_TILED_PIXELS);
  assert.deepEqual(getOutputDimensions(source, geometry), { width: 2048, height: 8192 });
  const point = { x: 0.38, y: 0.41 };
  const output = mapSourceToOutput(point, source, geometry);
  const recovered = mapOutputToSource(output, source, geometry);
  assert.ok(Math.abs(recovered.x - point.x) < 1e-12);
  assert.ok(Math.abs(recovered.y - point.y) < 1e-12);
});

test('tiled input budgets, tile size, buffer completeness and cancellation fail before unsafe work', () => {
  const source = patterned(33, 31);
  const recipe = richRecipe();
  for (const tileSize of [0, 15, 1025, 16.5, NaN])
    assert.throws(() => renderRecipeTiled(source, recipe, { tileSize }), /tileSize/);
  for (const maxPixels of [0, 33 * 31 - 1, MAX_TILED_PIXELS + 1, NaN])
    assert.throws(() => renderRecipeTiled(source, recipe, { maxPixels }), RangeError);
  assert.throws(
    () => validateTiledImage({ width: 16385, height: 1, data: new Uint8ClampedArray() }),
    /dimensions/,
  );
  assert.throws(
    () => validateTiledImage({ width: 16384, height: 4097, data: new Uint8ClampedArray() }),
    /budget/,
  );
  assert.throws(() => validateTiledImage({ ...source, data: source.data.subarray(4) }), /exactly/);
  assert.throws(
    () => renderRecipeTiled(source, recipe, { signal: { aborted: true } }),
    RenderAbortedError,
  );
  let checks = 0;
  assert.throws(
    () =>
      renderRecipeTiled(source, recipe, {
        tileSize: 16,
        signal: {
          get aborted() {
            checks += 1;
            return checks > 8;
          },
        },
      }),
    RenderAbortedError,
  );
});

test('tiled rendering in a real worker uses the same canonical pixels as reference export', async () => {
  const source = patterned(180, 140);
  const recipe = richRecipe();
  recipe.geometry = {
    crop: { x: 0.11, y: 0.09, width: 0.78, height: 0.83 },
    rotation: 270,
    flipX: true,
    flipY: true,
  };
  const worker = new Worker(new URL('./tiled-worker.mjs', import.meta.url), {
    execArgv: ['--import', 'tsx'],
  });
  try {
    const buffer = source.data.slice().buffer;
    const result = new Promise<RGBAImage>((resolve, reject) => {
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
    worker.postMessage(
      {
        width: source.width,
        height: source.height,
        buffer,
        recipe: JSON.parse(JSON.stringify(recipe)),
      },
      [buffer],
    );
    identical(await result, renderRecipe(source, recipe));
  } finally {
    await worker.terminate();
  }
});
