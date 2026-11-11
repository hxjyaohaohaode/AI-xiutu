import { renderRecipeV4 } from '@ai-xiutu/editor';
import type { RGBAImage } from '@ai-xiutu/editor';
import { createSampleRecipe } from './sample';
import type { SampleSettings } from './sample-settings';

let source: RGBAImage | null = null;
self.onmessage = (
  event: MessageEvent<
    SampleSettings & {
      id: number;
      source?: RGBAImage;
    }
  >,
) => {
  const request = event.data;
  if (request.source) source = request.source;
  if (!source || source.width * source.height > 400_000) {
    self.postMessage({ id: request.id, error: true });
    return;
  }
  try {
    const recipe = createSampleRecipe(request);
    const rendered = renderRecipeV4(source, recipe, { maxPixels: 400_000 });
    const data = new Uint8ClampedArray(rendered.data);
    self.postMessage({ id: request.id, image: { ...rendered, data } }, { transfer: [data.buffer] });
  } catch {
    self.postMessage({ id: request.id, error: true });
  }
};
