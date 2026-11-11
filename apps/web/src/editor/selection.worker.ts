import {
  compileSelectionMaskV3,
  compileEditorCoordinateMap,
  type RGBAImage,
  type Dimensions,
  type EditorRecipe,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
let source: RGBAImage | null = null;
self.onmessage = (
  event: MessageEvent<{
    type: string;
    source?: RGBAImage;
    id: number;
    mask: SelectionMaskV3;
    dimensions: Dimensions;
    recipe: EditorRecipe;
    ratio: number;
    opacity: number;
  }>,
) => {
  const message = event.data;
  if (message.type === 'source') {
    source = message.source ?? null;
    return;
  }
  try {
    if (!source) throw new Error('Missing source');
    const { mask, dimensions, recipe, ratio, opacity } = message;
    if (
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      !Number.isFinite(opacity) ||
      opacity < 0 ||
      opacity > 1
    )
      throw new Error('Invalid overlay bounds');
    const width = Math.max(1, Math.round(ratio >= 1 ? 384 : 384 * ratio));
    const height = Math.max(1, Math.round(ratio <= 1 ? 384 : 384 / ratio));
    const sample = compileSelectionMaskV3(mask, dimensions, source);
    const coordinateMap = compileEditorCoordinateMap(dimensions, recipe, source);
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const p = coordinateMap.toContent({ x: (x + 0.5) / width, y: (y + 0.5) / height });
        const i = (y * width + x) * 4;
        pixels[i] = 89;
        pixels[i + 1] = 174;
        pixels[i + 2] = 242;
        pixels[i + 3] =
          p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1
            ? 0
            : Math.round(sample(p.x, p.y) * opacity * 60);
      }
    self.postMessage({ id: message.id, width, height, pixels }, { transfer: [pixels.buffer] });
  } catch {
    self.postMessage({ id: message.id, error: true });
  }
};
