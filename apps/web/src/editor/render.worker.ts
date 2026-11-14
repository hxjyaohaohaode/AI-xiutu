import {
  renderEditorRecipe,
  renderEditorRecipeTiled,
  renderCutout,
  encodeRgbaPng,
  type CutoutSettings,
  getEditorOutputDimensions,
  localEditorSourceLimits,
  MAX_EXPLICIT_PIXELS,
  computeHistogram,
  pointPreviewMode,
  preparePointPreview,
  WarpPreviewCache,
  type Dimensions,
  type RGBAImage,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import {
  interactiveRaster,
  prepareBudgetedPreview,
  MAX_INTERACTIVE_PIXELS,
  MAX_PREVIEW_PIXELS,
} from './previewBudget';
import { editorGeometryKey } from './coordinates';
import { fitsNativePreview } from './native-preview';

let preview: RGBAImage | null = null;
let original: RGBAImage | null = null;
const draftSources = new Map<number, RGBAImage>();
const draftLimits = [76_800, 153_600, MAX_INTERACTIVE_PIXELS];
let draftLevel = 1;
let draftDuration = 0;
let sourceDimensions: Dimensions | null = null;
let images = new Map<string, RGBAImage>(),
  originalImages = new Map<string, RGBAImage>();
const previewSources = new Map<string, RGBAImage>();
const warpPreviewCache = new WarpPreviewCache();
let pointPreview: ReturnType<typeof preparePointPreview> | undefined;
let recycledBuffer: ArrayBuffer | undefined;
function preparedSource(source: RGBAImage, recipe: EditorRecipe, maxPixels: number) {
  const key = `${source.width}x${source.height}:${maxPixels}:${editorGeometryKey(recipe, false)}`;
  const cached = previewSources.get(key);
  if (cached) return cached;
  const image = prepareBudgetedPreview(source, recipe, maxPixels);
  if (previewSources.size >= 3) previewSources.delete(previewSources.keys().next().value!);
  previewSources.set(key, image);
  return image;
}
function draftRaster(source: RGBAImage, limit: number) {
  const cached = draftSources.get(limit);
  if (cached) return cached;
  const raster = interactiveRaster(source, limit);
  draftSources.set(limit, raster);
  return raster;
}
type Message = {
  type: string;
  id: number;
  image?: RGBAImage;
  original?: RGBAImage;
  buffer?: ArrayBuffer;
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
  previewQuality?: 'fast' | 'warp' | 'full';
  prewarmWarp?: boolean;
};
self.onmessage = async (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'source' || message.type === 'interactive-source') {
    preview = message.image ?? null;
    original = message.type === 'source' ? (message.original ?? null) : null;
    draftSources.clear();
    draftLevel = 1;
    draftDuration = 0;
    sourceDimensions = message.sourceDimensions ?? original ?? preview;
    images = message.images ?? new Map();
    originalImages = message.originalImages ?? new Map();
    previewSources.clear();
    warpPreviewCache.clear();
    recycledBuffer = undefined;
    pointPreview =
      message.type === 'interactive-source' &&
      preview &&
      sourceDimensions &&
      preview.width === sourceDimensions.width &&
      preview.height === sourceDimensions.height &&
      fitsNativePreview(preview.width, preview.height)
        ? preparePointPreview(preview)
        : undefined;
    if (message.type === 'interactive-source' && preview)
      draftRaster(preview, draftLimits[draftLevel]!);
    return;
  }
  if (message.type === 'recycle-point-preview') {
    if (
      pointPreview &&
      message.buffer?.byteLength &&
      message.buffer.byteLength <= (preview?.data.byteLength ?? 0)
    )
      recycledBuffer = message.buffer;
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
    const exporting = message.type === 'export';
    const interactive = message.type === 'interactive-preview';
    const warpDetail = interactive && message.previewQuality === 'warp';
    const fullSource = original ?? preview;
    // Settle on the native source whenever it fits. A spatial gesture can
    // temporarily sample a bounded raster of the same oriented photo.
    const native =
      !exporting &&
      message.maxPixels === undefined &&
      fullSource !== null &&
      sourceDimensions !== null &&
      fullSource.width === sourceDimensions.width &&
      fullSource.height === sourceDimensions.height &&
      fitsNativePreview(fullSource.width, fullSource.height);
    const source = exporting ? original : native ? fullSource : preview;
    if (!source || !message.recipe) throw new Error('请先导入图片。');
    if (exporting && message.cutout) {
      if (message.format !== undefined && message.format !== 'png')
        throw new Error('人物素材需要透明 PNG 格式。');
      const blob = await encodeRgbaPng(renderCutout(source, message.cutout));
      self.postMessage({ id: message.id, type: message.type, blob });
      return;
    }
    if (!exporting && sourceDimensions) {
      const version = message.recipe.schemaVersion;
      const { maxPixels: sourceCeiling } = localEditorSourceLimits(version);
      if (sourceDimensions.width * sourceDimensions.height > sourceCeiling)
        throw new Error(
          `原图超过 V${version} 的 ${(sourceCeiling / 1e6).toFixed(1)}MP 编辑像素上限，请准备较小副本。`,
        );
      // A smaller preview must not make an unexportable full-resolution transform appear valid.
      getEditorOutputDimensions(sourceDimensions, message.recipe);
    }
    const recipe = message.recipe;
    const mode = exporting ? null : pointPreviewMode(recipe);
    const useDraft = interactive && !warpDetail && message.previewQuality !== 'full' && !mode;
    const cache = !mode ? warpPreviewCache : undefined;
    const draftLimit = draftLimits[draftLevel]!;
    let recyclable = false;
    const renderPreview = () => {
      const input = useDraft
        ? preparedSource(
            draftRaster(source, draftLimit),
            recipe,
            draftLimit,
          )
        : native
          ? source
          : preparedSource(source, recipe, message.maxPixels ?? MAX_PREVIEW_PIXELS);
      const options = {
        maxPixels: native ? MAX_EXPLICIT_PIXELS : MAX_PREVIEW_PIXELS,
        images: native && original ? originalImages : images,
        warpPreviewCache: cache,
      };
      if (native && !warpDetail && mode && mode !== 'simple') {
        if (pointPreview === undefined) pointPreview = preparePointPreview(input);
        const mapped = pointPreview?.(recipe, recycledBuffer);
        if (mapped) {
          recyclable = message.type === 'interactive-preview';
          recycledBuffer = undefined;
          return mapped;
        }
      }
      if (!mode || warpDetail)
        return renderEditorRecipeTiled(input, recipe, { ...options, tileSize: 512 });
      return renderEditorRecipe(input, recipe, options);
    };
    if (warpDetail && message.prewarmWarp) {
      warpPreviewCache.prewarm(renderPreview);
      self.postMessage({ id: message.id, type: message.type });
      return;
    }
    const started = useDraft ? performance.now() : 0;
    const result = exporting
      ? message.originalOnly
        ? source
        : renderEditorRecipeTiled(source, message.recipe, {
            maxPixels: localEditorSourceLimits(recipe.schemaVersion).maxPixels,
            images: originalImages,
            tileSize: 512,
          })
      : renderPreview();
    if (useDraft) {
      const elapsed = performance.now() - started;
      draftDuration = draftDuration ? draftDuration * 0.6 + elapsed * 0.4 : elapsed;
      if (draftDuration > 65 && draftLevel > 0) draftLevel--;
      else if (draftDuration < 24 && draftLevel < draftLimits.length - 1) draftLevel++;
    }
    if (exporting && typeof OffscreenCanvas !== 'undefined') {
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
        message.originalOnly ||
        warpPreviewCache.keeps(result) ||
        result.data.buffer === source.data.buffer ||
        [...draftSources.values()].some((image) => image.data.buffer === result.data.buffer) ||
        [...previewSources.values()].some((image) => image.data.buffer === result.data.buffer)
          ? { ...result, data: new Uint8ClampedArray(result.data) }
          : result;
      self.postMessage(
        {
          id: message.id,
          type: message.type,
          result: safeResult,
          native,
          recyclable,
          histogram:
            message.type === 'preview' && result.width * result.height > MAX_PREVIEW_PIXELS
              ? computeHistogram(result, { maxPixels: MAX_EXPLICIT_PIXELS })
              : undefined,
        },
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
