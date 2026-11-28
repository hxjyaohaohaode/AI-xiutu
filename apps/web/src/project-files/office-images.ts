/** Signed-in exports read private originals; the public share viewer swaps in its link route. */
let pictureSource: { url: (assetId: string) => string; credentials: RequestCredentials } = {
  url: (assetId) => '/v1/assets/' + encodeURIComponent(assetId) + '/file',
  credentials: 'same-origin',
};
export function setOfficePictureSource(url: (assetId: string) => string) {
  pictureSource = { url, credentials: 'omit' };
}

export async function loadOfficePicture(assetId: string): Promise<Blob> {
  const response = await fetch(pictureSource.url(assetId), {
    credentials: pictureSource.credentials,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const mime = response.headers.get('Content-Type')?.split(';')[0];
  const length = Number(response.headers.get('Content-Length'));
  if (
    !response.ok ||
    !mime ||
    !/^image\/(png|jpeg|webp|gif)$/.test(mime) ||
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > 32 * 1024 * 1024
  )
    throw new Error('有一张图片不可读取或超出办公文件的导出范围。');
  const blob = await response.blob();
  if (blob.size !== length) throw new Error('图片读取不完整，未导出文件。');
  return blob;
}

export async function officePng(source: Blob, maxSide = 2400) {
  const href = URL.createObjectURL(source);
  try {
    const image = new Image();
    image.src = href;
    await image.decode();
    const width = image.naturalWidth,
      height = image.naturalHeight;
    if (!width || !height || width * height > 64_000_000)
      throw new Error('图片尺寸超过办公文件导出范围。');
    const isChart = source.type === 'image/svg+xml';
    const scale = isChart
      ? Math.min(3, maxSide / Math.max(width, height))
      : Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境无法导出图像。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(href);
  }
}
