import { MAX_DIMENSION, MAX_TILED_DIMENSION, MAX_TILED_PIXELS } from './geometry.js';
import { MAX_V3_PIXELS } from './v3-registry.js';
import { MAX_V4_PIXELS } from './v4-types.js';
import type { EditorRecipe } from './v2-types.js';

/** Browser source admission uses the monolithic preview side limit for V3/V4
 * and the separate tiled source path for existing V1/V2 works. */
export function localEditorSourceLimits(version: EditorRecipe['schemaVersion']) {
  if (version === 4) return { maxPixels: MAX_V4_PIXELS, maxDimension: MAX_DIMENSION };
  if (version === 3) return { maxPixels: MAX_V3_PIXELS, maxDimension: MAX_DIMENSION };
  return { maxPixels: MAX_TILED_PIXELS, maxDimension: MAX_TILED_DIMENSION };
}
