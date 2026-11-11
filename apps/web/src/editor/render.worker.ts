import {
  renderEditorRecipe,
  renderEditorRecipeTiled,
  renderCutout,
  encodeRgbaPng,
  type CutoutSettings,
  getEditorOutputDimensions,
  localEditorSourceLimits,
  WarpPreviewCache,
  type Dimensions,
  type RGBAImage,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import {
  prepareBudgetedPreview,
  prepareInteractiveSource,
  MAX_PREVIEW_PIXELS,
} from './previewBudget';
import { editorGeometryKey } from './coordinates';
import {
  InteractivePreviewPolicy,
  MAX_INTERACTIVE_SOURCE_PIXELS,
  previewFamily,
  type PreviewFamily,
} from './interactive-preview-policy';
import { canPreviewNativeColor } from './native-preview';

let preview: RGBAImage | null = null;
let detailPreview: RGBAImage | null = null;
let original: RGBAImage | null = null;
let sourceDimensions: Dimensions | null = null;
const livePolicy = new InteractivePreviewPolicy();
let previousLiveRecipe: EditorRecipe | null = null;
let previousLiveFamily: PreviewFamily = 'color';
let images = new Map<string, RGBAImage>(),
  originalImages = new Map<string, RGBAImage>(),
  detailImages = new Map<string, RGBAImage>();
const previewSources = new Map<string, RGBAImage>();
const warpPreviewCache = new WarpPreviewCache();
function preparedSource(source: RGBAImage, recipe: EditorRecipe, maxPixels: number) {
  // Fast and warp-detail previews can request the same budget, but they must
  // retain independent source rasters. Never upscale a cached fast-lane source.
  const key = `${source === detailPreview ? 'detail' : 'fast'}:${maxPixels}:${editorGeometryKey(recipe, false)}`;
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
  previewQuality?: 'fast' | 'warp';
  prewarmWarp?: boolean;
};
self.onmessage = async (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'interactive-source') {
    original = null;
    originalImages.clear();
    previewSources.clear();
    warpPreviewCache.clear();
    sourceDimensions = message.sourceDimensions ?? null;
    detailPreview = message.image ?? null;
    detailImages = message.images ?? new Map();
    preview = message.image
      ? prepareInteractiveSource(message.image, MAX_INTERACTIVE_SOURCE_PIXELS)
      : null;
    images = new Map(
      [...(message.images ?? [])].map(([id, value]) => [
        id,
        prepareInteractiveSource(value, MAX_INTERACTIVE_SOURCE_PIXELS),
      ]),
    );
    livePolicy.reset();
    previousLiveRecipe = null;
    previousLiveFamily = 'color';
    return;
  }
  if (message.type === 'source') {
    preview = message.image ?? null;
    detailPreview = null;
    detailImages.clear();
    original = message.original ?? null;
    sourceDimensions = original;
    images = message.images ?? new Map();
    originalImages = message.originalImages ?? new Map();
    previewSources.clear();
    warpPreviewCache.clear();
    livePolicy.reset();
    previousLiveRecipe = null;
    previousLiveFamily = 'color';
    return;
  }
  if (message.type === 'image-source') {
    if (message.sourceId && message.image) {
      images.set(
        message.sourceId,
        sourceDimensions && !original
          ? prepareInteractiveSource(message.image, MAX_INTERACTIVE_SOURCE_PIXELS)
          : message.image,
      );
      if (message.original) originalImages.set(message.sourceId, message.original);
      if (detailPreview) detailImages.set(message.sourceId, message.image);
    }
    return;
  }
  if (message.type === 'rekey-sources') {
    for (const [from, to] of message.mapping ?? []) {
      const p = images.get(from),
        o = originalImages.get(from),
        detail = detailImages.get(from);
      if (p) images.set(to, p);
      if (o) originalImages.set(to, o);
      if (detail) detailImages.set(to, detail);
    }
    return;
  }
  if (message.type === 'layer-sources') {
    const next = message.images ?? new Map();
    if (detailPreview) {
      detailImages = next;
      images = new Map(
        [...next].map(([id, value]) => [
          id,
          prepareInteractiveSource(value, MAX_INTERACTIVE_SOURCE_PIXELS),
        ]),
      );
    } else images = next;
    return;
  }
  try {
    const interactive = message.type === 'interactive-preview';
    const detail = interactive && message.previewQuality === 'warp';
    const native = !!(
      interactive &&
      !detail &&
      message.recipe &&
      detailPreview &&
      sourceDimensions &&
      detailPreview.width === sourceDimensions.width &&
      detailPreview.height === sourceDimensions.height &&
      detailPreview.width * detailPreview.height <= MAX_PREVIEW_PIXELS &&
      canPreviewNativeColor(message.recipe)
    );
    const source =
      message.type === 'export' ? original : detail || native ? detailPreview : preview;
    if (!source || !message.recipe) throw new Error('请先导入图片。');
    if (message.type === 'export' && message.cutout) {
      if (message.format !== undefined && message.format !== 'png')
        throw new Error('人物素材需要透明 PNG 格式。');
      const blob = await encodeRgbaPng(renderCutout(source, message.cutout));
      self.postMessage({ id: message.id, type: message.type, blob });
      return;
    }
    if (message.type !== 'export' && sourceDimensions) {
      const version = message.recipe.schemaVersion;
      const { maxPixels: sourceCeiling } = localEditorSourceLimits(version);
      if (sourceDimensions.width * sourceDimensions.height > sourceCeiling)
        throw new Error(
          `原图超过 V${version} 的 ${(sourceCeiling / 1e6).toFixed(1)}MP 编辑像素上限，请准备较小副本。`,
        );
      // A smaller preview must not make an unexportable full-resolution transform appear valid.
      getEditorOutputDimensions(sourceDimensions, message.recipe);
    }
    const started = performance.now();
    const family =
      interactive && !detail && !native
        ? previewFamily(previousLiveRecipe, message.recipe, previousLiveFamily)
        : null;
    const frame = family ? livePolicy.begin(family, started) : null;
    const budget = native
      ? MAX_PREVIEW_PIXELS
      : (frame?.pixels ?? message.maxPixels ?? MAX_PREVIEW_PIXELS);
    let renderImages = detail ? detailImages : images;
    if (interactive && !detail && 'imageLayers' in message.recipe) {
      renderImages = new Map();
      for (const layer of message.recipe.imageLayers) {
        const image = images.get(layer.sourceId);
        if (image && !renderImages.has(layer.sourceId))
          renderImages.set(layer.sourceId, prepareInteractiveSource(image, budget));
      }
    }
    const recipe = message.recipe;
    const renderPreview = () =>
      renderEditorRecipe(preparedSource(source, recipe, budget), recipe, {
        // Output is budgeted before rendering; auxiliary previews retain their normalized placement.
        maxPixels: MAX_PREVIEW_PIXELS,
        images: renderImages,
        warpPreviewCache: detail ? warpPreviewCache : undefined,
      });
    if (detail && message.prewarmWarp) {
      warpPreviewCache.prewarm(renderPreview);
      self.postMessage({ id: message.id, type: message.type });
      return;
    }
    const result =
      message.type === 'export'
        ? message.originalOnly
          ? source
          : renderEditorRecipeTiled(source, message.recipe, {
              maxPixels: localEditorSourceLimits(recipe.schemaVersion).maxPixels,
              images: originalImages,
              tileSize: 512,
            })
        : renderPreview();
    if (frame) {
      const endedAt = performance.now();
      livePolicy.complete(frame, endedAt - started, endedAt);
      previousLiveRecipe = message.recipe;
      previousLiveFamily = frame.family;
    }
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
      const safeResult =
        message.originalOnly || (detail && warpPreviewCache.keeps(result))
          ? { ...result, data: new Uint8ClampedArray(result.data) }
          : result;
      self.postMessage(
        { id: message.id, type: message.type, result: safeResult, native },
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
