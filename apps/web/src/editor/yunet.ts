import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import model from '../../../../third-party/portrait-yunet.json';
import type { Point } from '@ai-xiutu/editor';

export type FaceCandidate = { bounds: Bounds; points: Point[]; score: number };
type Bounds = { x: number; y: number; width: number; height: number };
export const yuNetFile = model.file;

function overlap(a: Bounds, b: Bounds) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return (width * height) / (a.width * a.height + b.width * b.height - width * height);
}

/** OpenCV Zoo uses BGR without mean subtraction and pads bottom/right to a stride of 32. */
function decode(
  output: InferenceSession.ReturnType,
  width: number,
  height: number,
  pw: number,
  ph: number,
) {
  const boxes: FaceCandidate[] = [];
  for (const stride of [8, 16, 32]) {
    const columns = pw / stride;
    const count = columns * (ph / stride);
    const read = (name: string, channels: number) => {
      const data = output[`${name}_${stride}`]?.data;
      if (!(data instanceof Float32Array) || data.length !== count * channels)
        throw new Error('Unexpected YuNet graph output');
      return data;
    };
    const scores = read('cls', 1),
      objects = read('obj', 1);
    const boxesAt = read('bbox', 4),
      pointsAt = read('kps', 10);
    for (let i = 0; i < count; i++) {
      const score = Math.sqrt(
        Math.max(0, Math.min(1, scores[i]!)) * Math.max(0, Math.min(1, objects[i]!)),
      );
      if (!(score >= 0.6)) continue;
      const row = Math.floor(i / columns),
        col = i % columns;
      const bx = (col + boxesAt[i * 4]!) * stride,
        by = (row + boxesAt[i * 4 + 1]!) * stride;
      const bw = Math.exp(boxesAt[i * 4 + 2]!) * stride;
      const bh = Math.exp(boxesAt[i * 4 + 3]!) * stride;
      if (!(
        bx >= 0 &&
        by >= 0 &&
        bx < width &&
        by < height &&
        bw >= 10 &&
        bh >= 10 &&
        bw <= width * 1.35 &&
        bh <= height * 1.35
      ))
        continue;
      boxes.push({
        score,
        bounds: {
          x: (bx - bw * 0.5) / width,
          y: (by - bh * 0.5) / height,
          width: bw / width,
          height: bh / height,
        },
        points: Array.from({ length: 5 }, (_, p) => ({
          x: ((col + pointsAt[i * 10 + 2 * p]!) * stride) / width,
          y: ((row + pointsAt[i * 10 + 2 * p + 1]!) * stride) / height,
        })),
      });
    }
  }
  const unique: FaceCandidate[] = [];
  for (const box of boxes.sort((a, b) => b.score - a.score).slice(0, 192)) {
    if (!unique.some((other) => overlap(other.bounds, box.bounds) > 0.3)) unique.push(box);
    if (unique.length === 20) break;
  }
  return unique;
}

export async function openYuNet() {
  const response = await fetch(`/vision/${model.file}`, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || Number(response.headers.get('content-length')) > model.bytes)
    throw new Error('YuNet model unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== model.bytes || bytesToHex(sha256(bytes)) !== model.sha256)
    throw new Error('YuNet model integrity check failed');
  env.wasm.numThreads = 1;
  env.wasm.proxy = false;
  const runtime = '/vision/wasm/ort-wasm-simd-threaded';
  env.wasm.wasmPaths = {
    wasm: new URL(runtime + '.wasm', self.location.origin),
    mjs: new URL(runtime + '.mjs', self.location.origin),
  };
  const session = await InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  return {
    async detect(image: ImageData) {
      const { data, width, height } = image;
      const pw = Math.ceil(width / 32) * 32,
        ph = Math.ceil(height / 32) * 32;
      const area = pw * ph;
      const values = new Float32Array(area * 3);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const src = (y * width + x) * 4,
            dst = y * pw + x;
          const a = data[src + 3]! / 255;
          values[dst] = data[src + 2]! * a;
          values[dst + area] = data[src + 1]! * a;
          values[dst + 2 * area] = data[src]! * a;
        }
      const input = new Tensor('float32', values, [1, 3, ph, pw]);
      let output: InferenceSession.ReturnType | undefined;
      try {
        output = await session.run({ input });
        return decode(output, width, height, pw, ph);
      } finally {
        input.dispose();
        if (output) for (const tensor of Object.values(output)) tensor.dispose();
      }
    },
    close: () => session.release(),
  };
}
