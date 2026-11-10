import { z } from 'zod';

export const creativeBriefSchema = z
  .object({
    feeling: z.string().trim().max(1200).default(''),
    purpose: z.string().trim().max(300).default(''),
    preserve: z.string().trim().max(800).default('人物特征、自然肤质、原有主体'),
    avoid: z.string().trim().max(800).default('过度磨皮、假白、肢体变形、无关文字和水印'),
    strength: z.enum(['subtle', 'balanced', 'bold']).default('balanced'),
    referenceIntent: z.enum(['style', 'subject', 'composition', 'all']).default('style'),
  })
  .strict();
export type CreativeBrief = z.infer<typeof creativeBriefSchema>;
export const assistantGrantSchema = z
  .object({
    mode: z.enum(['suggest', 'confirm', 'auto']),
    unitLimit: z.number().int().min(1).max(100000),
    stepLimit: z.number().int().min(1).max(100),
    minutes: z.number().int().min(1).max(120).default(30),
    allowedActions: z
      .array(z.enum(['assistant-turn', 'realtime-voice', 'edit', 'generate-image']))
      .min(1)
      .max(4),
    modelIds: z.array(z.string().min(1).max(128)).min(1).max(64),
  })
  .strict();
export interface AssistantGrant {
  id: string;
  mode: 'suggest' | 'confirm' | 'auto';
  unitLimit: number;
  usedUnits: number;
  stepLimit: number;
  usedSteps: number;
  expiresAt: string;
  revokedAt: string | null;
}
