import { z } from 'zod';
import { TOOLS, srgbToLinear, type EditorRecipe } from '@ai-xiutu/editor';

export const sceneBalanceSchema = z
  .object({
    strategy: z.enum(['balanced', 'open-shadows', 'retain-highlights', 'preserve-night']),
    strength: z.number().min(0).max(1),
  })
  .strict();

const fraction = z.number().min(0).max(1);
const measuredScene = z.object({
  before: z.object({
    visiblePixels: z.number().min(0),
    blackFraction: fraction,
    tone: z.object({
      low: fraction,
      mid: fraction,
      high: fraction,
      peak: fraction,
      channelClipFraction: fraction,
    }),
  }),
});

const clamp = (number: number, min: number, max: number) => Math.min(max, Math.max(min, number));

/** A bounded correction from the current composed image. Input is measured by the application. */
export function sceneBalance(base: EditorRecipe, observation: unknown, raw: unknown) {
  const { strategy, strength } = sceneBalanceSchema.parse(raw);
  const { before } = measuredScene.parse(observation);
  const { low, mid, high, peak, channelClipFraction } = before.tone;
  if (low > mid || mid > high || high > peak + 1 / 255)
    throw new Error('INVALID_SCENE_MEASUREMENTS');
  if (before.visiblePixels < 16 || high < 0.025 || strength === 0)
    return { strategy, changes: [], tone: before.tone };

  const shoulder = clamp((peak - 0.87) / 0.13 + channelClipFraction * 2, 0, 1);
  const headroom = Math.log2(srgbToLinear(0.96) / srgbToLinear(Math.max(0.03, peak)));
  const correction = Math.log2(srgbToLinear(0.46) / srgbToLinear(Math.max(0.035, mid)));
  let exposure = 0,
    shadows = 0,
    highlights = 0;
  if (strategy === 'balanced') {
    exposure =
      correction > 0
        ? Math.min(Math.max(0, headroom), correction * 0.45, 0.5)
        : Math.max(correction * 0.3, -0.38);
    shadows = clamp((0.23 - low) * 100, 0, 22);
    highlights = -shoulder * 17;
  } else if (strategy === 'open-shadows') {
    shadows = clamp((0.29 - low) * 135, 0, 33);
    highlights = -shoulder * 12;
  } else if (strategy === 'retain-highlights') {
    exposure = mid > 0.46 ? -shoulder * 0.26 : 0;
    highlights = -shoulder * 29;
  } else {
    // Preserve the overall low-key exposure and keep emissive areas from spreading.
    shadows = clamp((0.13 - low) * 70, 0, 8);
    highlights = -shoulder * 14;
  }
  if (before.blackFraction > 0.12) shadows *= 0.65;
  const changes = (
    [
      ['exposure', exposure],
      ['shadows', shadows],
      ['highlights', highlights],
    ] as const
  ).flatMap(([id, delta]) => {
    const { step, min, max } = TOOLS.find((tool) => tool.id === id)!;
    const difference = Math.round((delta * strength) / step) * step;
    const value = clamp(Number((base.adjustments[id] + difference).toFixed(8)), min, max);
    return difference !== 0 && value !== base.adjustments[id]
      ? [{ path: `adjustments.${id}`, value }]
      : [];
  });
  return { strategy, changes, tone: before.tone };
}
