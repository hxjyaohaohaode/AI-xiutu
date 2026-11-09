import { parentPort } from 'node:worker_threads';
import { renderEditorRecipeTiled } from '../src/index.ts';

parentPort.once('message', ({ width, height, buffer, recipe }) => {
  try {
    const result = renderEditorRecipeTiled(
      { width, height, data: new Uint8ClampedArray(buffer) },
      recipe,
      { tileSize: 17 },
    );
    parentPort.postMessage(
      { width: result.width, height: result.height, buffer: result.data.buffer },
      [result.data.buffer],
    );
  } catch (error) {
    parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
