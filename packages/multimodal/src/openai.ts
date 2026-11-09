import sharp from 'sharp';
import { MAX_HEADER_BYTES, readImageHeader } from '@ai-xiutu/editor';
import { postJson, record, reject, token, unknown } from './http.js';
import type {
  ImageGenerationInput,
  ImageMime,
  ImageModelDescriptor,
  ImageOptions,
  ImageParameterCapabilities,
  ImageProvider,
  ImageReference,
  OpenAIImageProfile,
} from './types.js';

export const OPENAI_IMAGE_GENERATIONS_ENDPOINT = 'https://api.openai.com/v1/images/generations';
export const OPENAI_IMAGE_EDITS_ENDPOINT = 'https://api.openai.com/v1/images/edits';
export const OPENAI_IMAGE_SOURCES = Object.freeze([
  'https://developers.openai.com/api/reference/resources/images/methods/generate',
  'https://developers.openai.com/api/reference/resources/images/methods/edit',
  'https://developers.openai.com/api/docs/guides/image-generation',
  'https://developers.openai.com/api/docs/guides/image-prompting',
]);
export const OPENAI_IMAGE_VERIFIED_AT = '2026-11-09';
export const OPENAI_IMAGE_MODEL_PROFILES = Object.freeze({
  'gpt-image-2': 'gpt-image-2',
  'gpt-image-2-2026-04-21': 'gpt-image-2',
  'gpt-image-2.5-sunburst': 'gpt-image-2.5',
  'gpt-image-2.5-sunburst-2026-09-08': 'gpt-image-2.5',
  'gpt-image-2.5-flare': 'gpt-image-2.5',
  'gpt-image-2.5-flare-2026-09-08': 'gpt-image-2.5',
  'gpt-image-2.6-sunburst': 'gpt-image-2.6',
  'gpt-image-2.6-flare': 'gpt-image-2.6',
} satisfies Record<string, OpenAIImageProfile>);
export const OPENAI_MAX_IMAGE_BYTES = 7_000_000;
const MAX_REFERENCE_TOTAL_BYTES = 28_000_000;
const MAX_REFERENCE_TOTAL_PIXELS = 33_554_432;

export interface OpenAIImageBudgets {
  maxOutputs: number;
  maxReferences: number;
  maxTotalPixels: number;
  maxTotalBytes: number;
}
function setting(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(env[key] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    reject('OPENAI_IMAGE_BUDGET_INVALID');
  return value;
}
export function getOpenAIImageBudgets(env: NodeJS.ProcessEnv = process.env): OpenAIImageBudgets {
  return Object.freeze({
    maxOutputs: setting(env, 'OPENAI_IMAGE_MAX_OUTPUTS', 4, 1, 10),
    maxReferences: setting(env, 'OPENAI_IMAGE_MAX_REFERENCES', 4, 1, 16),
    maxTotalPixels: setting(env, 'OPENAI_IMAGE_MAX_TOTAL_PIXELS', 16_777_216, 655_360, 67_108_864),
    maxTotalBytes: setting(
      env,
      'OPENAI_IMAGE_MAX_TOTAL_BYTES',
      28_000_000,
      OPENAI_MAX_IMAGE_BYTES,
      70_000_000,
    ),
  });
}
export function describeOpenAIImageModel(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): ImageModelDescriptor | undefined {
  if (!Object.hasOwn(OPENAI_IMAGE_MODEL_PROFILES, id)) return undefined;
  const profile = OPENAI_IMAGE_MODEL_PROFILES[id as keyof typeof OPENAI_IMAGE_MODEL_PROFILES];
  const limits = getOpenAIImageBudgets(env);
  const is26 = profile === 'gpt-image-2.6';
  const maxPixels = is26 ? 1_572_864 : 8_294_400;
  const maxDimension = is26 ? 1536 : 3840;
  const parameterCapabilities: ImageParameterCapabilities = {
    quality: {
      supported: true,
      values:
        profile === 'gpt-image-2'
          ? ['auto', 'low', 'medium', 'high']
          : ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
      default: 'auto',
    },
    background: { supported: true, values: ['auto', 'opaque', 'transparent'], default: 'auto' },
    outputFormat: { supported: true, values: ['png', 'jpeg', 'webp'], default: 'png' },
    outputCompression: {
      supported: true,
      min: 0,
      max: 100,
      default: 100,
      formats: ['jpeg', 'webp'],
    },
    n: { supported: true, min: 1, max: limits.maxOutputs, default: 1 },
    complexity: is26
      ? { supported: true, values: ['low', 'medium', 'high'], default: 'high' }
      : { supported: false, reason: '当前核验资料只对 GPT Image 2.6 明确开放复杂度参数。' },
    references: {
      supported: true,
      maxCount: limits.maxReferences,
      maxBytes: OPENAI_MAX_IMAGE_BYTES,
      maxTotalBytes: MAX_REFERENCE_TOTAL_BYTES,
      allowMask: true,
      allowMarkup: profile !== 'gpt-image-2',
    },
    size: {
      supported: true,
      multipleOf: 16,
      minPixels: 655_360,
      maxPixels,
      maxDimension,
      minAspectRatio: 1 / 3,
      maxAspectRatio: 3,
      auto: false,
      ...(is26
        ? {
            reason:
              '2.6支持16倍数及1:3至3:1自定义尺寸；本版保守限制1536边/1572864像素，这不是官方最大尺寸声明。',
          }
        : {}),
    },
    inputFidelity: {
      supported: false,
      reason: '不向所选2/2.5/2.6模型发送未明确允许的 input_fidelity；不映射成保真保证。',
    },
    stream: {
      supported: false,
      reason: '本版仅在整批结果审核、规范化和事务提交后发布，不发布未审核流式图像。',
    },
    partialImages: {
      supported: false,
      reason: '未接入部分图像审核与额外计费，partial_images 不发送。',
    },
    svg: {
      supported: false,
      reason: '2.6官方预览能力尚未接入安全矢量解析、审核与作者模型费用账。',
    },
    gif: { supported: false, reason: '2.6官方预览能力尚未接入逐帧审核、动画存储与总帧像素预算。' },
    dependencies: [
      {
        field: 'outputCompression',
        requires: 'outputFormat=jpeg|webp',
        reason: 'PNG不接受输出压缩参数。',
      },
      {
        field: 'background=transparent',
        requires: 'outputFormat=png|webp',
        reason: 'JPEG不能保存透明通道。',
      },
      {
        field: 'maskAssetId|markupAssetId',
        requires: 'referenceAssetIds[0]',
        reason: '引导图与首张参考图尺寸相同、PNG且有透明像素；二者互斥。模型引导不保证像素级锁定。',
      },
    ],
  };
  return Object.freeze({
    id,
    profile,
    provider: 'openai',
    minPixels: 655_360,
    maxPixels,
    maxDimension,
    supportsReference: true,
    minAspectRatio: 1 / 3,
    maxAspectRatio: 3,
    parameterCapabilities,
  });
}
export function getOpenAIImageModels(
  env: NodeJS.ProcessEnv = process.env,
): readonly ImageModelDescriptor[] {
  const raw = env.OPENAI_IMAGE_MODELS ?? '';
  if (raw.length > 2048) reject('OPENAI_MODEL_CONFIG_LIMIT');
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length > 16 || new Set(ids).size !== ids.length) reject('OPENAI_MODEL_CONFIG_INVALID');
  return Object.freeze(
    ids.map((id) => {
      const model = describeOpenAIImageModel(id, env);
      if (!model) reject('OPENAI_MODEL_NOT_SUPPORTED');
      return model;
    }),
  );
}
export function normalizeOpenAIImageOptions(
  input: ImageOptions = {},
): Required<Pick<ImageOptions, 'quality' | 'background' | 'outputFormat' | 'n'>> & ImageOptions {
  if (
    !record(input) ||
    Object.keys(input).some(
      (key) =>
        !['quality', 'background', 'outputFormat', 'outputCompression', 'n', 'complexity'].includes(
          key,
        ),
    )
  )
    reject('OPENAI_UNSUPPORTED_PARAMETER');
  return { quality: 'auto', background: 'auto', outputFormat: 'png', n: 1, ...input };
}
function referenceHeader(reference: ImageReference) {
  if (
    !reference ||
    !(reference.bytes instanceof Uint8Array) ||
    reference.bytes.length < 1 ||
    reference.bytes.length > OPENAI_MAX_IMAGE_BYTES
  )
    reject('OPENAI_REFERENCE_BYTE_LIMIT');
  let header;
  try {
    header = readImageHeader(reference.bytes.subarray(0, MAX_HEADER_BYTES), {
      maxPixels: 16_777_216,
      maxDimension: 8192,
    });
  } catch {
    reject('OPENAI_REFERENCE_INVALID');
  }
  if (
    header.animated ||
    !['png', 'jpeg', 'webp'].includes(header.format) ||
    `image/${header.format}` !== reference.mime
  )
    reject('OPENAI_REFERENCE_FORMAT');
  if (header.width <= 50 || header.height <= 50) reject('OPENAI_REFERENCE_DIMENSIONS');
  return header;
}
export function validateOpenAIImageInput(
  input: ImageGenerationInput,
  models: readonly ImageModelDescriptor[],
  budgets: OpenAIImageBudgets,
): void {
  const model = models.find((candidate) => candidate.id === input.model);
  if (!model || !model.parameterCapabilities) reject('OPENAI_MODEL_NOT_ENABLED');
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 32_000)
    reject('OPENAI_PROMPT_LIMIT');
  const options = normalizeOpenAIImageOptions(input.imageOptions);
  const caps = model.parameterCapabilities;
  if (
    !caps.quality.values?.includes(options.quality) ||
    !caps.background.values?.includes(options.background) ||
    !caps.outputFormat.values?.includes(options.outputFormat)
  )
    reject('OPENAI_PARAMETER_NOT_SUPPORTED');
  if (
    options.complexity !== undefined &&
    (!caps.complexity.supported || !caps.complexity.values?.includes(options.complexity))
  )
    reject('OPENAI_COMPLEXITY_NOT_SUPPORTED');
  if (!Number.isSafeInteger(options.n) || options.n < 1 || options.n > budgets.maxOutputs)
    reject('OPENAI_OUTPUT_COUNT_LIMIT');
  if (
    options.outputCompression !== undefined &&
    (!Number.isSafeInteger(options.outputCompression) ||
      options.outputCompression < 0 ||
      options.outputCompression > 100 ||
      options.outputFormat === 'png')
  )
    reject('OPENAI_COMPRESSION_DEPENDENCY');
  if (options.background === 'transparent' && options.outputFormat === 'jpeg')
    reject('OPENAI_TRANSPARENCY_DEPENDENCY');
  const { width, height } = input;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 16 ||
    height < 16 ||
    width % 16 ||
    height % 16 ||
    width > model.maxDimension ||
    height > model.maxDimension ||
    width / height < 1 / 3 ||
    width / height > 3 ||
    width * height < model.minPixels ||
    width * height > model.maxPixels
  )
    reject('OPENAI_SIZE_LIMIT');
  if (caps.size.allowedSizes && !caps.size.allowedSizes.includes(`${width}x${height}`))
    reject('OPENAI_SIZE_NOT_VERIFIED');
  if (width * height * options.n > budgets.maxTotalPixels) reject('OPENAI_BATCH_PIXEL_LIMIT');
  if (input.reference && input.references) reject('OPENAI_REFERENCE_AMBIGUOUS');
  const references = input.references ?? (input.reference ? [input.reference] : []);
  if (references.length > budgets.maxReferences) reject('OPENAI_REFERENCE_COUNT_LIMIT');
  if (input.mask && input.markup) reject('OPENAI_MASK_MARKUP_EXCLUSIVE');
  if ((input.mask || input.markup) && references.length === 0)
    reject('OPENAI_GUIDE_REQUIRES_REFERENCE');
  if (input.markup && !caps.references.allowMarkup) reject('OPENAI_MARKUP_NOT_SUPPORTED');
  let totalBytes = 0;
  let totalPixels = 0;
  const all = [
    ...references,
    ...(input.mask ? [input.mask] : []),
    ...(input.markup ? [input.markup] : []),
  ];
  for (const ref of all) {
    const header = referenceHeader(ref);
    totalBytes += ref.bytes.length;
    totalPixels += header.width * header.height;
  }
  if (totalBytes > MAX_REFERENCE_TOTAL_BYTES || totalPixels > MAX_REFERENCE_TOTAL_PIXELS)
    reject('OPENAI_REFERENCE_TOTAL_LIMIT');
  const guide = input.mask ?? input.markup;
  if (guide) {
    const first = referenceHeader(references[0]!);
    const header = referenceHeader(guide);
    if (
      guide.mime !== 'image/png' ||
      references[0]!.mime !== 'image/png' ||
      header.width !== first.width ||
      header.height !== first.height
    )
      reject('OPENAI_GUIDE_DIMENSIONS_OR_FORMAT');
  }
  if (input.safetyIdentifier !== undefined && !/^[a-f0-9]{64}$/.test(input.safetyIdentifier))
    reject('OPENAI_SAFETY_IDENTIFIER_INVALID');
}
/** A deterministic JSON request; callers freeze model/options and each referenced byte hash. */
export function buildOpenAIImageRequest(input: ImageGenerationInput): {
  endpoint: string;
  body: Record<string, unknown>;
} {
  const options = normalizeOpenAIImageOptions(input.imageOptions);
  const references = input.references ?? (input.reference ? [input.reference] : []);
  const asDataUrl = (image: ImageReference) => ({
    image_url: `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}`,
  });
  return {
    endpoint: references.length ? OPENAI_IMAGE_EDITS_ENDPOINT : OPENAI_IMAGE_GENERATIONS_ENDPOINT,
    body: {
      model: input.model,
      prompt: input.prompt,
      size: `${input.width}x${input.height}`,
      quality: options.quality,
      background: options.background,
      output_format: options.outputFormat,
      n: options.n,
      moderation: 'auto',
      stream: false,
      ...(options.outputCompression !== undefined
        ? { output_compression: options.outputCompression }
        : {}),
      ...(options.complexity !== undefined ? { complexity: options.complexity } : {}),
      ...(input.safetyIdentifier ? { safety_identifier: input.safetyIdentifier } : {}),
      ...(references.length ? { images: references.map(asDataUrl) } : {}),
      ...(input.mask ? { mask: asDataUrl(input.mask) } : {}),
      ...(input.markup ? { markup: asDataUrl(input.markup) } : {}),
    },
  };
}
function decode(value: unknown, requestId: string): Uint8Array {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > Math.ceil(OPENAI_MAX_IMAGE_BYTES / 3) * 4 ||
    value.length % 4 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    unknown('OPENAI_INVALID_BASE64', requestId);
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > OPENAI_MAX_IMAGE_BYTES || bytes.toString('base64') !== value)
    unknown('OPENAI_INVALID_BASE64', requestId);
  return bytes;
}
async function validateGuidePixels(input: ImageGenerationInput): Promise<void> {
  const guide = input.mask ?? input.markup;
  if (!guide) return;
  try {
    const image = sharp(guide.bytes, { limitInputPixels: 16_777_216, failOn: 'warning' });
    const meta = await image.metadata();
    if (!meta.hasAlpha || (meta.pages && meta.pages !== 1) || (await image.stats()).isOpaque)
      reject('OPENAI_GUIDE_NEEDS_TRANSPARENCY');
  } catch (error) {
    if (error instanceof Error && 'outcome' in error) throw error;
    reject('OPENAI_GUIDE_DECODE_FAILED');
  }
}
export function createOpenAIImageProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): ImageProvider {
  const key = token(env.OPENAI_API_KEY);
  if (env.OPENAI_BASE_URL && env.OPENAI_BASE_URL !== 'https://api.openai.com/v1')
    reject('OPENAI_ENDPOINT_NOT_ALLOWED');
  const models = getOpenAIImageModels(env);
  const budgets = getOpenAIImageBudgets(env);
  const configured = Boolean(key && models.length && env.OPENAI_IMAGE_ENABLED === 'true');
  const validate = (input: ImageGenerationInput) => {
    if (!configured) reject('OPENAI_IMAGE_NOT_CONFIGURED');
    validateOpenAIImageInput(input, models, budgets);
  };
  return {
    configured,
    models,
    validate,
    async generate(input) {
      validate(input);
      await validateGuidePixels(input);
      const options = normalizeOpenAIImageOptions(input.imageOptions);
      const request = buildOpenAIImageRequest(input);
      const { data, requestId } = await postJson(
        request.endpoint,
        key,
        request.body,
        Math.ceil(budgets.maxTotalBytes / 3) * 4 + 1_000_000,
        180_000,
        fetcher,
      );
      if (data.error || !Array.isArray(data.data) || data.data.length !== options.n)
        unknown('OPENAI_OUTPUT_COUNT_MISMATCH', requestId);
      if (data.output_format !== undefined && data.output_format !== options.outputFormat)
        unknown('OPENAI_OUTPUT_FORMAT_MISMATCH', requestId);
      if (data.size !== undefined && data.size !== `${input.width}x${input.height}`)
        unknown('OPENAI_OUTPUT_DIMENSIONS_MISMATCH', requestId);
      let totalBytes = 0;
      const images: Array<{ bytes: Uint8Array; mime: ImageMime }> = [];
      for (const value of data.data) {
        if (!record(value) || value.error) unknown('OPENAI_IMAGE_RESULT_UNKNOWN', requestId);
        // URL-only replies, extra/missing images and malformed bytes never become success.
        const bytes = decode(value.b64_json, requestId);
        totalBytes += bytes.length;
        if (totalBytes > budgets.maxTotalBytes) unknown('OPENAI_BATCH_BYTE_LIMIT', requestId);
        let header;
        try {
          header = readImageHeader(bytes.subarray(0, MAX_HEADER_BYTES));
        } catch {
          return unknown('OPENAI_OUTPUT_INVALID_IMAGE', requestId);
        }
        if (
          header.animated ||
          header.width !== input.width ||
          header.height !== input.height ||
          header.format !== options.outputFormat
        )
          unknown('OPENAI_OUTPUT_DIMENSIONS_OR_FORMAT_MISMATCH', requestId);
        if (options.background === 'transparent') {
          try {
            const image = sharp(bytes, { limitInputPixels: 8_294_400, failOn: 'warning' });
            if (!(await image.metadata()).hasAlpha || (await image.stats()).isOpaque)
              unknown('OPENAI_OUTPUT_NOT_TRANSPARENT', requestId);
          } catch (error) {
            if (error instanceof Error && 'outcome' in error) throw error;
            unknown('OPENAI_OUTPUT_ALPHA_INVALID', requestId);
          }
        }
        images.push({ bytes, mime: `image/${header.format}` as ImageMime });
      }
      const usage: Record<string, unknown> = {};
      if (record(data.usage))
        for (const name of ['input_tokens', 'output_tokens', 'total_tokens']) {
          const count = data.usage[name];
          if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
            usage[name] = count;
        }
      return { ...images[0]!, requestId, images, usage };
    },
  };
}
