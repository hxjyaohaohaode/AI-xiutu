import type { Dimensions, FaceWarpAnchorV3, Point } from '@ai-xiutu/editor';
import { center } from './geometry.js';
import { apertureWeight } from './contour-shaping.js';
import type { PortraitTarget } from './types.js';

export const eyeTransformIds: readonly string[] = [
  'eyeSize',
  'eyeWidth',
  'eyeHeight',
  'eyeSpacing',
  'eyeRotate',
] as const;
export const mouthTransformIds: readonly string[] = ['lipSize', 'lipWidth'] as const;
const inside = (p: Point) => p.x >= 0 && p.y >= 0 && p.x <= 1 && p.y <= 1;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Fit one transform to the full feature outline. Its aperture and internal
 * texture receive the same transform, even when several sliders are active. */
export function featureTransforms(
  target: PortraitTarget,
  { width, height }: Dimensions,
  value: (id: string) => number,
  coordinated = false,
  observed = false,
): FaceWarpAnchorV3[] {
  const { leftEye, rightEye, lips } = target.contours;
  if (!leftEye?.length || !rightEye?.length || !lips?.length) return [];
  const left = center(leftEye),
    right = center(rightEye);
  const dx = (right.x - left.x) * width,
    dy = (right.y - left.y) * height;
  const distance = Math.hypot(dx, dy);
  if (distance < 7) return [];
  const short = Math.min(width, height);
  const axis = (Math.atan2(dy, dx) * 180) / Math.PI;
  const ux = dx / distance,
    uy = dy / distance;
  const extent = (points: Point[], alongX: number, alongY: number) => {
    const values = points.map((p) => p.x * width * alongX + p.y * height * alongY);
    return Math.max(...values) - Math.min(...values);
  };
  const build = (
    from: Point,
    span: number,
    featureHeight: number,
    offset: number,
    horizontal: number,
    vertical: number,
    rotation: number,
    limit: number,
  ): FaceWarpAnchorV3 | undefined => {
    const to = {
      x: clamp(from.x + (offset * ux) / width, 0, 1),
      y: clamp(from.y + (offset * uy) / height, 0, 1),
    };
    if (!inside(from) || (!offset && !horizontal && !vertical && !rotation)) return;
    return {
      mode: 'affine',
      from,
      to,
      radius: Math.min(0.75, (span * 1.04) / short),
      strength: 1,
      affine: {
        radiusY: Math.min(0.75, limit / short, Math.max(span * 0.43, featureHeight * 1.43) / short),
        axis,
        scaleX: 1 + clamp(horizontal, -0.19, 0.23),
        scaleY: 1 + clamp(vertical, -0.2, 0.26),
        rotation: clamp(rotation, -12, 12),
      },
    };
  };
  const result: FaceWarpAnchorV3[] = [];
  const visibility = observed ? target.visibleParts : undefined;
  for (const [side, eye, brow, visible] of [
    [-1, leftEye, target.contours.leftBrow, visibility?.leftEye],
    [1, rightEye, target.contours.rightBrow, visibility?.rightEye],
  ] as const) {
    if (visible === false || !eye.every(inside)) continue;
    const origin = center(eye);
    const w = extent(eye, ux, uy),
      h = extent(eye, -uy, ux);
    if (w < 5 || h < Math.max(1.5, w * 0.075)) continue;
    const aperture = coordinated ? apertureWeight(h / w) : 1;
    if (aperture < 0.04) continue;
    const mouth = center(lips);
    const down = Math.sign((mouth.y - origin.y) * height * ux - (mouth.x - origin.x) * width * uy);
    if (!down) continue;
    const browCenter = brow?.length ? center(brow) : null;
    const gap = browCenter
      ? Math.abs((browCenter.y - origin.y) * height * ux - (browCenter.x - origin.x) * width * uy)
      : w;
    const size = value('eyeSize');
    const eyeMove = build(
      origin,
      w,
      h,
      side * w * value('eyeSpacing') * (coordinated ? 0.06 * aperture : 0.11),
      coordinated
        ? 0.079 * aperture * Math.tanh((size * 0.068 + value('eyeWidth') * 0.069) / 0.079)
        : size * 0.145 + value('eyeWidth') * 0.15,
      coordinated
        ? 0.098 * aperture * Math.tanh((size * 0.084 + value('eyeHeight') * 0.094) / 0.098)
        : size * 0.195 + value('eyeHeight') * 0.24,
      -side * value('eyeRotate') * down * (coordinated ? 5 * aperture : 11),
      Math.max(h * 1.05, gap * 0.86),
    );
    if (eyeMove) result.push(eyeMove);
  }
  const w = extent(lips, ux, uy),
    h = extent(lips, -uy, ux);
  if (visibility?.mouth !== false && lips.every(inside) && w >= 7 && h >= 2) {
    const size = value('lipSize');
    const lipMove = build(
      center(lips),
      w,
      h,
      0,
      coordinated
        ? 0.048 * Math.tanh((size * 0.015 + value('lipWidth') * 0.058) / 0.048)
        : size * 0.15 + value('lipWidth') * 0.15,
      coordinated ? 0 : size * 0.18,
      0,
      Math.max(h * 1.15, w * 0.39),
    );
    if (lipMove) result.push(lipMove);
  }
  return result;
}
