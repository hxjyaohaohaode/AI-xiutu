import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import { parseEditorRecipe, renderEditorRecipeTiled } from '@ai-xiutu/editor';

try {
  const images = new Map();
  for (const input of workerData.inputs) {
    const image = sharp(
      Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength),
      {
        limitInputPixels: workerData.maxPixels,
        failOn: 'warning',
      },
    );
    const meta = await image.metadata();
    if (
      meta.format !== 'png' ||
      (meta.pages ?? 1) !== 1 ||
      meta.width !== input.width ||
      meta.height !== input.height
    )
      throw new Error('VERSION_SOURCE_METADATA');
    const rgba = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer();
    images.set(input.id, {
      width: input.width,
      height: input.height,
      data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
    });
  }
  const source = images.get(workerData.sourceId);
  const recipe = parseEditorRecipe(workerData.recipe);
  const image = renderEditorRecipeTiled(source, recipe, {
    images,
    maxPixels: workerData.maxPixels,
    tileSize: 128,
  });
  const png = await sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 4 },
  })
    .png()
    .toBuffer();
  parentPort.postMessage({ width: image.width, height: image.height, png });
} catch (error) {
  parentPort.postMessage({ error: error instanceof RangeError ? 'BUDGET' : 'INVALID' });
}
