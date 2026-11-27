import { z } from 'zod';
import { sceneBalanceChanges, sceneBalanceStrategies, type EditorRecipe } from '@ai-xiutu/editor';

export const sceneBalanceSchema = z
  .object({
    strategy: z.enum(sceneBalanceStrategies),
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

/** A bounded correction from the current composed image. Input is measured by the application. */
export function sceneBalance(base: EditorRecipe, observation: unknown, raw: unknown) {
  const { strategy, strength } = sceneBalanceSchema.parse(raw);
  const { before } = measuredScene.parse(observation);
  const changes = sceneBalanceChanges(base.adjustments, before, strategy, strength)
    .map(({ id, value }) => ({ path: `adjustments.${id}`, value }));
  return { strategy, changes, tone: before.tone };
}
