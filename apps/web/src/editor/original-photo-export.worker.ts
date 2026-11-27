import {
  MAX_HEADER_BYTES,
  MAX_TILED_DIMENSION,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_PIXELS,
  photoOrientation,
  readImageHeader,
  renderOriginalPhotoPng,
  type Dimensions,
  type EditorRecipe,
} from '@ai-xiutu/editor';

self.onmessage = async (
  event: MessageEvent<{ file: File; recipe: EditorRecipe; originalDims: Dimensions }>,
) => {
  const { file, recipe, originalDims } = event.data;
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    if (!file.size || file.size > PHOTO_MAX_BYTES) throw new Error('原片须在 50 MiB 以内。');
    const bytes = new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer());
    const header = readImageHeader(bytes, {
      maxPixels: PHOTO_MAX_PIXELS,
      maxDimension: MAX_TILED_DIMENSION,
    });
    if (header.animated || (header.format !== 'png' && header.format !== 'jpeg'))
      throw new Error('原尺寸导出需要静态 JPEG 或 PNG 原片。');
    const turn = photoOrientation(bytes, header.format) >= 5;
    const width = turn ? header.height : header.width,
      height = turn ? header.width : header.height;
    if (width !== originalDims.width || height !== originalDims.height)
      throw new Error('文件尺寸与已保存的原片尺寸不符。');
    // Decode the original once, preserving the same EXIF and sRGB interpretation as import.
    const mime = header.format === 'jpeg' ? 'image/jpeg' : 'image/png';
    bitmap = await createImageBitmap(file.slice(0, file.size, mime), {
      imageOrientation: 'from-image',
    });
    if (bitmap.width !== width || bitmap.height !== height)
      throw new Error('浏览器解码后的尺寸与原片方向不符。');
    canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx || typeof CompressionStream !== 'function')
      throw new Error('浏览器缺少原尺寸 PNG 导出支持。');
    const source = bitmap,
      stripCanvas = canvas;
    let lastStep = 0;
    const result = await renderOriginalPhotoPng(
      { width, height },
      recipe,
      (rect) => {
        // Retain one strip-sized backing store. "copy" also replaces transparent pixels.
        if (stripCanvas.width !== rect.width) stripCanvas.width = rect.width;
        if (stripCanvas.height !== rect.height) stripCanvas.height = rect.height;
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(
          source,
          rect.left,
          rect.top,
          rect.width,
          rect.height,
          0,
          0,
          rect.width,
          rect.height,
        );
        const strip = ctx.getImageData(0, 0, rect.width, rect.height);
        if (ctx.isContextLost?.()) throw new Error('读取原片时画布被系统回收，请重新导出。');
        return strip;
      },
      (fraction) => {
        // The final result also covers compression and PNG framing.
        const step = Math.min(19, Math.floor(fraction * 20));
        if (step > lastStep) {
          lastStep = step;
          self.postMessage({ progress: step / 20 });
        }
      },
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '原尺寸导出失败。' });
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
};
