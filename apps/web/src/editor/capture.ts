import type { RGBAImage } from '@ai-xiutu/editor';
import type { AssistantVisualAttachment } from '@ai-xiutu/contracts';

export async function captureSketchVisual(file: File, kind: 'sketch' | 'photo' = 'sketch'): Promise<AssistantVisualAttachment> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  try {
    const ratio = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法准备共享图片。');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    const imageDataUrl = png.length <= 1_500_000 ? png : canvas.toDataURL('image/jpeg', 0.85);
    if (!imageDataUrl.startsWith('data:image/')) throw new Error('浏览器未能编码共享预览。');
    return { kind, imageDataUrl };
  } finally {
    bitmap.close();
    canvas.width = canvas.height = 0;
  }
}

/** Only image pixels leave this helper. UI, comments, cursors and filenames are excluded. */
export async function captureRenderedImage(image: RGBAImage): Promise<string> {
  const canvas = document.createElement('canvas'),
    small = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  try {
    const context = canvas.getContext('2d'),
      target = small.getContext('2d');
    if (!context || !target) throw new Error('当前浏览器无法准备共享图片。');
    const pixels = new Uint8ClampedArray(image.data.buffer as ArrayBuffer, image.data.byteOffset, image.data.byteLength);
    context.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
    const ratio = Math.min(1, 1024 / Math.max(image.width, image.height));
    small.width = Math.max(1, Math.round(image.width * ratio));
    small.height = Math.max(1, Math.round(image.height * ratio));
    // JPEG needs an explicit matte for transparent regions.
    target.fillStyle = '#ffffff';
    target.fillRect(0, 0, small.width, small.height);
    target.drawImage(canvas, 0, 0, small.width, small.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      small.toBlob((value) => value?.type === 'image/jpeg'
        ? resolve(value)
        : reject(new Error('浏览器未能编码共享预览。')), 'image/jpeg', 0.8),
    );
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('浏览器未能编码共享预览。'));
      reader.readAsDataURL(blob);
    });
  } finally {
    canvas.width = canvas.height = small.width = small.height = 0;
  }
}
