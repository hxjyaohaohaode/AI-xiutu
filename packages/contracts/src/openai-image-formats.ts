import { z } from 'zod';

export const openAIImageFormats = ['png', 'jpeg', 'webp', 'svg', 'gif'] as const;
export const gifFrameCount = { min: 2, max: 16, default: 9 } as const;
// The REST reference specifies the GIF container's maximum encoded delay.
export const gifFrameDelay = { min: 20, max: 655_350, default: 200 } as const;
export const openAISvgAuthorSchema = z.object({
  model: z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9.-]*$/),
  reasoning: z.object({
    effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
  }).strict().optional(),
}).strict();
export type OpenAISvgAuthor = z.infer<typeof openAISvgAuthorSchema>;

export function imageBillableOutputs(
  options?: { n?: number; outputFormat?: string; frameCount?: number; partialImages?: number },
) {
  const n = options?.n ?? 1;
  if (options?.outputFormat === 'gif') return n * (options.frameCount ?? gifFrameCount.default);
  if (options?.outputFormat === 'svg') return n + 1;
  return n + (options?.partialImages ?? 0);
}
