import { z } from 'zod';

export const CONTRACT_VERSION = 1 as const;
export const jobStates = [
  'queued',
  'running',
  'completed',
  'failed',
  'unknown',
  'cancelled',
] as const;
export type JobState = (typeof jobStates)[number];
export const resourceKinds = [
  'asset',
  'artwork',
  'revision',
  'document',
  'mask',
  'analysis',
  'recipe',
  'job',
] as const;
export type ResourceKind = (typeof resourceKinds)[number];
export const resourceRefSchema = z
  .object({
    kind: z.enum(resourceKinds),
    id: z.uuid(),
    projectId: z.uuid(),
    version: z.number().int().positive().optional(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export type ResourceReference = z.infer<typeof resourceRefSchema>;

/** Normalized source coordinates. Raster indices and CSS coordinates must not be
 * silently substituted; dimensions/hash identify the analysis frame. */
export const sourceFrameSchema = z
  .object({
    coordinates: z.literal('source-normalized'),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().min(1).max(16384),
    height: z.number().int().min(1).max(16384),
    orientation: z.literal('normalized'),
  })
  .strict();
export type SourceFrame = z.infer<typeof sourceFrameSchema>;

export const numericParameterSchema = z
  .object({
    path: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/)
      .max(120),
    label: z.string().min(1).max(100),
    group: z.string().min(1).max(80),
    unit: z.string().max(30),
    minimum: z.number().finite(),
    maximum: z.number().finite(),
    step: z.number().finite().positive(),
    neutral: z.number().finite(),
    integer: z.boolean(),
    /** Step is a UI increment, not a declaration that every real value lies on a lattice. */
    stepPolicy: z.literal('interaction-increment'),
    schemaVersions: z.array(z.number().int().positive()).min(1).max(16),
    scopes: z
      .array(z.enum(['global', 'region', 'group']))
      .min(1)
      .max(3),
    scopeMinimumVersion: z
      .object({
        global: z.number().int().positive(),
        region: z.number().int().positive().optional(),
        group: z.number().int().positive().optional(),
      })
      .strict(),
    aiWritable: z.boolean(),
    description: z.string().max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.maximum < value.minimum ||
      value.neutral < value.minimum ||
      value.neutral > value.maximum
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Parameter range does not contain its neutral value',
      });
    if (
      value.integer &&
      (!Number.isInteger(value.minimum) ||
        !Number.isInteger(value.maximum) ||
        !Number.isInteger(value.neutral))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Integer parameter bounds and neutral must be integers',
      });
  });
export type NumericParameterDescriptor = z.infer<typeof numericParameterSchema>;

export interface AnalysisAdapter<Input, Output> {
  readonly id: string;
  readonly algorithmVersion: string;
  readonly configured: boolean;
  analyze(input: Input, options: { signal: AbortSignal; frame: SourceFrame }): Promise<Output>;
}
export interface RenderAdapter<Recipe, Pixels> {
  readonly id: string;
  readonly algorithmVersion: string;
  readonly recipeVersions: readonly number[];
  validate(input: unknown): Recipe;
  render(input: Pixels, recipe: Recipe, options: { signal?: AbortSignal }): Promise<Pixels>;
}
export interface CommandEnvelope<Payload = unknown> {
  protocolVersion: 1;
  commandId: string;
  idempotencyKey: string;
  projectId: string;
  expectedVersion?: number;
  payload: Payload;
}
export const commandEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(1),
    commandId: z
      .string()
      .regex(/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/)
      .max(100),
    idempotencyKey: z.uuid(),
    projectId: z.uuid(),
    expectedVersion: z.number().int().positive().optional(),
    payload: z.unknown(),
  })
  .strict();

export interface DomainEvent {
  protocolVersion: 1;
  sequence: string;
  type: string;
  spaceId: string;
  projectId: string | null;
  entityId: string | null;
  createdAt: string;
}
export interface CandidateResult<Output = unknown> {
  protocolVersion: 1;
  jobId: string;
  inputHash: string;
  state: JobState;
  output: Output | null;
  /** Model completion and user adoption are distinct facts. */
  requiresUserDecision: boolean;
}

/** The source comes from the route and bytes/provenance come from the database.
 * A client cannot turn downloaded private bytes into an unscoped upload here. */
export const assetCopyRequestSchema = z
  .object({
    targetProjectId: z.uuid(),
    idempotencyKey: z.uuid(),
  })
  .strict();
export type AssetCopyRequest = z.infer<typeof assetCopyRequestSchema>;
export interface AssetCopyRecord {
  id: string;
  sourceAssetId: string;
  sourceProjectId: string;
  targetProjectId: string;
  copiedAssetId: string;
  createdAt: string;
}
export interface StorageAccountSummary {
  spaceId: string;
  version: number;
  maxBytes: number;
  maxAssets: number;
  retainedBytes: number;
  retainedAssets: number;
  accounting: 'retained-logical-assets';
  softDeleteReclaimsCapacity: false;
}

const shared = {
  protocolVersion: z.literal(1),
  idempotencyKey: z.uuid(),
  reason: z.string().trim().min(1).max(500).optional(),
};
const named = { title: z.string().trim().min(1).max(120).optional() };
export const aiResultDecisionSchema = z.discriminatedUnion('action', [
  z
    .object({
      ...shared,
      action: z.literal('reject'),
      outputIndex: z.number().int().min(0).max(9).optional(),
    })
    .strict(),
  z
    .object({
      ...shared,
      ...named,
      action: z.literal('fork'),
      outputIndex: z.number().int().min(0).max(9).optional(),
    })
    .strict(),
  z
    .object({
      ...shared,
      action: z.literal('replace'),
      outputIndex: z.number().int().min(0).max(9).default(0),
      targetArtworkId: z.uuid(),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...shared,
      action: z.literal('layer'),
      outputIndex: z.number().int().min(0).max(9).default(0),
      targetArtworkId: z.uuid(),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...shared,
      action: z.literal('apply-plan'),
      targetArtworkId: z.uuid(),
      expectedVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      ...shared,
      ...named,
      action: z.literal('save-text'),
      body: z.string().max(100000).optional(),
      targetDocumentId: z.uuid().optional(),
      expectedDocumentVersion: z.number().int().positive().optional(),
    })
    .strict()
    .refine(
      (value) => Boolean(value.targetDocumentId) === Boolean(value.expectedDocumentVersion),
      'Replacing a document requires its ID and expected version together',
    ),
]);
export type AiResultDecisionRequest = z.infer<typeof aiResultDecisionSchema>;
export interface AiResultDecision {
  id: string;
  jobId: string;
  projectId: string;
  actorId: string;
  action: AiResultDecisionRequest['action'];
  outputIndex: number | null;
  targetArtworkId: string | null;
  revisionId: string | null;
  documentId: string | null;
  documentVersion: number | null;
  reason: string | null;
  contentEdited: boolean;
  createdAt: string;
}
