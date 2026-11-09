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
): string | null {
  if (!model) return '请先选择一个图像模型。';
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) return '宽高需要是整数像素。';
  const c = model.parameterCapabilities?.size;
  if (c && !c.supported) return c.reason || '当前模型未开放尺寸设置。';
  if (c?.allowedSizes && !c.allowedSizes.includes(width + 'x' + height))
    return c.reason || '这个模型只开放列出的尺寸。';
  const maxDimension = Math.min(model.maxDimension ?? Infinity, c?.maxDimension ?? Infinity);
  const minWidth = model.minWidth ?? 64,
    minHeight = model.minHeight ?? 64;
  const maxWidth = Math.min(model.maxWidth ?? 8192, maxDimension),
    maxHeight = Math.min(model.maxHeight ?? 8192, maxDimension);
  if (width < minWidth || height < minHeight || width > maxWidth || height > maxHeight)
    return '宽 ' + minWidth + '–' + maxWidth + '，高 ' + minHeight + '–' + maxHeight + ' 像素。';
  const minPixels = Math.max(model.minPixels ?? 1, c?.minPixels ?? 1);
  const maxPixels = Math.min(model.maxPixels ?? 0, c?.maxPixels ?? Infinity);
  if (!maxPixels) return '服务尚未提供此模型的像素范围。';
  if (width * height < minPixels || width * height > maxPixels)
    return (
      '总像素需在 ' +
      (minPixels / 1e6).toFixed(2) +
      '–' +
      (maxPixels / 1e6).toFixed(2) +
      ' 百万之间。'
    );
  const multiple = c?.multipleOf ?? 1;
  if (width % multiple || height % multiple) return '宽高都需要是 ' + multiple + ' 的倍数。';
  const minRatio = Math.max(model.minAspectRatio ?? 0, c?.minAspectRatio ?? 0);
  const maxRatio = Math.min(model.maxAspectRatio ?? Infinity, c?.maxAspectRatio ?? Infinity);
  if (!minRatio || !Number.isFinite(maxRatio)) return '服务尚未提供此模型的宽高比范围。';
  if (width / height < minRatio || width / height > maxRatio)
    return '当前模型的宽高比需在 ' + minRatio.toFixed(2) + '–' + maxRatio.toFixed(2) + ' 之间。';
  return null;
}
export function allowedImageSizes(model: AIModel | undefined) {
  const fixed = model?.parameterCapabilities?.size.allowedSizes?.map((value) =>
    value.split('x').map(Number),
  );
  return (fixed ?? COMMON_SIZES)
    .filter(([width, height]) => !imageSizeError(model, width!, height!))
    .map(([width, height]) => ({ width: width!, height: height! }));
}
export function defaultImageOptions(model: AIModel | undefined): ImageOptions {
  const caps = model?.parameterCapabilities;
  if (!caps) return {};
  const result: ImageOptions = {};
  for (const field of ['quality', 'background', 'outputFormat', 'complexity'] as const) {
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
  if (caps.n.supported && Number.isInteger(selected.n)) result.n = selected.n;
  if (
    caps.outputCompression.supported &&
    caps.outputCompression.formats?.includes(result.outputFormat ?? 'png')
  )
    result.outputCompression = selected.outputCompression;
  return Object.keys(result).length ? result : undefined;
}
export function imageOptionsError(
  model: AIModel | undefined,
  selected: ImageOptions,
): string | null {
  const caps = model?.parameterCapabilities;
  if (!caps) return null;
  for (const field of ['quality', 'background', 'outputFormat', 'complexity'] as const) {
    const c = caps[field];
    if (c.supported && (!selected[field] || !c.values?.includes(selected[field]!)))
      return '请重新选择当前模型支持的参数。';
  }
  if (selected.background === 'transparent' && selected.outputFormat === 'jpeg')
    return '透明背景需要 PNG 或 WebP，JPEG 不支持透明度。';
  if (
    caps.n.supported &&
    (!Number.isInteger(selected.n) ||
      selected.n! < (caps.n.min ?? 1) ||
      selected.n! > (caps.n.max ?? 1))
  )
    return '输出数量超出当前模型范围。';
  if (
    caps.outputCompression.supported &&
    caps.outputCompression.formats?.includes(selected.outputFormat ?? 'png') &&
    (!Number.isInteger(selected.outputCompression) ||
      selected.outputCompression! < (caps.outputCompression.min ?? 0) ||
      selected.outputCompression! > (caps.outputCompression.max ?? 100))
  )
    return '编码质量超出当前模型范围。';
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
  const total = perImage * count;
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
  if (!Number.isSafeInteger(count) || count < 1) return '请重新选择输出数量。';
  const max = model.batchLimits?.maxTotalPixels;
  if (count > 1 && (!max || !Number.isSafeInteger(max)))
    return '服务尚未给出整批像素预算，请先选择1张。';
  if (max && width * height * count > max)
    return (
      '这批 ' +
      count +
      ' 张合计 ' +
      ((width * height * count) / 1e6).toFixed(2) +
      ' 百万像素，超过当前整批 ' +
      (max / 1e6).toFixed(2) +
      ' 百万预算。请减少张数或尺寸。'
    );
  const points = imagePointQuote(model, options);
  if (points !== null && points > 100000)
    return '整批服务点超过单次100000点上限，请减少张数或调整质量。';
  return null;
}
