import { renderCutout, type RGBAImage, type SelectionMaskV3 } from '@ai-xiutu/editor';
import { collageContext } from './collage-render';
import { drawCollageSource } from './collage-media';
import type { CollagePoint } from './collage-layout';

export function traceCollageMatte(width: number, height: number, points: CollagePoint[]) {
  const scale = Math.min(1, 2048 / Math.max(width, height));
  const matte = document.createElement('canvas');
  matte.width = Math.max(1, Math.round(width * scale));
  matte.height = Math.max(1, Math.round(height * scale));
  const context = collageContext(matte);
  context.filter = 'blur(0.55px)';
  context.beginPath();
  points.forEach(({ x, y }, index) => {
    const pixelX = x * matte.width,
      pixelY = y * matte.height;
    if (index === 0) context.moveTo(pixelX, pixelY);
    else context.lineTo(pixelX, pixelY);
  });
  context.closePath();
  context.fill('evenodd');
  return matte;
}

export async function personCollageMatte(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  signal: AbortSignal,
) {
  const factor = Math.min(1, 640 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * factor));
  const height = Math.max(1, Math.round(sourceHeight * factor));
  const alpha = document.createElement('canvas');
  alpha.width = width;
  alpha.height = height;
  const context = collageContext(alpha);
  drawCollageSource(context, source, { x: 0, y: 0, width, height });
  const pixels = context.getImageData(0, 0, width, height);
  const data = new Uint8ClampedArray(pixels.data);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const contentHash = Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  signal.throwIfAborted();
  const worker = new Worker(new URL('../editor/portrait.worker.ts', import.meta.url), {
    type: 'module',
  });
  const mask = await new Promise<SelectionMaskV3>((resolve, reject) => {
    const listeners = new AbortController();
    const finish = (mask?: SelectionMaskV3, error?: Error) => {
      window.clearTimeout(timeout);
      listeners.abort();
      worker.terminate();
      if (mask) resolve(mask);
      else reject(error ?? new Error('COLLAGE_SUBJECT'));
    };
    const timeout = window.setTimeout(() => finish(), 30_000);
    signal.addEventListener(
      'abort',
      () => finish(undefined, new DOMException('Aborted', 'AbortError')),
      {
        signal: listeners.signal,
      },
    );
    worker.addEventListener('error', () => finish(), { signal: listeners.signal });
    worker.addEventListener(
      'message',
      ({
        data,
      }: MessageEvent<{
        error?: string;
        result?: { segmentation?: { subject?: SelectionMaskV3 } };
      }>) => {
        if (data.result || data.error) finish(data.result?.segmentation?.subject);
      },
      { signal: listeners.signal },
    );
    const image: RGBAImage = { width, height, data };
    worker.postMessage(
      { id: 1, image, width, height, body: false, segmentation: true, contentHash },
      [data.buffer],
    );
  });
  signal.throwIfAborted();
  const refined = renderCutout(
    { width, height, data: pixels.data },
    {
      algorithm: 'guided-v4',
      selection: mask,
      radius: 0.009,
      decontaminate: 0,
    },
  );
  const result = context.createImageData(width, height);
  for (let index = 3; index < result.data.length; index += 4)
    result.data[index] = refined.data[index]!;
  context.putImageData(result, 0, 0);
  return alpha;
}
