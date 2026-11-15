import { z } from 'zod';
import { liveDelegationSchema, liveTranslationSchema, OPENAI_TRANSLATION_MODEL } from './openai-live.js';
import { creativeBriefSchema } from './creative.js';
import type { AssistantWorkspace } from './assistant-ui.js';
import type { MemorySuggestion } from './memory.js';

const assistantImageDataUrl = z
  .string()
  .max(1_500_000)
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/);

/** Browser → application protocol, deliberately not an arbitrary vendor-event tunnel. */
export const assistantContextSchema = z
  .object({
    artworkId: z.uuid(),
    assetId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    recipe: z.unknown(),
    imageDataUrl: assistantImageDataUrl.optional(),
  })
  .strict();
export type AssistantContext = z.infer<typeof assistantContextSchema>;
// A local photo can supply visual context for discussion without identifying a cloud artwork.
const voiceContextSchema = z.union([
  assistantContextSchema,
  z.object({ imageDataUrl: assistantImageDataUrl }).strict(),
]);
export type VoiceContext = z.infer<typeof voiceContextSchema>;
export const assistantVisualAttachmentSchema = z
  .object({
    kind: z.enum(['editor', 'photo', 'sketch']),
    imageDataUrl: assistantImageDataUrl,
  })
  .strict();
export type AssistantVisualAttachment = z.infer<typeof assistantVisualAttachmentSchema>;
export const assistantCandidateCommitSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    recipe: z.unknown().refine((value) => value !== undefined),
    includeUnsavedBase: z.boolean().default(false),
  })
  .strict();
export const assistantPublicSearchSchema = z
  .object({ query: z.string().trim().min(1).max(240), kind: z.enum(['text', 'images']) })
  .strict();
export const assistantResearchBranch = z.discriminatedUnion('kind', [
  assistantPublicSearchSchema
    .extend({ kind: z.literal('web'), resultKind: z.enum(['text', 'images']) })
    .strict(),
  z
    .object({
      kind: z.literal('cloud'),
      query: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(10),
    })
    .strict(),
  z.object({ kind: z.literal('canvas') }).strict(),
]);
export const assistantResearchPlan = z
  .array(assistantResearchBranch)
  .min(1)
  .max(4)
  .refine(
    (nodes) =>
      nodes.filter((node) => node.kind === 'web').length <= 2 &&
      nodes.filter((node) => node.kind === 'canvas').length <= 1,
  );
export type AssistantResearchBranch = z.infer<typeof assistantResearchBranch>;
export type AssistantDispatchPurpose = 'conversation' | 'web-search' | 'research-merge';
export interface AssistantBranchEvent {
  id: string;
  parentId: string | null;
  dependsOn: string[];
  kind: 'root' | 'web' | 'cloud' | 'canvas' | 'merge' | 'candidate' | 'pixel-review' | 'nomination';
  state: 'running' | 'completed' | 'failed';
  execution: 'provider' | 'server';
  resultCount?: number;
}
export const assistantScopeSchema = z
  .object({
    spaceIds: z.array(z.uuid()).max(12).default([]),
    referenceAssetIds: z.array(z.uuid()).max(8).default([]),
    allowWebSearch: z.boolean().default(false),
    publicSearch: assistantPublicSearchSchema.optional(),
    usePersonalMemory: z.boolean().default(false),
    executionGrantId: z.uuid().optional(),
    creativeBrief: creativeBriefSchema.optional(),
  })
  .strict();
export type AssistantScope = z.infer<typeof assistantScopeSchema>;
export const responseEfforts = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;
export const responseSummaries = ['auto', 'detailed', 'concise'] as const;
export const responseTiers = ['default', 'fast', 'priority', 'ultrafast', 'flex'] as const;
export const responseFormatSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text') }).strict(),
  z.object({ type: z.literal('json_object') }).strict(),
  z.object({
    type: z.literal('json_schema'),
    name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    schema: z.record(z.string(), z.unknown()).refine((value) => {
      if (value.type !== 'object' || JSON.stringify(value).length > 12_000) return false;
      function bounded(node: unknown, depth: number): boolean {
        if (depth > 16) return false;
        if (Array.isArray(node)) return node.every((item) => bounded(item, depth + 1));
        if (!node || typeof node !== 'object') return true;
        return Object.entries(node).every(([key, item]) =>
          key === '$ref'
            ? typeof item === 'string' && (item === '#' || item.startsWith('#/'))
            : bounded(item, depth + 1),
        );
      }
      return bounded(value, 0);
    }, 'Use a bounded object JSON Schema with local references'),
    strict: z.boolean().default(true),
  }).strict(),
]);
export const assistantResponseTuning = z
  .object({
    effort: z.enum(responseEfforts).optional(),
    verbosity: z.enum(['low', 'medium', 'high']).optional(),
    reasoningMode: z.enum(['standard', 'pro']).optional(),
    reasoningSummary: z.enum(responseSummaries).optional(),
    maxOutputTokens: z.number().int().min(256).max(8192).optional(),
    format: responseFormatSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
    topP: z.number().min(0).max(1).optional(),
    serviceTier: z.enum(responseTiers).optional(),
  })
  .strict();
export type AssistantResponseTuning = z.infer<typeof assistantResponseTuning>;
export type AssistantResponsePricing = {
  defaultTier: (typeof responseTiers)[number];
  tierUnits: Partial<Record<(typeof responseTiers)[number], number>>;
  /** Additional units when switching a standard model to pro mode. */
  proExtraUnits?: number;
};
export function assistantTurnPrice(
  base: number, pricing: AssistantResponsePricing | undefined,
  tuning: AssistantResponseTuning, defaults?: AssistantResponseTuning,
) {
  const tier = tuning.serviceTier ?? pricing?.defaultTier ?? 'default';
  const units = pricing?.tierUnits[tier] ?? (tier === (pricing?.defaultTier ?? 'default') ? base : null);
  if (units === null || !Number.isSafeInteger(units) || units <= 0) return null;
  const addsPro = tuning.reasoningMode === 'pro' && defaults?.reasoningMode !== 'pro';
  if (!addsPro) return units;
  const extra = pricing?.proExtraUnits;
  return extra !== undefined && Number.isSafeInteger(extra) && extra >= 0 && Number.isSafeInteger(units + extra)
    ? units + extra : null;
}
export const assistantTurnSchema = z
  .object({
    idempotencyKey: z.uuid(),
    modelId: z.string().min(1).max(128),
    prompt: z.string().trim().min(1).max(4000),
    context: assistantContextSchema.optional(),
    visualAttachment: assistantVisualAttachmentSchema.optional(),
    scope: assistantScopeSchema.default({
      spaceIds: [],
      referenceAssetIds: [],
      allowWebSearch: false,
      usePersonalMemory: false,
    }),
    parentTurnId: z.uuid().optional(),
    research: assistantResearchPlan.optional(),
    responseTuning: assistantResponseTuning.optional(),
    expectedUnits: z.number().int().positive().max(200_000).optional(),
  })
  .strict();
export const REALTIME_REASONING = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
const preferenceModelId = z.string().regex(/^(?:[a-zA-Z0-9._:-]{1,128})?$/);
export const assistantPreferencesSchema = z.object({
  textModel: preferenceModelId,
  voiceModel: preferenceModelId,
  mode: z.enum(['suggest', 'confirm']),
  captions: z.boolean(),
}).strict();
export type AssistantPreferences = z.infer<typeof assistantPreferencesSchema>;
export const defaultAssistantPreferences: Readonly<AssistantPreferences> = Object.freeze({
  textModel: '', voiceModel: '', mode: 'confirm', captions: true,
});
export const assistantPreferencesPatchSchema = assistantPreferencesSchema.partial()
  .refine((patch) => Object.keys(patch).length > 0);
export const DEFAULT_CALL_TRANSCRIPTION_MODEL = 'gpt-transcribe';
export const CALL_TRANSCRIPTION_MODELS = [
  DEFAULT_CALL_TRANSCRIPTION_MODEL,
  'gpt-live-transcribe',
  'gpt-realtime-whisper',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'gpt-4o-mini-transcribe-2025-03-20',
  'gpt-4o-mini-transcribe-2025-12-15',
  'whisper-1',
] as const;
export const realtimeOptionsSchema = z
  .object({
    transcriptionModel: z.enum(CALL_TRANSCRIPTION_MODELS).optional(),
    language: z
      .string()
      .regex(/^[a-z]{2}$/)
      .optional(),
    prompt: z.string().trim().min(1).max(800).optional(),
    delay: z.enum(REALTIME_REASONING).optional(),
    noiseReduction: z.enum(['near_field', 'far_field']).nullable().optional(),
    outputSpeed: z.number().min(0.25).max(1.5).optional(),
    turnDetection: z
      .discriminatedUnion('type', [
        z
          .object({
            type: z.literal('server_vad'),
            threshold: z.number().min(0).max(1).optional(),
            prefixPaddingMs: z.number().int().min(0).max(3000).optional(),
            silenceDurationMs: z.number().int().min(100).max(3000).optional(),
          })
          .strict(),
        z
          .object({
            type: z.literal('semantic_vad'),
            eagerness: z.enum(['auto', 'low', 'medium', 'high']).optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict()
  .refine(
    (options) =>
      options.transcriptionModel === 'gpt-realtime-whisper' ? !options.prompt : !options.delay,
    'Transcription delay is available only with Realtime Whisper, which does not accept a prompt',
  );
export const liveOptionsSchema = z
  .object({
    prompt: z.string().trim().min(1).max(1200).optional(),
    opening: z
      .string()
      .trim()
      .min(1)
      .refine((value) => new TextEncoder().encode(value).length <= 350)
      .optional(),
    acknowledgementDelayMs: z.number().int().min(0).max(800).optional(),
  })
  .strict();
export type RealtimeOptions = z.infer<typeof realtimeOptionsSchema>;
export type LiveOptions = z.infer<typeof liveOptionsSchema>;

export const personalVoiceTuningSchema = z.object({
  live: liveOptionsSchema.optional(),
  realtime: realtimeOptionsSchema.optional(),
  reasoningEffort: z.enum(REALTIME_REASONING).optional(),
  maxOutputTokens: z.number().int().min(256).max(4096).optional(),
}).strict();
export type PersonalVoiceTuning = z.infer<typeof personalVoiceTuningSchema>;
export const voiceSessionFields = z
  .object({
    idempotencyKey: z.uuid(),
    modelId: z.enum([
      'gpt-live-1',
      'gpt-realtime-2.1',
      'gpt-realtime-2.1-mini',
      'gpt-realtime-2',
      'gpt-realtime-1.5',
      'gpt-realtime',
      'gpt-realtime-2025-08-28',
      'gpt-realtime-mini',
      'gpt-realtime-mini-2025-12-15',
      OPENAI_TRANSLATION_MODEL,
    ]),
    backendModelId: z.string().min(1).max(128).optional(),
    voice: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,63}$/)
      .default('marin'),
    context: voiceContextSchema.optional(),
    delegation: liveDelegationSchema.optional(),
    translation: liveTranslationSchema.optional(),
    tuning: personalVoiceTuningSchema.optional(),
    expectedUnits: z.number().int().positive().max(100_000).optional(),
    scope: assistantScopeSchema.default({
      spaceIds: [],
      referenceAssetIds: [],
      allowWebSearch: false,
      usePersonalMemory: false,
    }),
  })
  .strict();
export const voiceSessionSchema = voiceSessionFields.refine((body) => body.modelId === OPENAI_TRANSLATION_MODEL
    ? Boolean(body.translation && !body.delegation && !body.backendModelId && !body.context)
    : Boolean(body.backendModelId && !body.translation &&
      (body.modelId === 'gpt-live-1' || !body.delegation)), 'Voice settings must match the selected model');
export const voiceClientEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('audio'),
      pcm: z
        .string()
        .min(4)
        .max(12_800)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .strict(),
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(4000) }).strict(),
  z.object({ type: z.literal('search'), search: assistantPublicSearchSchema }).strict(),
  z.object({ type: z.literal('context.invalidate') }).strict(),
  z
    .object({
      type: z.literal('context'),
      context: voiceContextSchema,
      contextTag: z.uuid().optional(),
    })
    .strict(),
  z.object({ type: z.literal('mute'), muted: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('playback-cut'),
      itemId: z.string().max(128),
      playedMs: z.number().int().min(0).max(600_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('interrupt'),
      itemId: z.string().max(128).optional(),
      playedMs: z.number().int().min(0).max(600_000).optional(),
    })
    .strict(),
  z.object({ type: z.literal('end') }).strict(),
  z.object({ type: z.literal('ping') }).strict(),
]);
export type VoiceClientEvent = z.infer<typeof voiceClientEventSchema>;
export interface AssistantCitation {
  title: string;
  url: string;
}
export const assistantCloudResourceSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid().optional(),
  name: z.string().max(300),
  title: z.string().max(200),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  spaceName: z.string().max(200),
  projectTitle: z.string().max(200),
});
export type AssistantCloudResource = z.infer<typeof assistantCloudResourceSchema>;
export function publicSearchLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/\.$/, '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes('.') ||
      /^\d+(\.\d+){3}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host)
    )
      return null;
    return url.href.length <= 2048 ? url.href : null;
  } catch {
    return null;
  }
}
const searchLink = z.string().refine((value) => publicSearchLink(value) === value);
export interface AssistantPublicImage {
  imageUrl: string;
  sourceUrl: string;
  caption: string;
}
export const assistantSearchEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cloud'),
    query: z.string().max(240),
    resources: z.array(assistantCloudResourceSchema).max(20),
  }),
  z.object({
    kind: z.literal('web'),
    query: z.string().max(240),
    requested: z.enum(['text', 'images']).optional(),
    sources: z.array(z.object({ url: searchLink, title: z.string().max(300) })).max(20),
    images: z
      .array(
        z.object({ imageUrl: searchLink, sourceUrl: searchLink, caption: z.string().max(400) }),
      )
      .max(8),
  }),
]);
export type AssistantSearchEvidence = z.infer<typeof assistantSearchEvidenceSchema>;
export interface GenerationDraftEvidence {
  policyVersion: string;
  promptSha256: string;
  references: {
    assetId: string;
    from: 'selected' | 'cloud-search' | 'history';
    sourceTurnId?: string;
  }[];
}
export interface AssistantCandidate {
  autoEligible?: boolean;
  observation?: unknown;
  /** Text-turn automatic actions are completed/blocked by the server atomically. */
  executionManagedBy?: 'server';
  executionGrantId?: string;
  appliedRevisionId?: string | null;
  id: string;
  kind: 'edit' | 'generation';
  summary: string;
  artworkId: string | null;
  baseVersion: number | null;
  baseRecipeHash: string | null;
  baseRecipe?: unknown;
  recipe?: unknown;
  changes?: { path: string; before: number; after: number; label: string }[];
  prompt?: string;
  referenceAssetIds?: string[];
  generationEvidence?: GenerationDraftEvidence;
  decision: 'pending' | 'previewed' | 'rejected';
}
export type VoiceServerEvent =
  | {
      type: 'ready';
      sessionId: string;
      modelId: string;
      maxSeconds: number;
      maxPublicSearches?: number;
      opening?: 'conversation' | 'preview';
    }
  | { type: 'audio'; pcm: string; itemId?: string }
  | {
      type: 'transcript';
      role: 'user' | 'assistant';
      text: string;
      delta: boolean;
      itemId?: string;
      startMs?: number;
      endMs?: number;
    }
  | { type: 'interrupted'; bySpeech?: true }
  | { type: 'search-started' }
  | {
      type: 'context';
      accepted: boolean;
      imageShared: boolean;
      contextTag?: string;
      reason?: 'version' | 'busy' | 'unavailable';
    }
  | { type: 'tool'; name: string; state: 'running' | 'completed' | 'failed' }
  | { type: 'delegated-result'; kind: 'responses' | 'decisions'; text: string }
  | {
      type: 'assistant-result';
      canvas?: Pick<AssistantContext, 'artworkId' | 'assetId' | 'expectedVersion'>;
      memorySuggestions?: MemorySuggestion[];
      workspace?: AssistantWorkspace;
      text: string;
      citations: AssistantCitation[];
      search?: AssistantSearchEvidence[];
      candidates: AssistantCandidate[];
      execution?:
        | { state: 'applied'; artworkId: string; revisionId: string; candidateId: string }
        | { state: 'blocked' | 'review_required'; candidateId?: string; code: string };
    }
  | { type: 'closed'; state: 'closed' | 'unknown' | 'failed'; reason: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong' };
