import {
  MAX_EXPLICIT_PIXELS,
  renderEditorRecipe,
  type EditorRecipe,
  type RGBAImage,
} from '@ai-xiutu/editor';

const BLOCK_SIZE = 256;
const MAX_BLOCKS = 16_384;
const MAX_COLORS = 1_048_576;
const packedRgba = new Uint8Array(Uint32Array.of(1).buffer)[0] === 1;

/** Index the actual source RGB values once, without resampling or quantizing any color. */
export function preparePointPreview(image: RGBAImage) {
  const count = image.width * image.height;
  if (
    !packedRgba ||
    count <= 4_194_304 ||
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
      if (colors.length === MAX_COLORS) return null;
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
    const { geometry, adjustments: a } = recipe;
    if (geometry.crop || geometry.rotation !== 0 || geometry.flipX || geometry.flipY) return null;
    if (
      !a.saturation &&
      !a.vibrance &&
      !a.brightness &&
      !a.contrast &&
      !a.shadows &&
      !a.highlights &&
      !a.whites &&
      !a.blacks
    )
      return null;
    const result = renderEditorRecipe(palette, recipe, { maxPixels: MAX_EXPLICIT_PIXELS });
    const transformed = new Uint32Array(
      result.data.buffer,
      result.data.byteOffset,
      swatches.length,
    );
    for (let i = 0; i < keys.length; i++) mapped[keys[i]!] = transformed[i]! & 0xffffff;
    const output = new Uint32Array(
      buffer?.byteLength === source.byteLength ? buffer : new ArrayBuffer(source.byteLength),
    );
    for (let i = 0; i < source.length; i++) {
      const rgba = source[i]!;
      const alpha = rgba & 0xff000000;
      if (!alpha) {
        output[i] = rgba;
        continue;
      }
      output[i] = alpha | mapped[offsets[(rgba >>> 8) & 65_535]! + (rgba & 255)]!;
    }
    return { width: image.width, height: image.height, data: new Uint8ClampedArray(output.buffer) };
  };
}
