import {
  getEditorOutputDimensions,
  parseEditorRecipe,
  srgbToLinear,
  linearToSrgb,
  validateImage,
  type Dimensions,
  type EditorRecipe,
  type RGBAImage,
} from '@ai-xiutu/editor';

export const MAX_PREVIEW_PIXELS = 4_194_304;
const linear = Float64Array.from({ length: 256 }, (_, i) => srgbToLinear(i / 255));

/** Area reconstruction is premultiplied in linear light; transparent RGB cannot bleed into the preview. */
function downsample(source: RGBAImage, target: Dimensions): RGBAImage {
  const { width, height } = target,
    data = new Uint8ClampedArray(width * height * 4),
    sx = source.width / width,
    sy = source.height / height,
    area = sx * sy;
  for (let y = 0; y < height; y++) {
    const top = y * sy,
      bottom = (y + 1) * sy;
    for (let x = 0; x < width; x++) {
      const left = x * sx,
        right = (x + 1) * sx;
      let a = 0,
        r = 0,
        g = 0,
        b = 0;
      for (let iy = Math.floor(top); iy < Math.min(source.height, Math.ceil(bottom)); iy++) {
        const wy = Math.min(bottom, iy + 1) - Math.max(top, iy);
        for (let ix = Math.floor(left); ix < Math.min(source.width, Math.ceil(right)); ix++) {
          const w = (Math.min(right, ix + 1) - Math.max(left, ix)) * wy,
            at = (iy * source.width + ix) * 4,
            alpha = (source.data[at + 3]! / 255) * w;
          a += alpha;
          r += linear[source.data[at]!]! * alpha;
          g += linear[source.data[at + 1]!]! * alpha;
          b += linear[source.data[at + 2]!]! * alpha;
        }
      }
      const at = (y * width + x) * 4;
      data[at + 3] = (a / area) * 255;
      if (a > 0) {
        data[at] = linearToSrgb(r / a) * 255;
        data[at + 1] = linearToSrgb(g / a) * 255;
        data[at + 2] = linearToSrgb(b / a) * 255;
      }
    }
  }
  return { width, height, data };
}

/**
 * Keep both the input and transformed preview inside the advertised pixel budget.
 * Only display input is reduced. Recipe coordinates, layer references and full export input stay unchanged.
 */
export function prepareBudgetedPreview(
  source: RGBAImage,
  input: EditorRecipe,
  maxPixels = MAX_PREVIEW_PIXELS,
): RGBAImage {
  validateImage(source, { maxPixels: MAX_PREVIEW_PIXELS });
  if (!Number.isSafeInteger(maxPixels) || maxPixels < 1 || maxPixels > MAX_PREVIEW_PIXELS)
    throw new RangeError(
      'Preview pixel budget must be a positive integer no greater than 4,194,304',
    );
  const recipe = parseEditorRecipe(input);
  let dimensions = { width: source.width, height: source.height };
  for (let attempt = 0; attempt < 32; attempt++) {
    let factor = 0.5;
    try {
      const output = getEditorOutputDimensions(dimensions, recipe),
        largestArea = Math.max(dimensions.width * dimensions.height, output.width * output.height);
      if (largestArea <= maxPixels) {
        return dimensions.width === source.width && dimensions.height === source.height
          ? source
          : downsample(source, dimensions);
      }
      // Re-evaluate after integer sizing: crop quantization and transformed corner ceil() may need another pass.
      factor = Math.sqrt(maxPixels / largestArea);
    } catch (error) {
      // Dimension ceilings can be reached by virtual uncropped previews before display downsampling.
      // Schema, horizon and singular-matrix errors must not be disguised as a resolution issue.
      if (!(error instanceof RangeError)) throw error;
    }
    const next = {
      width: Math.max(1, Math.floor(dimensions.width * factor)),
      height: Math.max(1, Math.floor(dimensions.height * factor)),
    };
    if (next.width === dimensions.width && next.height === dimensions.height)
      throw new RangeError(
        'This transform cannot fit the preview budget; reduce the transform scale',
      );
    dimensions = next;
  }
  throw new RangeError('This transform exceeds the bounded preview planning budget');
}
