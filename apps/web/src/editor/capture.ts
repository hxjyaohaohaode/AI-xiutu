import type { RGBAImage } from '@ai-xiutu/editor';

/** Only image pixels leave this helper. UI, comments, cursors and filenames are excluded. */
export async function captureRenderedImage(image: RGBAImage): Promise<string> {
  const canvas = document.createElement('canvas'),
    small = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d'),
    target = small.getContext('2d');
  if (!context || !target) throw new Error('当前浏览器无法准备共享图片。');
  context.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  const ratio = Math.min(1, 1024 / Math.max(image.width, image.height));
  small.width = Math.max(1, Math.round(image.width * ratio));
  small.height = Math.max(1, Math.round(image.height * ratio));
  // A JPEG has no alpha. Explicit neutral matte avoids accidental black transparent regions.
  target.fillStyle = '#ffffff';
  target.fillRect(0, 0, small.width, small.height);
  target.drawImage(canvas, 0, 0, small.width, small.height);
  const result = small.toDataURL('image/jpeg', 0.8);
  canvas.width = canvas.height = small.width = small.height = 0;
  if (!result.startsWith('data:image/jpeg;base64,')) throw new Error('浏览器未能编码共享预览。');
  return result;
}
