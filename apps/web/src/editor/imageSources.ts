import { MAX_HEADER_BYTES, readImageHeader, type RGBAImage } from '@ai-xiutu/editor';

export type ResolvedImageSource = { original: RGBAImage; preview: RGBAImage; file: File };
export async function decodeImageSourceBitmap(
  file: File,
  maxPixels = 16_777_216,
  firstFrame = false,
) {
  if (file.size > 64 * 1024 * 1024) throw new Error('合成素材单文件上限为 64MiB。');
  const header = readImageHeader(
    new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer()),
    {
      maxPixels,
      maxDimension: 8192,
    },
  );
  if (header.animated && !firstFrame) throw new Error('合成素材需要静态图片，请先明确选择单帧。');
  const mime = header.format === 'jpeg' ? 'image/jpeg' : `image/${header.format}`;
  const typed = new File([file], file.name, { type: mime, lastModified: file.lastModified });
  const bitmap = await createImageBitmap(typed, { imageOrientation: 'from-image' });
  if (
    !(
      (bitmap.width === header.width && bitmap.height === header.height) ||
      (bitmap.width === header.height && bitmap.height === header.width)
    ) ||
    bitmap.width * bitmap.height > maxPixels
  ) {
    bitmap.close();
    throw new Error('素材解码尺寸与头信息不一致。');
  }
  return { bitmap, file: typed };
}

/** Decode only validated static content. Image layers share a bounded memory budget. */
export async function decodeImageSource(
  file: File,
  maxPixels = 16_777_216,
): Promise<ResolvedImageSource> {
  const { bitmap, file: typed } = await decodeImageSourceBitmap(file, maxPixels);
  const canvas = document.createElement('canvas');
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('无法创建合成素材画布。');
    ctx.drawImage(bitmap, 0, 0);
    const full = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const scale = Math.min(1, Math.sqrt(1_048_576 / (bitmap.width * bitmap.height)));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const mini = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return {
      file: typed,
      original: { width: full.width, height: full.height, data: full.data },
      preview: { width: mini.width, height: mini.height, data: mini.data },
    };
  } finally {
    bitmap.close();
    canvas.width = 1;
    canvas.height = 1;
  }
}

/** Normalize a locally supported layer only when the selected server codec cannot read it. */
export async function normalizeImageSourceFile(file: File): Promise<File> {
  const decoded = await decodeImageSource(file),
    canvas = document.createElement('canvas');
  canvas.width = decoded.original.width;
  canvas.height = decoded.original.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法规范化素材。');
    context.putImageData(
      new ImageData(new Uint8ClampedArray(decoded.original.data), canvas.width, canvas.height),
      0,
      0,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('素材PNG编码失败。'))),
        'image/png',
      ),
    );
    return new File([blob], file.name.replace(/\.[^.]*$/, '') + '.png', { type: 'image/png' });
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}
