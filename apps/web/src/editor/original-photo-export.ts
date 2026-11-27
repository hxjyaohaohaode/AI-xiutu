import { originalPhotoExportSupported, type Dimensions, type EditorRecipe } from '@ai-xiutu/editor';

export { originalPhotoExportSupported };

export function originalPhotoExportAvailable(): boolean {
  return (
    typeof Worker === 'function' &&
    typeof OffscreenCanvas === 'function' &&
    typeof createImageBitmap === 'function' &&
    typeof CompressionStream === 'function'
  );
}

export async function exportOriginalPhoto(
  file: File,
  recipe: EditorRecipe,
  originalDims: Dimensions,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  signal?.throwIfAborted();
  if (!originalPhotoExportAvailable()) throw new Error('当前浏览器不支持后台原尺寸 PNG 导出。');
  if (!originalPhotoExportSupported(recipe)) throw new Error('此配方含原尺寸导出尚未支持的编辑。');
  const worker = new Worker(new URL('./original-photo-export.worker.ts', import.meta.url), {
    type: 'module',
  });
  const progress = (fraction: number) => {
    try {
      onProgress?.(fraction);
    } catch {
      /* A display callback does not affect encoding. */
    }
  };
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const abort = () => reject(signal?.reason ?? new DOMException('导出已取消。', 'AbortError'));
      const clean = () => signal?.removeEventListener('abort', abort);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = (
        event: MessageEvent<{ result?: Blob; error?: string; progress?: number }>,
      ) => {
        if (typeof event.data.progress === 'number') {
          progress(event.data.progress);
          return;
        }
        clean();
        if (event.data.result instanceof Blob && event.data.result.type === 'image/png') {
          progress(1);
          resolve(event.data.result);
        } else reject(new Error(event.data.error || '原尺寸导出未返回有效 PNG。'));
      };
      worker.onerror = () => {
        clean();
        reject(new Error('原尺寸导出工作线程中断。'));
      };
      worker.onmessageerror = () => {
        clean();
        reject(new Error('无法接收原尺寸导出结果。'));
      };
      try {
        worker.postMessage({ file, recipe, originalDims });
      } catch (error) {
        clean();
        reject(error);
      }
    });
  } finally {
    worker.terminate();
  }
}
