import { drawCollageSource } from './collage-media';
import type { CollagePoint, CollageTracker } from './collage-layout';

type Sample = CollagePoint & { offset: number; weight: number };

/** Follow position using the appearance of the selected foreground and its edge. */
export function trackCollageSubject(
  reference: CanvasImageSource,
  matte: HTMLCanvasElement,
): CollageTracker {
  const scale = Math.min(1, 104 / Math.max(matte.width, matte.height));
  const width = Math.max(1, Math.round(matte.width * scale));
  const height = Math.max(1, Math.round(matte.height * scale));
  const rect = { x: 0, y: 0, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(matte, 0, 0, width, height);
  const coverage = context.getImageData(0, 0, width, height).data;
  const pixels = (frame: CanvasImageSource) => {
    context.clearRect(0, 0, width, height);
    drawCollageSource(context, frame, rect);
    return context.getImageData(0, 0, width, height).data;
  };
  const anchor = pixels(reference);
  const samples: Sample[] = [];
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const offset = (y * width + x) * 4;
      const boundary =
        Math.abs(coverage[offset + 7]! - coverage[offset - 1]!) +
        Math.abs(coverage[offset + width * 4 + 3]! - coverage[offset - width * 4 + 3]!);
      if (coverage[offset + 3]! < 64 && boundary === 0) continue;
      let edge = 0;
      for (let channel = 0; channel < 3; channel++) {
        edge += Math.abs(anchor[offset + 4 + channel]! - anchor[offset - 4 + channel]!);
        edge += Math.abs(
          anchor[offset + width * 4 + channel]! - anchor[offset - width * 4 + channel]!,
        );
      }
      if (edge > 15) samples.push({ x, y, offset, weight: Math.min(3, 1 + boundary / 255) });
    }
  }
  // Select distributed points so hair or one strong edge cannot dominate the fit.
  const step = Math.max(1, Math.ceil(samples.length / 92));
  const features = samples.filter((_, index) => index % step === 0);
  const origin = { x: 0, y: 0 };
  if (features.length < 6) return () => origin;
  const reachX = Math.ceil(width * 0.44);
  const reachY = Math.ceil(height * 0.44);
  const minX = Math.min(reachX, ...features.map(({ x }) => x));
  const maxX = Math.min(reachX, ...features.map(({ x }) => width - x - 1));
  const minY = Math.min(reachY, ...features.map(({ y }) => y));
  const maxY = Math.min(reachY, ...features.map(({ y }) => height - y - 1));
  let position = origin;
  let lastSample = -Infinity;
  return (frame) => {
    const now = performance.now();
    if (now - lastSample < 55) return { x: position.x / width, y: position.y / height };
    lastSample = now;
    const current = pixels(frame);
    let best = position;
    let lowest = Infinity;
    function compare(x: number, y: number) {
      const displacement = (y * width + x) * 4;
      let sum = 0;
      for (const { offset, weight } of features) {
        for (let channel = 0; channel < 3; channel++)
          sum +=
            weight *
            Math.abs(anchor[offset + channel]! - current[offset + displacement + channel]!);
      }
      const score = sum / (features.length * 3) + Math.hypot(x - position.x, y - position.y) * 0.12;
      if (score < lowest) {
        lowest = score;
        best = { x, y };
      }
    }
    compare(position.x, position.y);
    for (let y = -minY; y <= maxY; y += 3) for (let x = -minX; x <= maxX; x += 3) compare(x, y);
    const coarse = best;
    for (let y = Math.max(-minY, coarse.y - 2); y <= Math.min(maxY, coarse.y + 2); y++)
      for (let x = Math.max(-minX, coarse.x - 2); x <= Math.min(maxX, coarse.x + 2); x++)
        compare(x, y);
    if (lowest < 50) position = best;
    return { x: position.x / width, y: position.y / height };
  };
}
