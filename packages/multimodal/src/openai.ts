import sharp from 'sharp';
import { MAX_HEADER_BYTES, readImageHeader } from '@ai-xiutu/editor';
import { gifFrameCount, gifFrameDelay, openAISvgAuthorSchema, responsesModel } from '@ai-xiutu/contracts';
import { postEventStream, postJson, record, reject, token, unknown } from './http.js';
import { sanitizeOpenAISvg } from './openai-image-artifacts.js';
import type {
  GeneratedImageOutput,
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
export const OPENAI_IMAGE_VERIFIED_AT = '2026-11-13';
export const OPENAI_IMAGE_MODEL_PROFILES = Object.freeze({
  'gpt-image-1-mini': 'gpt-image-1-mini',
  'gpt-image-1.5': 'gpt-image-1.5',
  'chatgpt-image-latest': 'chatgpt-image-latest',
  'gpt-image-2': 'gpt-image-2',
  'gpt-image-2-2026-04-21': 'gpt-image-2',
  'gpt-image-2.5-sunburst': 'gpt-image-2.5',
  'gpt-image-2.5-sunburst-2026-09-08': 'gpt-image-2.5',
  'gpt-image-2.5-flare': 'gpt-image-2.5',
  'gpt-image-2.5-flare-2026-09-08': 'gpt-image-2.5',
  'gpt-image-2.6-sunburst': 'gpt-image-2.6',
  'gpt-image-2.6-flare': 'gpt-image-2.6',
} satisfies Record<string, OpenAIImageProfile>);
const standardSizes = ['1024x1024', '1536x1024', '1024x1536'] as const;
const gifAutoSizes = ['512x512'] as const;
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
  const svg = is26 && env.OPENAI_IMAGE_SVG_ENABLED === 'true';
  const gif = is26 && env.OPENAI_IMAGE_GIF_ENABLED === 'true';
  const svgAuthors = (env.OPENAI_IMAGE_SVG_AUTHORS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (svg && (svgAuthors.length > 47 || new Set(svgAuthors).size !== svgAuthors.length ||
      svgAuthors.some((id) => !responsesModel(id)))) reject('OPENAI_SVG_AUTHOR_CONFIG_INVALID');
  const old =
    profile === 'gpt-image-1-mini' ||
    profile === 'gpt-image-1.5' ||
    profile === 'chatgpt-image-latest';
  const maxPixels = old ? 1_572_864 : 8_294_400;
  const minPixels = old ? 1_048_576 : 655_360;
  const maxDimension = old ? 1536 : 3840;
  const parameterCapabilities: ImageParameterCapabilities = {
    quality: {
      supported: true,
      values:
        is26 || profile === 'gpt-image-2.5'
          ? ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
          : ['auto', 'low', 'medium', 'high'],
      default: 'auto',
    },
    background: { supported: true, values: ['auto', 'opaque', 'transparent'], default: 'auto' },
    outputFormat: {
      supported: true,
      values: ['png', 'jpeg', 'webp', ...(svg ? ['svg'] : []), ...(gif ? ['gif'] : [])],
      default: 'png',
    },
    outputCompression: {
      supported: true,
      min: 0,
      max: 100,
      default: 100,
      formats: ['jpeg', 'webp'],
    },
    n: { supported: true, min: 1, max: limits.maxOutputs, default: 1 },
    moderation: { supported: true, values: ['auto', 'low'], default: 'auto' },
    complexity: is26
      ? { supported: true, values: ['low', 'medium', 'high'] }
      : { supported: false, reason: '当前核验资料只对 GPT Image 2.6 明确开放复杂度参数。' },
    references: {
      supported: true,
      maxCount: limits.maxReferences,
      maxBytes: OPENAI_MAX_IMAGE_BYTES,
      maxTotalBytes: MAX_REFERENCE_TOTAL_BYTES,
      allowMask: true,
      allowMarkup: is26 || profile === 'gpt-image-2.5',
    },
    size: {
      supported: true,
      multipleOf: 16,
      minPixels,
      maxPixels,
      maxDimension,
      minAspectRatio: 1 / 3,
      maxAspectRatio: 3,
      auto: true,
      autoSizes: standardSizes,
      ...(old ? { allowedSizes: standardSizes } : {}),
      ...(!old ? { reason: '大于 2560×1440 像素属于 OpenAI 实验性分辨率。' } : {}),
    },
    inputFidelity:
      profile === 'gpt-image-1.5' || profile === 'gpt-image-1-mini'
        ? {
            supported: true,
            values: profile === 'gpt-image-1.5' ? ['low', 'high'] : ['low'],
            default: 'low',
          }
        : { supported: false, reason: '此型号由 OpenAI 决定输入保真度。' },
    stream: {
      supported: !old,
      reason: old ? '该型号暂采用单次 JSON 返回。' : 'PNG、JPEG、WebP 支持单张流式生成。',
    },
    partialImages: {
      supported: !old && env.OPENAI_IMAGE_PARTIALS_ENABLED === 'true',
      min: 0,
      max: 3,
      default: 0,
      reason:
        env.OPENAI_IMAGE_PARTIALS_ENABLED === 'true'
          ? '部分图通过审核后展示。最终图完成后替换预览。'
          : '部署尚未启用供应商部分图预览。',
    },
    svg: {
      supported: svg,
      authors: svg ? svgAuthors.map((id) => ({ id, efforts: responsesModel(id)!.reasoning })) : [],
      reason: svg ? 'SVG 支持单张从文字生成。矢量作者另计用量。' : '此型号或部署未启用 SVG。',
    },
    gif: {
      supported: gif,
      frames: { supported: gif, ...gifFrameCount },
      durationMs: { supported: gif, ...gifFrameDelay },
      minPixels: 16 * 16,
      maxPixels: 8_294_400,
      maxDimension: 1920,
      autoSizes: gifAutoSizes,
      reason: gif ? '总尺寸由每帧画幅、帧数和模型分镜画布预算共同决定。' : '此型号或部署未启用 GIF。',
    },
    dependencies: [
      {
        field: 'outputCompression',
        requires: 'outputFormat=jpeg|webp',
        reason: 'PNG不接受输出压缩参数。',
      },
      {
        field: 'background=transparent',
        requires: 'outputFormat=png|webp|svg',
        reason: 'JPEG不能保存透明通道。',
      },
      {
        field: 'maskAssetId|markupAssetId',
        requires: 'referenceAssetIds[0]',
        reason: '引导图与首张参考图尺寸相同、PNG且有透明像素；二者互斥。模型引导不保证像素级锁定。',
      },
      {
        field: 'inputFidelity',
        requires: 'referenceAssetIds[0]',
        reason: '仅图像编辑请求可指定输入保真度。',
      },
    ],
  };
  return Object.freeze({
    id,
    profile,
    provider: 'openai',
    minPixels,
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
        ![
          'quality',
          'background',
          'outputFormat',
          'outputCompression',
          'n',
          'complexity',
          'size',
          'inputFidelity',
          'moderation',
          'stream',
          'partialImages',
          'frameCount',
          'frameDurationMs',
          'svg',
        ].includes(key),
    )
  )
    reject('OPENAI_UNSUPPORTED_PARAMETER');
  return { quality: 'auto', background: 'auto', outputFormat: 'png', n: 1, ...input };
}

function imageDimensionsFit(model: ImageModelDescriptor, width: number, height: number) {
  const caps = model.parameterCapabilities!.size;
  return (
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width >= 16 &&
    height >= 16 &&
    width % caps.multipleOf === 0 &&
    height % caps.multipleOf === 0 &&
    width <= model.maxDimension &&
    height <= model.maxDimension &&
    width / height >= caps.minAspectRatio &&
    width / height <= caps.maxAspectRatio &&
    width * height >= model.minPixels &&
    width * height <= model.maxPixels &&
    (!caps.allowedSizes || caps.allowedSizes.includes(`${width}x${height}`))
  );
}
function gifDimensionsFit(model: ImageModelDescriptor, width: number, height: number, frames: number) {
  const max = model.parameterCapabilities!.gif.maxDimension!;
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) &&
    width > 0 && height > 0 && width % 16 === 0 && height % 16 === 0 &&
    width <= max && height <= max && width * height * frames <= model.maxPixels;
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
  const svg = options.outputFormat === 'svg';
  const gif = options.outputFormat === 'gif';
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
  if (options.moderation !== undefined && !caps.moderation?.values?.includes(options.moderation))
    reject('OPENAI_MODERATION_NOT_SUPPORTED');
  if (!Number.isSafeInteger(options.n) || options.n < 1 || options.n > budgets.maxOutputs)
    reject('OPENAI_OUTPUT_COUNT_LIMIT');
  if (options.stream && (!caps.stream.supported || options.n !== 1))
    reject('OPENAI_STREAM_REQUIRES_ONE_IMAGE');
  if (
    options.partialImages !== undefined &&
    (!options.stream ||
      !caps.partialImages.supported ||
      !Number.isInteger(options.partialImages) ||
      options.partialImages < 0 ||
      options.partialImages > 3)
  )
    reject('OPENAI_PARTIAL_IMAGES_INVALID');
  if (
    options.outputCompression !== undefined &&
    (!Number.isSafeInteger(options.outputCompression) ||
      options.outputCompression < 0 ||
      options.outputCompression > 100 ||
      !caps.outputCompression.formats?.includes(options.outputFormat))
  )
    reject('OPENAI_COMPRESSION_DEPENDENCY');
  if (options.background === 'transparent' && !['png', 'webp', 'svg'].includes(options.outputFormat))
    reject('OPENAI_TRANSPARENCY_DEPENDENCY');
  if (svg || gif) {
    if (options.stream || options.partialImages !== undefined) reject('OPENAI_SPECIAL_FORMAT_STREAM');
    if (svg && (options.n !== 1 || input.reference || input.references?.length || input.mask || input.markup))
      reject('OPENAI_SVG_GENERATION_ONLY');
    if (gif && input.mask) reject('OPENAI_GIF_MASK_UNSUPPORTED');
  }
  if (svg) {
    const authors = caps.svg.authors ?? [];
    const author = options.svg ? openAISvgAuthorSchema.safeParse(options.svg) : undefined;
    if (authors.length && !author?.success) reject('OPENAI_SVG_AUTHOR_REQUIRED');
    if (author?.success) {
      const match = authors.find((value) => value.id === author.data.model);
      if (!match || (author.data.reasoning && !match.efforts.includes(author.data.reasoning.effort)))
        reject('OPENAI_SVG_AUTHOR_UNSUPPORTED');
    } else if (options.svg) reject('OPENAI_SVG_AUTHOR_UNSUPPORTED');
  } else if (options.svg) reject('OPENAI_SVG_FORMAT_REQUIRED');
  const frames = options.frameCount ?? gifFrameCount.default;
  if (gif ? !Number.isInteger(frames) || frames < gifFrameCount.min || frames > gifFrameCount.max :
      options.frameCount !== undefined || options.frameDurationMs !== undefined)
    reject('OPENAI_GIF_FRAMES_INVALID');
  if (options.frameDurationMs !== undefined &&
      (!Number.isInteger(options.frameDurationMs) || options.frameDurationMs < gifFrameDelay.min ||
        options.frameDurationMs > gifFrameDelay.max)) reject('OPENAI_GIF_DURATION_INVALID');
  const { width, height } = input;
  if (options.size !== undefined && (options.size !== 'auto' || !caps.size.auto))
    reject('OPENAI_SIZE_NOT_VERIFIED');
  if (!options.size && !(gif ? gifDimensionsFit(model, width, height, frames) :
      imageDimensionsFit(model, width, height))) reject('OPENAI_SIZE_LIMIT');
  const autoPixels = gif ? 512 * 512 : 1_572_864;
  if (
    (options.size === 'auto' ? autoPixels : width * height) *
      (gif ? options.n * frames : options.n + (options.partialImages ?? 0)) >
    budgets.maxTotalPixels
  )
    reject('OPENAI_BATCH_PIXEL_LIMIT');
  if (input.reference && input.references) reject('OPENAI_REFERENCE_AMBIGUOUS');
  const references = input.references ?? (input.reference ? [input.reference] : []);
  if (
    options.inputFidelity !== undefined &&
    (!references.length || !caps.inputFidelity.values?.includes(options.inputFidelity))
  )
    reject('OPENAI_INPUT_FIDELITY_NOT_SUPPORTED');
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
      size: options.size ?? `${input.width}x${input.height}`,
      quality: options.quality,
      background: options.background,
      output_format: options.outputFormat,
      n: options.n,
      moderation: options.moderation ?? 'auto',
      ...(['svg', 'gif'].includes(options.outputFormat) ? {} : { stream: options.stream ?? false }),
      ...(options.partialImages !== undefined ? { partial_images: options.partialImages } : {}),
      ...(options.frameCount !== undefined ? { frame_count: options.frameCount } : {}),
      ...(options.frameDurationMs !== undefined ? { frame_duration_ms: options.frameDurationMs } : {}),
      ...(options.svg ? { svg: options.svg } : {}),
      ...(options.outputCompression !== undefined
        ? { output_compression: options.outputCompression }
        : {}),
      ...(options.complexity !== undefined ? { complexity: options.complexity } : {}),
      ...(options.inputFidelity !== undefined ? { input_fidelity: options.inputFidelity } : {}),
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

function partialFrame(event: Record<string, unknown>, requestId: string) {
  const index = event.partial_image_index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 2)
    unknown('OPENAI_PARTIAL_INDEX_INVALID', requestId);
  const bytes = decode(event.b64_json, requestId);
  const header = readImageHeader(bytes.subarray(0, MAX_HEADER_BYTES));
  if (header.animated || !['png', 'jpeg', 'webp'].includes(header.format))
    unknown('OPENAI_PARTIAL_FORMAT_INVALID', requestId);
  return { index, bytes, mime: ('image/' + header.format) as ImageMime };
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
    async generate(input, onPartial) {
      validate(input);
      await validateGuidePixels(input);
      const options = normalizeOpenAIImageOptions(input.imageOptions);
      const descriptor = models.find((model) => model.id === input.model)!;
      const request = buildOpenAIImageRequest(input);
      const responseBytes = Math.ceil(budgets.maxTotalBytes / 3) * 4 + 1_000_000;
      const deadline = options.outputFormat === 'svg' || options.outputFormat === 'gif' ? 220_000 : 180_000;
      async function streamResult(): Promise<{ data: Record<string, unknown>; requestId: string }> {
        const type = request.endpoint === OPENAI_IMAGE_EDITS_ENDPOINT ? 'image_edit' : 'image_generation';
        const seen = new Set<number>();
        let complete: Record<string, unknown> | undefined;
        const { requestId } = await postEventStream(
          request.endpoint, key, request.body, responseBytes, deadline, fetcher,
          (event, id) => {
            if (complete) unknown('OPENAI_IMAGE_STREAM_UNEXPECTED_EVENT', id);
            if (event.type === type + '.completed') complete = event;
            else if (event.type === type + '.partial_image') {
              if (seen.size >= (options.partialImages ?? 0))
                unknown('OPENAI_IMAGE_STREAM_UNEXPECTED_EVENT', id);
              const frame = partialFrame(event, id);
              if (seen.has(frame.index)) unknown('OPENAI_PARTIAL_INDEX_INVALID', id);
              seen.add(frame.index);
              onPartial?.(frame);
            } else unknown('OPENAI_IMAGE_STREAM_UNEXPECTED_EVENT', id);
          },
        );
        if (!complete) unknown('OPENAI_IMAGE_STREAM_INCOMPLETE', requestId);
        return { data: { ...complete, data: [{ b64_json: complete.b64_json }] }, requestId };
      }
      const { data, requestId } = options.stream ? await streamResult() :
        await postJson(request.endpoint, key, request.body, responseBytes, deadline, fetcher);
      if (data.error || !Array.isArray(data.data) || data.data.length !== options.n)
        unknown('OPENAI_OUTPUT_COUNT_MISMATCH', requestId);
      if (data.output_format !== undefined && data.output_format !== options.outputFormat)
        unknown('OPENAI_OUTPUT_FORMAT_MISMATCH', requestId);
      if (
        !options.size &&
        data.size !== undefined &&
        data.size !== `${input.width}x${input.height}`
      )
        unknown('OPENAI_OUTPUT_DIMENSIONS_MISMATCH', requestId);
      let totalBytes = 0;
      const images: GeneratedImageOutput[] = [];
      for (const value of data.data) {
        if (!record(value) || value.error) unknown('OPENAI_IMAGE_RESULT_UNKNOWN', requestId);
        // URL-only replies, extra/missing images and malformed bytes never become success.
        const bytes = decode(value.b64_json, requestId);
        totalBytes += bytes.length;
        if (totalBytes > budgets.maxTotalBytes) unknown('OPENAI_BATCH_BYTE_LIMIT', requestId);
        if (options.outputFormat === 'svg' || options.outputFormat === 'gif') {
          const [width, height] = typeof data.size === 'string' && /^\d{1,4}x\d{1,4}$/.test(data.size)
            ? data.size.split('x').map(Number) as [number, number]
            : options.size ? [0, 0] : [input.width, input.height];
          if (options.outputFormat === 'svg') {
            if (!imageDimensionsFit(descriptor, width, height))
              unknown('OPENAI_OUTPUT_DIMENSIONS_OR_FORMAT_MISMATCH', requestId);
            let safe: Buffer;
            try { safe = sanitizeOpenAISvg(bytes, { width, height }); }
            catch { return unknown('OPENAI_SVG_CONTENT_UNSUPPORTED', requestId); }
            images.push({ bytes: safe, mime: 'image/svg+xml', width, height });
          } else {
            const frames = options.frameCount ?? gifFrameCount.default;
            if (!gifDimensionsFit(descriptor, width, height, frames) ||
                width * height * frames * options.n > budgets.maxTotalPixels)
              unknown('OPENAI_OUTPUT_DIMENSIONS_OR_FORMAT_MISMATCH', requestId);
            images.push({ bytes, mime: 'image/gif', width, height, frames });
          }
          continue;
        }
        let header;
        try {
          header = readImageHeader(bytes.subarray(0, MAX_HEADER_BYTES));
        } catch {
          return unknown('OPENAI_OUTPUT_INVALID_IMAGE', requestId);
        }
        if (
          header.animated ||
          (options.size === 'auto'
            ? !descriptor.parameterCapabilities?.size.autoSizes?.includes(
                `${header.width}x${header.height}`,
              )
            : header.width !== input.width || header.height !== input.height) ||
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
      if (record(data.usage)) {
        for (const field of ['input_tokens_details', 'output_tokens_details']) {
          const details = data.usage[field];
          if (!record(details)) continue;
          const counts: Record<string, unknown> = Object.fromEntries(
            ['text_tokens', 'image_tokens', 'cached_tokens'].flatMap((name) => {
              const value = details[name];
              return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
                ? [[name, value]]
                : [];
            }),
          );
          if (record(details.cached_tokens_details)) {
            const cached = details.cached_tokens_details;
            counts.cached_tokens_details = Object.fromEntries(
              ['text_tokens', 'image_tokens'].flatMap((name) => {
                const value = cached[name];
                return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
                  ? [[name, value]]
                  : [];
              }),
            );
          }
          if (Object.keys(counts).length) usage[field] = counts;
        }
      }
      if (options.outputFormat === 'svg') {
        const author = data.svg_usage;
        if (!record(author) || typeof author.model !== 'string' || !responsesModel(author.model))
          unknown('OPENAI_SVG_USAGE_UNCONFIRMED', requestId);
        const base = options.svg?.model;
        if (base && author.model !== base && responsesModel(author.model)?.baseModel !== base)
          unknown('OPENAI_SVG_AUTHOR_MISMATCH', requestId);
        const authorUsage: Record<string, unknown> = { model: author.model };
        for (const name of ['input_tokens', 'output_tokens', 'reasoning_tokens', 'total_tokens']) {
          const count = author[name];
          if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
            unknown('OPENAI_SVG_USAGE_UNCONFIRMED', requestId);
          authorUsage[name] = count;
        }
        usage.svg_author = authorUsage;
      }
      return { ...images[0]!, requestId, images, usage };
    },
  };
}
