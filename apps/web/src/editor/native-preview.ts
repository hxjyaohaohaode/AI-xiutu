import {
  DEFAULT_RECIPE_V2,
  MAX_EXPLICIT_PIXELS,
  MAX_DIMENSION,
  createFineTransformV3,
  createOpticsV3,
  type EditorRecipe,
} from '@ai-xiutu/editor';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const neutralOptics = createOpticsV3();
const neutralTransform = createFineTransformV3();

export function fitsNativePreview(width: number, height: number): boolean {
  return width <= MAX_DIMENSION && height <= MAX_DIMENSION && width * height <= MAX_EXPLICIT_PIXELS;
}

/** Native point color uses the renderer's exact byte maps and a bounded RGBA frame. */
export function canPreviewNativeColor(recipe: EditorRecipe): boolean {
  if (recipe.local.enabled || recipe.adjustments.sharpness !== 0 || recipe.adjustments.soften !== 0)
    return false;
  if (recipe.schemaVersion === 1) return true;
  if (
    recipe.regions.some((region) => region.enabled && region.opacity > 0) ||
    !equal(recipe.levels, DEFAULT_RECIPE_V2.levels) ||
    !equal(recipe.hsl, DEFAULT_RECIPE_V2.hsl) ||
    !equal(recipe.grading, DEFAULT_RECIPE_V2.grading) ||
    !equal(recipe.detail, DEFAULT_RECIPE_V2.detail) ||
    !equal(recipe.effects, DEFAULT_RECIPE_V2.effects)
  )
    return false;
  if (recipe.schemaVersion === 2) return true;
  if (
    (recipe.warp.enabled && recipe.warp.strokes.some((stroke) => stroke.strength !== 0)) ||
    recipe.paintLayers.some(
      (layer) => layer.enabled && layer.opacity > 0 && layer.strokes.length > 0,
    ) ||
    recipe.imageLayers.some((layer) => layer.enabled && layer.opacity > 0) ||
    recipe.regionEdits.some((region) => region.enabled && region.opacity > 0) ||
    recipe.regionGroups.some((group) => group.enabled && group.opacity > 0) ||
    !equal(recipe.optics, neutralOptics) ||
    !equal(recipe.transform, neutralTransform)
  )
    return false;
  return (
    recipe.schemaVersion === 3 ||
    (!recipe.projective.enabled &&
      !recipe.healing.some((op) => op.enabled && op.opacity > 0) &&
      !recipe.retouch.some((op) => op.enabled && op.opacity > 0))
  );
}
