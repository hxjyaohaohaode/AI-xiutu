import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { ImageHeaderError, MAX_HEADER_BYTES, readImageHeader } from '../src/index.js';

// These byte-level fixtures test preflight structure and budgets. They are not
// encoded image-quality fixtures or claims that the compressed payload decodes.
const u16 = (value: number): Buffer => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value);
  return b;
};
const u32 = (value: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(value);
  return b;
};
const box = (type: string, ...parts: Uint8Array[]): Buffer => {
  const payload = Buffer.concat(parts);
  return Buffer.concat([u32(payload.length + 8), Buffer.from(type), payload]);
};
const full = (type: string, ...parts: Uint8Array[]): Buffer => box(type, Buffer.alloc(4), ...parts);
const ftyp = box('ftyp', Buffer.from('avif'), Buffer.alloc(4), Buffer.from('avifmif1'));
const item = (id = 1, type = 'av01'): Buffer =>
  box('infe', Buffer.from([2, 0, 0, 0]), u16(id), u16(0), Buffer.from(`${type}\0`));
const info = (...items: Uint8Array[]): Buffer => full('iinf', u16(items.length), ...items);
const primary = (id = 1): Buffer => full('pitm', u16(id));
const spatial = (width = 20, height = 10): Buffer => full('ispe', u32(width), u32(height));
const av1 = (): Buffer => box('av1C', Buffer.from([0x81, 0x20, 2, 0]));
const association = (id = 1, indices = [1, 2]): Buffer =>
  full('ipma', u32(1), u16(id), Buffer.from([indices.length, ...indices]));
const properties = (...values: Uint8Array[]): Buffer =>
  box('iprp', box('ipco', ...values), association());
const metadata = (...fields: Uint8Array[]): Buffer => full('meta', ...fields);
const avif = (...fields: Uint8Array[]): Buffer => Buffer.concat([ftyp, metadata(...fields)]);
const ordinaryFields = (): Buffer[] => [info(item()), primary(), properties(spatial(), av1())];
const rejects = (value: Uint8Array): void =>
  assert.throws(() => readImageHeader(value), ImageHeaderError);

test('AVIF dimensions are selected through the actual primary item association, not the first ispe', () => {
  const bytes = avif(
    info(item()),
    primary(),
    box('iprp', box('ipco', spatial(3, 4), av1(), spatial(20, 10)), association(1, [3, 2])),
  );
  assert.deepEqual(readImageHeader(bytes), {
    width: 20,
    height: 10,
    format: 'avif',
    animated: false,
  });
  rejects(
    avif(
      info(item()),
      primary(),
      box('iprp', box('ipco', spatial(3, 4), av1(), spatial(20, 10)), association(1, [1, 2, 3])),
    ),
  );
  rejects(avif(info(item()), primary(2), properties(spatial(), av1())));
  rejects(avif(info(item(1, 'grid')), primary(), properties(spatial(), av1())));
  rejects(
    avif(info(item()), primary(), box('iprp', box('ipco', spatial(), av1()), association(2))),
  );
  rejects(
    avif(
      info(item()),
      primary(),
      box('iprp', box('ipco', spatial(), av1()), association(1, [1, 3])),
    ),
  );
});

test('AVIF FullBox fields cannot borrow bytes from a following sibling box', () => {
  assert.equal(readImageHeader(avif(...ordinaryFields())).width, 20);
  // A missing itemId previously read the first two bytes of the 65536-byte free
  // box length as primary ID 1 and incorrectly passed inspection.
  rejects(
    avif(
      info(item()),
      full('pitm'),
      box('free', Buffer.alloc(65_528)),
      properties(spatial(), av1()),
    ),
  );
  rejects(
    avif(
      info(box('infe', Buffer.from([3, 0, 0, 0]), u32(1), u16(0), Buffer.from('av01'))),
      primary(),
      properties(spatial(), av1()),
    ),
  );
  rejects(
    avif(
      info(item()),
      primary(),
      box(
        'iprp',
        box('ipco', spatial(), av1()),
        full('ipma', u32(1), u16(1), Buffer.from([2, 1])),
        box('free', Buffer.from([2])),
      ),
    ),
  );
  rejects(
    avif(
      info(item()),
      box('pitm', Buffer.from([1, 0, 0, 0]), u16(1)),
      properties(spatial(), av1()),
    ),
  );
});

test('AVIF item counts, item IDs, primary flags and minimum AV1 configuration are checked', () => {
  rejects(avif(full('iinf', u16(0), item()), primary(), properties(spatial(), av1())));
  rejects(avif(full('iinf', u16(2), item()), primary(), properties(spatial(), av1())));
  rejects(avif(info(item(), item()), primary(), properties(spatial(), av1())));
  rejects(
    avif(
      info(item()),
      box('pitm', Buffer.from([0, 0, 0, 1]), u16(1)),
      properties(spatial(), av1()),
    ),
  );
  rejects(avif(info(item(0)), primary(0), properties(spatial(), av1())));
  rejects(avif(info(item()), primary(), properties(spatial(), box('av1C'))));
});

test('AVIF rejects duplicate singleton metadata instead of choosing an arbitrary primary', () => {
  rejects(avif(info(item()), primary(), primary(2), properties(spatial(), av1())));
  rejects(avif(info(item()), info(item(2)), primary(), properties(spatial(), av1())));
  rejects(
    avif(info(item()), primary(), properties(spatial(), av1()), properties(spatial(10, 20), av1())),
  );
  rejects(
    avif(
      info(item()),
      primary(),
      box(
        'iprp',
        box('ipco', spatial(), av1()),
        box('ipco', spatial(10, 20), av1()),
        association(),
      ),
    ),
  );
});

test('AVIF scans visible top-level boxes after meta and rejects sequence or duplicate metadata', () => {
  const normal = avif(...ordinaryFields());
  rejects(Buffer.concat([ftyp, box('moov'), metadata(...ordinaryFields())]));
  rejects(Buffer.concat([normal, box('moov')]));
  rejects(Buffer.concat([normal, metadata(...ordinaryFields())]));
  const declaredSequence = Buffer.from(normal);
  declaredSequence.write('avis', 8);
  rejects(declaredSequence);
  assert.equal(
    readImageHeader(Buffer.concat([normal, box('mdat', Buffer.alloc(20))])).format,
    'avif',
  );
});

test('AVIF box lengths, extended sizes and bounded nesting fail closed', () => {
  const normal = avif(...ordinaryFields());
  const overflow = Buffer.from(normal);
  overflow.writeUInt32BE(0xffffffff, ftyp.length);
  rejects(overflow);
  const small = Buffer.from(normal);
  small.writeUInt32BE(7, ftyp.length);
  rejects(small);
  const hugeExtended = Buffer.concat([
    ftyp,
    u32(1),
    Buffer.from('meta'),
    u32(1),
    u32(20),
    Buffer.alloc(4),
  ]);
  rejects(hugeExtended);
  const childOverflow = avif(
    info(item()),
    primary(),
    box('iprp', Buffer.concat([u32(200), Buffer.from('ipco')])),
  );
  rejects(childOverflow);
  for (const length of [0, 15, 27, ftyp.length + 7, normal.length - 1])
    rejects(normal.subarray(0, length));
  rejects(
    avif(
      info(item()),
      primary(),
      box('iprp', box('ipco', ...Array.from({ length: 2050 }, () => box('free'))), association()),
    ),
  );
});

test('AVIF distinguishes an intentionally bounded large-file prefix from a truncated complete small file', async () => {
  const real = await sharp({ create: { width: 80, height: 60, channels: 3, background: 'red' } })
    .avif()
    .toBuffer();
  assert.deepEqual(readImageHeader(real), {
    width: 80,
    height: 60,
    format: 'avif',
    animated: false,
  });
  rejects(real.subarray(0, -1));
  const metadataPrefix = avif(...ordinaryFields());
  const prefix = Buffer.alloc(MAX_HEADER_BYTES);
  prefix.set(metadataPrefix);
  prefix.set(u32(MAX_HEADER_BYTES * 2), metadataPrefix.length);
  prefix.write('mdat', metadataPrefix.length + 4);
  assert.equal(readImageHeader(prefix).format, 'avif');
});

function bmpPrefix(width: number, height: number, depth = 24, fullFile = true): Buffer {
  const size = 54 + Math.ceil((width * depth) / 32) * 4 * Math.abs(height);
  const bytes = Buffer.alloc(fullFile ? size : MAX_HEADER_BYTES);
  bytes.write('BM');
  bytes.writeUInt32LE(size, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(depth, 28);
  return bytes;
}

test('BMP validates signed dimensions, padded row footprint and declared payload before decoding', () => {
  const valid = bmpPrefix(3, -2);
  assert.deepEqual(readImageHeader(valid), { width: 3, height: 2, format: 'bmp', animated: false });
  rejects(valid.subarray(0, -1));
  const shortStride = Buffer.from(valid);
  shortStride.writeUInt32LE(54 + 3 * 3 * 2, 2);
  rejects(shortStride);
  const negativeWidth = Buffer.from(valid);
  negativeWidth.writeInt32LE(-3, 18);
  rejects(negativeWidth);
  const overflowingHeight = Buffer.from(valid);
  overflowingHeight.writeInt32LE(-2147483648, 22);
  rejects(overflowingHeight);
  const badPlanes = Buffer.from(valid);
  badPlanes.writeUInt16LE(2, 26);
  rejects(badPlanes);
  const palette = Buffer.from(valid);
  palette.writeUInt32LE(1, 46);
  rejects(palette);
  const offsetBeyondEnd = Buffer.from(valid);
  offsetBeyondEnd.writeUInt32LE(valid.length, 10);
  rejects(offsetBeyondEnd);
});

const gifFrame = (width = 1, height = 1): Buffer => {
  const descriptor = Buffer.alloc(10);
  descriptor[0] = 0x2c;
  descriptor.writeUInt16LE(width, 5);
  descriptor.writeUInt16LE(height, 7);
  return Buffer.concat([descriptor, Buffer.from([2, 2, 0x44, 1, 0])]);
};
const gif = (...blocks: Uint8Array[]): Buffer =>
  Buffer.concat([
    Buffer.from('GIF89a'),
    Buffer.from([1, 0, 1, 0, 0x80, 0, 0]),
    Buffer.from([0, 0, 0, 255, 255, 255]),
    ...blocks,
  ]);

test('GIF counts actual image blocks, bounds extensions and requires the complete static trailer', () => {
  // Marker-looking bytes inside a comment do not manufacture another frame.
  const comment = Buffer.from([0x21, 0xfe, 3, 0x2c, 0x3b, 0x21, 0]);
  assert.deepEqual(readImageHeader(gif(comment, gifFrame(), Buffer.from([0x3b]))), {
    width: 1,
    height: 1,
    format: 'gif',
    animated: false,
  });
  assert.equal(readImageHeader(gif(gifFrame(), gifFrame(), Buffer.from([0x3b]))).animated, true);
  rejects(gif(gifFrame()));
  rejects(gif(gifFrame(), Buffer.from([0x3b, 0])));
  rejects(gif(Buffer.from([0x21, 0xfe, 255, 1])));
  rejects(gif(gifFrame(2, 1), Buffer.from([0x3b])));
  const bomb = gif(gifFrame(), Buffer.from([0x3b]));
  bomb.writeUInt16LE(65535, 6);
  bomb.writeUInt16LE(65535, 8);
  rejects(bomb);
});

test('extended formats share explicit pixel budgets without allocating decoded high-resolution images', () => {
  const largeBmp = bmpPrefix(8192, 4096, 24, false);
  const largeAvif = avif(info(item()), primary(), properties(spatial(8192, 4096), av1()));
  for (const bytes of [largeBmp, largeAvif]) {
    rejects(bytes);
    assert.equal(readImageHeader(bytes, { maxPixels: 33_554_432 }).width, 8192);
    assert.throws(() => readImageHeader(bytes, { maxPixels: 33_554_431 }), ImageHeaderError);
    assert.throws(
      () => readImageHeader(bytes, { maxPixels: 67_108_864, maxDimension: 8191 }),
      ImageHeaderError,
    );
  }
  const tooLarge = avif(info(item()), primary(), properties(spatial(16384, 8192), av1()));
  assert.throws(
    () => readImageHeader(tooLarge, { maxPixels: 67_108_864, maxDimension: 16384 }),
    ImageHeaderError,
  );
});
