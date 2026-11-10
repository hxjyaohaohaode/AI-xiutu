import {
  renderEditorRecipe,
  renderEditorRecipeTiled,
  renderCutout,
  type CutoutSettings,
  getEditorOutputDimensions,
  MAX_V3_PIXELS,
  type Dimensions,
  type RGBAImage,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import {
  prepareBudgetedPreview,
  prepareInteractiveSource,
  INTERACTIVE_PREVIEW_PIXELS,
  MAX_PREVIEW_PIXELS,
} from './previewBudget';
import { editorGeometryKey } from './coordinates';

let preview: RGBAImage | null = null;
let original: RGBAImage | null = null;
let sourceDimensions: Dimensions | null = null;
let liveBudget = INTERACTIVE_PREVIEW_PIXELS;
let images = new Map<string, RGBAImage>(),
  originalImages = new Map<string, RGBAImage>();
const previewSources = new Map<string, RGBAImage>();
function preparedSource(source: RGBAImage, recipe: EditorRecipe, maxPixels: number) {
  const key = `${maxPixels}:${editorGeometryKey(recipe)}`;
  const cached = previewSources.get(key);
  if (cached) return cached;
  const image = prepareBudgetedPreview(source, recipe, maxPixels);
  if (previewSources.size >= 3) previewSources.delete(previewSources.keys().next().value!);
  previewSources.set(key, image);
  return image;
}
type Message = {
  type: string;
  id: number;
  image?: RGBAImage;
  original?: RGBAImage;
  sourceDimensions?: Dimensions;
  recipe?: EditorRecipe;
  originalOnly?: boolean;
  format?: 'png' | 'jpeg' | 'webp';
  quality?: number;
  maxPixels?: number;
  images?: Map<string, RGBAImage>;
  originalImages?: Map<string, RGBAImage>;
  sourceId?: string;
  mapping?: Map<string, string>;
  cutout?: CutoutSettings;
};
self.onmessage = async (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'interactive-source') {
    original = null;
    originalImages.clear();
    previewSources.clear();
    sourceDimensions = message.sourceDimensions ?? null;
    preview = message.image ? prepareInteractiveSource(message.image) : null;
    images = new Map(
      [...(message.images ?? [])].map(([id, value]) => [id, prepareInteractiveSource(value)]),
    );
    liveBudget = INTERACTIVE_PREVIEW_PIXELS;
    return;
  }
  if (message.type === 'source') {
    preview = message.image ?? null;
    original = message.original ?? null;
    sourceDimensions = original;
    images = message.images ?? new Map();
    originalImages = message.originalImages ?? new Map();
    previewSources.clear();
    liveBudget = INTERACTIVE_PREVIEW_PIXELS;
    return;
  }
  if (message.type === 'image-source') {
    if (message.sourceId && message.image) {
      images.set(
        message.sourceId,
        sourceDimensions && !original ? prepareInteractiveSource(message.image) : message.image,
      );
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
    if (message.type !== 'export' && sourceDimensions) {
      if (
        (message.recipe.schemaVersion === 3 || message.recipe.schemaVersion === 4) &&
        sourceDimensions.width * sourceDimensions.height > MAX_V3_PIXELS
      )
        throw new Error('原图超过 V3 的 16.8MP 编辑上限，请明确准备较小副本。');
      // A smaller preview must not make an unexportable full-resolution transform appear valid.
      getEditorOutputDimensions(sourceDimensions, message.recipe);
    }
    const interactive = message.type === 'interactive-preview';
    const budget = interactive ? liveBudget : (message.maxPixels ?? MAX_PREVIEW_PIXELS);
    const started = performance.now();
    let renderImages = images;
    if (interactive && 'imageLayers' in message.recipe) {
      renderImages = new Map();
      for (const layer of message.recipe.imageLayers) {
        const image = images.get(layer.sourceId);
        if (image && !renderImages.has(layer.sourceId))
          renderImages.set(layer.sourceId, prepareInteractiveSource(image, budget));
      }
    }
    const result =
      message.type === 'export'
        ? message.cutout
          ? renderCutout(source, message.cutout)
          : message.originalOnly
            ? source
            : renderEditorRecipeTiled(source, message.recipe, {
                maxPixels:
                  message.recipe.schemaVersion === 3 || message.recipe.schemaVersion === 4
                    ? 16_777_216
                    : 67_108_864,
                images: originalImages,
                tileSize: 512,
              })
        : renderEditorRecipe(preparedSource(source, message.recipe, budget), message.recipe, {
            // Output is budgeted before rendering; validated auxiliary previews
            // keep their own dimensions and normalized placement.
            maxPixels: MAX_PREVIEW_PIXELS,
            images: renderImages,
          });
    // Lower the raster budget after an expensive frame. All recipe stages are still evaluated.
    if (interactive && performance.now() - started > 42 && liveBudget > 32_768) liveBudget /= 2;
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
