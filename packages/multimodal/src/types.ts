export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type ArkImageProfile =
  'seedream-5-pro' | 'seedream-5-flash' | 'seedream-5-lite' | 'seedream-4.5' | 'seedream-4.0';

export interface ImageModelDescriptor {
  readonly id: string;
  readonly profile: ArkImageProfile;
  readonly minPixels: number;
  readonly maxPixels: number;
  readonly maxDimension: 8192;
  readonly supportsReference: true;
}

export interface ImageGenerationInput {
  model: string;
  prompt: string;
  width: number;
  height: number;
  /** A reference/sketch is advisory, not a deterministic preservation mask. */
  reference?: { bytes: Uint8Array; mime: ImageMime };
}

export interface ImageGenerationResult {
  bytes: Uint8Array;
  mime: ImageMime;
  requestId: string;
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
