import type { Dimensions, Point } from '@ai-xiutu/editor';
import { center } from './geometry.js';
import type { PortraitTarget } from './types.js';

export const finePartTools = new Set(['nostrilTone', 'pupilSize', 'earSize', 'hairVolume']);
type Move = { from: Point; to: Point; radius: number; gain: number; mode: 'push' | 'bulge' };
export function finePartMoves(target: PortraitTarget, size: Dimensions) {
  const result = new Map<string, Move[]>();
  const { leftEye, rightEye, lips } = target.contours;
  if (!leftEye?.length || !rightEye?.length || !lips?.length) return result;
  const a = center(leftEye),
    b = center(rightEye),
    mouth = center(lips);
  const w = size.width,
    h = size.height,
    short = Math.min(w, h);
  const px = (p: Point, q: Point) => ({ x: (p.x - q.x) * w, y: (p.y - q.y) * h });
  const distance = (p: Point, q: Point) => {
    const d = px(p, q);
    return Math.hypot(d.x, d.y);
  };
  const eye = px(b, a),
    span = Math.hypot(eye.x, eye.y);
  if (span < 7) return result;
  const m = px(mouth, a),
    sign = Math.sign(eye.x * m.y - eye.y * m.x);
  const down = { x: (-eye.y / span) * sign, y: (eye.x / span) * sign };
  const visible = (p: Point) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  function put(
    id: string,
    from: Point,
    dx: number,
    dy: number,
    radius: number,
    gain: number,
    mode: Move['mode'] = 'push',
  ) {
    const to = { x: from.x + dx / w, y: from.y + dy / h };
    if (!visible(from) || !visible(to) || radius < 1.35) return;
    const moves = result.get(id) ?? [];
    moves.push({ from, to, radius: radius / short, gain, mode });
    result.set(id, moves);
  }
  for (const side of ['left', 'right']) {
    const pupil = target.contours[side + 'Pupil'];
    const iris = target.contours[side + 'Eye'];
    if (pupil?.length !== 2 || !iris?.length) continue;
    const p = pupil[0]!,
      core = distance(p, pupil[1]!);
    if (core / span < 0.009 || core / span > 0.135) continue;
    let clearance = Infinity,
      inside = false;
    for (let i = 0; i < iris.length; i++) {
      const a = iris[i]!,
        b = iris[(i + 1) % iris.length]!;
      const d = px(p, a),
        e = px(b, a);
      const t = Math.min(
        1,
        Math.max(0, (d.x * e.x + d.y * e.y) / Math.max(1e-12, e.x ** 2 + e.y ** 2)),
      );
      clearance = Math.min(clearance, Math.hypot(d.x - t * e.x, d.y - t * e.y));
      if (a.y > p.y !== b.y > p.y && p.x < a.x + ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y))
        inside = !inside;
    }
    if (inside && clearance > core)
      put('pupilSize', p, 0, 0, Math.min(core * 2.1, clearance * 0.96), 0.61, 'bulge');
  }
  for (const key of ['earA', 'earB']) {
    const ear = target.contours[key];
    if (ear?.length !== 4) continue;
    const [root, top, edge, bottom] = ear as [Point, Point, Point, Point];
    const width = distance(root, edge),
      height = distance(top, bottom);
    if (width < 2 || height < 5 || width / span > 0.32 || height / span > 0.63) continue;
    for (const [i, p] of [top, edge, bottom].entries()) {
      const d = px(p, root);
      put(
        'earSize',
        p,
        d.x * 0.32,
        d.y * 0.19,
        Math.min(height * 0.62, Math.max(width * 2.1, height * 0.3)),
        i === 1 ? 0.95 : 0.61,
      );
    }
  }
  if (!sign) return result;
  for (const [id, key, radius, range, min] of [
    ['hairline', 'hairline', 0.255, 0.092, 3],
    ['hairVolume', 'hairCrown', 0.37, -0.13, 4],
  ] as const) {
    const points = target.contours[key];
    if (!points || points.length < min || points.length > 9) continue;
    for (const [i, p] of points.entries()) {
      const factor = 0.82 + 0.18 * (1 - Math.abs((2 * i) / (points.length - 1) - 1));
      put(id, p, down.x * span * range, down.y * span * range, span * radius, factor);
    }
  }
  return result;
}
