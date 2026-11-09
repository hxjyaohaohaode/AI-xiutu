import type { Point, SelectionMaskV3 } from '@ai-xiutu/editor';
import type { PortraitTarget } from './types.js';

export const unit = (v: number) => Math.max(0, Math.min(1, v));
export function center(points: readonly Point[]): Point {
  if (!points.length) throw new Error('缺少部位关键点，不能推测调节位置。');
  return {
    x: points.reduce((a, p) => a + p.x, 0) / points.length,
    y: points.reduce((a, p) => a + p.y, 0) / points.length,
  };
}
export function boundsOf(points: readonly Point[]) {
  if (points.length < 3 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error('关键点无效。');
  const xs = points.map((p) => unit(p.x)),
    ys = points.map((p) => unit(p.y));
  const x = Math.min(...xs),
    y = Math.min(...ys),
    width = Math.max(...xs) - x,
    height = Math.max(...ys) - y;
  if (width < 0.001 || height < 0.001) throw new Error('可见部位过小，无法稳定编辑。');
  return { x, y, width, height };
}
/** Reconstruct each connected contour rather than sorting indices or assuming connection order. */
export function contourLoops(
  points: readonly Point[],
  connections: readonly { start: number; end: number }[],
): Point[][] {
  const edges = connections.map((e) => [e.start, e.end] as [number, number]);
  const loops: Point[][] = [];
  while (edges.length) {
    const first = edges.shift()!,
      chain = [first[0], first[1]];
    while (chain.length <= connections.length + 1) {
      const last = chain.at(-1)!;
      if (last === chain[0]) break;
      const ix = edges.findIndex((e) => e[0] === last || e[1] === last);
      if (ix < 0) break;
      const edge = edges.splice(ix, 1)[0]!;
      chain.push(edge[0] === last ? edge[1] : edge[0]);
    }
    if (chain.at(-1) !== chain[0]) continue;
    chain.pop();
    const unique = [...new Set(chain)].map((i) => points[i]).filter((p): p is Point => Boolean(p));
    if (unique.length >= 3) loops.push(unique.map((p) => ({ x: unit(p.x), y: unit(p.y) })));
  }
  return loops.sort((a, b) => polygonArea(b) - polygonArea(a));
}
function polygonArea(points: readonly Point[]) {
  return (
    Math.abs(
      points.reduce((n, p, i) => {
        const q = points[(i + 1) % points.length]!;
        return n + p.x * q.y - q.x * p.y;
      }, 0),
    ) / 2
  );
}
export function polygon(points: Point[], feather = 0.006): SelectionMaskV3 {
  if (points.length < 3) throw new Error('部位轮廓不足。');
  return {
    type: 'polygon',
    points: points.map((p) => ({ x: unit(p.x), y: unit(p.y) })),
    feather,
    invert: false,
  };
}
export function ellipse(p: Point, rx: number, ry: number, feather = 0.6): SelectionMaskV3 {
  return {
    type: 'radial',
    centerX: unit(p.x),
    centerY: unit(p.y),
    radiusX: Math.max(0.0001, Math.min(1, rx)),
    radiusY: Math.max(0.0001, Math.min(1, ry)),
    feather,
    invert: false,
  };
}
export function combine(
  operation: 'union' | 'intersection' | 'subtract',
  masks: SelectionMaskV3[],
): SelectionMaskV3 {
  if (!masks.length) throw new Error('没有可组合的部位。');
  return masks.length === 1 ? masks[0]! : { type: 'compound', operation, masks, invert: false };
}
export function facialMasks(target: PortraitTarget, skin: SelectionMaskV3 | null) {
  const c = target.contours,
    face = polygon(c.oval ?? [], 0.009);
  const exclusions = ['leftEye', 'rightEye', 'lips', 'leftBrow', 'rightBrow']
    .filter((k) => c[k]?.length)
    .map((k) => polygon(c[k]!, 0.001));
  const safe = exclusions.length ? combine('subtract', [face, combine('union', exclusions)]) : face;
  return {
    face,
    skin: skin ? combine('intersection', [safe, skin]) : safe,
    eyes: combine(
      'union',
      ['leftEye', 'rightEye'].map((k) => polygon(c[k] ?? [], 0.002)),
    ),
    brows: combine(
      'union',
      ['leftBrow', 'rightBrow'].map((k) => polygon(c[k] ?? [], 0.001)),
    ),
    lips: c.innerLips?.length
      ? combine('subtract', [polygon(c.lips ?? [], 0.001), polygon(c.innerLips, 0)])
      : polygon(c.lips ?? [], 0.001),
  };
}

export { validateTarget } from './validation.js';

/** Open eyebrow chains are not closed surfaces. Their bounded convex hull uses all model points. */
export function contourHull(
  points: readonly Point[],
  connections: readonly { start: number; end: number }[],
): Point[] {
  const indices = [...new Set(connections.flatMap((e) => [e.start, e.end]))];
  if (indices.some((i) => !Number.isInteger(i) || i < 0 || i >= points.length))
    throw new Error('轮廓连接指向不存在的关键点。');
  const sorted = indices
    .map((i) => ({ x: unit(points[i]!.x), y: unit(points[i]!.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const unique = sorted.filter(
    (p, i) => !i || p.x !== sorted[i - 1]!.x || p.y !== sorted[i - 1]!.y,
  );
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of [...unique].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
