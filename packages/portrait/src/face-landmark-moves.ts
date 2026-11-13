import type { Dimensions, Point, WarpStrokeV3 } from '@ai-xiutu/editor';
import { center } from './geometry.js';
import type { PortraitTarget } from './types.js';

export interface FaceMove {
  from: Point;
  to: Point;
  radius: number;
  mode: WarpStrokeV3['mode'];
  gain: number;
}

export const classicFaceFeatures = [
  'faceSlim',
  'faceNarrow',
  'vFace',
  'faceSmall',
  'temples',
  'cheekbones',
  'jaw',
  'chin',
  'forehead',
  'noseWidth',
  'noseTip',
  'noseLength',
  'smile',
  'browThickness',
] as const;

const visible = (point: Point | undefined): point is Point =>
  !!point && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

/** Keep supports attached to the visible mesh, with image-pixel distances on rolled faces. */
export function faceLandmarkMoves(target: PortraitTarget, { width, height }: Dimensions) {
  const moves = new Map<string, FaceMove[]>();
  const { leftEye, rightEye, lips, oval } = target.contours;
  if (!leftEye?.length || !rightEye?.length || !lips?.length || !oval?.length) return moves;
  const left = center(leftEye);
  const right = center(rightEye);
  const mouth = center(lips);
  const x = (right.x - left.x) * width;
  const y = (right.y - left.y) * height;
  const eyeDistance = Math.hypot(x, y);
  if (eyeDistance < 7) return moves;
  const ux = x / eyeDistance,
    uy = y / eyeDistance;
  const down = Math.sign((mouth.y - left.y) * height * ux - (mouth.x - left.x) * width * uy);
  if (!down) return moves;
  const vx = -uy * down,
    vy = ux * down;
  const along = (point: Point) => point.x * width * ux + point.y * height * uy;
  const vertical = (point: Point) => point.x * width * vx + point.y * height * vy;
  const short = Math.min(width, height);
  const span = (points: Point[], projection: (point: Point) => number) => {
    const values = points.map(projection);
    return Math.max(...values) - Math.min(...values);
  };
  const faceWidth = span(oval, along),
    faceHeight = span(oval, vertical);
  if (faceWidth < 15 || faceHeight < 18) return moves;
  const offset = (point: Point, dx: number, dy: number) => ({
    x: point.x + (ux * dx + vx * dy) / width,
    y: point.y + (uy * dx + vy * dy) / height,
  });
  const mark = (index: number) => target.landmarks[index];
  const add = (
    id: string,
    from: Point | undefined,
    dx: number,
    dy: number,
    radius: number,
    gain = 1,
    mode: FaceMove['mode'] = 'push',
  ) => {
    if (!visible(from) || radius < 1.5) return;
    const to = offset(from, dx, dy);
    if (!visible(to)) return;
    const entries = moves.get(id) ?? [];
    entries.push({ from, to, radius: radius / short, gain, mode });
    moves.set(id, entries);
  };
  const midpoint = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const middle = midpoint(left, right);
  // The projected nose-to-eye distances suppress the hidden side on a strong profile.
  const nose = mark(1);
  const noseMid = nose ? along(nose) : along(middle);
  for (const [eye, brow, side, mesh] of [
    [
      left,
      target.contours.leftBrow,
      -1,
      {
        mid: [454, 323, 361, 288],
        jaw: [288, 397, 365],
        lower: [379, 378, 400],
        cheek: 330,
        temple: 356,
        nose: [327, 326],
        corner: 291,
      },
    ],
    [
      right,
      target.contours.rightBrow,
      1,
      {
        mid: [234, 93, 132, 58],
        jaw: [58, 172, 136],
        lower: [150, 149, 176],
        cheek: 101,
        temple: 127,
        nose: [98, 97],
        corner: 61,
      },
    ],
  ] as const) {
    const visibility = Math.min(
      1,
      Math.max(0, (Math.abs(along(eye) - noseMid) / eyeDistance - 0.12) / 0.28),
    );
    if (visibility < 0.12) continue;
    for (const [i, point] of mesh.mid.entries()) {
      add(
        'faceSlim',
        mark(point),
        -side * faceWidth * 0.053,
        0,
        faceWidth * 0.25,
        visibility * [0.4, 0.82, 0.78, 0.49][i]!,
      );
      add(
        'faceNarrow',
        mark(point),
        -side * faceWidth * 0.055,
        0,
        faceWidth * 0.26,
        visibility * [0.82, 0.58, 0.26, 0.1][i]!,
      );
    }
    for (const [i, point] of mesh.jaw.entries())
      add(
        'jaw',
        mark(point),
        -side * faceWidth * 0.045,
        -faceHeight * 0.009,
        faceWidth * 0.21,
        visibility * [0.4, 0.75, 0.5][i]!,
      );
    for (const [i, point] of mesh.lower.entries())
      add(
        'vFace',
        mark(point),
        -side * faceWidth * 0.053,
        -faceHeight * 0.004,
        faceWidth * 0.18,
        visibility * [0.72, 0.5, 0.35][i]!,
      );
    add('cheekbones', mark(mesh.cheek), -side * faceWidth * 0.042, 0, faceWidth * 0.2, visibility);
    add('temples', mark(mesh.temple), side * faceWidth * 0.036, 0, faceWidth * 0.19, visibility);
    if (brow?.length) {
      const height = span(brow, vertical);
      const width = span(brow, along);
      if (height > 1 && width > 4)
        add(
          'browThickness',
          center(brow),
          0,
          0,
          Math.min(width * 0.54, height * 1.65),
          0.54 * visibility,
          'bulge',
        );
    }
    for (const [i, index] of mesh.nose.entries()) {
      const wing = mark(index);
      if (!nose || !wing) continue;
      const noseSpan = Math.abs(along(wing) - along(nose));
      if (noseSpan >= 1.6 && noseSpan <= eyeDistance * 0.46)
        add(
          'noseWidth',
          wing,
          -side * noseSpan * 0.18,
          0,
          noseSpan * 1.12,
          visibility * (i === 0 ? 0.85 : 0.42),
        );
    }
    const lipWidth = span(lips, along);
    if (lipWidth >= 7)
      add('smile', mark(mesh.corner), 0, -lipWidth * 0.065, lipWidth * 0.29, visibility);
  }
  const chin = mark(152);
  add('chin', chin, 0, faceHeight * 0.06, faceWidth * 0.28, 0.9);
  for (const index of [148, 377])
    add('chin', mark(index), 0, faceHeight * 0.027, faceWidth * 0.2, 0.5);
  for (const index of [10, 109, 338])
    add(
      'forehead',
      mark(index),
      0,
      -faceHeight * 0.045,
      faceWidth * 0.27,
      index === 10 ? 0.9 : 0.42,
    );
  add('faceSmall', center(oval), 0, 0, faceWidth * 0.72, 0.4, 'pinch');
  const base = mark(2),
    bridge = mark(168);
  if (base && bridge) {
    const length = vertical(base) - vertical(bridge);
    if (length >= 4 && length < faceHeight * 0.55) {
      add('noseTip', nose, 0, length * 0.11, length * 0.48, 0.9);
      add('noseLength', base, 0, length * 0.18, length * 0.6, 0.9);
      add('noseLength', nose, 0, length * 0.11, length * 0.43, 0.58);
    }
  }
  return moves;
}
