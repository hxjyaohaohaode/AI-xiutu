import type { RGBAImage, RenderOptions } from './types.js';
import type { RetouchRegionV4 } from './v4-types.js';
import type { SpatialRegionV4 } from './v4-spatial.js';
import { checkV3 } from './v3-pixels.js';

/** Separable running sums: O(pixels), independent of radius, no full integral image. */
export function boxSum(
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
  options: RenderOptions,
): Float32Array {
  const scratch = new Float64Array(input.length),
    result = new Float32Array(input.length);
  for (let y = 0; y < height; y++) {
    if ((y & 31) === 0) checkV3(options);
    let sum = 0;
    for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += input[y * width + x]!;
    for (let x = 0; x < width; x++) {
      scratch[y * width + x] = sum;
      if (x - radius >= 0) sum -= input[y * width + x - radius]!;
      if (x + radius + 1 < width) sum += input[y * width + x + radius + 1]!;
    }
  }
  for (let x = 0; x < width; x++) {
    if ((x & 31) === 0) checkV3(options);
    let sum = 0;
    for (let y = 0; y <= Math.min(radius, height - 1); y++) sum += scratch[y * width + x]!;
    for (let y = 0; y < height; y++) {
      result[y * width + x] = sum;
      if (y - radius >= 0) sum -= scratch[(y - radius) * width + x]!;
      if (y + radius + 1 < height) sum += scratch[(y + radius + 1) * width + x]!;
    }
  }
  return result;
}

/** Luminance-guided frequency separation with alpha-weighted statistics.
 * He/Sun/Tang local-linear guided filter; this is not neural skin reconstruction. */
export function guidedRetouch(
  image: RGBAImage,
  roi: SpatialRegionV4,
  op: RetouchRegionV4,
  options: RenderOptions,
): RGBAImage {
  const radius = Math.max(1, Math.round(op.radius * Math.min(image.width, image.height)));
  const respectMask = op.algorithm === 'guided-v2';
  // q depends on averages of local coefficients: the real footprint is 2r.
  // V2 gives every sample outside the effective mask exactly zero statistical weight.
  const halo = respectMask ? 0 : 2 * radius;
  const left = Math.max(0, roi.left - halo),
    top = Math.max(0, roi.top - halo);
  const width = Math.min(image.width, roi.left + roi.width + halo) - left;
  const height = Math.min(image.height, roi.top + roi.height + halo) - top;
  const size = width * height;
  if (size > 4194304) throw new RangeError('保边美肤的邻域超过 4MP，请缩小处理范围或半径');
  const alpha = new Float32Array(size),
    guide = new Float32Array(size),
    field = new Float32Array(size);
  const sourceAt = (at: number) =>
    ((top + Math.floor(at / width)) * image.width + left + (at % width)) * 4;
  for (let at = 0; at < size; at++) {
    if ((at & 16383) === 0) checkV3(options);
    const src = sourceAt(at);
    alpha[at] = (image.data[src + 3]! / 255) * (respectMask ? roi.weights[at]! : 1);
    guide[at] = alpha[at]
      ? (0.2126 * image.data[src]! +
          0.7152 * image.data[src + 1]! +
          0.0722 * image.data[src + 2]!) /
        255
      : 0;
  }
  function guidance(r: number, epsilon: number) {
    const norm = boxSum(alpha, width, height, r, options);
    function mean(values: Float32Array) {
      for (let at = 0; at < size; at++) field[at] = values[at]! * alpha[at]!;
      const result = boxSum(field, width, height, r, options);
      for (let at = 0; at < size; at++) result[at] = result[at]! / Math.max(1e-8, norm[at]!);
      return result;
    }
    const meanGuide = mean(guide);
    const variance = new Float32Array(size);
    for (let at = 0; at < size; at++) variance[at] = guide[at]! ** 2;
    const corrGuide = mean(variance);
    for (let at = 0; at < size; at++)
      variance[at] = Math.max(0, corrGuide[at]! - meanGuide[at]! ** 2);
    const a = new Float32Array(size),
      b = new Float32Array(size);
    function filter(p: Float32Array) {
      const meanP = mean(p);
      for (let at = 0; at < size; at++) a[at] = guide[at]! * p[at]!;
      const corr = mean(a);
      for (let at = 0; at < size; at++) {
        a[at] = (corr[at]! - meanGuide[at]! * meanP[at]!) / (variance[at]! + epsilon);
        b[at] = meanP[at]! - a[at]! * meanGuide[at]!;
      }
      const ma = mean(a),
        mb = mean(b);
      for (let at = 0; at < size; at++) ma[at] = ma[at]! * guide[at]! + mb[at]!;
      return ma;
    }
    return { meanGuide, filter };
  }
  const { meanGuide, filter } = guidance(radius, respectMask ? 0.0012 : 0.0025);
  const low = filter(guide),
    delta = new Float32Array(size);
  const fine =
    respectMask && radius > 1 && (op.smoothing || op.texture)
      ? guidance(Math.max(1, Math.floor(radius / 3)), 0.0012).filter(guide)
      : null;
  const atXY = (x: number, y: number) =>
    Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x));
  const median = new Float64Array(9);
  const distance = Math.max(1, Math.min(4, Math.floor(radius / 2)));
  const directions = [
    [distance, 0],
    [0, distance],
    [distance, distance],
    [distance, -distance],
  ] as const;
  for (let y = 0; y < height; y++) {
    if ((y & 15) === 0) checkV3(options);
    for (let x = 0; x < width; x++) {
      const at = y * width + x,
        lum = guide[at]!;
      if (respectMask && alpha[at] === 0) continue;
      let impulse = 0;
      if (op.speckle) {
        let index = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const n = atXY(x + dx, y + dy);
            median[index++] = alpha[n]! > 0 ? guide[n]! : lum;
          }
        median.sort();
        if (Math.abs(lum - median[4]!) > 0.055) impulse = median[4]! - lum;
      }
      let line = 0;
      // Both sides must be brighter: a single dark/light edge is not a wrinkle.
      if (op.fineLines)
        for (const [dx, dy] of directions) {
          const i = atXY(x + dx, y + dy),
            j = atXY(x - dx, y - dy);
          if (alpha[i]! <= 0 || alpha[j]! <= 0) continue;
          line = Math.max(line, Math.min(guide[i]! - lum, guide[j]! - lum));
        }
      const residual = lum - low[at]!;
      const smoothing = ((-0.85 * op.smoothing) / 100) * (fine ? fine[at]! - low[at]! : residual);
      const detail =
        (((op.texture >= 0 ? 1.5 : 1) * op.texture) / 100) * (fine ? lum - fine[at]! : residual);
      const shine = Math.max(0, lum - Math.max(0.58, meanGuide[at]! + 0.045));
      delta[at] =
        smoothing +
        detail +
        (impulse * op.speckle) / 100 +
        (Math.max(0, line - 0.01) * 0.8 * op.fineLines) / 100 -
        (shine * 0.85 * op.shine) / 100;
    }
  }
  const data = new Uint8ClampedArray(image.data),
    chroma = new Float32Array(size);
  const changes = respectMask
    ? [new Float32Array(size), new Float32Array(size), new Float32Array(size)]
    : null;
  for (let c = 0; c < 3; c++) {
    for (let at = 0; at < size; at++)
      chroma[at] = alpha[at] ? image.data[sourceAt(at) + c]! / 255 - guide[at]! : 0;
    const smoothChroma = op.uniformity ? filter(chroma) : null;
    for (let y = 0; y < roi.height; y++) {
      if ((y & 31) === 0) checkV3(options);
      for (let x = 0; x < roi.width; x++) {
        const amount = roi.weights[y * roi.width + x]! * op.opacity;
        if (amount <= 1 / 65535) continue;
        const at = (y + roi.top - top) * width + x + roi.left - left,
          src = sourceAt(at);
        const change =
          delta[at]! +
          (smoothChroma ? ((smoothChroma[at]! - chroma[at]!) * op.uniformity) / 100 : 0);
        if (changes) changes[c]![at] = change * 255 * amount;
        else data[src + c] = image.data[src + c]! + change * 255 * amount;
      }
    }
  }
  if (changes) {
    for (let at = 0; at < size; at++) {
      if ((at & 16383) === 0) checkV3(options);
      const src = sourceAt(at);
      // Clip the magnitude of the color change as a vector, preserving its
      // direction instead of flattening independent saturated channels.
      let gain = 1;
      for (let c = 0; c < 3; c++) {
        const change = changes[c]![at]!;
        if (change > 0) gain = Math.min(gain, (255 - image.data[src + c]!) / change);
        else if (change < 0) gain = Math.min(gain, image.data[src + c]! / -change);
      }
      for (let c = 0; c < 3; c++) data[src + c] = image.data[src + c]! + changes[c]![at]! * gain;
    }
  }
  return { width: image.width, height: image.height, data };
}
