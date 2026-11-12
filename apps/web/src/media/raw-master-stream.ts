import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export interface RawMaster {
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

const TILE_EDGE = 256;
const HEADER_LIMIT = 1_048_576;
const text = new TextDecoder('ascii');
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

class MasterStream {
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly digest = sha256.create();
  offset = 0;
  private chunk: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private cursor = 0;
  private received = 0;

  constructor(
    stream: ReadableStream<Uint8Array>,
    private readonly limit: number,
  ) {
    this.reader = stream.getReader();
  }

  async take(size: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(size) || size < 0 || this.offset + size > this.limit)
      throw new RangeError('Invalid retained EXR range');
    this.offset += size;
    if (this.cursor + size <= this.chunk.length) {
      const value = this.chunk.subarray(this.cursor, this.cursor + size);
      this.cursor += size;
      return value;
    }
    const output = new Uint8Array(size);
    let filled = 0;
    while (filled < size) {
      if (this.cursor === this.chunk.length) {
        const { done, value } = await this.reader.read();
        if (done) throw new Error('Retained EXR ended early');
        this.received += value.byteLength;
        if (this.received > this.limit) throw new RangeError('Retained EXR exceeds its byte count');
        this.digest.update(value);
        this.chunk = value;
        this.cursor = 0;
      }
      const count = Math.min(this.chunk.length - this.cursor, size - filled);
      output.set(this.chunk.subarray(this.cursor, this.cursor + count), filled);
      this.cursor += count;
      filled += count;
    }
    return output;
  }

  async fieldName() {
    const bytes: number[] = [];
    for (let index = 0; index < 256 && this.offset < HEADER_LIMIT; index++) {
      const byte = (await this.take(1))[0]!;
      if (byte === 0) return text.decode(Uint8Array.from(bytes));
      bytes.push(byte);
    }
    throw new Error('Invalid retained EXR header name');
  }

  async verify(expected: string) {
    if (
      this.offset !== this.limit ||
      this.received !== this.limit ||
      !(await this.reader.read()).done
    )
      throw new Error('Unexpected retained EXR length');
    if (bytesToHex(this.digest.digest()) !== expected)
      throw new Error('Retained EXR checksum mismatch');
  }
}

async function readRawHeader(input: MasterStream, source: RawMaster) {
  const signature = view(await input.take(8));
  // The server writes one level of single-part, 256px tiled float RGB EXR.
  if (signature.getUint32(0, true) !== 20_000_630 || (signature.getUint32(4, true) & ~1024) !== 514)
    throw new Error('Unsupported retained RAW master container');
  const attributes = new Map<string, { type: string; data: Uint8Array }>();
  for (;;) {
    const name = await input.fieldName();
    if (!name) break;
    const type = await input.fieldName();
    const size = view(await input.take(4)).getInt32(0, true);
    if (size < 0 || input.offset + size > HEADER_LIMIT || attributes.has(name))
      throw new Error('Invalid retained EXR attribute');
    attributes.set(name, { type, data: await input.take(size) });
  }
  const requireField = (key: string, type: string, size?: number) => {
    const field = attributes.get(key);
    if (!field || field.type !== type || (size !== undefined && field.data.length !== size))
      throw new Error('Invalid retained EXR header field');
    return field.data;
  };
  const bounds = view(requireField('dataWindow', 'box2i', 16));
  const width = bounds.getInt32(8, true) - bounds.getInt32(0, true) + 1;
  const height = bounds.getInt32(12, true) - bounds.getInt32(4, true) + 1;
  const tiles = view(requireField('tiles', 'tiledesc', 9));
  if (
    width !== source.width ||
    height !== source.height ||
    tiles.getUint32(0, true) !== TILE_EDGE ||
    tiles.getUint32(4, true) !== TILE_EDGE ||
    tiles.getUint8(8) !== 0 ||
    requireField('compression', 'compression', 1)[0] !== 3 ||
    requireField('lineOrder', 'lineOrder', 1)[0] !== 0
  )
    throw new Error('Unsupported retained EXR geometry or compression');
  const channels = requireField('channels', 'chlist', 55);
  const indexes: number[] = [];
  for (let offset = 0; offset < 54; offset += 18) {
    const index = [82, 71, 66].indexOf(channels[offset]!); // R, G, B
    const format = view(channels.subarray(offset + 2, offset + 18));
    if (
      index < 0 ||
      indexes.includes(index) ||
      channels[offset + 1] !== 0 ||
      format.getInt32(0, true) !== 2 ||
      format.getInt32(8, true) !== 1 ||
      format.getInt32(12, true) !== 1
    )
      throw new Error('Unsupported retained RAW master channels');
    indexes.push(index);
  }
  if (channels[54] !== 0) throw new Error('Invalid retained EXR channel list');
  return indexes;
}

async function inflateZip(bytes: Uint8Array, size: number) {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  const reader = stream.getReader();
  const decoded = new Uint8Array(size);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > size) throw new Error('Retained EXR tile exceeds its bounds');
      decoded.set(value, offset);
      offset += value.byteLength;
    }
    if (offset !== size) throw new Error('Retained EXR tile ended early');
  } finally {
    await reader.cancel().catch(() => {});
  }
  for (let index = 1; index < size; index++)
    decoded[index] = (decoded[index - 1]! + decoded[index]! - 128) & 255;
  return decoded;
}

export function normalizedRawCodes() {
  return Float32Array.from({ length: 65_536 }, (_, code) => code / 65_535);
}

/** Verify the immutable EXR and pack each original pixel without rounding away
 * float precision. The server RAW master stores exactly normalized uint16. */
export async function streamRawMaster(
  response: Response,
  source: RawMaster,
  onRows: (top: number, data: Uint16Array<ArrayBuffer>) => Promise<void>,
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
    source.bytes > source.width * source.height * 12 + HEADER_LIMIT
  )
    throw new Error('Invalid retained RAW master response');
  const input = new MasterStream(response.body, source.bytes);
  const codeBits = new Uint32Array(normalizedRawCodes().buffer);
  const sampleBits = new Uint32Array(1);
  const sampleFloat = new Float32Array(sampleBits.buffer);
  const { width, height } = source;
  const tileRows = Math.ceil(height / TILE_EDGE);
  const tileColumns = Math.ceil(width / TILE_EDGE);
  try {
    const channels = await readRawHeader(input, source);
    const offsets = view(await input.take(tileRows * tileColumns * 8));
    for (let row = 0; row < tileRows; row++) {
      const top = row * TILE_EDGE;
      const bandHeight = Math.min(TILE_EDGE, height - top);
      const count = width * bandHeight * 3;
      const band = new Uint16Array(count + (count % 2)); // GPU writes are 4-byte aligned.
      for (let col = 0; col < tileColumns; col++) {
        const left = col * TILE_EDGE;
        const tileWidth = Math.min(TILE_EDGE, width - left);
        const expectedSize = tileWidth * bandHeight * 12;
        if (offsets.getBigUint64((row * tileColumns + col) * 8, true) !== BigInt(input.offset))
          throw new Error('Invalid retained EXR tile offset');
        const header = view(await input.take(20));
        const size = header.getInt32(16, true);
        if (
          header.getInt32(0, true) !== col ||
          header.getInt32(4, true) !== row ||
          header.getInt32(8, true) !== 0 ||
          header.getInt32(12, true) !== 0 ||
          size < 1 ||
          size > expectedSize
        )
          throw new Error('Invalid retained EXR tile geometry');
        const bytes = await input.take(size);
        const zipped = size < expectedSize;
        const decoded = zipped ? await inflateZip(bytes, expectedSize) : bytes;
        const plain = zipped ? null : view(decoded);
        const half = expectedSize / 2;
        let offset = 0;
        for (let y = 0; y < bandHeight; y++) {
          for (const channel of channels) {
            let target = (y * width + left) * 3 + channel;
            for (let x = 0; x < tileWidth; x++, target += 3, offset += 4) {
              const i = offset / 2;
              sampleBits[0] = plain
                ? plain.getUint32(offset, true)
                : decoded[i]! |
                  (decoded[i + half]! << 8) |
                  (decoded[i + 1]! << 16) |
                  (decoded[i + half + 1]! << 24);
              const code = Math.round(sampleFloat[0]! * 65_535);
              if (codeBits[code] !== sampleBits[0])
                throw new Error('Retained RAW sample cannot be packed without loss');
              band[target] = code;
            }
          }
        }
      }
      await onRows(top, band);
    }
    await input.verify(source.sha256);
  } finally {
    await input.reader.cancel().catch(() => {});
  }
}
