import {
  compileSelectionMask,
  mapOutputToSource,
  type RGBAImage,
  type Dimensions,
  type Geometry,
  type SelectionMaskV2,
} from '@ai-xiutu/editor';
let source: RGBAImage | null = null;
self.onmessage = (
  event: MessageEvent<{
    type: string;
    source?: RGBAImage;
    id: number;
    mask: SelectionMaskV2;
    dimensions: Dimensions;
    geometry: Geometry;
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
    if (!source) throw new Error('Missing selection source');
    const { mask, dimensions, geometry, ratio, opacity } = message;
    if (
      !Number.isFinite(ratio) ||
      ratio <= 0 ||
      !Number.isFinite(opacity) ||
      opacity < 0 ||
      opacity > 1
    )
      throw new Error('Invalid overlay bounds');
    const width = Math.max(1, Math.round(ratio >= 1 ? 384 : 384 * ratio)),
      height = Math.max(1, Math.round(ratio <= 1 ? 384 : 384 / ratio));
    // A very narrow frame must not allocate height proportional to an arbitrarily tiny ratio.
    if (width > 384 || height > 384) throw new Error('Overlay pixel budget exceeded');
    const sample = compileSelectionMask(mask, dimensions, source);
    const p0 = mapOutputToSource({ x: 0, y: 0 }, dimensions, geometry),
      px = mapOutputToSource({ x: 1, y: 0 }, dimensions, geometry),
      py = mapOutputToSource({ x: 0, y: 1 }, dimensions, geometry);
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width,
          v = (y + 0.5) / height;
        const sx = p0.x + u * (px.x - p0.x) + v * (py.x - p0.x),
          sy = p0.y + u * (px.y - p0.y) + v * (py.y - p0.y),
          i = (y * width + x) * 4;
        pixels[i] = 241;
        pixels[i + 1] = 93;
        pixels[i + 2] = 77;
        pixels[i + 3] = Math.round(sample(sx, sy) * opacity * 78);
      }
    self.postMessage({ id: message.id, width, height, pixels }, { transfer: [pixels.buffer] });
  } catch {
    self.postMessage({ id: message.id, error: true });
  }
};
