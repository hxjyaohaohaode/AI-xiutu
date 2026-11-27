import type { Adjustments, RGBAImage } from './types.js';
import { TOOLS } from './registry.js';
import { srgbToLinear } from './transfer.js';

/** Display-encoded sRGB measurements, weighted by visible alpha coverage. */
export function measureSceneTone(image: RGBAImage, sampleStride = 1) {
  const luma = new Float64Array(256),
    peak = new Float64Array(256);
  let visiblePixels = 0,
    sum = 0,
    squared = 0,
    blacks = 0,
    whites = 0;
  const stride = 4 * Math.max(1, Math.floor(sampleStride));
  for (let at = 0; at < image.data.length; at += stride) {
    const alpha = image.data[at + 3]! / 255;
    if (!alpha) continue;
    const r = image.data[at]!,
      g = image.data[at + 1]!,
      b = image.data[at + 2]!;
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const level = Math.round(y * 255),
      maximum = Math.max(r, g, b);
    visiblePixels += alpha;
    sum += y * alpha;
    squared += y * y * alpha;
    luma[level] = luma[level]! + alpha;
    peak[maximum] = peak[maximum]! + alpha;
    if (y <= 1 / 255) blacks += alpha;
    if (y >= 254 / 255) whites += alpha;
  }
  const quantile = (histogram: Float64Array, fraction: number) => {
    if (!visiblePixels) return 0;
    const threshold = fraction * visiblePixels;
    let cumulative = 0;
    for (let i = 0; i < 256; i++) {
      cumulative += histogram[i]!;
      if (cumulative >= threshold) return i / 255;
    }
    return 1;
  };
  const meanLuma = visiblePixels ? sum / visiblePixels : 0;
  return {
    width: image.width,
    height: image.height,
    visiblePixels,
    meanLuma,
    lumaDeviation: visiblePixels
      ? Math.sqrt(Math.max(0, squared / visiblePixels - meanLuma ** 2))
      : 0,
    blackFraction: visiblePixels ? blacks / visiblePixels : 0,
    whiteFraction: visiblePixels ? whites / visiblePixels : 0,
    tone: {
      low: quantile(luma, 0.1),
      mid: quantile(luma, 0.5),
      high: quantile(luma, 0.98),
      peak: quantile(peak, 0.98),
      channelClipFraction: visiblePixels ? peak[255]! / visiblePixels : 0,
    },
  };
}

export const sceneBalanceStrategies = ['balanced', 'open-shadows', 'retain-highlights', 'preserve-night'] as const;
export type SceneBalanceStrategy = typeof sceneBalanceStrategies[number];
const clamp = (number: number, min: number, max: number) => Math.min(max, Math.max(min, number));

/** Absolute input values for the existing render engine. This helper only
 * changes light controls and uses visible sRGB samples, not source highlights. */
export function sceneBalanceChanges(
  base: Adjustments,
  before: Pick<ReturnType<typeof measureSceneTone>, 'visiblePixels' | 'blackFraction' | 'tone'>,
  strategy: SceneBalanceStrategy,
  strength: number,
) {
  const { low, mid, high, peak, channelClipFraction } = before.tone;
  if (low > mid || mid > high || high > peak + 1 / 255)
    throw new Error('INVALID_SCENE_MEASUREMENTS');
  if (before.visiblePixels < 16 || high < 0.025 || strength === 0) return [];

  const shoulder = clamp((peak - 0.87) / 0.13 + channelClipFraction * 2, 0, 1);
  const headroom = Math.log2(srgbToLinear(0.96) / srgbToLinear(Math.max(0.03, peak)));
  const correction = Math.log2(srgbToLinear(0.46) / srgbToLinear(Math.max(0.035, mid)));
  let exposure = 0, shadows = 0, highlights = 0;
  if (strategy === 'balanced') {
    exposure = correction > 0
      ? Math.min(Math.max(0, headroom), correction * 0.45, 0.5)
      : Math.max(correction * 0.3, -0.38);
    shadows = clamp((0.23 - low) * 100, 0, 22);
    highlights = -shoulder * 17;
  } else if (strategy === 'open-shadows') {
    shadows = clamp((0.29 - low) * 135, 0, 33);
    highlights = -shoulder * 12;
  } else if (strategy === 'retain-highlights') {
    exposure = mid > 0.46 ? -shoulder * 0.26 : 0;
    highlights = -shoulder * 29;
  } else {
    shadows = clamp((0.13 - low) * 70, 0, 8);
    highlights = -shoulder * 14;
  }
  if (before.blackFraction > 0.12) shadows *= 0.65;
  return ([['exposure', exposure], ['shadows', shadows], ['highlights', highlights]] as const)
    .flatMap(([id, delta]) => {
      const { step, min, max } = TOOLS.find((tool) => tool.id === id)!;
      const difference = Math.round((delta * strength) / step) * step;
      const value = clamp(Number((base[id] + difference).toFixed(8)), min, max);
      return difference !== 0 && value !== base[id] ? [{ id, value }] : [];
    });
}
