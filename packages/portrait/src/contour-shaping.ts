import type { Dimensions, FaceContourV3, Point } from '@ai-xiutu/editor';
import { center, unit } from './geometry.js';
import type { PortraitTarget } from './types.js';

export const contourTools = [
  'faceSlim',
  'faceNarrow',
  'vFace',
  'jaw',
  'cheekbones',
  'faceSmall',
] as const;

const ease = (amount: number) => {
  const t = unit(amount);
  return t * t * (3 - 2 * t);
};

export function apertureWeight(ratio: number): number {
  return ease((ratio - 0.082) / 0.105) * (1 - 0.36 * ease((ratio - 0.37) / 0.19));
}

/** Slice the detected silhouette in face coordinates. V-face, jaw and
 * cheek controls share the same row displacement instead of moving the same
 * patch several times. The eye line and the tip of the chin are fixed. */
export function portraitContour(
  target: PortraitTarget,
  { width, height }: Dimensions,
  value: (id: string) => number,
  sceneAware = false,
): FaceContourV3 | undefined {
  const { leftEye, rightEye, oval, lips } = target.contours;
  if (!leftEye?.length || !rightEye?.length || !oval?.length || !lips?.length) return;
  const first = center(leftEye);
  const second = center(rightEye);
  const eyeLineX = (second.x - first.x) * width;
  const eyeLineY = (second.y - first.y) * height;
  const distance = Math.hypot(eyeLineX, eyeLineY);
  if (distance < 7) return;
  const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const short = Math.min(width, height);
  let cos = eyeLineX / distance;
  let sin = eyeLineY / distance;
  const local = (point: Point) => {
    const x = ((point.x - mid.x) * width) / short;
    const y = ((point.y - mid.y) * height) / short;
    return { x: x * cos + y * sin, y: -x * sin + y * cos };
  };
  if (local(center(lips)).y < 0) {
    cos = -cos;
    sin = -sin;
  }
  const outline = oval.map(local);
  const mouth = local(center(lips));
  const mouthXs = lips.map((point) => local(point).x);
  const mouthLeft = Math.min(...mouthXs);
  const mouthRight = Math.max(...mouthXs);
  const nose = local(target.landmarks[1] ?? mid);
  const bottom = Math.max(...outline.map((p) => p.y));
  const eyeSpan = distance / short;
  if (bottom * short < 9 || mouth.y <= bottom * 0.2 || mouth.y >= bottom * 0.95) return;
  const widths = outline.map((p) => p.x);
  const faceWidth = Math.max(...widths) - Math.min(...widths);
  if (faceWidth * short < 15) return;
  const cheek = (t: number, center: number, width: number) =>
    Math.exp(-(((t - center) / width) ** 2));
  const strengths = contourTools.map(value) as [number, number, number, number, number, number];
  if (strengths.every((v) => v === 0)) return;
  const [slim, narrow, vFace, jaw, cheekbones, small] = strengths;
  const balance = sceneAware
    ? 1 / Math.max(1, Math.hypot(...strengths) * 0.87 +
      0.28 * Math.max(0, value('eyeSize'), value('eyeHeight'), value('eyeWidth')))
    : 1;
  const rows: FaceContourV3['rows'] = [];
  const rowCount = 18;
  const chinHold = 0.985;
  // The small-face control also changes upper cheek width. Start at a real
  // upper contour, regardless of the active values, to keep sampling stable.
  const upper = Math.min(...outline.map((point) => point.y)) / bottom;
  const start = Math.max(-0.4, upper * 0.76);
  const mouthRow = mouth.y / bottom;
  const visibility = (side: number) =>
    unit((Math.abs(side * eyeSpan * 0.5 - nose.x) / eyeSpan - 0.12) / 0.27);
  const leftVisibility = visibility(-1);
  const rightVisibility = visibility(1);
  for (let i = 0; i < rowCount; i++) {
    const t = start + (i * (chinHold - start)) / (rowCount - 1);
    const y = t * bottom;
    const hits = [];
    for (let j = 0; j < outline.length; j++) {
      const a = outline[j]!;
      const b = outline[(j + 1) % outline.length]!;
      if (a.y <= y === b.y <= y) continue;
      hits.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    if (hits.length < 2) return;
    const left = Math.min(...hits);
    const right = Math.max(...hits);
    const span = right - left;
    if (span < 0.000001) return;
    const rowCenter = nose.x * (1 - unit(t)) + mouth.x * unit(t);
    const smile = cheek(t, mouthRow, 0.15);
    const desiredLeft = rowCenter - span * 0.14;
    const desiredRight = rowCenter + span * 0.14;
    const leftCore = Math.max(
      left + span * 0.16,
      Math.min(right - span * 0.42, desiredLeft + (mouthLeft - span * 0.016 - desiredLeft) * smile),
    );
    const rightCore = Math.min(
      right - span * 0.16,
      Math.max(
        left + span * 0.42,
        desiredRight + (mouthRight + span * 0.016 - desiredRight) * smile,
      ),
    );
    const chinTaper = ease((chinHold - t) / 0.19);
    const midTaper = ease(t / 0.16) * chinTaper;
    const request =
      midTaper *
        (slim * 0.029 * cheek(t, mouthRow * 0.66, 0.34) +
          narrow * 0.024 * cheek(t, mouthRow * 0.44, 0.22) +
          vFace * 0.024 * cheek(t, mouthRow + (1 - mouthRow) * 0.42, 0.235) +
          jaw * 0.018 * cheek(t, mouthRow + (1 - mouthRow) * 0.16, 0.18) +
          cheekbones * 0.016 * cheek(t, mouthRow * 0.49, 0.19)) +
      small * 0.015 * ease((t - start) / 0.25) * chinTaper;
    const cap = Math.min(0.056 * span, 0.025 * faceWidth);
    // As the requested contour approaches the smile, there is less room for a
    // gentle transition. Keep the mouth stable by sharing that smaller budget.
    const shift = (room: number, visibility: number) => {
      const available = Math.min(cap, room * 0.22);
      return i === 0 || i === rowCount - 1 || available <= 0
        ? 0
        : visibility * available * Math.tanh((request * span * balance) / available);
    };
    rows.push({
      y,
      left,
      right,
      leftCore,
      rightCore,
      leftShift: shift(leftCore - left, leftVisibility),
      rightShift: shift(right - rightCore, rightVisibility),
    });
  }
  if (!rows.some((row) => row.leftShift || row.rightShift)) return;
  return { center: mid, axis: (Math.atan2(sin, cos) * 180) / Math.PI, rows };
}
