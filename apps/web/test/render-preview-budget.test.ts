import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV3,
  createRecipeV2,
  getEditorOutputDimensions,
  type RGBAImage,
} from '@ai-xiutu/editor';
import { prepareBudgetedPreview, MAX_PREVIEW_PIXELS } from '../src/editor/previewBudget.js';

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

test('actual worker protocol downsizes expanded previews and retains the full transformed export and layer coordinates', async () => {
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
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'self', descriptor);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
