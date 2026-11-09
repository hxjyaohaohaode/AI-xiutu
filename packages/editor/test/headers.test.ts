import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageHeaderError, MAX_HEADER_BYTES, readImageHeader } from '../src/index.js';

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};
const text = (value: string): Uint8Array => new TextEncoder().encode(value);
const be16 = (n: number): Uint8Array => Uint8Array.of((n >>> 8) & 255, n & 255);
const be32 = (n: number): Uint8Array =>
  Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const le24 = (n: number): Uint8Array => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255);
const le32 = (n: number): Uint8Array =>
  Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);

// Header fixtures are structural test data, not claimed complete compressed images.
function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const data = concat(text(type), payload);
  let crc = -1;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return concat(be32(payload.length), data, be32((crc ^ -1) >>> 0));
}
function pngHeader(width = 640, height = 480, chunks: Uint8Array[] = []): Uint8Array {
  return concat(
    Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10),
    pngChunk('IHDR', concat(be32(width), be32(height), Uint8Array.of(8, 6, 0, 0, 0))),
    ...chunks,
    pngChunk('IDAT', Uint8Array.of(0, 0)),
    pngChunk('IEND', new Uint8Array()),
  );
}
const jpegSegment = (marker: number, payload: Uint8Array): Uint8Array =>
  concat(Uint8Array.of(255, marker), be16(payload.length + 2), payload);
const jpegFrame = (width: number, height: number, marker = 0xc0): Uint8Array =>
  jpegSegment(
    marker,
    concat(
      Uint8Array.of(8),
      be16(height),
      be16(width),
      Uint8Array.of(3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0),
    ),
  );
const jpegScan = (): Uint8Array =>
  jpegSegment(0xda, Uint8Array.of(3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0));
const jpegHeader = (width = 640, height = 480, marker = 0xc0): Uint8Array =>
  concat(
    Uint8Array.of(255, 216),
    jpegSegment(0xe1, text('Exif\0\0opaque')),
    jpegFrame(width, height, marker),
    jpegScan(),
  );
const webpChunk = (type: string, payload: Uint8Array): Uint8Array =>
  concat(text(type), le32(payload.length), payload, new Uint8Array(payload.length & 1));
const webp = (...chunks: Uint8Array[]): Uint8Array => {
  const body = concat(text('WEBP'), ...chunks);
  return concat(text('RIFF'), le32(body.length), body);
};
const vp8 = (width: number, height: number): Uint8Array =>
  webpChunk(
    'VP8 ',
    Uint8Array.of(0x10, 0, 0, 0x9d, 1, 0x2a, width & 255, width >>> 8, height & 255, height >>> 8),
  );
const vp8l = (width: number, height: number): Uint8Array =>
  webpChunk('VP8L', concat(Uint8Array.of(0x2f), le32((width - 1) | ((height - 1) << 14))));
const vp8x = (width: number, height: number, flags = 0): Uint8Array =>
  webpChunk('VP8X', concat(Uint8Array.of(flags, 0, 0, 0), le24(width - 1), le24(height - 1)));

test('header preflight recognizes static PNG, 8-bit JPEG profiles and both WebP bitstreams', () => {
  assert.deepEqual(readImageHeader(pngHeader()), {
    width: 640,
    height: 480,
    format: 'png',
    animated: false,
  });
  for (const marker of [0xc0, 0xc1, 0xc2])
    assert.deepEqual(readImageHeader(jpegHeader(640, 480, marker)), {
      width: 640,
      height: 480,
      format: 'jpeg',
      animated: false,
    });
  for (const bytes of [
    webp(vp8(640, 480)),
    webp(vp8l(640, 480)),
    webp(vp8x(640, 480), vp8(640, 480)),
    webp(vp8x(640, 480, 0x20), webpChunk('ICCP', Uint8Array.of(1, 2, 3)), vp8l(640, 480)),
  ]) {
    assert.deepEqual(readImageHeader(bytes), {
      width: 640,
      height: 480,
      format: 'webp',
      animated: false,
    });
  }
});

test('animation declarations are flagged before any decoder is constructed', () => {
  const animatedPng = pngHeader(32, 24, [pngChunk('acTL', concat(be32(3), be32(0)))]);
  assert.deepEqual(readImageHeader(animatedPng), {
    width: 32,
    height: 24,
    format: 'png',
    animated: true,
  });
  assert.deepEqual(readImageHeader(webp(vp8x(32, 24, 2))), {
    width: 32,
    height: 24,
    format: 'webp',
    animated: true,
  });
  assert.throws(
    () => readImageHeader(pngHeader(32, 24, [pngChunk('acTL', new Uint8Array(8))])),
    /animation control/,
  );
  assert.throws(
    () => readImageHeader(webp(vp8x(32, 24), webpChunk('ANIM', new Uint8Array(6)), vp8(32, 24))),
    /misplaced/,
  );
});

test('header dimensions block zero sizes, huge sides and decompression pixel bombs', () => {
  for (const bytes of [
    pngHeader(0, 32),
    pngHeader(0xffffffff, 2),
    pngHeader(8192, 8192),
    jpegHeader(65535, 65535),
    jpegHeader(8192, 4096),
    webp(vp8(8193, 1)),
    webp(vp8l(8192, 8192)),
    webp(vp8x(0x1000000, 1, 2)),
  ]) {
    assert.throws(() => readImageHeader(bytes), /dimensions/);
  }
  assert.equal(readImageHeader(pngHeader(4096, 4096)).width, 4096);
  assert.throws(() => readImageHeader(webp(vp8x(10, 10), vp8(8192, 2048))), /disagree/);
});

test('PNG preflight checks header CRC, chunk boundaries, ordering and bounded metadata', () => {
  const badCrc = pngHeader();
  badCrc[29] = badCrc[29]! ^ 1;
  assert.throws(() => readImageHeader(badCrc), /CRC/);
  const badLength = pngHeader();
  badLength.set(be32(0x7fffffff), 33);
  assert.throws(() => readImageHeader(badLength), /truncated/);
  const duplicateIhdr = pngHeader(16, 16, [pngChunk('IHDR', new Uint8Array(13))]);
  assert.throws(() => readImageHeader(duplicateIhdr), /Unexpected/);
  const unknownCritical = pngHeader(16, 16, [pngChunk('ABCD', new Uint8Array())]);
  assert.throws(() => readImageHeader(unknownCritical), /Unsupported critical/);
  const longMetadata = pngHeader(16, 16, [
    pngChunk('tEXt', new Uint8Array(MAX_HEADER_BYTES)),
  ]).slice(0, MAX_HEADER_BYTES);
  assert.throws(() => readImageHeader(longMetadata), /inspection budget/);
  assert.throws(() => readImageHeader(pngHeader().slice(0, 42)), /truncated/);
  const beforeIdat = pngHeader().slice(0, 33);
  assert.throws(() => readImageHeader(beforeIdat), /not found/);
});

test('JPEG preflight rejects malformed segments, alternate size frames and unknown coding modes', () => {
  for (const bytes of [
    Uint8Array.of(255, 216, 255, 225, 0, 1),
    Uint8Array.of(255, 216, 255, 225, 255, 255),
    concat(Uint8Array.of(255, 216), jpegFrame(2, 2), jpegFrame(8192, 8192), jpegScan()),
    jpegHeader(2, 2, 0xc3),
    concat(Uint8Array.of(255, 216), jpegScan()),
    concat(Uint8Array.of(255, 216), jpegFrame(2, 2), Uint8Array.of(255, 217)),
    jpegHeader().slice(0, -1),
  ])
    assert.throws(() => readImageHeader(bytes), ImageHeaderError);
  const badComponents = jpegHeader();
  const index = badComponents.indexOf(0xc0);
  badComponents[index + 8] = 0;
  assert.throws(() => readImageHeader(badComponents), /components/);
});

test('WebP preflight checks RIFF length, padding, frame signatures, versions and canvas mismatch', () => {
  const invalidRiff = webp(vp8(2, 3));
  invalidRiff.set(le32(0xffffffff), 4);
  const shortChunk = webp(vp8(2, 3));
  shortChunk.set(le32(0xfffffffe), 16);
  const keyFrame = webp(vp8(2, 3));
  keyFrame[20] = 0x11;
  const losslessVersion = webp(vp8l(2, 3));
  losslessVersion[24] = 0xe0;
  const invalidPadding = webp(vp8x(2, 3), webpChunk('ICCP', Uint8Array.of(1)), vp8(2, 3));
  invalidPadding[39] = 1;
  for (const bytes of [
    invalidRiff,
    shortChunk,
    keyFrame,
    losslessVersion,
    invalidPadding,
    webp(vp8x(2, 3, 0x80)),
    webp(vp8x(2, 3), vp8l(3, 2)),
    webp(vp8(2, 3)).slice(0, -1),
  ]) {
    assert.throws(() => readImageHeader(bytes), ImageHeaderError);
  }
});

test('unsupported signatures and oversized header buffers fail closed', () => {
  for (const bytes of [
    new Uint8Array(),
    text('GIF89a'),
    text('<svg width="100000"/>'),
    text('RIFF0000AVI '),
    Uint8Array.of(137, 80, 78),
    new Uint8Array(MAX_HEADER_BYTES + 1),
  ]) {
    assert.throws(() => readImageHeader(bytes), ImageHeaderError);
  }
  assert.throws(
    () => readImageHeader(new Uint8ClampedArray(20) as unknown as Uint8Array),
    ImageHeaderError,
  );
});
