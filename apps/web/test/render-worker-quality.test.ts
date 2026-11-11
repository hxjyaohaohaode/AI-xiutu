import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecipeV4, renderEditorRecipe, type RGBAImage } from '@ai-xiutu/editor';

test('all live tools preserve the original raster, cached pixels and auxiliary sources', async (t) => {
  const replies: any[] = [];
  const scope = {
    onmessage: null as null | ((event: { data: any }) => void | Promise<void>),
    postMessage(value: any, options: Transferable[] | StructuredSerializeOptions = []) {
      replies.push(
        structuredClone(value, { transfer: Array.isArray(options) ? options : options.transfer }),
      );
    },
  };
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../src/editor/render.worker.ts');
    const send = async (data: any) => {
      await scope.onmessage!({ data });
      const reply = replies.at(-1);
      if (data.type === 'interactive-preview') assert.equal(reply.error, undefined);
      return reply;
    };
    const source: RGBAImage = {
      width: 768,
      height: 512,
      data: Uint8ClampedArray.from({ length: 768 * 512 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (i * 53 + Math.floor(i / 3072) * 23) % 256,
      ),
    };
    const original = source.data.slice();
    let id = 0;
    await t.test(
      'saturation and curve changes keep more than four million original pixels',
      async () => {
        const large: RGBAImage = {
          width: 2304,
          height: 1856,
          data: Uint8ClampedArray.from({ length: 2304 * 1856 * 4 }, (_, i) =>
            i % 4 === 3 ? 255 : ((i * 37) ^ (i >> 12)) & 255,
          ),
        };
        await send({ type: 'interactive-source', image: large, sourceDimensions: large });
        const recipe = createRecipeV4({ adjustments: { saturation: 33, contrast: -4 } });
        recipe.curves.rgb = [
          [0, 0],
          [0.46, 0.52],
          [1, 1],
        ];
        const preview = await send({
          type: 'interactive-preview',
          id: ++id,
          recipe,
        });
        assert.deepEqual(
          preview.result,
          renderEditorRecipe(large, recipe, { maxPixels: 16_777_216 }),
        );
      },
    );

    await t.test(
      'mixed color and flow-v2 retain the same pixels and keep cached buffers attached',
      async () => {
        await send({ type: 'interactive-source', image: source, sourceDimensions: source });
        const color = createRecipeV4();
        color.adjustments.contrast = 15;
        for (let i = 0; i < 3; i++) {
          color.adjustments.exposure = i * 0.1;
          const colorFrame = await send({
            type: 'interactive-preview',
            id: ++id,
            recipe: structuredClone(color),
          });
          assert.deepEqual(colorFrame.result, renderEditorRecipe(source, color));
        }
        const warp = structuredClone(color);
        warp.warp.enabled = true;
        warp.warp.strokes.push({
          id: 'detail-flow',
          algorithm: 'flow-v2',
          resampling: 'bounded-cubic-v1',
          mode: 'push',
          from: { x: 0.45, y: 0.5 },
          to: { x: 0.51, y: 0.47 },
          radius: 0.18,
          feather: 0.7,
          strength: 0.45,
        });
        const detail = await send({
          type: 'interactive-preview',
          id: ++id,
          previewQuality: 'warp',
          recipe: warp,
        });
        assert.equal(detail.result.width, source.width);
        assert.equal(detail.result.height, source.height);
        assert.deepEqual(detail.result, renderEditorRecipe(source, warp));
        const fastAgain = await send({
          type: 'interactive-preview',
          id: ++id,
          recipe: structuredClone(color),
        });
        assert.deepEqual(fastAgain.result, renderEditorRecipe(source, color));

        // A zero-displacement warp can return the cached pre-warp buffer itself.
        // Exercise a real transferable reply twice before a changed stroke reuses it.
        const neutral = createRecipeV4();
        for (let i = 0; i < 2; i++) {
          const result = await send({
            type: 'interactive-preview',
            id: ++id,
            previewQuality: 'warp',
            recipe: neutral,
          });
          assert.deepEqual(result.result, renderEditorRecipe(source, neutral));
        }
        neutral.warp = structuredClone(warp.warp);
        const resumed = await send({
          type: 'interactive-preview',
          id: ++id,
          previewQuality: 'warp',
          recipe: neutral,
        });
        assert.deepEqual(resumed.result, renderEditorRecipe(source, neutral));
        assert.deepEqual(source.data, original);
      },
    );

    await t.test(
      'layer replacement, aliases and a new source remain aligned in the detail lane',
      async () => {
        const image = (r: number, g: number, b: number): RGBAImage => ({
          width: 2,
          height: 1,
          data: new Uint8ClampedArray([r, g, b, 255, r, g, b, 255]),
        });
        const base = image(20, 40, 60);
        const first = image(180, 40, 80);
        const second = image(20, 160, 70);
        await send({
          type: 'interactive-source',
          image: base,
          sourceDimensions: base,
          images: new Map([['local', first]]),
        });
        const recipe = createRecipeV4();
        recipe.imageLayers.push({
          id: 'layer',
          name: 'Layer',
          sourceId: 'local',
          enabled: true,
          opacity: 1,
          blendMode: 'normal',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          rotationDegrees: 0,
          flipX: false,
          flipY: false,
          mask: null,
        });
        const preview = () =>
          send({ type: 'interactive-preview', id: ++id, previewQuality: 'warp', recipe });
        assert.deepEqual((await preview()).result.data, first.data);
        await send({ type: 'image-source', sourceId: 'local', image: second });
        assert.deepEqual((await preview()).result.data, second.data);
        await send({ type: 'rekey-sources', mapping: new Map([['local', 'cloud']]) });
        recipe.imageLayers[0]!.sourceId = 'cloud';
        assert.deepEqual((await preview()).result.data, second.data);
        await send({ type: 'layer-sources', images: new Map([['cloud', first]]) });
        assert.deepEqual((await preview()).result.data, first.data);
        await send({ type: 'interactive-source', image: second, sourceDimensions: second });
        const clean = await send({
          type: 'interactive-preview',
          id: ++id,
          previewQuality: 'warp',
          recipe: createRecipeV4(),
        });
        assert.deepEqual(clean.result.data, second.data);
        await scope.onmessage!({
          data: { type: 'interactive-preview', id: ++id, previewQuality: 'warp', recipe },
        });
        assert.match(replies.at(-1).error, /Missing resolved image layer/);
      },
    );
  } finally {
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
