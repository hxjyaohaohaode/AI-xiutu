import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { LinearMaster } from './linear-master-stream';
import { inflateMasterBlock } from './master-inflate';

const TILE_EDGE = 256;
const TILE_BYTES = TILE_EDGE * TILE_EDGE * 6;
const MAX_TIFF_BYTES = 512 * 1024 ** 2;
const HOST_LITTLE_ENDIAN = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;
const invalid = () => new Error('Unsupported retained TIFF master layout');

function readDirectory(bytes: Uint8Array, source: LinearMaster) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = view.getUint16(0);
  if (order !== 0x4949 && order !== 0x4d4d) throw invalid();
  const little = order === 0x4949;
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  const directory = u32(4);
  if (u16(2) !== 42 || directory < 8 || directory + 2 > bytes.length) throw invalid();
  const entries = u16(directory);
  const next = directory + 2 + entries * 12;
  if (entries > 64 || next + 4 > bytes.length || u32(next) !== 0) throw invalid();
  const fields = new Map<number, number>();
  for (let offset = directory + 2; offset < next; offset += 12) {
    const tag = u16(offset);
    if (fields.has(tag)) throw invalid();
    fields.set(tag, offset);
  }
  const values = (tag: number, count: number) => {
    const entry = fields.get(tag);
    if (entry === undefined || u32(entry + 4) !== count) throw invalid();
    const type = u16(entry + 2);
    if (type !== 3 && type !== 4) throw invalid();
    const size = type === 3 ? 2 : 4;
    const start = size * count <= 4 ? entry + 8 : u32(entry + 8);
    if (start < 8 || start + size * count > bytes.length) throw invalid();
    const read = type === 3 ? u16 : u32;
    return Array.from({ length: count }, (_, i) => read(start + i * size));
  };
  const single = (tag: number) => values(tag, 1)[0]!;
  if (
    single(256) !== source.width ||
    single(257) !== source.height ||
    values(258, 3).some((bits) => bits !== 16) ||
    ![8, 32946].includes(single(259)) ||
    single(262) !== 2 ||
    (fields.has(274) && single(274) !== 1) ||
    single(277) !== 3 ||
    single(284) !== 1 ||
    single(317) !== 2 ||
    single(322) !== TILE_EDGE ||
    single(323) !== TILE_EDGE ||
    fields.has(338) ||
    (fields.has(339) && values(339, 3).some((format) => format !== 1))
  )
    throw invalid();
  const columns = Math.ceil(source.width / TILE_EDGE);
  const rows = Math.ceil(source.height / TILE_EDGE);
  return {
    little,
    columns,
    rows,
    offsets: values(324, columns * rows),
    sizes: values(325, columns * rows),
  };
}

/** Read the checked, opaque sRGB TIFF written by the media pipeline. The
 * private master hash and complete layout are verified before GPU rendering. */
export async function streamTiffMaster(
  response: Response,
  source: LinearMaster,
  onRows: (top: number, band: Uint16Array<ArrayBuffer>) => Promise<void>,
) {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get('content-length')) !== source.bytes ||
    ![source.width, source.height, source.bytes].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    source.width > 16_384 ||
    source.height > 16_384 ||
    source.width * source.height > 64_000_000 ||
    source.bytes < 8 ||
    source.bytes > MAX_TIFF_BYTES
  )
    throw new Error('Invalid retained TIFF master response');
  const input = response.body.getReader();
  const bytes = new Uint8Array(source.bytes);
  const digest = sha256.create();
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await input.read();
      if (done) break;
      if (length + value.byteLength > bytes.length) throw invalid();
      bytes.set(value, length);
      digest.update(value);
      length += value.byteLength;
    }
  } finally {
    await input.cancel().catch(() => {});
  }
  if (length !== bytes.length || bytesToHex(digest.digest()) !== source.sha256)
    throw new Error('Retained TIFF master integrity check failed');

  const { width, height } = source;
  const { little, columns, rows, offsets, sizes } = readDirectory(bytes, source);
  for (let row = 0; row < rows; row++) {
    const top = row * TILE_EDGE;
    const lines = Math.min(TILE_EDGE, height - top);
    const band = new Uint16Array(Math.ceil((width * lines * 3) / 2) * 2);
    await Promise.all(
      Array.from({ length: columns }, async (_, column) => {
        const tile = row * columns + column;
        const offset = offsets[tile]!,
          size = sizes[tile]!;
        if (offset < 8 || size < 1 || size > TILE_BYTES + 8192 || offset + size > bytes.length)
          throw invalid();
        const samples = new Uint16Array(
          (await inflateMasterBlock(bytes.subarray(offset, offset + size), TILE_BYTES)).buffer,
        );
        if (little !== HOST_LITTLE_ENDIAN)
          for (let i = 0; i < samples.length; i++)
            samples[i] = ((samples[i]! & 255) << 8) | (samples[i]! >>> 8);
        const left = column * TILE_EDGE;
        const used = Math.min(TILE_EDGE, width - left) * 3;
        for (let y = 0; y < lines; y++) {
          const start = y * TILE_EDGE * 3;
          for (let i = start + 3; i < start + used; i++) samples[i] = samples[i]! + samples[i - 3]!;
          band.set(samples.subarray(start, start + used), (y * width + left) * 3);
        }
      }),
    );
    await onRows(top, band);
  }
}
