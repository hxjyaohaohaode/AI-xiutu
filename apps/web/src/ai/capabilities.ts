import { t } from '../i18n';
import { gifFrameCount, gifFrameDelay, imageBillableOutputs } from '@ai-xiutu/contracts';
import type { AIModel, ImageOptions } from './types';
export const COMMON_SIZES = [
  [1024, 1024],
  [1536, 1024],
  [1024, 1536],
  [2048, 2048],
  [2560, 1440],
  [1440, 2560],
  [3840, 2160],
  [2160, 3840],
  [4096, 4096],
] as const;
export function imageSizeError(
  model: AIModel | undefined,
  width: number,
  height: number,
  options?: ImageOptions,
): string | null {
  if (!model) return t('请先选择一个图像模型。');
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height))
    return t('宽高需要是整数像素。');
  const c = model.parameterCapabilities?.size;
  const gif = options?.outputFormat === 'gif' ? model.parameterCapabilities?.gif : undefined;
  if (c && !c.supported) return t(c.reason || '当前模型未开放尺寸设置。');
  if (c?.allowedSizes && !c.allowedSizes.includes(width + 'x' + height))
    return t(c.reason || '这个模型只开放列出的尺寸。');
  const maxDimension = Math.min(model.maxDimension ?? Infinity, gif?.maxDimension ?? c?.maxDimension ?? Infinity);
  const minWidth = model.minWidth ?? 64,
    minHeight = model.minHeight ?? 64;
  const maxWidth = Math.min(model.maxWidth ?? 8192, maxDimension),
    maxHeight = Math.min(model.maxHeight ?? 8192, maxDimension);
  if (width < minWidth || height < minHeight || width > maxWidth || height > maxHeight)
    return t('宽 {minWidth}–{maxWidth}，高 {minHeight}–{maxHeight} 像素。', {
      minWidth,
      maxWidth,
      minHeight,
      maxHeight,
    });
  const minPixels = gif?.minPixels ?? Math.max(model.minPixels ?? 1, c?.minPixels ?? 1);
  const maxPixels = Math.min(model.maxPixels ?? 0, c?.maxPixels ?? Infinity);
  if (!maxPixels) return t('服务尚未提供此模型的像素范围。');
  if (width * height < minPixels || width * height > maxPixels)
    return t('总像素需在 {min}–{max} 百万之间。', {
      min: (minPixels / 1e6).toFixed(2),
      max: (maxPixels / 1e6).toFixed(2),
    });
  const multiple = c?.multipleOf ?? 1;
  if (width % multiple || height % multiple)
    return t('宽高都需要是 {multiple} 的倍数。', { multiple });
  if (gif) {
    if (width * height * (options?.frameCount ?? gifFrameCount.default) > (gif.maxPixels ?? maxPixels))
      return t('动画的画幅与帧数超出模型像素预算。');
    return null;
  }
  const minRatio = Math.max(model.minAspectRatio ?? 0, c?.minAspectRatio ?? 0);
  const maxRatio = Math.min(model.maxAspectRatio ?? Infinity, c?.maxAspectRatio ?? Infinity);
  if (!minRatio || !Number.isFinite(maxRatio)) return t('服务尚未提供此模型的宽高比范围。');
  if (width / height < minRatio || width / height > maxRatio)
    return t('当前模型的宽高比需在 {min}–{max} 之间。', {
      min: minRatio.toFixed(2),
      max: maxRatio.toFixed(2),
    });
  return null;
}
export function allowedImageSizes(model: AIModel | undefined, options?: ImageOptions) {
  const gif = options?.outputFormat === 'gif';
  const fixed = (gif ? ['512x512', '512x768', '768x512', '768x768'] :
    model?.parameterCapabilities?.size.allowedSizes)?.map((value) =>
    value.split('x').map(Number),
  );
  return (fixed ?? COMMON_SIZES)
    .filter(([width, height]) => !imageSizeError(model, width!, height!, options))
    .map(([width, height]) => ({ width: width!, height: height! }));
}
export function defaultImageOptions(model: AIModel | undefined): ImageOptions {
  const caps = model?.parameterCapabilities;
  if (!caps) return {};
  const result: ImageOptions = {};
  for (const field of ['quality', 'background', 'outputFormat'] as const) {
    const c = caps[field];
    if (c.supported && c.values?.length)
      result[field] =
        typeof c.default === 'string' && c.values.includes(c.default) ? c.default : c.values[0];
  }
  if (caps.n.supported)
    result.n = Math.max(caps.n.min ?? 1, Math.min(caps.n.max ?? 1, Number(caps.n.default ?? 1)));
  if (caps.outputCompression.supported)
    result.outputCompression = Number(caps.outputCompression.default ?? 100);
  return result;
}
/** Reconcile refreshed capabilities without dropping choices that are still valid. */
export function reconcileImageOptions(
  model: AIModel | undefined,
  selected: ImageOptions,
): ImageOptions {
  const caps = model?.parameterCapabilities;
  if (!caps) return {};
  const requested = requestImageOptions(model, selected) ?? {};
  const retained = Object.fromEntries(
    Object.entries(requested).filter(([, value]) => value !== undefined),
  );
  let next: ImageOptions = { ...defaultImageOptions(model), ...retained };
  if (caps.n.supported)
    next.n = Math.max(caps.n.min ?? 1, Math.min(caps.n.max ?? 1, Math.round(next.n ?? 1)));
  if (caps.outputCompression.supported && next.outputCompression !== undefined)
    next.outputCompression = Math.max(
      caps.outputCompression.min ?? 0,
      Math.min(caps.outputCompression.max ?? 100, Math.round(next.outputCompression)),
    );
  if (model && next.background === 'transparent' && next.outputFormat === 'jpeg')
    next =
      changeImageOption(model, next, 'background', 'transparent') ?? defaultImageOptions(model);
  return imageOptionsError(model, next) ? defaultImageOptions(model) : next;
}
export function requestImageOptions(
  model: AIModel | undefined,
  selected: ImageOptions,
): ImageOptions | undefined {
  const caps = model?.parameterCapabilities;
  if (!caps) return undefined;
  const result: ImageOptions = {};
  for (const field of ['quality', 'background', 'outputFormat', 'complexity'] as const) {
    const value = selected[field];
    if (caps[field].supported && value && caps[field].values?.includes(value))
      result[field] = value;
  }
  if (selected.size === 'auto' && caps.size.auto) result.size = 'auto';
  if (selected.inputFidelity && caps.inputFidelity.values?.includes(selected.inputFidelity))
    result.inputFidelity = selected.inputFidelity;
  if (selected.moderation && caps.moderation?.values?.includes(selected.moderation))
    result.moderation = selected.moderation;
  if (selected.stream && caps.stream.supported) {
    result.stream = true;
    if (caps.partialImages.supported && selected.partialImages !== undefined)
      result.partialImages = selected.partialImages;
  }
  if (caps.n.supported && Number.isInteger(selected.n)) result.n = selected.n;
  if (result.outputFormat === 'svg' && selected.svg) result.svg = selected.svg;
  if (result.outputFormat === 'gif') {
    result.frameCount = selected.frameCount;
    result.frameDurationMs = selected.frameDurationMs;
  }
  if (
    caps.outputCompression.supported &&
    caps.outputCompression.formats?.includes(result.outputFormat ?? 'png')
  )
    result.outputCompression = selected.outputCompression;
  return Object.keys(result).length ? result : undefined;
}

/** Resolve only the declared JPEG/transparency dependency, in one user initiated update. */
export function changeImageOption(
  model: AIModel,
  selected: ImageOptions,
  field: 'quality' | 'background' | 'outputFormat' | 'complexity',
  value: string,
): ImageOptions | null {
  const capabilities = model.parameterCapabilities;
  if (!capabilities?.[field].supported || !capabilities[field].values?.includes(value)) return null;
  const next = { ...selected, [field]: value };
  if (next.background === 'transparent' && ['jpeg', 'gif'].includes(next.outputFormat ?? '')) {
    if (field === 'background') {
      const format = capabilities.outputFormat.supported
        ? ['png', 'webp'].find((entry) => capabilities.outputFormat.values?.includes(entry))
        : undefined;
      if (!format) return null;
      next.outputFormat = format;
    } else if (field === 'outputFormat') {
      const background = capabilities.background.supported
        ? ['opaque', 'auto'].find((entry) => capabilities.background.values?.includes(entry))
        : undefined;
      if (!background) return null;
      next.background = background;
    } else return null;
  }
  if (field === 'outputFormat') {
    if (value === 'svg' || value === 'gif') {
      delete next.stream;
      delete next.partialImages;
      delete next.outputCompression;
    }
    if (value === 'svg') {
      next.n = 1;
      const author = capabilities.svg.authors?.[0];
      if (author) next.svg = { model: author.id };
      delete next.inputFidelity;
    } else delete next.svg;
    if (value === 'gif') {
      next.frameCount = gifFrameCount.default;
      next.frameDurationMs = gifFrameDelay.default;
      if (capabilities.gif.autoSizes?.length) next.size = 'auto';
    } else {
      delete next.frameCount;
      delete next.frameDurationMs;
    }
  }
  const compression = capabilities.outputCompression;
  if (compression.supported && compression.formats?.includes(next.outputFormat ?? 'png')) {
    if (
      !Number.isInteger(next.outputCompression) ||
      next.outputCompression! < (compression.min ?? 0) ||
      next.outputCompression! > (compression.max ?? 100)
    )
      next.outputCompression = Math.max(
        compression.min ?? 0,
        Math.min(compression.max ?? 100, Number(compression.default ?? 100)),
      );
  }
  return next;
}
export function imageOptionsError(
  model: AIModel | undefined,
  selected: ImageOptions,
): string | null {
  const caps = model?.parameterCapabilities;
  if (!caps) return null;
  for (const field of ['quality', 'background', 'outputFormat'] as const) {
    const c = caps[field];
    if (c.supported && (!selected[field] || !c.values?.includes(selected[field]!)))
      return t('请重新选择当前模型支持的参数。');
  }
  if (
    (selected.size && !caps.size.auto) ||
    (selected.complexity && !caps.complexity.values?.includes(selected.complexity)) ||
    (selected.inputFidelity && !caps.inputFidelity.values?.includes(selected.inputFidelity)) ||
    (selected.moderation && !caps.moderation?.values?.includes(selected.moderation))
  )
    return t('请重新选择当前模型支持的参数。');
  if (selected.background === 'transparent' && ['jpeg', 'gif'].includes(selected.outputFormat ?? ''))
    return t('此透明背景设置支持 PNG、WebP 或 SVG。');
  if (selected.stream && (!caps.stream.supported || (selected.n ?? 1) !== 1 ||
      ['gif','svg'].includes(selected.outputFormat ?? '')))
    return t('流式生成每次限一张图。');
  if (
    selected.partialImages !== undefined &&
    (!selected.stream ||
      !caps.partialImages.supported ||
      !Number.isInteger(selected.partialImages) ||
      selected.partialImages < 0 ||
      selected.partialImages > 3)
  )
    return t('部分图数量须为 0–3，且需要流式生成。');
  if (
    caps.n.supported &&
    (!Number.isInteger(selected.n) ||
      selected.n! < (caps.n.min ?? 1) ||
      selected.n! > (caps.n.max ?? 1))
  )
    return t('输出数量超出当前模型范围。');
  if (selected.outputFormat === 'svg') {
    const authors = caps.svg.authors ?? [];
    const author = authors.find((option) => option.id === selected.svg?.model);
    if ((selected.n ?? 1) !== 1 || (authors.length > 0 && !author) ||
        (selected.svg?.reasoning && !author?.efforts.includes(selected.svg.reasoning.effort)))
      return t('请选择受支持的 SVG 作者及推理强度。');
  }
  if (selected.outputFormat === 'gif' && (
    (selected.frameCount !== undefined && (!Number.isInteger(selected.frameCount) ||
      selected.frameCount < gifFrameCount.min || selected.frameCount > gifFrameCount.max)) ||
    (selected.frameDurationMs !== undefined && (!Number.isInteger(selected.frameDurationMs) ||
      selected.frameDurationMs < gifFrameDelay.min || selected.frameDurationMs > gifFrameDelay.max))))
    return t('GIF 帧数或每帧停留时间超出范围。');
  if (
    caps.outputCompression.supported &&
    caps.outputCompression.formats?.includes(selected.outputFormat ?? 'png') &&
    (!Number.isInteger(selected.outputCompression) ||
      selected.outputCompression! < (caps.outputCompression.min ?? 0) ||
      selected.outputCompression! > (caps.outputCompression.max ?? 100))
  )
    return t('编码质量超出当前模型范围。');
  return null;
}
export function imagePointQuote(model: AIModel | undefined, options: ImageOptions): number | null {
  if (!model) return null;
  const perImage =
    model.pricing?.qualityPerImage[options.quality ?? 'auto'] ??
    model.pricing?.defaultPerImage ??
    model.pointsPerPlan;
  if (typeof perImage !== 'number' || !Number.isSafeInteger(perImage) || perImage < 1) return null;
  const count = model.parameterCapabilities?.n.supported ? (options.n ?? 1) : 1;
  const total = perImage * imageBillableOutputs({ ...options, n: count, partialImages: options.stream ? options.partialImages : undefined });
  return Number.isSafeInteger(count) && count >= 1 && Number.isSafeInteger(total) ? total : null;
}

export function imageBatchError(
  model: AIModel | undefined,
  width: number,
  height: number,
  options: ImageOptions,
): string | null {
  if (!model) return null;
  const count = model.parameterCapabilities?.n.supported ? (options.n ?? 1) : 1;
  if (!Number.isSafeInteger(count) || count < 1) return t('请重新选择输出数量。');
  const max = model.batchLimits?.maxTotalPixels;
  if (count > 1 && (!max || !Number.isSafeInteger(max)))
    return t('服务尚未给出整批像素预算，请先选择1张。');
  const pixels =
    options.size === 'auto'
      ? Math.max(
          0,
          ...((options.outputFormat === 'gif' ? model.parameterCapabilities?.gif.autoSizes :
            model.parameterCapabilities?.size.autoSizes) ?? []).map((size) => {
            const [w, h] = size.split('x').map(Number);
            return w! * h!;
          }),
        )
      : width * height;
  const frames = options.outputFormat === 'gif' ? count * (options.frameCount ?? gifFrameCount.default) :
    count + (options.stream ? (options.partialImages ?? 0) : 0);
  if (max && pixels * frames > max)
    return t(
      '这批 {count} 张合计 {total} 百万像素，超过当前整批 {max} 百万预算。请减少张数或尺寸。',
      { count: frames, total: ((pixels * frames) / 1e6).toFixed(2), max: (max / 1e6).toFixed(2) },
    );
  const points = imagePointQuote(model, options);
  if (points !== null && points > 100000)
    return t('整批服务点超过单次100000点上限，请减少张数或调整质量。');
  return null;
}
