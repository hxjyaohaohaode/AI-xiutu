import type { RGBAImage, RenderOptions } from './types.js';
import { checkV3 } from './v3-pixels.js';

export const MATTE_RAYS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

/** Each ray sees the first confirmed boundary, including transparent barriers.
 * Trace each scanline once and only retain results for uncertain pixels. */
export function findVisibleMatteAnchors(
  image: RGBAImage,
  labels: Float32Array,
  matte: Float32Array,
  radius: number,
  options: RenderOptions,
) {
  const { width, height, data } = image;
  const slots = new Uint32Array(labels.length);
  let count = 0;
  for (let at = 0; at < matte.length; at++) {
    if ((at & 16383) === 0) checkV3(options);
    if (matte[at] !== 0 && matte[at] !== 1) slots[at] = ++count;
  }
  const samples = new Uint32Array(count * MATTE_RAYS.length);
  for (const [ray, [dx, dy]] of MATTE_RAYS.entries()) {
    const scan = (x: number, y: number) => {
      checkV3(options);
      let anchor = 0;
      let distance = 0;
      for (; x >= 0 && y >= 0 && x < width && y < height; x -= dx, y -= dy) {
        const at = y * width + x;
        if (labels[at] === 0 || labels[at] === 1) {
          anchor = data[at * 4 + 3]! >= 224 ? at + 1 : 0;
          distance = 0;
          continue;
        }
        const slot = slots[at]!;
        if (++distance <= radius && anchor && slot)
          samples[(slot - 1) * MATTE_RAYS.length + ray] = anchor;
      }
    };
    const edgeX = dx > 0 ? width - 1 : 0;
    const edgeY = dy > 0 ? height - 1 : 0;
    if (dx !== 0) for (let y = 0; y < height; y++) scan(edgeX, y);
    if (dy !== 0) for (let x = 0; x < width; x++) if (dx === 0 || x !== edgeX) scan(x, edgeY);
  }
  return { slots, samples };
}

/** Propagate actual samples through the uncertain band. Confirmed pixels of
 * the opposite class stop propagation, including painted occluders and holes. */
export function findMatteAnchors(
  image: RGBAImage,
  labels: Float32Array,
  radius: number,
  options: RenderOptions,
): readonly [Int32Array, Int32Array] {
  const { data, width, height } = image;
  const cost = new Float32Array(labels.length);
  function propagate(label: number) {
    const seed = new Int32Array(labels.length).fill(-1);
    const visit = (at: number, neighbor: number) => {
      const hard = labels[neighbor] === label && data[neighbor * 4 + 3]! >= 224;
      const anchor = hard ? neighbor : seed[neighbor]!;
      if (anchor < 0) return;
      const a = at * 4,
        b = neighbor * 4;
      const edge =
        Math.abs(data[a]! - data[b]!) +
        Math.abs(data[a + 1]! - data[b + 1]!) +
        Math.abs(data[a + 2]! - data[b + 2]!);
      const distance = (hard ? 0 : cost[neighbor]!) + 1 + edge * (1 / 48);
      if (distance > radius || (seed[at]! >= 0 && cost[at]! <= distance)) return;
      seed[at] = anchor;
      cost[at] = distance;
    };
    for (const direction of [1, -1, 1, -1]) {
      for (let row = 0; row < height; row++) {
        if ((row & 31) === 0) checkV3(options);
        const y = direction === 1 ? row : height - 1 - row;
        for (let column = 0; column < width; column++) {
          const x = direction === 1 ? column : width - 1 - column;
          const at = y * width + x;
          if (labels[at] === 0 || labels[at] === 1) continue;
          if (column) visit(at, at - direction);
          if (row) visit(at, at - direction * width);
        }
      }
    }
    return seed;
  }
  return [propagate(0), propagate(1)];
}
