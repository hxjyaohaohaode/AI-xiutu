/**
 * Reads image dimensions (and basic EXIF for JPEG) from the first bytes of a
 * file, so the size is known before the browser decodes anything. A 300 MB
 * photo is then shown from a downscaled decode instead of a full-size bitmap.
 */

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  exif?: Record<string, string>;
}

const be16 = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const be32 = (b: Uint8Array, o: number) => be16(b, o) * 65536 + be16(b, o + 2);
const le16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const le32 = (b: Uint8Array, o: number) => le16(b, o) + le16(b, o + 2) * 65536;
const le24 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);

export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length < 24) return null;
  // PNG / APNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: be32(b, 16), height: be32(b, 20), format: 'PNG' };
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { width: le16(b, 6), height: le16(b, 8), format: 'GIF' };
  // BMP
  if (b[0] === 0x42 && b[1] === 0x4d && b.length >= 26) return { width: le32(b, 18), height: Math.abs(le32(b, 22) | 0), format: 'BMP' };
  // WebP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const chunk = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (chunk === 'VP8X' && b.length >= 30) return { width: le24(b, 24) + 1, height: le24(b, 27) + 1, format: 'WebP' };
    if (chunk === 'VP8L' && b.length >= 25) {
      const bits = le32(b, 21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'WebP' };
    }
    if (chunk === 'VP8 ' && b.length >= 30) return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff, format: 'WebP' };
    return null;
  }
  // JPEG: walk segments to the first SOFn, collecting EXIF on the way.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    let exif: Record<string, string> | undefined;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = b[o + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      const length = be16(b, o + 2);
      if (marker === 0xe1 && !exif && String.fromCharCode(...b.subarray(o + 4, o + 8)) === 'Exif') exif = readExif(b.subarray(o + 10, o + 2 + length));
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        let width = be16(b, o + 7);
        let height = be16(b, o + 5);
        // EXIF orientations 5–8 rotate by 90°; browsers apply it, so report display size.
        if (exif?.orientation && Number(exif.orientation) >= 5) [width, height] = [height, width];
        return { width, height, format: 'JPEG', ...(exif ? { exif } : {}) };
      }
      o += 2 + length;
    }
    return null;
  }
  // AVIF / HEIC: ISO-BMFF 'ispe' property box.
  if (String.fromCharCode(b[4]!, b[5]!, b[6]!, b[7]!) === 'ftyp') {
    const brand = String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!);
    for (let i = 12; i + 20 < b.length; i++)
      if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65)
        return { width: be32(b, i + 8), height: be32(b, i + 12), format: /avi/.test(brand) ? 'AVIF' : 'HEIF' };
  }
  return null;
}

const exifTags: Record<number, string> = {
  0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation', 0x0132: 'dateTime', 0x829a: 'exposure', 0x829d: 'fNumber',
  0x8827: 'iso', 0x9003: 'taken', 0x920a: 'focalLength', 0xa434: 'lens', 0x8769: '__exif',
};

/** Minimal TIFF/EXIF reader for the camera fields people look for. */
export function readExif(t: Uint8Array): Record<string, string> | undefined {
  if (t.length < 8) return undefined;
  const little = t[0] === 0x49;
  const r16 = (o: number) => (little ? le16(t, o) : be16(t, o));
  const r32 = (o: number) => (little ? le32(t, o) : be32(t, o));
  const out: Record<string, string> = {};
  const visit = (ifd: number, depth: number) => {
    if (ifd <= 0 || ifd + 2 > t.length || depth > 2) return;
    const count = Math.min(r16(ifd), 256);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > t.length) return;
      const name = exifTags[r16(e)];
      if (!name) continue;
      const type = r16(e + 2);
      const n = r32(e + 4);
      const value = e + 8;
      if (name === '__exif') visit(r32(value), depth + 1);
      else if (type === 2) {
        const at = n > 4 ? r32(value) : value;
        out[name] = new TextDecoder().decode(t.subarray(at, Math.min(t.length, at + n))).replace(/\0+$/, '').trim();
      } else if (type === 3) out[name] = String(r16(value));
      else if (type === 4) out[name] = String(r32(value));
      else if (type === 5 || type === 10) {
        const at = r32(value);
        if (at + 8 > t.length) continue;
        const num = r32(at),
          den = r32(at + 4) || 1;
        out[name] = name === 'exposure' && num < den ? `1/${Math.round(den / num)}` : String(Math.round((num / den) * 100) / 100);
      }
    }
  };
  visit(r32(4), 0);
  return Object.keys(out).length ? out : undefined;
}
