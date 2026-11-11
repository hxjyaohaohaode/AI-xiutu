import { validateImage, srgbToLinear, linearToSrgb } from './engine.js';
import { renderRecipeV2, renderRecipeV2Tiled } from './v2-engine.js';
import { validateTiledImage } from './tiled.js';
import {
  getOutputDimensions,
  pixelCrop,
  sourcePixel,
  MAX_INPUT_PIXELS,
  validateTiledDimensions,
} from './geometry.js';
import { createRecipeV2 } from './v2-recipe.js';
import { parseRecipeV3, recipeV2Stage, createColorBlockV3 } from './v3-recipe.js';
import { compileFineTransformV3, applyMatrixV3 } from './v3-geometry.js';
import { compileSelectionMaskV3, getSelectionBoundsV3 } from './v3-mask.js';
import { applyOpticsV3 } from './v3-optics.js';
import { applyPaintLayersV3, applyImageLayersV3, preparePaintLayersV3 } from './v3-paint.js';
import { applyWarpV3 } from './v3-warp.js';
import { sampleBilinearV3, checkV3, clamp01 } from './v3-pixels.js';
import { MAX_V3_PIXELS } from './v3-registry.js';
import type { RecipeV3, ColorBlockV3, RenderOptionsV3, TiledRenderOptionsV3 } from './v3-types.js';
import type { RGBAImage, Geometry, CropRect } from './types.js';
import type { RecipeV2 } from './v2-types.js';

const NEUTRAL_GEOMETRY: Geometry = { crop: null, rotation: 0, flipX: false, flipY: false };
const decodeByte = Float64Array.from({ length: 256 }, (_, value) => srgbToLinear(value / 255));
const readBudget = (requested: number | undefined) => {
  const budget = requested ?? MAX_INPUT_PIXELS;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > MAX_V3_PIXELS)
    throw new RangeError(`V3 render maxPixels must be an integer from 1 to ${MAX_V3_PIXELS}`);
  return budget;
};
const opticsActive = (r: Pick<RecipeV3, 'optics'>) =>
  r.optics.denoiseLuminance !== 0 ||
  r.optics.denoiseChroma !== 0 ||
  r.optics.aberrationRed !== 0 ||
  r.optics.aberrationBlue !== 0;
export function legacyGeometry(
  image: RGBAImage,
  geometry: Geometry,
  options: RenderOptionsV3,
): RGBAImage {
  if (geometry.crop === null && geometry.rotation === 0 && !geometry.flipX && !geometry.flipY)
    return image;
  const dimensions = getOutputDimensions(image, geometry),
    crop = pixelCrop(image, geometry),
    data = new Uint8ClampedArray(dimensions.width * dimensions.height * 4);
  for (let y = 0; y < dimensions.height; y++) {
    if ((y & 31) === 0) checkV3(options);
    for (let x = 0; x < dimensions.width; x++) {
      const src = sourcePixel(x, y, dimensions, crop, geometry, image.width) * 4,
        dst = (y * dimensions.width + x) * 4;
      data[dst] = image.data[src]!;
      data[dst + 1] = image.data[src + 1]!;
      data[dst + 2] = image.data[src + 2]!;
      data[dst + 3] = image.data[src + 3]!;
    }
  }
  return { ...dimensions, data };
}
function fineGeometry(image: RGBAImage, recipe: RecipeV3, options: RenderOptionsV3): RGBAImage {
  const context = compileFineTransformV3(image, recipe.transform);
  if (context.identity) return image;
  validateTiledDimensions(context.dimensions, options.maxPixels);
  const { width, height } = context.dimensions,
    data = new Uint8ClampedArray(width * height * 4),
    sample = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    if ((y & 15) === 0) checkV3(options);
    for (let x = 0; x < width; x++) {
      const p = applyMatrixV3(context.inverse, { x: x + 0.5, y: y + 0.5 });
      sampleBilinearV3(image, p.x, p.y, sample, 'transparent');
      const at = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) data[at + c] = sample[c]!;
    }
  }
  return { width, height, data };
}
function colorRecipe(color: ColorBlockV3): RecipeV2 {
  const { optics: _, ...fields } = color;
  return { ...createRecipeV2(), ...fields };
}
function render(
  image: RGBAImage,
  input: RecipeV3,
  options: TiledRenderOptionsV3,
  tiled: boolean,
): RGBAImage {
  const budget = readBudget(options.maxPixels),
    opts = { ...options, maxPixels: budget };
  if (
    options.tileSize !== undefined &&
    (!Number.isSafeInteger(options.tileSize) || options.tileSize < 16 || options.tileSize > 1024)
  )
    throw new RangeError('V3 tileSize must be an integer from 16 to 1024');
  if (tiled) validateTiledImage(image, opts);
  else validateImage(image, opts);
  const recipe = parseRecipeV3(input),
    base = recipeV2Stage(recipe);
  // Refuse output expansion before allocating intermediates or processing a pixel.
  const dimensions = compileFineTransformV3(
    getOutputDimensions(image, recipe.geometry),
    recipe.transform,
  ).dimensions;
  validateTiledDimensions(dimensions, budget);
  let auxiliaryPixels = 0;
  const resolvedIds = new Set<string>();
  for (const layer of recipe.imageLayers) {
    if (!layer.enabled || layer.opacity === 0) continue;
    if (resolvedIds.has(layer.sourceId)) continue;
    const resolved = options.images?.get(layer.sourceId);
    if (!resolved) throw new Error(`Missing resolved image layer: ${layer.sourceId}`);
    validateTiledImage(resolved, { maxPixels: budget, signal: options.signal });
    resolvedIds.add(layer.sourceId);
    auxiliaryPixels += resolved.width * resolved.height;
  }
  if (auxiliaryPixels > MAX_V3_PIXELS * 2)
    throw new RangeError('V3 resolved image layers exceed the combined 32MP budget');
  checkV3(opts);
  const sourceEdits =
    opticsActive(recipe) ||
    recipe.regionEdits.some((r) => r.enabled && r.opacity > 0) ||
    recipe.regionGroups.some((g) => g.enabled && g.opacity > 0) ||
    recipe.imageLayers.some((l) => l.enabled && l.opacity > 0) ||
    recipe.paintLayers.some((l) => l.enabled && l.opacity > 0 && l.strokes.length > 0) ||
    (recipe.warp.enabled && recipe.warp.strokes.some((s) => s.strength !== 0));
  const run = (source: RGBAImage, r: RecipeV2) =>
    tiled ? renderRecipeV2Tiled(source, r, opts) : renderRecipeV2(source, r, opts);
  // Semantic migration is byte-exact when no new source-space stages are active.
  if (!sourceEdits) return fineGeometry(run(image, base), recipe, opts);
  const composeSource = () => {
    const preparedPaint = preparePaintLayersV3(recipe.paintLayers, image, opts);
    let current = run(image, { ...base, geometry: NEUTRAL_GEOMETRY });
    current = applyOpticsV3(current, recipe.optics, opts);
    const neutralColor = JSON.stringify(createColorBlockV3());
    const regions = recipe.regionEdits
      .filter((r) => r.enabled && r.opacity > 0)
      .map((region) => ({ region, mask: compileSelectionMaskV3(region.mask, image, image) }));
    const colorStage = (
      color: ColorBlockV3,
      bounds: CropRect,
      weight: (x: number, y: number) => number,
    ) => {
      if (JSON.stringify(color) === neutralColor) return;
      if (bounds.width === 0 || bounds.height === 0) return;
      const outputCrop = pixelCrop(image, { ...NEUTRAL_GEOMETRY, crop: bounds });
      const windowed =
        !opticsActive(color) &&
        bounds.width >= 1e-6 &&
        bounds.height >= 1e-6 &&
        outputCrop.width * outputCrop.height < image.width * image.height * 0.75;
      const local = colorRecipe(color);
      // The shared tiled renderer retains source coordinates and the complete filter halo.
      const candidate = windowed
        ? renderRecipeV2Tiled(
            current,
            { ...local, geometry: { ...NEUTRAL_GEOMETRY, crop: bounds } },
            opts,
          )
        : applyOpticsV3(run(current, local), color.optics, opts);
      const originX = windowed ? outputCrop.left : 0,
        originY = windowed ? outputCrop.top : 0;
      for (let y = outputCrop.top; y < outputCrop.top + outputCrop.height; y++) {
        if ((y & 15) === 0) checkV3(opts);
        for (let x = outputCrop.left; x < outputCrop.left + outputCrop.width; x++) {
          const at = (y * image.width + x) * 4;
          if (current.data[at + 3] === 0) continue;
          const amount = weight((x + 0.5) / image.width, (y + 0.5) / image.height);
          if (amount === 0) continue;
          const adjusted = ((y - originY) * candidate.width + x - originX) * 4;
          if (amount === 1) {
            current.data[at] = candidate.data[adjusted]!;
            current.data[at + 1] = candidate.data[adjusted + 1]!;
            current.data[at + 2] = candidate.data[adjusted + 2]!;
            continue;
          }
          for (let c = 0; c < 3; c++) {
            const before = decodeByte[current.data[at + c]!]!,
              after = decodeByte[candidate.data[adjusted + c]!]!;
            current.data[at + c] = clamp01(linearToSrgb(before + (after - before) * amount)) * 255;
          }
        }
      }
    };
    // Group corrections happen once on the max-union; overlap never multiplies a shared correction.
    for (const group of recipe.regionGroups) {
      if (!group.enabled || group.opacity === 0) continue;
      const members = regions.filter((r) => r.region.groupId === group.id);
      if (!members.length) continue;
      colorStage(
        group.color,
        getSelectionBoundsV3(
          {
            type: 'compound',
            operation: 'union',
            masks: members.map(({ region }) => region.mask),
            invert: false,
          },
          image,
        ),
        (x, y) =>
          members.reduce((v, m) => Math.max(v, m.mask(x, y) * m.region.opacity), 0) * group.opacity,
      );
    }
    for (const { region, mask } of regions)
      colorStage(
        region.color,
        getSelectionBoundsV3(region.mask, image),
        (x, y) => mask(x, y) * region.opacity,
      );
    current = applyImageLayersV3(current, recipe.imageLayers, options.images, image, opts);
    current = applyPaintLayersV3(
      current,
      recipe.paintLayers,
      image,
      opts,
      options.tileSize ?? 256,
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
  const output = fineGeometry(current, recipe, opts);
  checkV3(opts);
  return output;
}
export function renderRecipeV3(
  image: RGBAImage,
  recipe: RecipeV3,
  options: RenderOptionsV3 = {},
): RGBAImage {
  return render(image, recipe, options, false);
}
/** Bounded floating-point work buffers; whole RGBA images remain required by source-space compositing. */
export function renderRecipeV3Tiled(
  image: RGBAImage,
  recipe: RecipeV3,
  options: TiledRenderOptionsV3 = {},
): RGBAImage {
  return render(image, recipe, options, true);
}
