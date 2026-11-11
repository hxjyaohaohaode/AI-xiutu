import type { Dimensions, Point, WarpStrokeV3 } from '@ai-xiutu/editor';
import { center } from './geometry.js';
import type { PortraitTarget } from './types.js';

export const detailFeatureIds = [
  'eyeWidth',
  'eyeHeight',
  'lowerLid',
  'irisScale',
  'browPosition',
  'lipWidth',
  'upperLip',
  'lowerLip',
] as const;
export type DetailFeatureId = (typeof detailFeatureIds)[number];
type Move = { from: Point; to: Point; radius: number; mode: WarpStrokeV3['mode']; gain: number };
const visible = (p: Point) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

/** Derive independent motion supports from the observed outlines in source pixels. */
export function facialDetailMoves(target: PortraitTarget, dimensions: Dimensions) {
  const result = new Map<DetailFeatureId, Move[]>();
  const { width, height } = dimensions;
  const contours = target.contours;
  const leftEye = contours.leftEye,
    rightEye = contours.rightEye,
    lips = contours.lips;
  if (!leftEye?.length || !rightEye?.length || !lips?.length) return result;
  const first = center(leftEye),
    second = center(rightEye),
    mouth = center(lips);
  const dx = (second.x - first.x) * width,
    dy = (second.y - first.y) * height;
  const length = Math.hypot(dx, dy);
  if (length < 3) return result;
  const ux = dx / length,
    uy = dy / length;
  const down = Math.sign((mouth.y - first.y) * height * ux - (mouth.x - first.x) * width * uy);
  if (down === 0) return result;
  const vx = -uy * down,
    vy = ux * down,
    short = Math.min(width, height);
  const u = (p: Point) => p.x * width * ux + p.y * height * uy;
  const v = (p: Point) => p.x * width * vx + p.y * height * vy;
  const extent = (points: Point[]) => {
    let left = points[0]!,
      right = left,
      top = left,
      bottom = left;
    for (const p of points.slice(1)) {
      if (u(p) < u(left)) left = p;
      if (u(p) > u(right)) right = p;
      if (v(p) < v(top)) top = p;
      if (v(p) > v(bottom)) bottom = p;
    }
    return { left, right, top, bottom, width: u(right) - u(left), height: v(bottom) - v(top) };
  };
  const move = (
    id: DetailFeatureId,
    from: Point,
    along: number,
    down: number,
    pixels: number,
    mode: Move['mode'] = 'push',
    gain = 1,
  ) => {
    if (!visible(from) || pixels < 1.2) return;
    const to = {
      x: from.x + (along * ux + down * vx) / width,
      y: from.y + (along * uy + down * vy) / height,
    };
    if (!visible(to)) return;
    const moves = result.get(id) ?? [];
    moves.push({ from, to, radius: pixels / short, mode, gain });
    result.set(id, moves);
  };
  for (const [eye, brow, iris] of [
    [leftEye, contours.leftBrow, 468],
    [rightEye, contours.rightBrow, 473],
  ] as const) {
    const e = extent(eye);
    if (e.width < 6 || e.height < Math.max(1.5, e.width * 0.07)) continue;
    const cornerSupport = Math.min(e.width * 0.3, Math.max(2, e.height * 0.76));
    move('eyeWidth', e.left, -e.width * 0.1, 0, cornerSupport);
    move('eyeWidth', e.right, e.width * 0.1, 0, cornerSupport);
    const lidSupport = Math.min(e.width * 0.3, e.height * 0.82);
    move('eyeHeight', e.top, 0, -e.height * 0.23, lidSupport);
    move('eyeHeight', e.bottom, 0, e.height * 0.23, lidSupport);
    move('lowerLid', e.bottom, 0, e.height * 0.27, lidSupport);
    if (brow?.length) {
      const b = extent(brow),
        origin = center(brow);
      const clearance = v(e.top) - v(origin);
      move('browPosition', origin, 0, -clearance * 0.22, Math.min(b.width * 0.65, clearance * 0.8));
    }
    // The iris landmark order is resolved against the actual aperture below.
    const candidates = [iris, iris === 468 ? 473 : 468];
    for (const index of candidates) {
      const pupil = target.landmarks[index];
      if (
        !pupil ||
        u(pupil) <= u(e.left) ||
        u(pupil) >= u(e.right) ||
        v(pupil) <= v(e.top) ||
        v(pupil) >= v(e.bottom)
      )
        continue;
      let inside = false,
        clearance = Infinity;
      for (let i = 0; i < eye.length; i++) {
        const a = eye[i]!,
          b = eye[(i + 1) % eye.length]!;
        if (
          a.y > pupil.y !== b.y > pupil.y &&
          pupil.x < a.x + ((pupil.y - a.y) * (b.x - a.x)) / (b.y - a.y)
        )
          inside = !inside;
        const ax = (pupil.x - a.x) * width,
          ay = (pupil.y - a.y) * height;
        const ex = (b.x - a.x) * width,
          ey = (b.y - a.y) * height;
        const projection = Math.min(
          1,
          Math.max(0, (ax * ex + ay * ey) / Math.max(1e-12, ex * ex + ey * ey)),
        );
        clearance = Math.min(clearance, Math.hypot(ax - ex * projection, ay - ey * projection));
      }
      const ring = target.landmarks.slice(index + 1, index + 5);
      const irisRadius =
        ring.length === 4
          ? ring.reduce(
              (sum, p) => sum + Math.hypot((p.x - pupil.x) * width, (p.y - pupil.y) * height),
              0,
            ) / 4
          : 0;
      if (
        inside &&
        irisRadius >= 1 &&
        irisRadius < e.width * 0.42 &&
        clearance >= irisRadius * 0.65
      )
        move('irisScale', pupil, 0, 0, Math.min(clearance * 0.95, irisRadius * 1.7), 'bulge', 0.48);
      break;
    }
  }
  const lip = extent(lips);
  if (lip.width >= 7 && lip.height >= 3) {
    const inner = contours.innerLips?.length ? extent(contours.innerLips) : null;
    const corners = Math.min(lip.width * 0.23, lip.height * 0.68);
    move('lipWidth', lip.left, -lip.width * 0.08, 0, corners);
    move('lipWidth', lip.right, lip.width * 0.08, 0, corners);
    const upper = inner ? v(inner.top) - v(lip.top) : lip.height * 0.35;
    const lower = inner ? v(lip.bottom) - v(inner.bottom) : lip.height * 0.35;
    move('upperLip', lip.top, 0, -upper * 0.4, upper * 0.88);
    move('lowerLip', lip.bottom, 0, lower * 0.4, lower * 0.88);
  }
  return result;
}
