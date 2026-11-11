import { z } from 'zod';
import { creativeBriefSchema } from './creative.js';
import type { AssistantWorkspace } from './assistant-ui.js';
import type { MemorySuggestion } from './memory.js';

/** Browser → application protocol, deliberately not an arbitrary vendor-event tunnel. */
export const assistantContextSchema = z
  .object({
    artworkId: z.uuid(),
    assetId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    recipe: z.unknown(),
    imageDataUrl: z
      .string()
      .max(1_500_000)
      .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
  })
  .strict();
export type AssistantContext = z.infer<typeof assistantContextSchema>;
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
export const assistantTurnSchema = z
  .object({
    idempotencyKey: z.uuid(),
    modelId: z.string().min(1).max(128),
    prompt: z.string().trim().min(1).max(4000),
    context: assistantContextSchema.optional(),
    scope: assistantScopeSchema.default({
      spaceIds: [],
      referenceAssetIds: [],
      allowWebSearch: false,
      usePersonalMemory: false,
    }),
    parentTurnId: z.uuid().optional(),
    research: assistantResearchPlan.optional(),
  })
  .strict();
export const voiceSessionSchema = z
  .object({
    idempotencyKey: z.uuid(),
    modelId: z.enum([
      'gpt-live-1',
      'gpt-realtime-2.1',
      'gpt-realtime-2.1-mini',
      'gpt-realtime-2',
      'gpt-realtime-1.5',
      'gpt-realtime',
      'gpt-realtime-mini',
    ]),
    backendModelId: z.string().min(1).max(128),
    voice: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{0,63}$/)
      .default('marin'),
    context: assistantContextSchema.optional(),
    scope: assistantScopeSchema.default({
      spaceIds: [],
      referenceAssetIds: [],
      allowWebSearch: false,
      usePersonalMemory: false,
    }),
  })
  .strict();
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
      context: assistantContextSchema,
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
  | { type: 'context'; accepted: boolean; imageShared: boolean; contextTag?: string }
  | { type: 'tool'; name: string; state: 'running' | 'completed' | 'failed' }
  | {
      type: 'assistant-result';
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
