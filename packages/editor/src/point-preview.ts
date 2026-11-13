import { getOutputDimensions, MAX_EXPLICIT_PIXELS, pixelCrop, sourcePixel } from './geometry.js';
import { renderEditorRecipe } from './v2-engine.js';
import { DEFAULT_RECIPE_V2 } from './v2-recipe.js';
import type { EditorRecipe } from './v2-types.js';
import { createFineTransformV3, createOpticsV3 } from './v3-recipe.js';
import type { RGBAImage } from './types.js';

const BLOCK_SIZE = 256;
const MAX_BLOCKS = 16_384;
const MAX_COLORS = 1_048_576;
const packedRgba = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const neutralOptics = createOpticsV3();
const neutralTransform = createFineTransformV3();
const identityGeometry = { crop: null, rotation: 0, flipX: false, flipY: false } as const;

/** Whether the result for an RGB triplet is independent of position and nearby pixels. */
export function pointPreviewMode(recipe: EditorRecipe): 'simple' | 'coupled' | 'extended' | null {
  const a = recipe.adjustments;
  if (recipe.local.enabled || a.sharpness !== 0 || a.soften !== 0) return null;
  const basic =
    a.saturation ||
    a.vibrance ||
    a.brightness ||
    a.contrast ||
    a.shadows ||
    a.highlights ||
    a.whites ||
    a.blacks
      ? 'coupled'
      : 'simple';
  if (recipe.schemaVersion === 1) return basic;
  if (
    recipe.regions.some((region) => region.enabled && region.opacity > 0) ||
    recipe.detail.texture !== 0 ||
    recipe.detail.clarity !== 0 ||
    recipe.effects.vignette.amount !== 0 ||
    recipe.effects.grain.amount !== 0
  )
    return null;
  if (
    (recipe.schemaVersion === 3 || recipe.schemaVersion === 4) &&
    ((recipe.warp.enabled && recipe.warp.strokes.some((stroke) => stroke.strength !== 0)) ||
      recipe.paintLayers.some(
        (layer) => layer.enabled && layer.opacity > 0 && layer.strokes.length > 0,
      ) ||
      recipe.imageLayers.some((layer) => layer.enabled && layer.opacity > 0) ||
      recipe.regionEdits.some((region) => region.enabled && region.opacity > 0) ||
      recipe.regionGroups.some((group) => group.enabled && group.opacity > 0) ||
      !equal(recipe.optics, neutralOptics) ||
      !equal(recipe.transform, neutralTransform))
  )
    return null;
  if (
    recipe.schemaVersion === 4 &&
    (recipe.compositeGrade !== undefined || recipe.projective.enabled ||
      recipe.healing.some((operation) => operation.enabled && operation.opacity > 0) ||
      recipe.retouch.some((operation) => operation.enabled && operation.opacity > 0))
  )
    return null;
  return !equal(recipe.levels, DEFAULT_RECIPE_V2.levels) ||
    !equal(recipe.hsl, DEFAULT_RECIPE_V2.hsl) ||
    !equal(recipe.grading, DEFAULT_RECIPE_V2.grading) ||
    recipe.effects.monochrome !== 0 ||
    recipe.effects.fade !== 0
    ? 'extended'
    : basic;
}

/** Index the actual source RGB values once, without resampling or quantizing any color. */
export function preparePointPreview(image: RGBAImage) {
  const count = image.width * image.height;
  if (
    !packedRgba ||
    count < 1_048_576 ||
    count > MAX_EXPLICIT_PIXELS ||
    image.data.length !== count * 4 ||
    image.data.byteOffset % 4
  )
    return null;
  const source = new Uint32Array(image.data.buffer, image.data.byteOffset, count);
  // Active green/blue pairs get a 256-entry red table, bounded to 16 MiB.
  const offsets = new Int32Array(65_536).fill(-1);
  const mapped = new Uint32Array(MAX_BLOCKS * BLOCK_SIZE);
  const colors: number[] = [];
  const maxColors = Math.min(MAX_COLORS, Math.floor(count / 2));
  let nextOffset = 0;
  for (let i = 0; i < source.length; i++) {
    const rgba = source[i]!;
    if (rgba >>> 24 === 0) continue;
    const rgb = rgba & 0xffffff;
    const id = rgb >>> 8;
    let start = offsets[id]!;
    if (start < 0) {
      if (nextOffset === mapped.length) return null;
      start = offsets[id] = nextOffset;
      nextOffset += BLOCK_SIZE;
    }
    const at = start + (rgb & 255);
    if (mapped[at] === 0) {
      if (colors.length === maxColors) return null;
      colors.push(rgb);
      mapped[at] = 1;
    }
  }
  if (!colors.length) return null;
  const width = Math.min(1024, colors.length);
  const height = Math.ceil(colors.length / width);
  const swatches = new Uint32Array(width * height);
  for (let i = 0; i < colors.length; i++) swatches[i] = colors[i]! | 0xff000000;
  const palette = { width, height, data: new Uint8ClampedArray(swatches.buffer) };
  const keys = Uint32Array.from(colors, (rgb) => offsets[rgb >>> 8]! + (rgb & 255));
  return (recipe: EditorRecipe, buffer?: ArrayBuffer): RGBAImage | null => {
    const mode = pointPreviewMode(recipe);
    if (mode === null || mode === 'simple') return null;
    const { geometry } = recipe;
    const dimensions = getOutputDimensions(image, geometry);
    const crop = pixelCrop(image, geometry);
    const result = renderEditorRecipe(
      palette,
      { ...recipe, geometry: identityGeometry },
      { maxPixels: MAX_EXPLICIT_PIXELS },
    );
    const transformed = new Uint32Array(
      result.data.buffer,
      result.data.byteOffset,
      swatches.length,
    );
    for (let i = 0; i < keys.length; i++) mapped[keys[i]!] = transformed[i]! & 0xffffff;
    const length = dimensions.width * dimensions.height * 4;
    const output = new Uint32Array(
      buffer?.byteLength === length ? buffer : new ArrayBuffer(length),
    );
    const locate = (x: number, y: number) =>
      sourcePixel(x, y, dimensions, crop, geometry, image.width);
    const step = dimensions.width > 1 ? locate(1, 0) - locate(0, 0) : 0;
    // Crop and quarter-turns only reorder the same original pixels.
    for (let y = 0; y < dimensions.height; y++) {
      let at = locate(0, y);
      const start = y * dimensions.width;
      for (let i = start; i < start + dimensions.width; i++, at += step) {
        const rgba = source[at]!;
        const alpha = rgba & 0xff000000;
        output[i] = alpha ? alpha | mapped[offsets[(rgba >>> 8) & 65_535]! + (rgba & 255)]! : rgba;
      }
    }
    return { ...dimensions, data: new Uint8ClampedArray(output.buffer) };
  };
}
