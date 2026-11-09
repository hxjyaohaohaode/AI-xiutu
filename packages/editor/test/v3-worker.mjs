import { parentPort } from 'node:worker_threads';
import { renderEditorRecipeTiled } from '../src/index.ts';
parentPort.once('message', ({ width, height, buffer, recipe, images }) => {
  try {
    const resolved = new Map(
      images.map(([id, image]) => [
        id,
        { width: image.width, height: image.height, data: new Uint8ClampedArray(image.buffer) },
      ]),
    );
    const result = renderEditorRecipeTiled(
      { width, height, data: new Uint8ClampedArray(buffer) },
      recipe,
      { tileSize: 19, images: resolved },
    );
    parentPort.postMessage(
      { width: result.width, height: result.height, buffer: result.data.buffer },
      [result.data.buffer],
    );
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
