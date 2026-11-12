import {
  createCutoutAlphaPrior,
  MAX_CUTOUT_ALPHA_EDGE,
  parseSelectionMaskV3,
  type CutoutAlphaPrior,
  type Dimensions,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';

function smoothstep(value: number) {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
}

/** Manhattan distance to semantic support, with two linear raster passes. */
function measureSupportDistance(distance: Uint16Array, width: number, height: number) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      let value = distance[at]!;
      if (x) value = Math.min(value, distance[at - 1]! + 1);
      if (y) value = Math.min(value, distance[at - width]! + 1);
      distance[at] = value;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const at = y * width + x;
      let value = distance[at]!;
      if (x + 1 < width) value = Math.min(value, distance[at + 1]! + 1);
      if (y + 1 < height) value = Math.min(value, distance[at + width]! + 1);
      distance[at] = value;
    }
  }
}

/** Follow similar colors out from areas both models identify as background.
 * Keep the connected path and the color of its background seed in agreement. */
function suppressConnectedBackground(
  alpha: Uint8Array,
  semantic: Float32Array,
  rgba: Uint8ClampedArray,
  { width }: Dimensions,
  semanticCore: number,
) {
  const size = alpha.length;
  const queue = new Uint32Array(size);
  const seeds = new Uint32Array(size);
  const steps = new Uint8Array(size);
  const reach = Math.round(Math.min(42, Math.max(12, 0.15 * Math.sqrt(semanticCore))));
  let tail = 0;
  for (let i = 0; i < size; i++) {
    if (alpha[i]! <= 8 && semantic[i]! <= 0.12) {
      queue[tail++] = i;
      steps[i] = 1;
      seeds[i] = i;
    }
  }
  const colorDistance = (left: number, right: number) => {
    const a = left * 4;
    const b = right * 4;
    return (
      Math.abs(rgba[a]! - rgba[b]!) +
      Math.abs(rgba[a + 1]! - rgba[b + 1]!) +
      Math.abs(rgba[a + 2]! - rgba[b + 2]!)
    );
  };
  const visit = (from: number, at: number) => {
    if (steps[at] || semantic[at]! >= 0.35 || colorDistance(from, at) > 18) return;
    const seed = seeds[from]!;
    const distance = colorDistance(seed, at);
    if (distance >= 30) return;
    const step = steps[from]! + 1;
    queue[tail++] = at;
    steps[at] = step;
    seeds[at] = seed;
    if (alpha[at]! <= 8) return;
    const confidence =
      (1 - smoothstep(distance / 30)) *
      (1 - smoothstep(semantic[at]! / 0.35)) *
      (1 - smoothstep((step - reach * 0.7) / (reach * 0.3)));
    alpha[at] = Math.round(alpha[at]! * (1 - confidence));
  };
  for (let head = 0; head < tail; head++) {
    const at = queue[head]!;
    if (steps[at]! >= reach) continue;
    const x = at % width;
    if (x > 0) visit(at, at - 1);
    if (x + 1 < width) visit(at, at + 1);
    if (at >= width) visit(at, at - width);
    if (at + width < size) visit(at, at + width);
  }
}

/** Keep the matting model's edge coverage and restore high-confidence human
 * regions that it omits, such as a hand or an opaque garment behind glasses. */
export function fusePortraitCutoutPrior(
  predicted: Float32Array,
  grid: Dimensions,
  subject: SelectionMaskV3,
  source: Dimensions,
  modelRgba?: Uint8ClampedArray,
): CutoutAlphaPrior | undefined {
  const mask = parseSelectionMaskV3(subject);
  const { width, height } = grid;
  if (
    mask.type !== 'raster' ||
    mask.invert ||
    ![width, height].every(
      (edge) => Number.isInteger(edge) && edge > 0 && edge <= MAX_CUTOUT_ALPHA_EDGE,
    ) ||
    predicted.length !== width * height ||
    (modelRgba && modelRgba.length !== width * height * 4)
  )
    return undefined;
  const coarse = new Uint8Array(mask.width * mask.height);
  let at = 0;
  for (let i = 0; i < mask.runs.length; i += 2) {
    const end = at + mask.runs[i]!;
    coarse.fill(mask.runs[i + 1]!, at, end);
    at = end;
  }
  const axis = (length: number, cells: number) =>
    Array.from({ length }, (_, i) => {
      const position = Math.min(cells - 1, Math.max(0, ((i + 0.5) * cells) / length - 0.5));
      const low = Math.floor(position);
      return [low, Math.min(cells - 1, low + 1), position - low] as const;
    });
  const rows = axis(height, mask.height),
    columns = axis(width, mask.width);
  const alpha = new Uint8Array(predicted.length);
  const semanticCoverage = modelRgba ? new Float32Array(predicted.length) : undefined;
  const distance = new Uint16Array(predicted.length).fill(width + height);
  let modelCore = 0,
    modelOutside = 0,
    semanticCore = 0,
    overlap = 0;
  for (let y = 0; y < height; y++) {
    const [y0, y1, ty] = rows[y]!;
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        probability = predicted[i]!;
      if (!Number.isFinite(probability) || probability < -1e-6 || probability > 1 + 1e-6)
        return undefined;
      const [x0, x1, tx] = columns[x]!;
      const a = coarse[y0 * mask.width + x0]! * (1 - tx) + coarse[y0 * mask.width + x1]! * tx;
      const b = coarse[y1 * mask.width + x0]! * (1 - tx) + coarse[y1 * mask.width + x1]! * tx;
      const semantic = (a * (1 - ty) + b * ty) / 255;
      if (semanticCoverage) semanticCoverage[i] = semantic;
      if (semantic >= 0.35) distance[i] = 0;
      if (probability >= 0.9) modelCore++;
      if (probability <= 0.1) modelOutside++;
      if (semantic >= 0.9) {
        semanticCore++;
        if (probability >= 0.9) overlap++;
      }
      const weight = Math.max(probability, smoothstep((semantic - 0.76) / 0.23));
      alpha[i] = Math.round(255 * Math.min(1, Math.max(0, weight)));
    }
  }
  if (
    !modelOutside ||
    !modelCore ||
    !semanticCore ||
    overlap < 0.2 * Math.min(modelCore, semanticCore)
  )
    return undefined;
  measureSupportDistance(distance, width, height);
  // Fade distant matte-only islands. Scale the fringe by the subject area so a
  // small full-body portrait does not recruit a wall or the surface it touches.
  const reach = Math.min(36, Math.max(8, 0.1 * Math.sqrt(semanticCore)));
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] && distance[i]! > 0.35 * reach)
      alpha[i] = Math.round(alpha[i]! * smoothstep((reach - distance[i]!) / (0.65 * reach)));
  }
  if (semanticCoverage && modelRgba)
    suppressConnectedBackground(alpha, semanticCoverage, modelRgba, grid, semanticCore);
  return createCutoutAlphaPrior(source, grid, alpha);
}
