import { createRecipeV4 } from '@ai-xiutu/editor';
import {
  DEFAULT_SAMPLE_SETTINGS,
  resolveSampleSettings,
  type SampleSettings,
} from './sample-settings';
export { DEFAULT_SAMPLE_SETTINGS, getSampleImage, type SampleSettings } from './sample-settings';

/** Preview and legacy sample entries use one resolved snapshot. A preset is never a second filter layer. */
export function createSampleRecipe(settings: SampleSettings = DEFAULT_SAMPLE_SETTINGS) {
  const recipe = createRecipeV4();
  const values = resolveSampleSettings(settings);
  recipe.adjustments.temperature = values.warmth;
  recipe.adjustments.exposure = values.exposure;
  recipe.adjustments.contrast = values.contrast;
  recipe.adjustments.saturation = values.saturation;
  recipe.adjustments.highlights = values.highlights;
  recipe.adjustments.shadows = values.shadows;
  recipe.adjustments.vibrance = values.vibrance;
  recipe.detail.clarity = values.clarity;
  return recipe;
}
