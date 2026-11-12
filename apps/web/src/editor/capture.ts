import type { RGBAImage } from '@ai-xiutu/editor';
import type { AssistantVisualAttachment } from '@ai-xiutu/contracts';

/** Freeze the editor surface locally before the chat page takes over the viewport. */
export async function captureWorkspaceVisual(
  workspace: HTMLElement,
  preview: RGBAImage,
): Promise<AssistantVisualAttachment> {
  try {
    const { toCanvas } = await import('html-to-image');
    // The crop view has a separate preview worker and can briefly show a
    // loading surface even after the main recipe has finished rendering.
    const deadline = performance.now() + 1200;
    while (true) {
      const photo = workspace.querySelector<HTMLCanvasElement>('.image-frame > canvas[aria-label]');
      if (photo?.width && photo.height && photo.checkVisibility()) break;
      if (!workspace.isConnected || performance.now() >= deadline)
        throw new Error('The workspace photo is still rendering');
      await new Promise<void>((resolve) => setTimeout(resolve, 32));
    }
    const { width, height } = workspace.getBoundingClientRect();
    if (!width || !height) throw new Error('Workspace is not visible');
    const canvas = await toCanvas(workspace, {
      pixelRatio: Math.min(1.5, 1280 / Math.max(width, height)),
      backgroundColor: getComputedStyle(workspace).getPropertyValue('--surface').trim() || '#fff',
      skipFonts: true,
      filter: (node) =>
        !node.matches?.(
          'img, video, iframe, textarea, input[type=file], [hidden], [inert], ' +
            '.studio-account, .canvas-file-info, .workspace-notice-anchor, ' +
            '.workspace-canvas-status, .collaboration-status, .workspace-busy, ' +
            '.ai-activity-banner, .free-panel[data-panel-id=ai]',
        ),
    });
    try {
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.82);
      if (!imageDataUrl.startsWith('data:image/jpeg;base64,') || imageDataUrl.length > 1_500_000)
        throw new Error('Workspace snapshot could not be encoded');
      return { kind: 'editor', imageDataUrl };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } catch {
    return { kind: 'photo', imageDataUrl: await captureRenderedImage(preview) };
  }
}

export async function captureSketchVisual(file: File): Promise<AssistantVisualAttachment> {
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
    return { kind: 'sketch', imageDataUrl };
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
