import { createRecipeV4 } from '@ai-xiutu/editor';
import { DEFAULT_SAMPLE_SETTINGS, type SampleSettings } from './sample-settings';
export { DEFAULT_SAMPLE_SETTINGS, getSampleImage, type SampleSettings } from './sample-settings';

/** One recipe for both the live introduction and the editable studio source. */
export function createSampleRecipe(settings: SampleSettings = DEFAULT_SAMPLE_SETTINGS) {
  const recipe = createRecipeV4();
  recipe.adjustments.temperature = Math.max(
    -60,
    Math.min(60, Number.isFinite(settings.warmth) ? settings.warmth : 18),
  );
  recipe.adjustments.exposure = Math.max(
    -1,
    Math.min(1, Number.isFinite(settings.exposure) ? settings.exposure : 0.1),
  );
  recipe.adjustments.saturation =
    settings.preset === 'vivid' ? 18 : settings.preset === 'soft' ? -18 : 0;
  recipe.adjustments.contrast =
    settings.preset === 'vivid' ? 10 : settings.preset === 'soft' ? -12 : 0;
  return recipe;
}
