import type { RGBAImage } from '@ai-xiutu/editor';

export function resizeMatteInput(image: RGBAImage, width: number, height: number) {
  const source = new OffscreenCanvas(image.width, image.height);
  const sourceContext = source.getContext('2d');
  const target = new OffscreenCanvas(width, height);
  const context = target.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!sourceContext || !context) throw new Error('Portrait matting canvas is unavailable');
  sourceContext.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#808080';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  source.width = source.height = 1;
  const rgba = context.getImageData(0, 0, width, height).data;
  target.width = target.height = 1;
  return rgba;
}
