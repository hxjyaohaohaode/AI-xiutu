import {
  getOutputDimensions,
  MAX_DIMENSION,
  pixelCrop,
  sourcePixel,
  type PixelCrop,
  validateTiledDimensions,
} from './geometry.js';
import { PHOTO_MAX_PIXELS } from './photo-source.js';
import { encodeRgbaPngStrips } from './png.js';
import { pointPreviewMode, requiresSourceComposition } from './point-preview.js';
import type { Dimensions, RGBAImage } from './types.js';
import {
  createPhotoTileRenderer,
  recipeV2Halo,
  renderEditorRecipe,
  renderEditorRecipeTiled,
} from './v2-engine.js';
import { migrateRecipeToV2, parseEditorRecipe } from './v2-recipe.js';
import { recipeV2Stage } from './v3-recipe.js';
import { recipeV3Stage } from './v4-recipe.js';
import type { EditorRecipe } from './v2-types.js';

// Keep the reference renderer's linear-light scratch space bounded as well as the canvas.
const STRIP_PIXELS = 262_144;

export function originalPhotoExportSupported(input: EditorRecipe): boolean {
  try {
    return !requiresSourceComposition(parseEditorRecipe(input));
  } catch {
    return false;
  }
}

/** Read only the source rectangle which maps to one strip of the final PNG. */
export function renderOriginalPhotoPng(
  dimensions: Dimensions,
  input: EditorRecipe,
  read: (rectangle: PixelCrop) => RGBAImage,
  onStripEncoded?: (fraction: number) => void,
): Promise<Blob> {
  const recipe = parseEditorRecipe(input);
  if (requiresSourceComposition(recipe)) throw new Error('此配方含原尺寸导出尚未支持的编辑。');
  if (dimensions.width * dimensions.height > PHOTO_MAX_PIXELS)
    throw new RangeError('原片超过 6400 万像素。');
  validateTiledDimensions(dimensions, PHOTO_MAX_PIXELS);
  const output = getOutputDimensions(dimensions, recipe.geometry);
  const crop = pixelCrop(dimensions, recipe.geometry);
  const source = (x: number, y: number) =>
    sourcePixel(x, y, output, crop, recipe.geometry, dimensions.width);

  // Quarter-turns and reflections map any integer rectangle to one integer rectangle.
  function sourceBounds(
    left: number,
    top: number,
    width: number,
    height: number,
    halo: number,
  ): PixelCrop {
    const first = source(left, top);
    const last = source(left + width - 1, top + height - 1);
    const x0 = first % dimensions.width,
      x1 = last % dimensions.width;
    const y0 = Math.floor(first / dimensions.width),
      y1 = Math.floor(last / dimensions.width);
    const x = Math.max(0, Math.min(x0, x1) - halo);
    const y = Math.max(0, Math.min(y0, y1) - halo);
    return {
      left: x,
      top: y,
      width: Math.min(dimensions.width, Math.max(x0, x1) + halo + 1) - x,
      height: Math.min(dimensions.height, Math.max(y0, y1) + halo + 1) - y,
    };
  }
  function readSource(rect: PixelCrop) {
    const image = read(rect);
    if (
      image.width !== rect.width ||
      image.height !== rect.height ||
      !(image.data instanceof Uint8ClampedArray) ||
      image.data.length !== rect.width * rect.height * 4
    )
      throw new Error('原片解码返回的区域尺寸不一致。');
    return image;
  }
  function* pointStrips() {
    const stripRecipe = { ...recipe, geometry: { ...recipe.geometry, crop: null } };
    const stripHeight = Math.max(1, Math.floor(STRIP_PIXELS / output.width));
    for (let top = 0; top < output.height; top += stripHeight) {
      const rows = Math.min(stripHeight, output.height - top);
      const image = readSource(sourceBounds(0, top, output.width, rows, 0));
      const render =
        Math.max(image.width, image.height) <= MAX_DIMENSION
          ? renderEditorRecipe
          : renderEditorRecipeTiled;
      yield render(image, stripRecipe);
      onStripEncoded?.((top + rows) / output.height);
    }
  }
  function* spatialStrips() {
    const stage = recipe.schemaVersion === 4 ? recipeV3Stage(recipe) : recipe;
    const base = stage.schemaVersion === 3 ? recipeV2Stage(stage) : migrateRecipeToV2(stage);
    const render = createPhotoTileRenderer(base, dimensions);
    const halo = recipeV2Halo(base);
    // Even a 16K-wide panorama with several neighborhood stages uses at
    // most 512×512 input pixels per tile, including pixels outside the crop.
    const side = Math.floor(Math.sqrt(STRIP_PIXELS)) - 2 * halo;
    const stripHeight = Math.min(side, Math.floor(STRIP_PIXELS / output.width));
    for (let top = 0; top < output.height; top += stripHeight) {
      const rows = Math.min(stripHeight, output.height - top);
      const pixels = new Uint32Array(output.width * rows);
      for (let left = 0; left < output.width; left += side) {
        const columns = Math.min(side, output.width - left);
        const rect = sourceBounds(left, top, columns, rows, halo);
        const tile = render(readSource(rect), rect.left, rect.top);
        const packed = new Uint32Array(
          tile.data.buffer,
          tile.data.byteOffset,
          tile.width * tile.height,
        );
        const localIndex = (x: number, y: number) => {
          const at = source(x, y);
          return (
            (Math.floor(at / dimensions.width) - rect.top) * rect.width +
            (at % dimensions.width) -
            rect.left
          );
        };
        const step = columns === 1 ? 0 : localIndex(left + 1, top) - localIndex(left, top);
        for (let row = 0; row < rows; row++) {
          let from = localIndex(left, top + row);
          const start = row * output.width + left;
          for (let i = start; i < start + columns; i++, from += step) pixels[i] = packed[from]!;
        }
      }
      yield { width: output.width, height: rows, data: new Uint8ClampedArray(pixels.buffer) };
      onStripEncoded?.((top + rows) / output.height);
    }
  }
  return encodeRgbaPngStrips(output, pointPreviewMode(recipe) ? pointStrips() : spatialStrips());
}
