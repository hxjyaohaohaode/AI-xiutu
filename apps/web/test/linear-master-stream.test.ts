import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { streamLinearMaster } from '../src/media/linear-master-stream';

const integers = (...values: number[]) => {
  const data = Buffer.alloc(values.length * 4);
  for (const [index, value] of values.entries()) data.writeInt32LE(value, index * 4);
  return data;
};

const attribute = (name: string, type: string, data: Buffer) =>
  Buffer.concat([Buffer.from(`${name}\0${type}\0`), integers(data.length), data]);

function retainedTile(width: number, height: number, values: Float32Array, zip: boolean) {
  const channels = Buffer.concat([
    ...['B', 'G', 'R'].map((name) =>
      Buffer.concat([Buffer.from(`${name}\0`), integers(2, 0, 1, 1)]),
    ),
    Buffer.of(0),
  ]);
  const header = Buffer.concat([
    integers(20_000_630, 514),
    attribute('channels', 'chlist', channels),
    attribute('dataWindow', 'box2i', integers(-7, 13, width - 8, height + 12)),
    attribute('compression', 'compression', Buffer.of(3)),
    attribute('lineOrder', 'lineOrder', Buffer.of(0)),
    attribute('tiles', 'tiledesc', Buffer.concat([integers(256, 256), Buffer.of(0)])),
    Buffer.of(0),
  ]);
  const planeRows = Buffer.alloc(width * height * 12);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    for (const channel of [2, 1, 0]) {
      for (let x = 0; x < width; x++, offset += 4)
        planeRows.writeFloatLE(values[(y * width + x) * 3 + channel]!, offset);
    }
  }
  let bytes = planeRows;
  if (zip) {
    const shuffled = Buffer.alloc(bytes.length);
    const half = bytes.length / 2;
    for (let index = 0; index < half; index++) {
      shuffled[index] = bytes[index * 2]!;
      shuffled[index + half] = bytes[index * 2 + 1]!;
    }
    for (let index = shuffled.length - 1; index > 0; index--)
      shuffled[index] = (shuffled[index]! - shuffled[index - 1]! + 128) & 255;
    bytes = deflateSync(shuffled);
    assert.ok(bytes.length < planeRows.length);
  }
  const table = Buffer.alloc(8);
  table.writeBigUInt64LE(BigInt(header.length + table.length));
  const file = Buffer.concat([header, table, integers(0, 0, 0, 0, bytes.length), bytes]);
  const sha256 = createHash('sha256').update(file).digest('hex');
  const response = () => {
    let read = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (read === file.length) controller.close();
        else {
          const end = Math.min(read + 11, file.length);
          controller.enqueue(file.subarray(read, end));
          read = end;
        }
      },
    });
    return new Response(body, { headers: { 'content-length': String(file.length) } });
  };
  return { source: { width, height, bytes: file.length, sha256 }, response };
}

test('RAW master streaming reconstructs plain and ZIP tiles at exact uint16 precision', async () => {
  for (const [width, height, zip] of [
    [3, 1, false],
    [9, 3, true],
  ] as const) {
    const codes = Uint16Array.from(
      { length: width * height * 3 },
      (_, i) => [31, 32769, 65535][i % 3]!,
    );
    const pixels = Float32Array.from(codes, (code) => code / 65535);
    const { source, response } = retainedTile(width, height, pixels, zip);
    let calls = 0;
    await streamLinearMaster(response(), source, 'camera-raw', async (row, band) => {
      assert.equal(row, 0);
      assert.deepEqual(band.subarray(0, codes.length), codes);
      assert.equal(band.byteLength % 4, 0);
      calls++;
    });
    assert.equal(calls, 1);
    await assert.rejects(
      streamLinearMaster(
        response(),
        { ...source, sha256: '0'.repeat(64) },
        'camera-raw',
        async () => {},
      ),
      /checksum mismatch/,
    );
  }
});

test('RAW master streaming refuses float samples outside the reversible RAW encoding', async () => {
  const { source, response } = retainedTile(1, 1, Float32Array.of(0.125, 0, 1), false);
  await assert.rejects(
    streamLinearMaster(response(), source, 'camera-raw', async () =>
      assert.fail('Invalid tile must never be uploaded'),
    ),
    /cannot be packed without loss/,
  );
});

test('display HDR master streaming retains signed float bits and highlight headroom', async () => {
  const pixels = Float32Array.of(-0.125, 4, 18.75, 0.234, 1, 0);
  const { source, response } = retainedTile(2, 1, pixels, false);
  let calls = 0;
  await streamLinearMaster(response(), source, 'display-hdr', async (row, band) => {
    assert.equal(row, 0);
    assert.deepEqual(band, new Uint32Array(pixels.buffer));
    calls++;
  });
  assert.equal(calls, 1);

  const invalid = retainedTile(1, 1, Float32Array.of(Infinity, 0, 0), false);
  await assert.rejects(
    streamLinearMaster(invalid.response(), invalid.source, 'display-hdr', async () =>
      assert.fail('Invalid tile must never be uploaded'),
    ),
    /sample is non-finite/,
  );
});
