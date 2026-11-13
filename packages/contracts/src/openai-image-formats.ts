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

/** The two-frame Images 2.6 request packs a 4×2 or 2×4 storyboard. */
export function openAITwoFrameGifFits(
  width: number,
  height: number,
  limits: { minPixels: number; maxPixels: number; maxDimension: number; minAspectRatio: number; maxAspectRatio: number },
) {
  return [[4, 2], [2, 4]].some(([columns, rows]) => {
    const w = width * columns!, h = height * rows!, pixels = w * h;
    return Math.max(w, h) <= limits.maxDimension && pixels >= limits.minPixels &&
      pixels <= limits.maxPixels && w / h >= limits.minAspectRatio && w / h <= limits.maxAspectRatio;
  });
}

export function imageBillableOutputs(
  options?: { n?: number; outputFormat?: string; frameCount?: number; partialImages?: number },
) {
  const n = options?.n ?? 1;
  if (options?.outputFormat === 'gif') return n * (options.frameCount ?? gifFrameCount.default);
  if (options?.outputFormat === 'svg') return n + 1;
  return n + (options?.partialImages ?? 0);
}
