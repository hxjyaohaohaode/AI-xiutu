import {
  renderEditorRecipe,
  renderEditorRecipeTiled,
  getEditorOutputDimensions,
  MAX_V3_PIXELS,
  type RGBAImage,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import { prepareBudgetedPreview, MAX_PREVIEW_PIXELS } from './previewBudget';

let preview: RGBAImage | null = null;
let original: RGBAImage | null = null;
let images = new Map<string, RGBAImage>(),
  originalImages = new Map<string, RGBAImage>();
type Message = {
  type: string;
  id: number;
  image?: RGBAImage;
  original?: RGBAImage;
  recipe?: EditorRecipe;
  originalOnly?: boolean;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  images?: Map<string, RGBAImage>;
  originalImages?: Map<string, RGBAImage>;
  sourceId?: string;
  mapping?: Map<string, string>;
};
self.onmessage = async (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'source') {
    preview = message.image ?? null;
    original = message.original ?? null;
    images = message.images ?? new Map();
    originalImages = message.originalImages ?? new Map();
    return;
  }
  if (message.type === 'image-source') {
    if (message.sourceId && message.image) {
      images.set(message.sourceId, message.image);
      if (message.original) originalImages.set(message.sourceId, message.original);
    }
    return;
  }
  if (message.type === 'rekey-sources') {
    for (const [from, to] of message.mapping ?? []) {
      const p = images.get(from),
        o = originalImages.get(from);
      if (p) images.set(to, p);
      if (o) originalImages.set(to, o);
    }
    return;
  }
  if (message.type === 'layer-sources') {
    images = message.images ?? new Map();
    return;
  }
  try {
    const source = message.type === 'export' ? original : preview;
    if (!source || !message.recipe) throw new Error('请先导入图片。');
    if (message.type !== 'export' && original) {
      if (message.recipe.schemaVersion === 3 && original.width * original.height > MAX_V3_PIXELS)
        throw new Error('原图超过 V3 的 16.8MP 编辑上限，请明确准备较小副本。');
      // A smaller preview must not make an unexportable full-resolution transform appear valid.
      getEditorOutputDimensions(original, message.recipe);
    }
    const result =
      message.type === 'export'
        ? message.originalOnly
          ? source
          : renderEditorRecipeTiled(source, message.recipe, {
              maxPixels: message.recipe.schemaVersion === 3 ? 16_777_216 : 67_108_864,
              images: originalImages,
              tileSize: 512,
            })
        : renderEditorRecipe(prepareBudgetedPreview(source, message.recipe), message.recipe, {
            maxPixels: MAX_PREVIEW_PIXELS,
            images,
          });
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
