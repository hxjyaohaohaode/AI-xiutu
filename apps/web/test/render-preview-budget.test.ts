import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV3,
  createRecipeV2,
  createRecipeV4,
  getEditorOutputDimensions,
  type RGBAImage,
} from '@ai-xiutu/editor';
import {
  prepareBudgetedPreview,
  MAX_PREVIEW_PIXELS,
  INTERACTIVE_PREVIEW_PIXELS,
} from '../src/editor/previewBudget.js';

const fixture = (width: number, height: number): RGBAImage => ({
  width,
  height,
  data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 41 + 16) % 256,
  ),
});

test('preview preparation is an exact reference identity when geometry already fits the budget', () => {
  const image = fixture(24, 16);
  assert.equal(prepareBudgetedPreview(image, createRecipeV3()), image);
  assert.equal(prepareBudgetedPreview(image, createRecipeV2()), image);
  assert.throws(() => prepareBudgetedPreview(image, createRecipeV3(), 0), /budget/);
  assert.throws(() => prepareBudgetedPreview(image, createRecipeV3(), Infinity), /budget/);
});

test('adaptive downsampling preserves alpha with premultiplied linear area reconstruction', () => {
  const pixels = [255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255];
  const image = { width: 4, height: 1, data: new Uint8ClampedArray(pixels) };
  const output = prepareBudgetedPreview(image, createRecipeV3(), 2);
  assert.deepEqual([output.width, output.height], [2, 1]);
  assert.deepEqual([...output.data], [255, 0, 0, 128, 188, 188, 188, 255]);
  assert.deepEqual([...image.data], pixels);
});

test('output-aware planning handles rotation, projective crop and scale without rewriting recipe or source coordinates', () => {
  const image = fixture(80, 56);
  const recipes = [
    createRecipeV3({ transform: { rotationDegrees: 45 } }),
    createRecipeV3({ transform: { scaleX: 4, scaleY: 4 } }),
    createRecipeV3({
      geometry: { crop: { x: 0.13, y: 0.17, width: 0.58, height: 0.61 } },
      transform: { rotationDegrees: 23.5, perspectiveX: 35, perspectiveY: -22, skewX: 10 },
    }),
  ];
  for (const recipe of recipes) {
    const before = structuredClone(recipe),
      preview = prepareBudgetedPreview(image, recipe, 1024),
      dimensions = getEditorOutputDimensions(preview, recipe);
    assert(preview.width * preview.height <= 1024);
    assert(dimensions.width * dimensions.height <= 1024);
    assert(preview.width <= image.width && preview.height <= image.height);
    assert.deepEqual(recipe, before);
  }
  const singular = createRecipeV3();
  singular.transform.skewX = singular.transform.skewY = 45;
  assert.throws(() => prepareBudgetedPreview(image, singular, 1024), /singular/);
});

test('actual worker protocol downsizes expanded previews and retains the full transformed export and layer coordinates', async (t) => {
  // Test the real worker dispatcher with transferable replies. Node has no browser PNG encoder.
  const replies: any[] = [];
  const scope = {
    onmessage: null as null | ((event: { data: any }) => void | Promise<void>),
    postMessage(value: any, options: Transferable[] | StructuredSerializeOptions = []) {
      replies.push(
        structuredClone(value, { transfer: Array.isArray(options) ? options : options.transfer }),
      );
    },
  };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../src/editor/render.worker.ts');
    const send = async (message: any) => {
      await scope.onmessage!({ data: message });
      return replies.at(-1);
    };
    const source = fixture(1800, 1200),
      untouched = new Uint8ClampedArray(source.data),
      recipe = createRecipeV3({ transform: { rotationDegrees: 45 } }),
      expected = getEditorOutputDimensions(source, recipe);
    assert(expected.width * expected.height > MAX_PREVIEW_PIXELS);
    await send({ type: 'source', image: source, original: source });
    const preview = await send({ type: 'preview', id: 1, recipe });
    assert.equal(preview.error, undefined);
    assert(preview.result.width * preview.result.height <= MAX_PREVIEW_PIXELS);
    const exported = await send({ type: 'export', id: 2, recipe });
    assert.equal(exported.error, undefined);
    assert.deepEqual(
      [exported.result.width, exported.result.height],
      [expected.width, expected.height],
    );
    assert.deepEqual(source.data, untouched);
    replies.length = 0;

    // Auxiliary preview kinds share the exact same budgeted pipeline and normalized image-layer placement.
    const small = fixture(8, 4),
      overlay = fixture(2, 2),
      composed = createRecipeV3();
    composed.imageLayers.push({
      id: 'layer',
      sourceId: 'source-layer',
      name: 'Layer',
      enabled: true,
      opacity: 1,
      blendMode: 'normal',
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
      rotationDegrees: 0,
      flipX: false,
      flipY: false,
      mask: null,
    });
    await send({ type: 'source', image: small, images: new Map([['source-layer', overlay]]) });
    const outputs = [];
    for (const [index, type] of [
      'compare-preview',
      'crop-preview',
      'selection-preview',
    ].entries()) {
      const reply = await send({ type, id: index + 10, recipe: composed });
      assert.equal(reply.error, undefined);
      outputs.push(reply.result);
    }
    assert.deepEqual(outputs[0], outputs[1]);
    assert.deepEqual(outputs[1], outputs[2]);
    assert.deepEqual(
      [...outputs[0].data.subarray((1 * 8 + 2) * 4, (1 * 8 + 2) * 4 + 4)],
      [...overlay.data.subarray(0, 4)],
    );

    await t.test(
      'interactive display budgets preserve larger auxiliary sources through settled preview and full export',
      async () => {
        const solid = (width: number, height: number, pixel: number[]): RGBAImage => ({
          width,
          height,
          data: Uint8ClampedArray.from(
            { length: width * height * 4 },
            (_, index) => pixel[index % 4],
          ),
        });
        const basePixel = [24, 48, 96, 255],
          previewPixel = [232, 104, 36, 255],
          originalPixel = [28, 180, 220, 255],
          basePreview = solid(16, 16, basePixel),
          baseOriginal = solid(32, 32, basePixel),
          layerPreview = solid(24, 16, previewPixel),
          layerOriginal = solid(48, 32, originalPixel),
          mixedRecipe = createRecipeV4();
        mixedRecipe.imageLayers.push({
          id: 'large-auxiliary-layer',
          sourceId: 'large-auxiliary-source',
          name: 'Larger auxiliary source',
          enabled: true,
          opacity: 1,
          blendMode: 'normal',
          x: 0.25,
          y: 0.25,
          width: 0.5,
          height: 0.5,
          rotationDegrees: 0,
          flipX: true,
          flipY: false,
          mask: null,
        });
        const beforeRecipe = structuredClone(mixedRecipe),
          sources = [basePreview, baseOriginal, layerPreview, layerOriginal],
          beforeSources = structuredClone(sources),
          interactiveBudget = 64;
        assert(layerPreview.width * layerPreview.height > interactiveBudget);
        await send({
          type: 'source',
          image: basePreview,
          original: baseOriginal,
          images: new Map([['large-auxiliary-source', layerPreview]]),
          originalImages: new Map([['large-auxiliary-source', layerOriginal]]),
        });
        const pixelAt = (image: RGBAImage, x: number, y: number) => [
          ...image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4),
        ];
        for (const [index, stage] of [
          { type: 'preview', maxPixels: interactiveBudget, size: 8, pixel: previewPixel },
          { type: 'preview', maxPixels: MAX_PREVIEW_PIXELS, size: 16, pixel: previewPixel },
          { type: 'export', size: 32, pixel: originalPixel },
          // Reusing the cached interactive source after transferable replies must remain valid.
          { type: 'preview', maxPixels: interactiveBudget, size: 8, pixel: previewPixel },
        ].entries()) {
          const reply = await send({
            type: stage.type,
            id: 30 + index,
            recipe: mixedRecipe,
            maxPixels: stage.maxPixels,
          });
          assert.equal(
            reply.error,
            undefined,
            `${stage.type} stage ${index} accepts the auxiliary source`,
          );
          assert.deepEqual([reply.result.width, reply.result.height], [stage.size, stage.size]);
          assert.deepEqual(pixelAt(reply.result, 0, 0), basePixel);
          assert.deepEqual(pixelAt(reply.result, stage.size / 2, stage.size / 2), stage.pixel);
          assert.deepEqual(
            mixedRecipe,
            beforeRecipe,
            'normalized placement and all layer values remain unchanged',
          );
          assert.deepEqual(
            sources,
            beforeSources,
            'cached previews and full-resolution sources retain their pixels',
          );
        }
      },
    );

    await t.test(
      'the separate live worker resets source caches and still validates original dimensions',
      async () => {
        const colors = [
          [210, 38, 64, 255],
          [28, 160, 88, 255],
        ];
        for (const [index, color] of colors.entries()) {
          const image: RGBAImage = {
            width: 640,
            height: 480,
            data: Uint8ClampedArray.from({ length: 640 * 480 * 4 }, (_, at) => color[at % 4]),
          };
          await send({
            type: 'interactive-source',
            image,
            sourceDimensions: { width: 1280, height: 960 },
          });
          const reply = await send({
            type: 'interactive-preview',
            id: 50 + index,
            recipe: createRecipeV4(),
          });
          assert.equal(reply.error, undefined);
          assert.ok(reply.result.width * reply.result.height <= INTERACTIVE_PREVIEW_PIXELS);
          assert.deepEqual(
            [...reply.result.data.subarray(0, 4)],
            color,
            'new source must never reuse the old image cache',
          );
          assert.equal(
            image.data.length,
            640 * 480 * 4,
            'transferred display frames do not detach source pixels',
          );
        }
        const exportAttempt = await send({ type: 'export', id: 52, recipe: createRecipeV4() });
        assert.ok(exportAttempt.error, 'a live-only worker cannot export stale original pixels');
        await send({
          type: 'interactive-source',
          image: fixture(16, 16),
          sourceDimensions: { width: 5000, height: 5000 },
        });
        const invalid = await send({
          type: 'interactive-preview',
          id: 53,
          recipe: createRecipeV4(),
        });
        assert.match(invalid.error, /16.8MP/);
      },
    );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'self', descriptor);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
