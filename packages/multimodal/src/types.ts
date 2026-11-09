export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type ArkImageProfile =
  'seedream-5-pro' | 'seedream-5-flash' | 'seedream-5-lite' | 'seedream-4.5' | 'seedream-4.0';
export type OpenAIImageProfile = 'gpt-image-2' | 'gpt-image-2.5' | 'gpt-image-2.6';
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export interface ImageOptions {
  quality?: ImageQuality;
  background?: 'auto' | 'opaque' | 'transparent';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  outputCompression?: number;
  n?: number;
  complexity?: 'low' | 'medium' | 'high';
}
export interface ImageReference {
  bytes: Uint8Array;
  mime: ImageMime;
}
export interface ParameterCapability {
  supported: boolean;
  values?: readonly string[];
  min?: number;
  max?: number;
  default?: string | number;
  reason?: string;
  formats?: readonly string[];
}
export interface ImageParameterCapabilities {
  quality: ParameterCapability;
  background: ParameterCapability;
  outputFormat: ParameterCapability;
  outputCompression: ParameterCapability;
  n: ParameterCapability;
  complexity: ParameterCapability;
  references: {
    supported: boolean;
    maxCount: number;
    maxBytes: number;
    maxTotalBytes?: number;
    allowMask: boolean;
    allowMarkup: boolean;
  };
  size: {
    supported: boolean;
    multipleOf: number;
    minPixels: number;
    maxPixels: number;
    maxDimension: number;
    minAspectRatio: number;
    maxAspectRatio: number;
    auto: false;
    allowedSizes?: readonly string[];
    reason?: string;
  };
  inputFidelity: ParameterCapability;
  stream: ParameterCapability;
  partialImages: ParameterCapability;
  svg: ParameterCapability;
  gif: ParameterCapability;
  dependencies: readonly { field: string; requires: string; reason: string }[];
}

export interface ImageModelDescriptor {
  readonly id: string;
  readonly profile: ArkImageProfile | OpenAIImageProfile;
  readonly provider?: 'ark' | 'openai';
  readonly minPixels: number;
  readonly maxPixels: number;
  readonly maxDimension: number;
  readonly supportsReference: true;
  readonly minAspectRatio?: number;
  readonly maxAspectRatio?: number;
  readonly parameterCapabilities?: ImageParameterCapabilities;
}

export interface ImageGenerationInput {
  model: string;
  prompt: string;
  width: number;
  height: number;
  /** A reference/sketch is advisory, not a deterministic preservation mask. */
  reference?: ImageReference;
  references?: readonly ImageReference[];
  mask?: ImageReference;
  markup?: ImageReference;
  imageOptions?: ImageOptions;
  safetyIdentifier?: string;
}

export interface ImageGenerationResult {
  bytes: Uint8Array;
  mime: ImageMime;
  requestId: string;
  /** Every requested output must be present; the caller publishes the entire batch atomically. */
  images?: readonly { bytes: Uint8Array; mime: ImageMime }[];
  usage?: Record<string, unknown>;
}
export interface ImageProvider {
  readonly configured: boolean;
  readonly models: readonly ImageModelDescriptor[];
  /** Entirely local admission check; call before reserving funds/enqueuing a job. */
  validate(input: ImageGenerationInput): void;
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}

export interface SpeechProvider {
  readonly configured: boolean;
  readonly models: readonly string[];
  transcribe(input: {
    model: string;
    wav: Uint8Array;
  }): Promise<{ text: string; requestId: string }>;
}

export interface WavInfo {
  durationSeconds: number;
  sampleRate: 16000;
  channels: 1;
}
