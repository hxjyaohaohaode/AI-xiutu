import { renderRecipe, renderRecipeTiled, type RGBAImage, type RecipeV1 } from '@ai-xiutu/editor';

let preview: RGBAImage | null = null;
let original: RGBAImage | null = null;
type Message = {
  type: string;
  id: number;
  image?: RGBAImage;
  original?: RGBAImage;
  recipe?: RecipeV1;
  originalOnly?: boolean;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
};
self.onmessage = async (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'source') {
    preview = message.image ?? null;
    original = message.original ?? null;
    return;
  }
  try {
    const source = message.type === 'export' ? original : preview;
    if (!source || !message.recipe) throw new Error('请先导入图片。');
    const result =
      message.type === 'export'
        ? message.originalOnly
          ? source
          : renderRecipeTiled(source, message.recipe, { maxPixels: 67_108_864, tileSize: 512 })
        : renderRecipe(source, message.recipe, { maxPixels: 4_194_304 });
    if (message.type === 'export' && typeof OffscreenCanvas !== 'undefined') {
      const format = message.format ?? 'png';
      const canvas = new OffscreenCanvas(result.width, result.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前浏览器无法创建导出画布。');
      const pixels = new Uint8ClampedArray(
        result.data.buffer as ArrayBuffer,
        result.data.byteOffset,
        result.data.byteLength,
      );
      context.putImageData(new ImageData(pixels, result.width, result.height), 0, 0);
      if (format === 'jpeg') {
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      const blob = await canvas.convertToBlob({
        type: `image/${format}`,
        quality: message.quality ?? 0.94,
      });
      canvas.width = 1;
      canvas.height = 1;
      if (blob.type !== `image/${format}`)
        throw new Error(
          `这个浏览器未提供 ${format.toUpperCase()} 编码，请选择 PNG 或其他可用格式。`,
        );
      self.postMessage({ id: message.id, type: message.type, blob });
    } else {
      const safeResult = message.originalOnly
        ? { ...result, data: new Uint8ClampedArray(result.data) }
        : result;
      self.postMessage(
        { id: message.id, type: message.type, result: safeResult },
        { transfer: [safeResult.data.buffer] },
      );
    }
  } catch (error) {
    self.postMessage({
      id: message.id,
      type: message.type,
      error:
        error instanceof Error ? error.message : '图像处理失败。可降低明确选择的分辨率预算后重试。',
    });
  }
};
