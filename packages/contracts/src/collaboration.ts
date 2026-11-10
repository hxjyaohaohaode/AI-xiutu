import { z } from 'zod';

/** Protocol coordinates always refer to the immutable oriented source image. */
export const COLLABORATION_PROTOCOL_VERSION = 1 as const;
export const collaborationLimits = Object.freeze({
  sessionTtlSeconds: 60,
  leaseTtlSeconds: 30,
  heartbeatRecommendedMs: 10_000,
  presenceMinimumIntervalMs: 250,
  previewMinimumIntervalMs: 300,
  pollIntervalMs: 350,
  maxWaitMs: 20_000,
  maxPollsPerUser: 8,
  maxPollsPerInstance: 128,
  maxSessionsPerArtwork: 24,
  maxSessionsPerUser: 4,
  maxLeasesPerSession: 8,
  maxPreviewBytes: 131_072,
  eventPageSize: 200,
  retainedTransientEvents: 1_000,
});
const identifier = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:-]+$/);
export const collaborationTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('document') }).strict(),
  z.object({ kind: z.literal('parameter'), id: identifier }).strict(),
  z.object({ kind: z.literal('curve'), id: z.enum(['rgb', 'red', 'green', 'blue']) }).strict(),
  // Separate legacy regions from v3 regions: equal ids in different collections are legal.
  z
    .object({
      kind: z.literal('region'),
      id: identifier,
      collection: z.enum(['regions', 'regionEdits']),
    })
    .strict(),
  z.object({ kind: z.literal('region-group'), id: identifier }).strict(),
  z.object({ kind: z.literal('image-layer'), id: identifier }).strict(),
  z.object({ kind: z.literal('paint-layer'), id: identifier }).strict(),
]);
export type CollaborationTarget = z.infer<typeof collaborationTargetSchema>;
const point = z
  .object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) })
  .strict();
export const collaborationOperationSchema = z.discriminatedUnion('type', [
  z
    .object({ type: z.literal('set-parameter'), path: identifier, value: z.number().finite() })
    .strict(),
  z
    .object({
      type: z.literal('set-curve'),
      channel: z.enum(['rgb', 'red', 'green', 'blue']),
      points: z
        .array(z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]))
        .min(2)
        .max(16),
    })
    .strict(),
  // Values undergo the authoritative whole-recipe parser after replacement; not arbitrary JSON patches.
  z
    .object({
      type: z.literal('replace-node'),
      collection: z.enum(['regions', 'regionEdits', 'regionGroups', 'imageLayers', 'paintLayers']),
      id: identifier,
      value: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z.object({ type: z.literal('replace-recipe'), recipe: z.unknown() }).strict(),
]);
export type CollaborationOperation = z.infer<typeof collaborationOperationSchema>;
export const collaborationHeartbeatSchema = z
  .object({
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cursor: point.nullable().optional(),
    tool: z.string().trim().max(80).nullable().optional(),
    selection: collaborationTargetSchema.nullable().optional(),
  })
  .strict();
export type CollaborationHeartbeat = z.infer<typeof collaborationHeartbeatSchema>;
const fenceSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((s) => BigInt(s) <= 9223372036854775807n);
export const collaborationLeaseProofSchema = z
  .object({ sessionId: z.uuid(), fence: fenceSchema })
  .strict();
export const collaborationCommandSchema = z
  .object({
    protocolVersion: z.literal(1),
    idempotencyKey: z.uuid(),
    sessionId: z.uuid(),
    leaseId: z.uuid(),
    fence: fenceSchema,
    baseVersion: z.number().int().positive(),
    operation: collaborationOperationSchema,
  })
  .strict();
export type CollaborationCommand = z.infer<typeof collaborationCommandSchema>;
export const collaborationPreviewSchema = collaborationCommandSchema
  .omit({ protocolVersion: true, idempotencyKey: true })
  .extend({
    sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  });
export type CollaborationPreviewRequest = z.infer<typeof collaborationPreviewSchema>;
export interface SourceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CollaborationSession {
  id: string;
  artworkId: string;
  userId: string;
  displayName: string;
  cursor: { x: number; y: number } | null;
  tool: string | null;
  selection: CollaborationTarget | null;
  sequence: number;
  expiresAt: string;
}
export interface CollaborationLease {
  id: string;
  sessionId: string;
  userId: string;
  displayName: string;
  target: CollaborationTarget;
  fence: string;
  expiresAt: string;
  /** Conservative source-space support; null means the target is a non-spatial global property. */
  bounds: SourceBounds | null;
}
export interface CollaborationPreview {
  leaseId: string;
  sessionId: string;
  userId: string;
  sequence: number;
  baseVersion: number;
  operation: CollaborationOperation;
  expiresAt: string;
}
export interface CollaborationEvent {
  cursor: string;
  type: 'presence.changed' | 'lease.changed' | 'preview.changed' | 'revision.committed';
  actorId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}
/** API adds its existing artwork/revision/asset DTOs, keeping transport types independent of web. */
export interface CollaborationSnapshot<Artwork = unknown, Revision = unknown, Asset = unknown> {
  artwork: Artwork;
  revision: Revision | null;
  asset: Asset;
  presences: CollaborationSession[];
  leases: CollaborationLease[];
  previews: CollaborationPreview[];
  limits: typeof collaborationLimits;
  serverTime: string;
}
export interface CollaborationPollResponse<Artwork = unknown, Revision = unknown, Asset = unknown> {
  protocolVersion: 1;
  cursor: string;
  resetRequired: boolean;
  hasMore: boolean;
  snapshot: CollaborationSnapshot<Artwork, Revision, Asset>;
  events: CollaborationEvent[];
}
export interface CollaborationCommandResponse<
  Artwork = unknown,
  Revision = unknown,
  Asset = unknown,
> {
  artwork: Artwork;
  revision: Revision;
  asset: Asset;
  cursor: string;
  rebased: boolean;
  replayed: boolean;
}
