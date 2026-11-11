import type { RGBAImage } from './types.js';

/** Display-encoded sRGB measurements, weighted by visible alpha coverage. */
export function measureSceneTone(image: RGBAImage) {
  const luma = new Float64Array(256),
    peak = new Float64Array(256);
  let visiblePixels = 0,
    sum = 0,
    squared = 0,
    blacks = 0,
    whites = 0;
  for (let at = 0; at < image.data.length; at += 4) {
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
