import { MAX_HEADER_BYTES, readImageHeader } from '@ai-xiutu/editor';
import { postJson, record, reject, token, unknown } from './http.js';
import type {
  ArkImageProfile,
  ImageGenerationInput,
  ImageMime,
  ImageModelDescriptor,
  ImageProvider,
} from './types.js';

export const ARK_IMAGE_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
export const MAX_IMAGE_BYTES = 7_000_000;
export const MAX_IMAGE_RESPONSE_BYTES = 10_000_000;
const profiles: Record<ArkImageProfile, { min: number; max: number }> = {
  'seedream-5-pro': { min: 921600, max: 4624220 },
  'seedream-5-flash': { min: 921600, max: 4624220 },
  'seedream-5-lite': { min: 3686400, max: 16777216 },
  'seedream-4.5': { min: 3686400, max: 16777216 },
  'seedream-4.0': { min: 921600, max: 16777216 },
};
const mimeOf = (format: string): ImageMime => {
  if (format !== 'png' && format !== 'jpeg' && format !== 'webp')
    reject('ARK_UNSUPPORTED_IMAGE_FORMAT');
  return `image/${format}`;
};

/** No implicit model ID: operations must bind enabled IDs/endpoints to an audited profile. */
export function getArkImageModels(
  env: NodeJS.ProcessEnv = process.env,
): readonly ImageModelDescriptor[] {
  const raw = env.ARK_IMAGE_MODELS_JSON;
  if (!raw) return Object.freeze([]);
  if (raw.length > 16_384) reject('ARK_MODEL_CONFIG_LIMIT');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    reject('ARK_MODEL_CONFIG_INVALID_JSON');
  }
  if (!Array.isArray(parsed) || parsed.length > 16) reject('ARK_MODEL_CONFIG_INVALID');
  const seen = new Set<string>();
  return Object.freeze(
    parsed.map((entry: unknown) => {
      if (
        !record(entry) ||
        Object.keys(entry).some((key) => key !== 'id' && key !== 'profile') ||
        typeof entry.id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(entry.id) ||
        typeof entry.profile !== 'string' ||
        !Object.hasOwn(profiles, entry.profile) ||
        seen.has(entry.id)
      )
        reject('ARK_MODEL_CONFIG_INVALID');
      seen.add(entry.id);
      const profile = entry.profile as ArkImageProfile;
      const limits = profiles[profile];
      return Object.freeze({
        id: entry.id,
        profile,
        minPixels: limits.min,
        maxPixels: limits.max,
        maxDimension: 8192 as const,
        supportsReference: true as const,
      });
    }),
  );
}

export function validateArkImageInput(
  input: ImageGenerationInput,
  models: readonly ImageModelDescriptor[],
): void {
  if (!input || typeof input !== 'object') reject('ARK_INPUT_INVALID');
  const model = models.find((candidate) => candidate.id === input.model);
  if (!model) reject('ARK_MODEL_NOT_ENABLED');
  if (
    typeof input.prompt !== 'string' ||
    input.prompt.length > 8000 ||
    !input.prompt.trim() ||
    Array.from(input.prompt).length > 2000 ||
    Buffer.byteLength(input.prompt, 'utf8') > 8000
  )
    reject('ARK_PROMPT_LIMIT');
  if (
    !Number.isSafeInteger(input.width) ||
    !Number.isSafeInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.width > model.maxDimension ||
    input.height > model.maxDimension
  )
    reject('ARK_SIZE_LIMIT');
  const pixels = input.width * input.height;
  const ratio = input.width / input.height;
  if (pixels < model.minPixels || pixels > model.maxPixels || ratio < 1 / 16 || ratio > 16)
    reject('ARK_PROFILE_SIZE_LIMIT');
  if (input.reference !== undefined) {
    const reference = input.reference;
    if (
      !reference ||
      !(reference.bytes instanceof Uint8Array) ||
      reference.bytes.length === 0 ||
      reference.bytes.length > MAX_IMAGE_BYTES
    )
      reject('ARK_REFERENCE_SIZE_LIMIT');
    let header;
    try {
      header = readImageHeader(reference.bytes.subarray(0, MAX_HEADER_BYTES));
    } catch {
      reject('ARK_REFERENCE_INVALID_IMAGE');
    }
    if (
      header.animated ||
      mimeOf(header.format) !== reference.mime ||
      header.width <= 50 ||
      header.height <= 50 ||
      header.width / header.height < 1 / 16 ||
      header.width / header.height > 16
    )
      reject('ARK_REFERENCE_UNSUPPORTED');
  }
}

function decodeBase64(value: unknown, requestId: string): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/.test(value)
  )
    unknown('ARK_INVALID_IMAGE_BASE64', requestId);
  const padding = value.indexOf('=');
  if (padding >= 0 && (padding < value.length - 2 || !/^={1,2}$/.test(value.slice(padding))))
    unknown('ARK_INVALID_IMAGE_BASE64', requestId);
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== value)
    unknown('ARK_INVALID_IMAGE_BASE64', requestId);
  return bytes;
}

export function createArkImageProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): ImageProvider {
  const apiKey = token(env.ARK_API_KEY);
  const models = getArkImageModels(env);
  if (env.ARK_IMAGE_ENDPOINT && env.ARK_IMAGE_ENDPOINT !== ARK_IMAGE_ENDPOINT)
    reject('ARK_ENDPOINT_NOT_ALLOWED');
  const configured = Boolean(apiKey && models.length > 0);
  const validate = (input: ImageGenerationInput): void => {
    if (!configured) reject('ARK_IMAGE_NOT_CONFIGURED');
    validateArkImageInput(input, models);
  };
  return {
    configured,
    models,
    validate,
    async generate(input) {
      validate(input);
      const model = models.find((candidate) => candidate.id === input.model)!;
      const singleOnly = model.profile === 'seedream-5-pro' || model.profile === 'seedream-5-flash';
      const body: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        size: `${input.width}x${input.height}`,
        response_format: 'b64_json',
        watermark: true,
        ...(!singleOnly ? { sequential_image_generation: 'disabled', stream: false } : {}),
        ...(input.reference
          ? {
              image: `data:${input.reference.mime};base64,${Buffer.from(input.reference.bytes).toString('base64')}`,
            }
          : {}),
      };
      const { data, requestId } = await postJson(
        ARK_IMAGE_ENDPOINT,
        apiKey,
        body,
        MAX_IMAGE_RESPONSE_BYTES,
        120_000,
        fetcher,
      );
      if (
        data.error ||
        !Array.isArray(data.data) ||
        data.data.length !== 1 ||
        !record(data.data[0]) ||
        data.data[0].error
      )
        unknown('ARK_IMAGE_RESULT_UNKNOWN', requestId);
      const output = data.data[0];
      // Never follow returned URLs. A URL-only reply remains a paid/unknown task.
      const bytes = decodeBase64(output.b64_json, requestId);
      let header;
      try {
        header = readImageHeader(bytes.subarray(0, MAX_HEADER_BYTES));
      } catch {
        return unknown('ARK_OUTPUT_INVALID_IMAGE', requestId);
      }
      if (
        header.animated ||
        header.width !== input.width ||
        header.height !== input.height ||
        (output.size !== undefined && output.size !== `${header.width}x${header.height}`) ||
        (output.output_format !== undefined && output.output_format !== header.format)
      )
        unknown('ARK_OUTPUT_DIMENSIONS_OR_FORMAT_MISMATCH', requestId);
      return { bytes, mime: mimeOf(header.format), requestId };
    },
  };
}
