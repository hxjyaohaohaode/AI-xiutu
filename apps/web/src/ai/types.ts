import type { EditorRecipe } from '@ai-xiutu/editor';
export type AIOperation = 'edit-plan' | 'generate-image' | 'generate-text' | 'transcribe';
export type ParameterCapability = {
  supported: boolean;
  values?: readonly string[];
  min?: number;
  max?: number;
  default?: string | number;
  reason?: string;
  formats?: readonly string[];
};
export type ImageCapabilities = {
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
};
export type ImageOptions = {
  quality?: string;
  background?: string;
  outputFormat?: string;
  outputCompression?: number;
  n?: number;
  complexity?: string;
};
export type AIModel = {
  id: string;
  label: string;
  provider?: 'qwen' | 'ark' | 'openai';
  operations?: AIOperation[];
  pointsPerPlan?: number;
  enabled: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  minPixels?: number;
  maxPixels?: number;
  maxDimension?: number;
  minAspectRatio?: number;
  maxAspectRatio?: number;
  runtimeAvailable?: boolean;
  runtimeOperations?: AIOperation[];
  runtimeReason?: string | null;
  parameterCapabilities?: ImageCapabilities;
  batchLimits?: { maxTotalPixels: number; maxTotalBytes: number };
  maxOutputs?: number;
  pricing?: {
    unit: 'service-point';
    per: 'image';
    defaultPerImage: number;
    qualityPerImage: Record<string, number>;
  };
};
export type GeneratedImage = {
  assetId: string;
  artworkId: string;
  width: number;
  height: number;
  index?: number;
  url?: string;
  thumbnailUrl?: string;
};
export type JobOutput =
  | {
      kind: 'edit-plan';
      recipe: EditorRecipe;
      summary: string;
      baseVersion: number;
      inputHash: string;
      artworkId: string;
      proposalVersion?: 2;
      parameterChanges?: {
        path: string;
        label: string;
        before: number;
        after: number;
        unit: string;
      }[];
    }
  | ({
      kind: 'image';
      images?: GeneratedImage[];
      modelId: string;
      providerOutputFormat?: string;
      canonicalFormat?: 'png';
    } & GeneratedImage)
  | { kind: 'text'; title: string; body: string; summary: string }
  | { kind: 'transcript'; text: string; noSpeech?: boolean };
export type JobRequest = {
  operation?: AIOperation;
  proposalVersion?: 2;
  prompt?: string;
  width?: number;
  height?: number;
  imageOptions?: ImageOptions;
  referenceAssetId?: string;
  referenceAssetIds?: string[];
  maskAssetId?: string;
  markupAssetId?: string;
  artworkId?: string;
  expectedVersion?: number;
  parentJobId?: string;
  contextDocumentId?: string;
  expectedDocumentVersion?: number;
};
export type AIJob = {
  id: string;
  projectId?: string;
  operation?: AIOperation;
  artworkId?: string;
  modelId: string;
  prompt?: string;
  request?: JobRequest;
  parentJobId?: string | null;
  threadId?: string;
  contextSummary?: {
    parentResultIncluded: boolean;
    contextDocumentId?: string | null;
    documentVersion?: number | null;
  };
  state: 'queued' | 'running' | 'unknown' | 'completed' | 'failed' | 'cancelled';
  output: JobOutput | null;
  errorCode: string | null;
  reservedUnits: number;
  createdAt: string;
  updatedAt: string;
};
export type ModelResponse = {
  models: AIModel[];
  executionEnabled: boolean;
  reason?: string;
  availableOperations?: AIOperation[];
  operationStatus?: Record<string, { available: boolean; reason: string | null }>;
};
