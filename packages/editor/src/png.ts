import { validateImage } from './engine.js';
import type { Dimensions, RGBAImage } from './types.js';

export const PNG_SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let n = index;
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

export function pngCrc(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = crcTable[(crc ^ bytes[i]!) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(data.length + 12);
  const view = new DataView(result.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) result[i + 4] = type.charCodeAt(i);
  result.set(data, 8);
  view.setUint32(data.length + 8, pngCrc(result, 4, data.length + 8));
  return result;
}

function* scanlines({ width, height, data }: RGBAImage) {
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const offset = y * stride;
    const line = new Uint8Array(stride + 1);
    line[0] = 1; // PNG Sub filter, with a four-byte RGBA predictor.
    line.set(data.subarray(offset, offset + 4), 1);
    for (let x = 4; x < stride; x++) line[x + 1] = data[offset + x]! - data[offset + x - 4]!;
    yield line;
  }
}

/** The zlib wrapper for uncompressed DEFLATE. Validated rows fit one block. */
function* storedDeflate(rows: Iterable<Uint8Array>) {
  yield Uint8Array.of(0x78, 0x01);
  const modulus = 65521;
  let low = 1,
    high = 0;
  for (const row of rows) {
    const block = new Uint8Array(row.length + 5);
    const header = new DataView(block.buffer);
    header.setUint16(1, row.length, true);
    header.setUint16(3, 0xffff ^ row.length, true);
    block.set(row, 5);
    for (const byte of row) {
      low += byte;
      if (low >= modulus) low -= modulus;
      high += low;
      if (high >= modulus) high -= modulus;
    }
    yield block;
  }
  const end = Uint8Array.of(1, 0, 0, 255, 255, 0, 0, 0, 0);
  new DataView(end.buffer).setUint32(5, high * 65536 + low);
  yield end;
}

/** One PNG stream across all strips. Each yielded strip starts on an output row. */
export async function encodeRgbaPngStrips(
  { width, height }: Dimensions,
  strips: Iterable<RGBAImage>,
): Promise<Blob> {
  function* lines() {
    let written = 0;
    for (const strip of strips) {
      if (
        strip.width !== width ||
        !Number.isSafeInteger(strip.height) ||
        strip.height < 1 ||
        strip.height > height - written ||
        strip.data.length !== width * strip.height * 4
      )
        throw new RangeError('Invalid PNG strip dimensions');
      yield* scanlines(strip);
      written += strip.height;
    }
    if (written !== height) throw new RangeError('PNG is missing scanlines');
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6], 8);
  const parts = [PNG_SIGNATURE, chunk('IHDR', header), chunk('sRGB', Uint8Array.of(0))];
  const pages: Blob[] = [];
  let compressedBytes = 0;
  const append = (bytes: Uint8Array) => {
    parts.push(chunk('IDAT', bytes));
    compressedBytes += bytes.length;
    if (compressedBytes >= 1024 * 1024) {
      pages.push(new Blob(parts));
      parts.length = 0;
      compressedBytes = 0;
    }
  };
  const rows = lines();
  if (typeof CompressionStream === 'function') {
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      pull(controller) {
        const next = rows.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
    });
    const reader = stream.pipeThrough(new CompressionStream('deflate')).getReader();
    try {
      for (let part = await reader.read(); !part.done; part = await reader.read())
        append(part.value);
    } finally {
      reader.releaseLock();
    }
  } else {
    if (width * 4 + 1 > 65_535) throw new Error('Large PNG rows require CompressionStream');
    for (const part of storedDeflate(rows)) append(part);
  }
  parts.push(chunk('IEND', new Uint8Array(0)));
  pages.push(new Blob(parts));
  return new Blob(pages, { type: 'image/png' });
}

/** Encode straight sRGB samples without a premultiplied canvas round trip. */
export async function encodeRgbaPng(image: RGBAImage): Promise<Blob> {
  validateImage(image);
  return encodeRgbaPngStrips(image, [image]);
}
