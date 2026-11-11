import type { RGBAImage, RenderOptions } from './types.js';
import type { RetouchRegionV4 } from './v4-types.js';
import type { SpatialRegionV4 } from './v4-spatial.js';
import { checkV3 } from './v3-pixels.js';
import { linearToSrgb, srgbToLinear } from './engine.js';

/** Separable running sums: O(pixels), independent of radius, no full integral image. */
export function boxSum(
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
  options: RenderOptions,
  workspace?: Float64Array,
): Float32Array {
  const scratch = workspace ?? new Float64Array(input.length),
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
  // Keep each column's arithmetic order identical while walking contiguous rows.
  // A column-at-a-time traversal thrashes cache on large portrait regions.
  const sums = new Float64Array(width);
  for (let y = 0; y <= Math.min(radius, height - 1); y++) {
    if ((y & 31) === 0) checkV3(options);
    for (let x = 0; x < width; x++) sums[x]! += scratch[y * width + x]!;
  }
  for (let y = 0; y < height; y++) {
    if ((y & 31) === 0) checkV3(options);
    const row = y * width,
      remove = (y - radius) * width,
      add = (y + radius + 1) * width;
    for (let x = 0; x < width; x++) {
      result[row + x] = sums[x]!;
      if (y - radius >= 0) sums[x]! -= scratch[remove + x]!;
      if (y + radius + 1 < height) sums[x]! += scratch[add + x]!;
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
  const robust = op.algorithm === 'guided-v4';
  const detailV3 = robust || op.algorithm === 'guided-v3';
  const respectMask = detailV3 || op.algorithm === 'guided-v2';
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
  const boxWorkspace = new Float64Array(size);
  const box = (values: Float32Array, r: number) =>
    boxSum(values, width, height, r, options, boxWorkspace);
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
    const norm = box(alpha, r);
    function mean(values: Float32Array) {
      for (let at = 0; at < size; at++) field[at] = values[at]! * alpha[at]!;
      const result = box(field, r);
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
      const meanP = p === guide ? meanGuide : mean(p);
      if (p !== guide) for (let at = 0; at < size; at++) a[at] = guide[at]! * p[at]!;
      const corr = p === guide ? corrGuide : mean(a);
      for (let at = 0; at < size; at++) {
        a[at] = (corr[at]! - meanGuide[at]! * meanP[at]!) / (variance[at]! + epsilon);
        b[at] = meanP[at]! - a[at]! * meanGuide[at]!;
      }
      const ma = mean(a),
        mb = mean(b);
      for (let at = 0; at < size; at++) ma[at] = ma[at]! * guide[at]! + mb[at]!;
      return ma;
    }
    return { meanGuide, mean, filter };
  }
  const stats =
    !robust || op.smoothing || op.texture || op.uniformity || op.shine
      ? guidance(radius, respectMask ? 0.0012 : 0.0025)
      : null;
  const low = !robust || op.smoothing || op.texture ? stats!.filter(guide) : guide,
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
  const localReflection = detailV3 && op.shine > 0 ? new Float32Array(size) : null;
  if (localReflection) {
    const light = new Float32Array(size);
    for (let at = 0; at < size; at++) {
      if ((at & 16383) === 0) checkV3(options);
      if (!alpha[at]) continue;
      const src = sourceAt(at);
      const r = srgbToLinear(image.data[src]! / 255),
        g = srgbToLinear(image.data[src + 1]! / 255),
        b = srgbToLinear(image.data[src + 2]! / 255),
        max = Math.max(r, g, b);
      light[at] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      localReflection[at] = max ? (max - Math.min(r, g, b)) / max : 0;
    }
    const diffuseLight = stats!.mean(light),
      diffuseSaturation = stats!.mean(localReflection);
    for (let at = 0; at < size; at++) {
      if ((at & 16383) === 0) checkV3(options);
      const saturationDrop =
        (diffuseSaturation[at]! - localReflection[at]!) / Math.max(0.1, diffuseSaturation[at]!);
      const whiteness = Math.min(1, Math.max(0, (saturationDrop - 0.025) / 0.18));
      const prominence = Math.max(0, light[at]! - diffuseLight[at]! - 0.004);
      const src = sourceAt(at);
      const floor = srgbToLinear(
        Math.min(image.data[src]!, image.data[src + 1]!, image.data[src + 2]!) / 255,
      );
      localReflection[at] =
        (Math.min(floor * 0.75, prominence * 0.88) *
          whiteness *
          whiteness *
          (3 - 2 * whiteness) *
          op.shine) /
        100;
    }
  }
  const validSample = (x: number, y: number) =>
    x >= 0 && x < width && y >= 0 && y < height && alpha[y * width + x]! > 1 / 65535;
  function trough(x: number, y: number, dx: number, dy: number): number {
    if (!validSample(x, y) || !validSample(x + dx, y + dy) || !validSample(x - dx, y - dy))
      return 0;
    const center = guide[y * width + x]!;
    return Math.max(
      0,
      Math.min(guide[(y + dy) * width + x + dx]!, guide[(y - dy) * width + x - dx]!) - center,
    );
  }
  function coherentLine(x: number, y: number, dx: number, dy: number): number {
    const across = trough(x, y, dx, dy);
    if (across <= 0.01) return 0;
    const tx = -Math.sign(dy),
      ty = Math.sign(dx);
    const continuity = Math.min(trough(x + tx, y + ty, dx, dy), trough(x - tx, y - ty, dx, dy));
    return across * Math.min(1, Math.max(0, (continuity / across - 0.2) / 0.5));
  }
  // A compact impulse disagrees with opposite neighbors on several axes.
  // A straight edge or line has a same-side/tangent pair and is protected.
  function spotCorrection(
    values: Float32Array,
    x: number,
    y: number,
    step: number,
    threshold: number,
  ) {
    const at = y * width + x,
      value = values[at]!;
    let sum = 0,
      consistent = 0,
      examined = 0;
    for (const [dx, dy] of directions) {
      const xx = x + Math.sign(dx) * step,
        yy = y + Math.sign(dy) * step;
      const ox = x - Math.sign(dx) * step,
        oy = y - Math.sign(dy) * step;
      if (!validSample(xx, yy) || !validSample(ox, oy)) continue;
      examined++;
      const a = values[yy * width + xx]! - value,
        b = values[oy * width + ox]! - value;
      if (
        a * b <= 0 ||
        Math.min(Math.abs(a), Math.abs(b)) <= threshold ||
        Math.abs(a - b) > threshold * 2
      )
        continue;
      const n = yy * width + xx,
        o = oy * width + ox;
      if (values !== guide && Math.abs(guide[n]! - guide[o]!) > 0.11) continue;
      consistent++;
      sum += (a + b) / 2;
    }
    return consistent >= 3 && consistent === examined ? sum / consistent : 0;
  }
  for (let y = 0; y < height; y++) {
    if ((y & 15) === 0) checkV3(options);
    for (let x = 0; x < width; x++) {
      const at = y * width + x,
        lum = guide[at]!;
      if (respectMask && alpha[at] === 0) continue;
      let impulse = 0;
      if (op.speckle && robust) {
        impulse =
          spotCorrection(guide, x, y, 1, 0.034) || spotCorrection(guide, x, y, distance, 0.05);
      } else if (op.speckle) {
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
          if (detailV3) {
            const xDirection = Math.sign(dx),
              yDirection = Math.sign(dy);
            line = Math.max(line, coherentLine(x, y, xDirection, yDirection));
            if (distance > 1) line = Math.max(line, coherentLine(x, y, dx, dy));
            continue;
          }
          const i = atXY(x + dx, y + dy),
            j = atXY(x - dx, y - dy);
          if (alpha[i]! <= 0 || alpha[j]! <= 0) continue;
          line = Math.max(line, Math.min(guide[i]! - lum, guide[j]! - lum));
        }
      const residual = lum - low[at]!;
      const smoothing = ((-0.85 * op.smoothing) / 100) * (fine ? fine[at]! - low[at]! : residual);
      const detail =
        (((op.texture >= 0 ? 1.5 : 1) * op.texture) / 100) * (fine ? lum - fine[at]! : residual);
      const shine = detailV3 ? 0 : Math.max(0, lum - Math.max(0.58, stats!.meanGuide[at]! + 0.045));
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
  const chromaSpotDelta = op.chromaSpots ? new Float32Array(size) : null;
  const lumaWeights = [0.2126, 0.7152, 0.0722] as const;
  for (let c = 0; c < 3; c++) {
    for (let at = 0; at < size; at++)
      chroma[at] = alpha[at] ? image.data[sourceAt(at) + c]! / 255 - guide[at]! : 0;
    const smoothChroma = op.uniformity ? stats!.filter(chroma) : null;
    for (let y = 0; y < roi.height; y++) {
      if ((y & 31) === 0) checkV3(options);
      for (let x = 0; x < roi.width; x++) {
        const amount = roi.weights[y * roi.width + x]! * op.opacity;
        if (amount <= 1 / 65535) continue;
        const at = (y + roi.top - top) * width + x + roi.left - left,
          src = sourceAt(at);
        const reflection = localReflection?.[at] ?? 0;
        const channel = image.data[src + c]! / 255;
        const chromaSpot = op.chromaSpots
          ? (spotCorrection(chroma, x + roi.left - left, y + roi.top - top, distance, 0.018) *
              op.chromaSpots) /
            100
          : 0;
        if (chromaSpotDelta) chromaSpotDelta[at]! += lumaWeights[c]! * chromaSpot * amount * 255;
        const specularChange =
          reflection > 0
            ? linearToSrgb(Math.max(0, srgbToLinear(channel) - reflection)) - channel
            : 0;
        const change =
          delta[at]! +
          chromaSpot +
          specularChange +
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
      const lumaCorrection = chromaSpotDelta?.[at] ?? 0;
      for (let c = 0; c < 3; c++) {
        const change = changes[c]![at]! - lumaCorrection;
        if (change > 0) gain = Math.min(gain, (255 - image.data[src + c]!) / change);
        else if (change < 0) gain = Math.min(gain, image.data[src + c]! / -change);
      }
      for (let c = 0; c < 3; c++)
        data[src + c] = image.data[src + c]! + (changes[c]![at]! - lumaCorrection) * gain;
    }
  }
  return { width: image.width, height: image.height, data };
}
