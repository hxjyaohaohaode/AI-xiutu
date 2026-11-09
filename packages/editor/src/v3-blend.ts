import type { BlendModeV3 } from './v3-types.js';
import { clamp01 } from './v3-pixels.js';

const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
function setLum(r: number, g: number, b: number, l: number, out: Float64Array): void {
  const delta = l - lum(r, g, b);
  r += delta;
  g += delta;
  b += delta;
  const low = Math.min(r, g, b),
    high = Math.max(r, g, b);
  if (low < 0) {
    const k = l / (l - low);
    r = l + (r - l) * k;
    g = l + (g - l) * k;
    b = l + (b - l) * k;
  }
  if (high > 1) {
    const k = (1 - l) / (high - l);
    r = l + (r - l) * k;
    g = l + (g - l) * k;
    b = l + (b - l) * k;
  }
  out[0] = clamp01(r);
  out[1] = clamp01(g);
  out[2] = clamp01(b);
}
function setSat(r: number, g: number, b: number, sat: number, out: Float64Array): void {
  const lo = Math.min(r, g, b),
    hi = Math.max(r, g, b),
    scale = hi === lo ? 0 : sat / (hi - lo);
  out[0] = (r - lo) * scale;
  out[1] = (g - lo) * scale;
  out[2] = (b - lo) * scale;
}
function channel(b: number, s: number, mode: BlendModeV3): number {
  switch (mode) {
    case 'normal':
      return s;
    case 'multiply':
      return b * s;
    case 'screen':
      return b + s - b * s;
    case 'overlay':
      return b <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'hard-light':
      return s <= 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'soft-light':
      return s <= 0.5
        ? b - (1 - 2 * s) * b * (1 - b)
        : b + (2 * s - 1) * ((b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)) - b);
    case 'darken':
      return Math.min(b, s);
    case 'lighten':
      return Math.max(b, s);
    case 'difference':
      return Math.abs(b - s);
    case 'exclusion':
      return b + s - 2 * b * s;
    case 'color-dodge':
      return b === 0 ? 0 : s === 1 ? 1 : Math.min(1, b / (1 - s));
    case 'color-burn':
      return b === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - b) / s);
    default:
      return s;
  }
}
/** W3C Compositing Level 1 blending math; display-encoded sRGB, straight RGBA in 0..255. */
export function blendRgbaV3(
  backdrop: ArrayLike<number>,
  source: ArrayLike<number>,
  mode: BlendModeV3,
  opacity = 1,
  out = new Float64Array(4),
): Float64Array {
  const ab = clamp01(backdrop[3]! / 255),
    as = clamp01((source[3]! / 255) * opacity),
    ao = as + ab * (1 - as);
  if (as === 0) {
    for (let c = 0; c < 4; c++) out[c] = backdrop[c]!;
    return out;
  }
  const br = backdrop[0]! / 255,
    bg = backdrop[1]! / 255,
    bb = backdrop[2]! / 255,
    sr = source[0]! / 255,
    sg = source[1]! / 255,
    sb = source[2]! / 255;
  if (mode === 'hue') {
    setSat(sr, sg, sb, Math.max(br, bg, bb) - Math.min(br, bg, bb), out);
    setLum(out[0]!, out[1]!, out[2]!, lum(br, bg, bb), out);
  } else if (mode === 'saturation') {
    setSat(br, bg, bb, Math.max(sr, sg, sb) - Math.min(sr, sg, sb), out);
    setLum(out[0]!, out[1]!, out[2]!, lum(br, bg, bb), out);
  } else if (mode === 'color') setLum(sr, sg, sb, lum(br, bg, bb), out);
  else if (mode === 'luminosity') setLum(br, bg, bb, lum(sr, sg, sb), out);
  else {
    out[0] = channel(br, sr, mode);
    out[1] = channel(bg, sg, mode);
    out[2] = channel(bb, sb, mode);
  }
  for (let c = 0; c < 3; c++) {
    const b = c === 0 ? br : c === 1 ? bg : bb,
      s = c === 0 ? sr : c === 1 ? sg : sb;
    out[c] =
      ao === 0
        ? 0
        : clamp01((as * (1 - ab) * s + as * ab * out[c]! + (1 - as) * ab * b) / ao) * 255;
  }
  out[3] = ao * 255;
  return out;
}
