import {
  getOutputDimensions,
  MAX_DIMENSION,
  pixelCrop,
  sourcePixel,
  type PixelCrop,
} from './geometry.js';
import { PHOTO_MAX_PIXELS } from './photo-source.js';
import { encodeRgbaPngStrips } from './png.js';
import { pointPreviewMode } from './point-preview.js';
import type { Dimensions, RGBAImage } from './types.js';
import { renderEditorRecipe, renderEditorRecipeTiled } from './v2-engine.js';
import { parseEditorRecipe } from './v2-recipe.js';
import type { EditorRecipe } from './v2-types.js';

// Keep the reference renderer's linear-light scratch space bounded as well as the canvas.
const STRIP_PIXELS = 262_144;

export function originalPhotoExportSupported(input: EditorRecipe): boolean {
  try {
    return pointPreviewMode(parseEditorRecipe(input)) !== null;
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
  if (pointPreviewMode(recipe) === null) throw new Error('此配方含原尺寸导出尚未支持的编辑。');
  if (dimensions.width * dimensions.height > PHOTO_MAX_PIXELS)
    throw new RangeError('原片超过 6400 万像素。');
  const output = getOutputDimensions(dimensions, recipe.geometry);
  const crop = pixelCrop(dimensions, recipe.geometry);
  const stripHeight = Math.max(1, Math.floor(STRIP_PIXELS / output.width));
  const stripRecipe = { ...recipe, geometry: { ...recipe.geometry, crop: null } };
  const source = (x: number, y: number) =>
    sourcePixel(x, y, output, crop, recipe.geometry, dimensions.width);
  function* strips() {
    for (let top = 0; top < output.height; top += stripHeight) {
      const rows = Math.min(stripHeight, output.height - top);
      // Orthonormal rotations and axis reflections are exact pixel permutations.
      // Opposite output corners therefore bound the complete integer source rectangle.
      const first = source(0, top),
        last = source(output.width - 1, top + rows - 1);
      const x0 = first % dimensions.width,
        x1 = last % dimensions.width;
      const y0 = Math.floor(first / dimensions.width),
        y1 = Math.floor(last / dimensions.width);
      const rect = {
        left: Math.min(x0, x1),
        top: Math.min(y0, y1),
        width: Math.abs(x1 - x0) + 1,
        height: Math.abs(y1 - y0) + 1,
      };
      const image = read(rect);
      if (image.width !== rect.width || image.height !== rect.height)
        throw new Error('原片解码返回的区域尺寸不一致。');
      const render =
        Math.max(rect.width, rect.height) <= MAX_DIMENSION
          ? renderEditorRecipe
          : renderEditorRecipeTiled;
      yield render(image, stripRecipe);
      onStripEncoded?.((top + rows) / output.height);
    }
  }
  return encodeRgbaPngStrips(output, strips());
}
