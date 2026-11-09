import { MAX_EXPLICIT_PIXELS } from './geometry.js';

export const MAX_HEADER_BYTES = 1_048_576;

export interface ImageHeader {
  width: number;
  height: number;
  format: 'png' | 'jpeg' | 'webp' | 'bmp' | 'gif' | 'avif';
  /** Callers must reject animation before passing a file to the still-image decoder. */
  animated: boolean;
}

export class ImageHeaderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageHeaderError';
  }
}

function fail(message: string): never {
  throw new ImageHeaderError(message);
}
const ascii = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
const be16 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! * 256 + bytes[offset + 1]!;
const le16 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! + bytes[offset + 1]! * 256;
const be32 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! * 0x1000000 +
  bytes[offset + 1]! * 0x10000 +
  bytes[offset + 2]! * 256 +
  bytes[offset + 3]!;
const le24 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 0x10000;
const le32 = (bytes: Uint8Array, offset: number): number =>
  le24(bytes, offset) + bytes[offset + 3]! * 0x1000000;

function need(bytes: Uint8Array, offset: number, count: number): void {
  if (offset < 0 || count < 0 || offset + count > bytes.length) {
    fail(
      `Image header is truncated or extends beyond the ${MAX_HEADER_BYTES}-byte inspection budget; use a smaller static PNG, JPEG, or WebP`,
    );
  }
}

export interface HeaderLimits {
  maxPixels?: number;
  maxDimension?: number;
}
function checked(
  width: number,
  height: number,
  format: ImageHeader['format'],
  limits: HeaderLimits,
  animated = false,
): ImageHeader {
  const maxPixels = limits.maxPixels ?? MAX_EXPLICIT_PIXELS;
  const maxDimension = limits.maxDimension ?? 8192;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > maxDimension ||
    height > maxDimension ||
    width * height > maxPixels
  )
    fail('Unsafe image dimensions: image exceeds the declared header budget');
  return { width, height, format, animated };
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let bit = 0; bit < 8; bit += 1) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function checkPngCrc(bytes: Uint8Array, offset: number, length: number): void {
  let crc = 0xffffffff;
  for (let i = offset + 4; i < offset + 8 + length; i += 1)
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 255]! ^ (crc >>> 8);
  if ((crc ^ 0xffffffff) >>> 0 !== be32(bytes, offset + 8 + length))
    fail('PNG header chunk has an invalid CRC');
}

function readPng(bytes: Uint8Array, limits: HeaderLimits): ImageHeader {
  need(bytes, 8, 25);
  if (be32(bytes, 8) !== 13 || ascii(bytes, 12) !== 'IHDR')
    fail('PNG must start with a 13-byte IHDR chunk');
  checkPngCrc(bytes, 8, 13);
  const result = checked(be32(bytes, 16), be32(bytes, 20), 'png', limits);
  const depth = bytes[24]!;
  const color = bytes[25]!;
  const validDepths: Record<number, readonly number[]> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (!validDepths[color]?.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28]! > 1)
    fail('Unsupported or malformed PNG IHDR fields');
  let offset = 33;
  let seenPalette = false;
  let seenAnimation = false;
  while (offset < bytes.length) {
    need(bytes, offset, 8);
    const length = be32(bytes, offset);
    const type = ascii(bytes, offset + 4);
    if (length > 0x7fffffff || !/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2]!.toUpperCase())
      fail('Malformed PNG chunk header');
    if (type === 'IHDR' || type === 'IEND') fail('Unexpected PNG chunk before image data');
    if (type === 'IDAT') {
      if (color === 3 && !seenPalette) fail('Indexed PNG is missing its palette');
      // A short buffer is the complete File.slice() result, not a partial IDAT body.
      if (bytes.length < MAX_HEADER_BYTES && offset + length + 12 > bytes.length)
        fail('PNG image data chunk is truncated');
      return { ...result, animated: seenAnimation };
    }
    need(bytes, offset, length + 12);
    checkPngCrc(bytes, offset, length);
    if (type === 'PLTE') {
      if (
        seenPalette ||
        color === 0 ||
        color === 4 ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0 ||
        (color === 3 && length / 3 > 2 ** depth)
      )
        fail('Malformed PNG palette');
      seenPalette = true;
    } else if (type === 'acTL') {
      if (seenAnimation || length !== 8 || be32(bytes, offset + 8) === 0)
        fail('Malformed PNG animation control');
      seenAnimation = true;
    } else if (type === 'fcTL') {
      if (!seenAnimation || length !== 26) fail('Malformed PNG animation frame header');
    } else if (type === 'fdAT') fail('PNG animation data appears before the default image');
    else if (type[0] === type[0]!.toUpperCase()) fail(`Unsupported critical PNG chunk ${type}`);
    offset += length + 12;
  }
  return fail('PNG image data was not found within the header inspection budget');
}

function readJpeg(bytes: Uint8Array, limits: HeaderLimits): ImageHeader {
  let offset = 2;
  let result: ImageHeader | null = null;
  let frameComponents = new Set<number>();
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) fail('Malformed JPEG marker boundary');
    while (bytes[offset] === 0xff) offset += 1;
    need(bytes, offset, 1);
    const marker = bytes[offset++]!;
    if (
      marker === 0x00 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      fail('Unexpected standalone JPEG marker before image scan');
    need(bytes, offset, 2);
    const length = be16(bytes, offset);
    if (length < 2) fail('Invalid JPEG segment length');
    need(bytes, offset, length);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (result) fail('Multiple JPEG frame headers are unsupported');
      if (length < 11 || bytes[offset + 2] !== 8)
        fail('Only 8-bit baseline, extended sequential, or progressive JPEG is supported');
      const components = bytes[offset + 7]!;
      if (![1, 3, 4].includes(components) || length !== 8 + 3 * components)
        fail('Malformed JPEG frame components');
      result = checked(be16(bytes, offset + 5), be16(bytes, offset + 3), 'jpeg', limits);
      frameComponents = new Set<number>();
      for (let component = 0; component < components; component += 1) {
        const p = offset + 8 + component * 3;
        const id = bytes[p]!;
        const sampling = bytes[p + 1]!;
        if (
          frameComponents.has(id) ||
          (sampling & 15) < 1 ||
          (sampling & 15) > 4 ||
          sampling >>> 4 < 1 ||
          sampling >>> 4 > 4 ||
          bytes[p + 2]! > 3
        )
          fail('Malformed JPEG component fields');
        frameComponents.add(id);
      }
    } else if (marker === 0xda) {
      if (!result || length < 8) fail('JPEG scan appears before a valid frame header');
      const components = bytes[offset + 2]!;
      if (components < 1 || components > frameComponents.size || length !== 6 + components * 2)
        fail('Malformed JPEG scan header');
      const seen = new Set<number>();
      for (let component = 0; component < components; component += 1) {
        const p = offset + 3 + component * 2;
        const id = bytes[p]!;
        const table = bytes[p + 1]!;
        if (!frameComponents.has(id) || seen.has(id) || (table & 15) > 3 || table >>> 4 > 3)
          fail('Malformed JPEG scan component');
        seen.add(id);
      }
      return result;
    } else if (!(
      (marker >= 0xe0 && marker <= 0xef) ||
      marker === 0xdb ||
      marker === 0xc4 ||
      marker === 0xdd ||
      marker === 0xfe
    )) {
      fail(`Unsupported JPEG marker 0x${marker.toString(16)}`);
    } else if (marker === 0xdd && length !== 4) fail('Malformed JPEG restart interval');
    offset += length;
  }
  return fail('JPEG scan header was not found within the inspection budget');
}

function webpFrame(
  bytes: Uint8Array,
  type: string,
  offset: number,
  length: number,
  limits: HeaderLimits,
): ImageHeader {
  if (type === 'VP8 ') {
    if (length < 10) fail('Truncated WebP VP8 frame header');
    need(bytes, offset, 10);
    const tag = le24(bytes, offset);
    if (
      (tag & 1) !== 0 ||
      ((tag >>> 1) & 7) > 3 ||
      (tag & 16) === 0 ||
      bytes[offset + 3] !== 0x9d ||
      bytes[offset + 4] !== 1 ||
      bytes[offset + 5] !== 0x2a
    )
      fail('Invalid WebP VP8 key frame');
    const width = le16(bytes, offset + 6);
    const height = le16(bytes, offset + 8);
    if ((width & 0xc000) !== 0 || (height & 0xc000) !== 0)
      fail('Scaled VP8 frame headers are unsupported');
    return checked(width, height, 'webp', limits);
  }
  if (length < 5) fail('Truncated WebP VP8L frame header');
  need(bytes, offset, 5);
  if (bytes[offset] !== 0x2f) fail('Invalid WebP VP8L signature');
  const bits = le32(bytes, offset + 1);
  if (bits >>> 29 !== 0) fail('Unsupported WebP VP8L version');
  return checked((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 'webp', limits);
}

function readWebp(bytes: Uint8Array, limits: HeaderLimits): ImageHeader {
  need(bytes, 0, 20);
  const total = le32(bytes, 4) + 8;
  if (total < 20 || total > 0xfffffffe || total % 2 !== 0) fail('Malformed WebP RIFF length');
  if (bytes.length < MAX_HEADER_BYTES && total > bytes.length)
    fail('WebP RIFF container is truncated');
  if (total < bytes.length) fail('WebP has trailing data beyond its RIFF container');
  let offset = 12;
  let canvas: ImageHeader | null = null;
  while (offset < total) {
    need(bytes, offset, 8);
    const type = ascii(bytes, offset);
    const length = le32(bytes, offset + 4);
    const end = offset + 8 + length + (length & 1);
    if (end > total) fail('WebP chunk exceeds the declared RIFF size');
    if (type === 'VP8X') {
      if (offset !== 12 || canvas || length !== 10) fail('Malformed WebP extended header');
      need(bytes, offset + 8, 10);
      const flags = bytes[offset + 8]!;
      if (
        (flags & 0xc1) !== 0 ||
        bytes[offset + 9] !== 0 ||
        bytes[offset + 10] !== 0 ||
        bytes[offset + 11] !== 0
      )
        fail('Unsupported reserved WebP header fields');
      canvas = checked(
        le24(bytes, offset + 12) + 1,
        le24(bytes, offset + 15) + 1,
        'webp',
        limits,
        (flags & 2) !== 0,
      );
      if (canvas.animated) return canvas; // A caller must reject it without decoding frames.
    } else if (type === 'VP8 ' || type === 'VP8L') {
      const frame = webpFrame(bytes, type, offset + 8, length, limits);
      if (canvas && (frame.width !== canvas.width || frame.height !== canvas.height))
        fail('WebP canvas and encoded frame dimensions disagree');
      return canvas ?? frame;
    } else {
      if (!canvas || type === 'ANIM' || type === 'ANMF')
        fail('Unsupported or misplaced WebP chunk');
      // Metadata/alpha can precede the bitstream; skip only within the bounded prefix.
      need(bytes, offset + 8, length + (length & 1));
    }
    if ((length & 1) !== 0 && bytes[end - 1] !== 0) fail('Invalid WebP padding');
    offset = end;
  }
  return fail('WebP frame header was not found within the inspection budget');
}

function readBmp(bytes: Uint8Array, limits: HeaderLimits): ImageHeader {
  need(bytes, 0, 54);
  const total = le32(bytes, 2),
    pixelOffset = le32(bytes, 10),
    dib = le32(bytes, 14);
  if (
    ![40, 108, 124].includes(dib) ||
    pixelOffset < 14 + dib ||
    bytes[6] !== 0 ||
    bytes[7] !== 0 ||
    bytes[8] !== 0 ||
    bytes[9] !== 0
  )
    fail('Unsupported BMP header');
  need(bytes, 14, dib);
  const width = le32(bytes, 18) | 0,
    height = Math.abs(le32(bytes, 22) | 0),
    depth = le16(bytes, 28);
  if (
    le16(bytes, 26) !== 1 ||
    ![24, 32].includes(depth) ||
    le32(bytes, 30) !== 0 ||
    le32(bytes, 46) !== 0
  )
    fail('Only uncompressed 24/32-bit RGB BMP is supported locally');
  const result = checked(width, height, 'bmp', limits);
  const pixelBytes = Math.ceil((width * depth) / 32) * 4 * height;
  if (total < pixelOffset + pixelBytes || (bytes.length < MAX_HEADER_BYTES && bytes.length < total))
    fail('BMP pixel data is truncated');
  return result;
}

function readGif(bytes: Uint8Array, limits: HeaderLimits): ImageHeader {
  need(bytes, 0, 13);
  const result = checked(le16(bytes, 6), le16(bytes, 8), 'gif', limits);
  const packed = bytes[10]!;
  let offset = 13,
    frames = 0;
  if (packed & 0x80) {
    const length = 3 * 2 ** ((packed & 7) + 1);
    need(bytes, offset, length);
    offset += length;
  }
  const skipBlocks = () => {
    for (;;) {
      need(bytes, offset, 1);
      const n = bytes[offset++]!;
      if (!n) return;
      need(bytes, offset, n);
      offset += n;
    }
  };
  while (offset < bytes.length) {
    const marker = bytes[offset++]!;
    if (marker === 0x3b) {
      if (frames !== 1 || offset !== bytes.length)
        fail('GIF must contain one complete still frame and trailer');
      return result;
    }
    if (marker === 0x21) {
      need(bytes, offset, 1);
      const label = bytes[offset++]!;
      if (label === 0xf9) {
        need(bytes, offset, 6);
        if (bytes[offset] !== 4 || bytes[offset + 5] !== 0) fail('Malformed GIF graphics control');
        offset += 6;
      } else if (label === 0xff || label === 0xfe) skipBlocks();
      else fail('Unsupported GIF extension; convert this image explicitly before editing');
      continue;
    }
    if (marker !== 0x2c) fail('Malformed GIF block boundary');
    need(bytes, offset, 9);
    const x = le16(bytes, offset),
      y = le16(bytes, offset + 2),
      width = le16(bytes, offset + 4),
      height = le16(bytes, offset + 6),
      flags = bytes[offset + 8]!;
    if (
      !width ||
      !height ||
      x + width > result.width ||
      y + height > result.height ||
      (flags & 0x18) !== 0
    )
      fail('GIF frame exceeds its logical screen');
    frames++;
    if (frames > 1) return { ...result, animated: true };
    offset += 9;
    if (flags & 0x80) {
      const length = 3 * 2 ** ((flags & 7) + 1);
      need(bytes, offset, length);
      offset += length;
    } else if (!(packed & 0x80)) fail('GIF image has no color table');
    need(bytes, offset, 1);
    const codeSize = bytes[offset++]!;
    if (codeSize < 2 || codeSize > 8) fail('Invalid GIF LZW code size');
    skipBlocks();
  }
  return fail(
    'Complete static GIF was not found within the 1 MiB inspection budget; use explicit server conversion',
  );
}

interface IsoBox {
  type: string;
  start: number;
  content: number;
  end: number;
}
function readAvif(bytes: Uint8Array, limits: HeaderLimits): ImageHeader {
  let boxesRead = 0;
  const inside = (owner: IsoBox, offset: number, count: number) => {
    if (offset < owner.content || offset + count > owner.end)
      fail('AVIF field exceeds its own box boundary');
    need(bytes, offset, count);
  };
  const box = (offset: number, bound: number): IsoBox => {
    need(bytes, offset, 8);
    if (++boxesRead > 2048) fail('AVIF box count exceeds inspection budget');
    let size = be32(bytes, offset),
      header = 8;
    const type = ascii(bytes, offset + 4);
    if (size === 1) {
      need(bytes, offset, 16);
      const high = be32(bytes, offset + 8);
      if (high !== 0) fail('AVIF extended box is too large');
      size = be32(bytes, offset + 12);
      header = 16;
    }
    if (size === 0) size = bound - offset;
    if (size < header || offset + size > bound) fail('AVIF box exceeds its container');
    return { type, start: offset, content: offset + header, end: offset + size };
  };
  const children = (parent: IsoBox, skip = 0) => {
    const output: IsoBox[] = [];
    let at = parent.content + skip;
    while (at < parent.end) {
      const b = box(at, parent.end);
      output.push(b);
      at = b.end;
    }
    return output;
  };
  const ftyp = box(0, bytes.length);
  if (ftyp.type !== 'ftyp' || ftyp.end - ftyp.content < 8 || (ftyp.end - ftyp.content) % 4 !== 0)
    fail('Malformed AVIF file type box');
  const brands = [ascii(bytes, ftyp.content)];
  for (let p = ftyp.content + 8; p < ftyp.end; p += 4) brands.push(ascii(bytes, p));
  if (brands.includes('avis')) fail('Animated AVIF sequences are not accepted as still images');
  if (!brands.includes('avif'))
    fail('This HEIF family codec is not supported locally; AVIF is required');
  let metadata: IsoBox | undefined;
  for (let at = ftyp.end; at < bytes.length;) {
    need(bytes, at, 8);
    const type = ascii(bytes, at + 4);
    if (type === 'mdat' && be32(bytes, at) > bytes.length - at) {
      if (bytes.length < MAX_HEADER_BYTES) fail('AVIF media data is truncated');
      break;
    }
    const b = box(at, bytes.length);
    if (b.type === 'moov') fail('AVIF sequence containers are unsupported');
    if (b.type === 'meta') {
      if (metadata) fail('Duplicate AVIF metadata box');
      metadata = b;
    }
    at = b.end;
  }
  if (!metadata)
    fail('AVIF metadata is outside the bounded prefix; use explicit server conversion');
  inside(metadata, metadata.content, 4);
  if (be32(bytes, metadata.content) !== 0) fail('Unsupported AVIF metadata version');
  const fields = children(metadata, 4);
  const pitm = fields.find((b) => b.type === 'pitm');
  const iprp = fields.find((b) => b.type === 'iprp');
  const iinf = fields.find((b) => b.type === 'iinf');
  for (const type of ['pitm', 'iprp', 'iinf'])
    if (fields.filter((b) => b.type === type).length > 1) fail(`Duplicate AVIF ${type} box`);
  if (!pitm || !iprp || !iinf) fail('AVIF is missing primary-image metadata');
  inside(pitm, pitm.content, 6);
  const primaryVersion = bytes[pitm.content]!;
  if (primaryVersion > 1) fail('Unsupported AVIF primary item version');
  const primaryLength = primaryVersion === 0 ? 6 : 8;
  inside(pitm, pitm.content, primaryLength);
  if (pitm.end - pitm.content !== primaryLength || (be32(bytes, pitm.content) & 0xffffff) !== 0)
    fail('Malformed AVIF primary item box');
  const primary =
    primaryVersion === 0 ? be16(bytes, pitm.content + 4) : be32(bytes, pitm.content + 4);
  if (!primary) fail('AVIF primary item ID is invalid');
  inside(iinf, iinf.content, 6);
  const iinfVersion = bytes[iinf.content]!;
  if (iinfVersion > 1) fail('Unsupported AVIF item information version');
  inside(iinf, iinf.content, iinfVersion === 0 ? 6 : 8);
  const declaredItems =
    iinfVersion === 0 ? be16(bytes, iinf.content + 4) : be32(bytes, iinf.content + 4);
  const infoBoxes = children(iinf, iinfVersion === 0 ? 6 : 8);
  if (declaredItems !== infoBoxes.length || infoBoxes.some((b) => b.type !== 'infe'))
    fail('AVIF item count disagrees with its information boxes');
  let primaryType = '';
  const itemIds = new Set<number>();
  for (const b of infoBoxes) {
    inside(b, b.content, 4);
    const version = bytes[b.content]!;
    if (version !== 2 && version !== 3) fail('Unsupported AVIF item information entry');
    inside(b, b.content, version === 2 ? 13 : 15);
    const item = version === 2 ? be16(bytes, b.content + 4) : be32(bytes, b.content + 4);
    if (itemIds.has(item)) fail('Duplicate AVIF item ID');
    itemIds.add(item);
    if (item === primary) primaryType = ascii(bytes, b.content + (version === 2 ? 8 : 10));
  }
  if (primaryType !== 'av01')
    fail('Derived/grid AVIF requires explicit server conversion before local editing');
  const props = children(iprp),
    ipco = props.find((b) => b.type === 'ipco'),
    ipmas = props.filter((b) => b.type === 'ipma');
  if (props.filter((b) => b.type === 'ipco').length > 1) fail('Duplicate AVIF property container');
  if (!ipco || !ipmas.length) fail('AVIF image properties are missing');
  const properties = children(ipco);
  const dimensions = new Map<number, ImageHeader>();
  properties.forEach((b, index) => {
    if (b.type === 'ispe') {
      if (b.end - b.content !== 12 || be32(bytes, b.content) !== 0)
        fail('Malformed AVIF spatial property');
      dimensions.set(
        index + 1,
        checked(be32(bytes, b.content + 4), be32(bytes, b.content + 8), 'avif', limits),
      );
    }
  });
  const associated: number[] = [];
  for (const associations of ipmas) {
    inside(associations, associations.content, 8);
    const version = bytes[associations.content]!,
      flags = be32(bytes, associations.content) & 0xffffff;
    if (version > 1 || (flags & ~1) !== 0) fail('Unsupported AVIF property association version');
    const count = be32(bytes, associations.content + 4);
    if (count > 1024) fail('AVIF association count exceeds inspection budget');
    let at = associations.content + 8;
    for (let entry = 0; entry < count; entry++) {
      inside(associations, at, version === 0 ? 3 : 5);
      const id = version === 0 ? be16(bytes, at) : be32(bytes, at);
      at += version === 0 ? 2 : 4;
      const n = bytes[at++]!;
      if (!itemIds.has(id)) fail('AVIF associations refer to an unknown item');
      for (let i = 0; i < n; i++) {
        inside(associations, at, flags & 1 ? 2 : 1);
        const property = (flags & 1 ? be16(bytes, at) : bytes[at]!) & (flags & 1 ? 0x7fff : 0x7f);
        at += flags & 1 ? 2 : 1;
        if (property > properties.length) fail('AVIF property index is invalid');
        if (id === primary) associated.push(property);
      }
    }
    if (at !== associations.end) fail('AVIF property association size is inconsistent');
  }
  const selected = associated
    .map((index) => dimensions.get(index))
    .filter((value): value is ImageHeader => Boolean(value));
  if (
    selected.length !== 1 ||
    !associated.some((index) => {
      const property = properties[index - 1];
      return (
        property?.type === 'av1C' &&
        property.end - property.content >= 4 &&
        bytes[property.content] === 0x81
      );
    })
  )
    fail('AVIF primary image lacks a unique size or AV1 configuration');
  return selected[0]!;
}

/**
 * Read File.slice(0, MAX_HEADER_BYTES) before creating any decoder/bitmap.
 * The buffer must be the whole file when it is shorter than the prefix budget.
 * This bounds dimensions and detects declared animation; it does not validate
 * compressed pixels, metadata semantics, decoder safety, or EXIF orientation.
 */
export function readImageHeader(bytes: Uint8Array, limits: HeaderLimits = {}): ImageHeader {
  if (
    !Number.isSafeInteger(limits.maxPixels ?? MAX_EXPLICIT_PIXELS) ||
    (limits.maxPixels ?? MAX_EXPLICIT_PIXELS) < 1 ||
    (limits.maxPixels ?? MAX_EXPLICIT_PIXELS) > 67_108_864 ||
    !Number.isSafeInteger(limits.maxDimension ?? 8192) ||
    (limits.maxDimension ?? 8192) < 1 ||
    (limits.maxDimension ?? 8192) > 16384
  )
    fail('Invalid header dimension budget');
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_HEADER_BYTES)
    fail(`Supply the first min(file size, ${MAX_HEADER_BYTES}) bytes of a supported image file`);
  if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return readPng(bytes, limits);
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes, limits);
  if (bytes.length >= 12 && ascii(bytes, 0) === 'RIFF' && ascii(bytes, 8) === 'WEBP')
    return readWebp(bytes, limits);
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return readBmp(bytes, limits);
  if (
    bytes.length >= 6 &&
    ['GIF87a', 'GIF89a'].includes(String.fromCharCode(...bytes.subarray(0, 6)))
  )
    return readGif(bytes, limits);
  if (bytes.length >= 16 && ascii(bytes, 4) === 'ftyp') return readAvif(bytes, limits);
  return fail(
    'Unsupported image signature; use a static PNG, 8-bit JPEG, WebP, AVIF, GIF or supported BMP',
  );
}
