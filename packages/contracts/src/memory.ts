import { z } from 'zod';
export const assistantMemorySchema = z
  .object({
    scope: z.enum(['user', 'team', 'project', 'artwork']),
    category: z.enum(['preference', 'constraint', 'workflow', 'correction']),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(4000),
    artworkId: z.uuid().optional(),
    sourceTurnId: z.uuid().optional(),
    expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export interface AssistantMemory {
  id: string;
  scope: 'user' | 'team' | 'project' | 'artwork';
  category: 'preference' | 'constraint' | 'workflow' | 'correction';
  title: string;
  content: string;
  version: number;
  ownerId: string;
  projectId: string | null;
  artworkId: string | null;
  sourceTurnId: string | null;
  expiresAt: string | null;
  updatedAt: string;
  canEdit: boolean;
}
export const memorySuggestionSchema = z
  .object({
    scope: z.enum(['user', 'team', 'project', 'artwork']),
    category: z.enum(['preference', 'constraint', 'workflow', 'correction']),
    title: z.string().trim().min(1).max(160),
    content: z.string().trim().min(1).max(4000),
    evidence: z.string().trim().min(1).max(500),
  })
  .strict();
export type MemorySuggestion = z.infer<typeof memorySuggestionSchema>;
