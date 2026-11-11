import { validateImage } from './engine.js';
import { validateTiledImage } from './tiled.js';
import { MAX_INPUT_PIXELS, getOutputDimensions, validateTiledDimensions } from './geometry.js';
import { createFineTransformV3 } from './v3-recipe.js';
import { parseRecipeV4, recipeV3Stage } from './v4-recipe.js';
import { renderRecipeV3, renderRecipeV3Tiled, legacyGeometry } from './v3-engine.js';
import { compileFineTransformV3, applyMatrixV3 } from './v3-geometry.js';
import { compileProjectiveTransformV4, multiplyMatrixV4, invertMatrixV4 } from './v4-geometry.js';
import { applyHealingV4, applyRetouchV4, retouchActiveV4 } from './v4-spatial.js';
import { applyImageLayersV3, applyPaintLayersV3, preparePaintLayersV3 } from './v3-paint.js';
import { applyWarpV3 } from './v3-warp.js';
import { checkV3, sampleBilinearV3 } from './v3-pixels.js';
import {
  MAX_V4_PIXELS,
  type RecipeV4,
  type RenderOptionsV4,
  type TiledRenderOptionsV4,
} from './v4-types.js';
import type { RGBAImage } from './types.js';
import type { RecipeV3 } from './v3-types.js';

/** v4 geometry composes the fine and four-corner matrices before the single reconstruction.
 * The pre-projective viewport is still clipped, so a perspective cannot reveal cropped pixels. */
function geometryV4(image: RGBAImage, recipe: RecipeV4, options: RenderOptionsV4): RGBAImage {
  const fine = compileFineTransformV3(image, recipe.transform),
    projective = compileProjectiveTransformV4(fine.dimensions, recipe.projective),
    matrix = multiplyMatrixV4(projective.matrix, fine.matrix),
    inverse = invertMatrixV4(matrix),
    dimensions = projective.dimensions;
  if (fine.identity && projective.identity) return image;
  validateTiledDimensions(dimensions, options.maxPixels);
  const data = new Uint8ClampedArray(dimensions.width * dimensions.height * 4),
    sample = new Float64Array(4);
  for (let y = 0; y < dimensions.height; y++) {
    if ((y & 15) === 0) checkV3(options);
    for (let x = 0; x < dimensions.width; x++) {
      const edge = { x: x + 0.5, y: y + 0.5 };
      // A valid convex quad can leave the inverse horizon in an unused part of
      // its bounding rectangle. Those pixels are transparent, not render errors.
      const z =
        projective.inverse[6] * edge.x + projective.inverse[7] * edge.y + projective.inverse[8];
      if (z < 1e-10) continue;
      const pre = applyMatrixV3(projective.inverse, edge);
      if (pre.x < 0 || pre.y < 0 || pre.x > fine.dimensions.width || pre.y > fine.dimensions.height)
        continue;
      // The preceding fine transform may also leave an inverse horizon inside
      // its bounding viewport. Preserve the same clipping as the coordinate map.
      const fineZ = fine.inverse[6] * pre.x + fine.inverse[7] * pre.y + fine.inverse[8];
      if (fineZ < 1e-10) continue;
      const point = applyMatrixV3(inverse, edge),
        at = (y * dimensions.width + x) * 4;
      sampleBilinearV3(image, point.x, point.y, sample, 'transparent');
      for (let c = 0; c < 4; c++) data[at + c] = sample[c]!;
    }
  }
  return { ...dimensions, data };
}

function render(
  image: RGBAImage,
  input: RecipeV4,
  options: TiledRenderOptionsV4,
  tiled: boolean,
): RGBAImage {
  const budget = options.maxPixels ?? MAX_INPUT_PIXELS;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > MAX_V4_PIXELS)
    throw new RangeError(`V4 render maxPixels must be an integer from 1 to ${MAX_V4_PIXELS}`);
  const opts = { ...options, maxPixels: budget };
  if (tiled) validateTiledImage(image, opts);
  else validateImage(image, opts);
  const recipe = parseRecipeV4(input),
    base = recipeV3Stage(recipe),
    fine = compileFineTransformV3(getOutputDimensions(image, recipe.geometry), recipe.transform),
    projective = compileProjectiveTransformV4(fine.dimensions, recipe.projective);
  validateTiledDimensions(projective.dimensions, budget);
  const run = (source: RGBAImage, r: RecipeV3, stageOptions = opts) =>
    tiled ? renderRecipeV3Tiled(source, r, stageOptions) : renderRecipeV3(source, r, stageOptions);
  checkV3(opts);
  const spatial =
    recipe.healing.some((op) => op.enabled && op.opacity > 0) ||
    recipe.retouch.some(retouchActiveV4);
  // This fast path is the migration contract: all old pixels and rounding remain v3 exact.
  if (!spatial && projective.identity) return run(image, base);
  if (!spatial)
    return geometryV4(run(image, { ...base, transform: createFineTransformV3() }), recipe, opts);

  // Admission of auxiliary buffers and paths occurs before creating full-sized intermediates.
  let auxiliaryPixels = 0;
  const ids = new Set<string>();
  for (const layer of recipe.imageLayers) {
    if (!layer.enabled || layer.opacity === 0 || ids.has(layer.sourceId)) continue;
    const resolved = opts.images?.get(layer.sourceId);
    if (!resolved) throw new Error(`Missing resolved image layer: ${layer.sourceId}`);
    validateTiledImage(resolved, opts);
    ids.add(layer.sourceId);
    auxiliaryPixels += resolved.width * resolved.height;
  }
  if (auxiliaryPixels > MAX_V4_PIXELS * 2)
    throw new RangeError('Resolved image layers exceed the combined 32MP budget');
  const composeSource = () => {
    const preparedPaint = preparePaintLayersV3(recipe.paintLayers, image, opts);
    let current = run(
      image,
      {
        ...base,
        geometry: { crop: null, rotation: 0, flipX: false, flipY: false },
        transform: createFineTransformV3(),
        imageLayers: [],
        paintLayers: [],
        warp: { ...base.warp, enabled: false },
      },
      { ...opts, warpPreviewCache: undefined },
    );
    current = applyHealingV4(current, recipe.healing, image, opts);
    current = applyRetouchV4(current, recipe.retouch, image, opts);
    current = applyImageLayersV3(current, recipe.imageLayers, opts.images, image, opts);
    current = applyPaintLayersV3(
      current,
      recipe.paintLayers,
      image,
      opts,
      opts.tileSize ?? 256,
      preparedPaint,
    );
    return current;
  };
  let current =
    opts.warpPreviewCache?.beforeWarp(image, recipe, opts, tiled, composeSource) ?? composeSource();
  current =
    opts.warpPreviewCache?.warp(current, recipe.warp, image, opts) ??
    applyWarpV3(current, recipe.warp, image, opts);
  current = legacyGeometry(current, recipe.geometry, opts);
  current = geometryV4(current, recipe, opts);
  checkV3(opts);
  return current;
}
export function renderRecipeV4(
  image: RGBAImage,
  recipe: RecipeV4,
  options: RenderOptionsV4 = {},
): RGBAImage {
  return render(image, recipe, options, false);
}
export function renderRecipeV4Tiled(
  image: RGBAImage,
  recipe: RecipeV4,
  options: TiledRenderOptionsV4 = {},
): RGBAImage {
  return render(image, recipe, options, true);
}
