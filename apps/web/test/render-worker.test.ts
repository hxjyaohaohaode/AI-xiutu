import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecipeV3, type RGBAImage } from '@ai-xiutu/editor';

test('worker fallback keeps original pixels after transfer, resolves layer aliases and clears them for a new source', async () => {
  // Node has no browser encoder. Exercise the real worker's transfer-buffer
  // fallback; browser encoding is verified separately in the browser suite.
  const replies: any[] = [];
  const scope = {
    onmessage: null as null | ((event: { data: any }) => void | Promise<void>),
    postMessage(value: any, options: Transferable[] | StructuredSerializeOptions = []) {
      const transfer = Array.isArray(options) ? options : options.transfer;
      replies.push(structuredClone(value, { transfer }));
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'self');
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  try {
    await import('../src/editor/render.worker.ts');
    const send = async (data: any) => {
      await scope.onmessage!({ data });
      return replies.at(-1);
    };
    const image = (r: number, g: number, b: number): RGBAImage => ({
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([r, g, b, 255, r, g, b, 255]),
    });
    const original = image(18, 45, 90);
    const untouched = [...original.data];
    const layer = image(80, 190, 30);
    await send({
      type: 'source',
      image: original,
      original,
      images: new Map([['local-one', layer]]),
      originalImages: new Map([['local-one', layer]]),
    });
    const first = await send({
      type: 'export',
      id: 1,
      originalOnly: true,
      recipe: createRecipeV3(),
      format: 'png',
    });
    assert.equal(first.id, 1);
    assert.deepEqual([...first.result.data], untouched);
    assert.deepEqual([...original.data], untouched);
    const second = await send({
      type: 'export',
      id: 2,
      originalOnly: true,
      recipe: createRecipeV3(),
      format: 'png',
    });
    assert.equal(second.id, 2);
    assert.deepEqual([...second.result.data], untouched);
    assert.deepEqual([...original.data], untouched);
    const recipe = createRecipeV3();
    recipe.imageLayers.push({
      id: 'image-one',
      name: 'Imported layer',
      sourceId: 'cloud-one',
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
    await send({ type: 'rekey-sources', mapping: new Map([['local-one', 'cloud-one']]) });
    const composite = await send({ type: 'export', id: 3, recipe, format: 'png' });
    assert.equal(composite.error, undefined);
    assert.deepEqual([...composite.result.data], [...layer.data]);
    assert.deepEqual([...original.data], untouched);
    // Retaining the old key permits undo before cloud save to keep rendering.
    recipe.imageLayers[0]!.sourceId = 'local-one';
    const undone = await send({ type: 'export', id: 4, recipe, format: 'png' });
    assert.deepEqual([...undone.result.data], [...layer.data]);
    const next = image(230, 160, 40);
    await send({ type: 'source', image: next, original: next });
    const missing = await send({ type: 'export', id: 5, recipe, format: 'png' });
    assert.equal(missing.id, 5);
    assert.ok(missing.error, 'a new source must not inherit private layers from the old source');
    const clean = await send({ type: 'export', id: 6, recipe: createRecipeV3(), format: 'png' });
    assert.deepEqual([...clean.result.data], [...next.data]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'self', previous);
    else Reflect.deleteProperty(globalThis, 'self');
  }
});
