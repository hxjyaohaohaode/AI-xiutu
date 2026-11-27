// Ordinary phone photos retain their original encoding. Only the editing raster is reduced.
export const PHOTO_MAX_BYTES = 50 * 1024 * 1024;
export const PHOTO_MAX_PIXELS = 64_000_000;
export const PHOTO_PROXY_PIXELS = 4_194_304;
export const PHOTO_RETAIN_BYTES = 7_000_000;

export function photoProxySize(width: number, height: number, limit = PHOTO_PROXY_PIXELS, maxSide = 8192) {
  const scale = Math.min(1, Math.sqrt(limit / (width * height)), maxSide / width, maxSide / height);
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function isRetainedPhoto(format: string, bytes: number, pixels: number) {
  return (format === 'jpeg' || format === 'png') && (bytes > PHOTO_RETAIN_BYTES || pixels > PHOTO_PROXY_PIXELS);
}

/** Read only TIFF's Orientation tag from bounded JPEG APP1 or PNG eXIf metadata. */
export function photoOrientation(bytes: Uint8Array, format: 'jpeg' | 'png') {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  function tiff(start: number, end: number) {
    if (start + 8 > end) return 1;
    const order = view.getUint16(start), little = order === 0x4949;
    if ((!little && order !== 0x4d4d) || view.getUint16(start + 2, little) !== 42) return 1;
    const directory = start + view.getUint32(start + 4, little);
    if (directory < start + 8 || directory + 2 > end) return 1;
    const count = view.getUint16(directory, little);
    for (let i = 0, item = directory + 2; i < count && item + 12 <= end; i++, item += 12) {
      if (view.getUint16(item, little) === 274 && view.getUint16(item + 2, little) === 3 &&
          view.getUint32(item + 4, little) === 1) {
        const value = view.getUint16(item + 8, little);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
    return 1;
  }
  if (format === 'png') {
    for (let i = 8; i + 12 <= bytes.length;) {
      const n = view.getUint32(i), type = view.getUint32(i + 4);
      if (i + n + 12 > bytes.length || type === 0x49444154) break;
      if (type === 0x65584966) return tiff(i + 8, i + 8 + n);
      i += n + 12;
    }
  } else {
    for (let i = 2; i + 4 <= bytes.length && bytes[i] === 255;) {
      while (i < bytes.length && bytes[i] === 255) i++;
      const marker = bytes[i++];
      if (marker === 0xda || marker === 0xd9 || i + 2 > bytes.length) break;
      const n = view.getUint16(i), end = i + n;
      if (n < 2 || end > bytes.length) break;
      if (marker === 0xe1 && n >= 16 && view.getUint32(i + 2) === 0x45786966 && view.getUint16(i + 6) === 0)
        return tiff(i + 8, end);
      i = end;
    }
  }
  return 1;
}
