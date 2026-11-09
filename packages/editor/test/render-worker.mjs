import { parentPort, workerData } from 'node:worker_threads';
import { renderRecipe } from '../src/index.ts';

const result = renderRecipe(workerData.image, workerData.recipe);
parentPort.postMessage(result, [result.data.buffer]);
