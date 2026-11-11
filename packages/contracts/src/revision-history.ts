import { z } from 'zod';

export const revisionOriginKindSchema = z.enum([
  'initial',
  'manual',
  'rename',
  'restore',
  'history-fork',
  'project-copy',
  'collaboration',
  'ai-fork',
  'ai-generated',
  'ai-replace',
  'ai-layer',
  'ai-parameters',
  'assistant-auto',
  'assistant-confirm',
]);
export type RevisionOriginKind = z.infer<typeof revisionOriginKindSchema>;

export const revisionHistoryQuerySchema = z.object({
  beforeVersion: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  summary: z.enum(['true', 'false']).default('false'),
});

export const forkRevisionSchema = z
  .object({
    revisionId: z.uuid(),
    idempotencyKey: z.uuid(),
    title: z.string().trim().min(1).max(120),
  })
  .strict();

export const replaceArtworkSourceSchema = z
  .object({
    assetId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    mode: z.enum(['reset', 'carry-color']).default('reset'),
  })
  .strict();
