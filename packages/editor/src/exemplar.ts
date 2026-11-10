import type { RGBAImage, RenderOptions } from './types.js';
import type { HealingOperationV4 } from './v4-types.js';
import type { SpatialRegionV4 } from './v4-spatial.js';
import { checkV3 } from './v3-pixels.js';

// Exemplar synthesis inspired by Criminisi/Pérez/Toyama. The bounded search and
// priority sampling below are explicit implementation choices, not their exact solver.
export const MAX_EXEMPLAR_TARGET = 32768;
export const MAX_EXEMPLAR_WORK = 134217728;
export function exemplarFill(
  image: RGBAImage,
  roi: SpatialRegionV4,
  op: HealingOperationV4,
  options: RenderOptions,
  budget: { used: number },
): RGBAImage {
  if (roi.targetPixels > MAX_EXEMPLAR_TARGET)
    throw new RangeError('纹理重建单次最多处理 32768 个像素，请分成较小区域');
  const { width, height, left, top, weights } = roi;
  const radius = op.patchRadius ?? 4,
    size = width * height;
  const unknown = new Uint8Array(size),
    confidence = new Float32Array(size);
  const filled = new Uint8ClampedArray(size * 3),
    front = new Set<number>();
  let remaining = 0;
  function spend(n = 1) {
    budget.used += n;
    if (budget.used > MAX_EXEMPLAR_WORK)
      throw new RangeError('纹理搜索已达到计算预算，请缩小选区、搜索范围或补片半径');
  }
  function local(x: number, y: number) {
    return x >= left && x < left + width && y >= top && y < top + height
      ? (y - top) * width + x - left
      : -1;
  }
  function isUnknown(x: number, y: number) {
    const at = local(x, y);
    return at >= 0 && unknown[at] === 1;
  }
  const inside = (x: number, y: number) => x >= 0 && x < image.width && y >= 0 && y < image.height;
  const known = (x: number, y: number) =>
    inside(x, y) && image.data[(y * image.width + x) * 4 + 3] === 255 && !isUnknown(x, y);
  function value(x: number, y: number, c: number) {
    const at = local(x, y);
    return at >= 0 ? filled[at * 3 + c]! : image.data[(y * image.width + x) * 4 + c]!;
  }
  const lum = (x: number, y: number) =>
    0.2126 * value(x, y, 0) + 0.7152 * value(x, y, 1) + 0.0722 * value(x, y, 2);
  const adjacent = (x: number, y: number) =>
    known(x - 1, y) || known(x + 1, y) || known(x, y - 1) || known(x, y + 1);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = y * width + x,
        source = ((y + top) * image.width + x + left) * 4;
      unknown[at] = weights[at]! > 1 / 65535 ? 1 : 0;
      confidence[at] = 1 - unknown[at]!;
      remaining += unknown[at]!;
      for (let c = 0; c < 3; c++) filled[at * 3 + c] = image.data[source + c]!;
    }
  for (let at = 0; at < size; at++)
    if (unknown[at] && adjacent(left + (at % width), top + Math.floor(at / width))) front.add(at);
  const previous: { dx: number; dy: number }[] = [];
  while (remaining) {
    checkV3(options);
    let chosen = -1,
      priority = -1,
      chosenConfidence = 0;
    // Deterministic frontier sampling avoids quadratic scans of a large brush edge.
    const stride = Math.max(1, Math.ceil(front.size / 256));
    let index = 0;
    for (const at of front) {
      if (index++ % stride) continue;
      const x = left + (at % width),
        y = top + Math.floor(at / width);
      let sum = 0,
        count = 0,
        edge = 0;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          spend();
          const px = x + dx,
            py = y + dy;
          if (!inside(px, py)) continue;
          count++;
          if (!known(px, py)) continue;
          const i = local(px, py);
          sum += i < 0 ? 1 : confidence[i]!;
          // Strong known contours enter before flat regions; no gradients read the hole.
          if (known(px + 1, py)) edge = Math.max(edge, Math.abs(lum(px + 1, py) - lum(px, py)));
          if (known(px, py + 1)) edge = Math.max(edge, Math.abs(lum(px, py + 1) - lum(px, py)));
        }
      const c = sum / Math.max(1, count),
        p = c * (0.05 + edge / 255);
      if (p > priority) {
        priority = p;
        chosen = at;
        chosenConfidence = c;
      }
    }
    if (chosen < 0) throw new RangeError('纹理重建需要未选中的可见边界');
    const x = left + (chosen % width),
      y = top + Math.floor(chosen / width);
    const probes: { dx: number; dy: number; rgb: number[]; confidence: number }[] = [];
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (!known(x + dx, y + dy)) continue;
        const at = local(x + dx, y + dy);
        probes.push({
          dx,
          dy,
          rgb: [0, 1, 2].map((c) => value(x + dx, y + dy, c)),
          confidence: at < 0 ? 1 : Math.max(0.05, confidence[at]!),
        });
      }
    let best: { x: number; y: number; score: number; offset: number[] } | null = null;
    const visited = new Set<string>();
    const search = Math.max(
      radius + 1,
      Math.round(op.searchRadius * Math.min(image.width, image.height)),
    );
    function candidate(sx: number, sy: number) {
      const key = `${sx},${sy}`;
      if (visited.has(key)) return;
      visited.add(key);
      if (!op.source && Math.hypot(sx - x, sy - y) > search) return;
      if (
        sx - radius < 0 ||
        sy - radius < 0 ||
        sx + radius >= image.width ||
        sy + radius >= image.height
      )
        return;
      // Source pixels always come from the immutable stage input. Repaired pixels
      // may guide matching but can never become a source and amplify a mistake.
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          spend();
          const at = local(sx + dx, sy + dy);
          if (
            (at >= 0 && weights[at]! > 1 / 65535) ||
            image.data[((sy + dy) * image.width + sx + dx) * 4 + 3] !== 255
          )
            return;
        }
      const offset = [0, 0, 0];
      let norm = 0;
      for (const p of probes) {
        spend();
        norm += p.confidence;
        const at = ((sy + p.dy) * image.width + sx + p.dx) * 4;
        for (let c = 0; c < 3; c++) offset[c]! += (p.rgb[c]! - image.data[at + c]!) * p.confidence;
      }
      for (let c = 0; c < 3; c++) offset[c] = Math.max(-32, Math.min(32, offset[c]! / norm));
      let score = 0;
      for (const p of probes) {
        spend();
        const at = ((sy + p.dy) * image.width + sx + p.dx) * 4;
        for (let c = 0; c < 3; c++)
          score += (p.rgb[c]! - image.data[at + c]! - offset[c]!) ** 2 * p.confidence;
      }
      score =
        score / norm +
        offset.reduce((s, v) => s + v * v, 0) * 0.08 +
        Math.hypot(sx - x, sy - y) * 0.0001;
      if (best === null || score < best.score) best = { x: sx, y: sy, score, offset };
    }
    if (op.source) {
      candidate(
        Math.round(op.source.x * image.width - (left + width / 2) + x),
        Math.round(op.source.y * image.height - (top + height / 2) + y),
      );
    } else {
      for (const shift of previous) candidate(x + shift.dx, y + shift.dy);
      const side = Math.max(4, Math.floor(Math.sqrt(op.iterations)));
      for (let gy = 0; gy <= side; gy++) {
        checkV3(options);
        for (let gx = 0; gx <= side; gx++)
          candidate(
            Math.round(x - search + (2 * search * gx) / side),
            Math.round(y - search + (2 * search * gy) / side),
          );
      }
      // Coarse-to-fine search catches texture phase between grid samples.
      for (
        let step = Math.max(1, Math.ceil(search / side));
        step >= 1;
        step = Math.floor(step / 2)
      ) {
        const b = best as { x: number; y: number } | null;
        if (!b) break;
        for (let dy = -step; dy <= step; dy += step)
          for (let dx = -step; dx <= step; dx += step) candidate(b.x + dx, b.y + dy);
      }
    }
    const donor = best as { x: number; y: number; score: number; offset: number[] } | null;
    if (!donor)
      throw new RangeError('周围没有完整的可用纹理补片，请扩大搜索、缩小补片或选择其他来源');
    previous.unshift({ dx: donor.x - x, dy: donor.y - y });
    previous.length = Math.min(previous.length, 8);
    const donorMean = [0, 0, 0];
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const src = ((donor.y + dy) * image.width + donor.x + dx) * 4;
        for (let c = 0; c < 3; c++) donorMean[c]! += image.data[src + c]!;
      }
    for (let c = 0; c < 3; c++) donorMean[c]! /= (2 * radius + 1) ** 2;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const at = local(x + dx, y + dy);
        if (at < 0 || !unknown[at]) continue;
        const src = ((donor.y + dy) * image.width + donor.x + dx) * 4;
        for (let c = 0; c < 3; c++)
          filled[at * 3 + c] =
            donorMean[c]! + (image.data[src + c]! - donorMean[c]!) * op.texture + donor.offset[c]!;
        unknown[at] = 0;
        confidence[at] = chosenConfidence;
        remaining--;
        front.delete(at);
      }
    for (let dy = -radius - 1; dy <= radius + 1; dy++)
      for (let dx = -radius - 1; dx <= radius + 1; dx++) {
        const at = local(x + dx, y + dy);
        if (at >= 0 && unknown[at] && adjacent(x + dx, y + dy)) front.add(at);
      }
  }
  const data = new Uint8ClampedArray(image.data);
  for (let at = 0; at < size; at++) {
    if ((at & 16383) === 0) checkV3(options);
    const amount = weights[at]! * op.opacity;
    if (amount <= 1 / 65535) continue;
    const dest = ((top + Math.floor(at / width)) * image.width + left + (at % width)) * 4;
    for (let c = 0; c < 3; c++)
      data[dest + c] =
        image.data[dest + c]! + (filled[at * 3 + c]! - image.data[dest + c]!) * amount;
  }
  return { width: image.width, height: image.height, data };
}
