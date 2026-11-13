import { smoothCurveSegments } from './curves.js';
import type { Dimensions, Point } from './types.js';
import type { FaceContourV3 } from './v3-types.js';

function contourFrame(contour: FaceContourV3, dimensions: Dimensions) {
  const x = contour.center.x * dimensions.width;
  const y = contour.center.y * dimensions.height;
  const angle = (contour.axis * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const short = Math.min(dimensions.width, dimensions.height);
  const top = contour.rows[0]!.y * short;
  const bottom = contour.rows.at(-1)!.y * short;
  const widest = Math.max(...contour.rows.map((row) => row.right - row.left)) * short;
  return { x, y, cos, sin, short, top, bottom, padding: widest * 0.23 };
}

export function faceContourBounds(contour: FaceContourV3, dimensions: Dimensions) {
  const { x, y, cos, sin, short, top, bottom, padding } = contourFrame(contour, dimensions);
  const left =
    Math.min(...contour.rows.map((row) => row.left - Math.abs(row.leftShift))) * short - padding;
  const right =
    Math.max(...contour.rows.map((row) => row.right + Math.abs(row.rightShift))) * short + padding;
  const corners = [top, bottom].flatMap((v) =>
    [left, right].map((u) => ({ x: x + u * cos - v * sin, y: y + u * sin + v * cos })),
  );
  return {
    left: Math.min(...corners.map((p) => p.x)),
    right: Math.max(...corners.map((p) => p.x)),
    top: Math.min(...corners.map((p) => p.y)),
    bottom: Math.max(...corners.map((p) => p.y)),
  };
}

const columns = ['left', 'right', 'leftCore', 'rightCore', 'leftShift', 'rightShift'] as const;
const samples = 192;

const ease = (v: number) => {
  const t = Math.max(0, Math.min(1, v));
  return t * t * (3 - 2 * t);
};

/** Inverse horizontal displacement along the observed contour, in face axes.
 * The middle of each row stays fixed. The inner and outer ramps meet at the
 * edited silhouette with zero slope and never translate an entire background. */
export function compileFaceContour(contour: FaceContourV3, dimensions: Dimensions) {
  const { x, y, cos, sin, short, top, bottom, padding } = contourFrame(contour, dimensions);
  const pitch = (bottom - top) / samples;
  const table = new Float64Array((samples + 1) * columns.length);
  for (const [column, key] of columns.entries()) {
    const segments = smoothCurveSegments(
      contour.rows.map((row) => [row.y * short, row[key] * short]),
    );
    let index = 0;
    for (let i = 0; i <= samples; i++) {
      const v = top + i * pitch;
      while (index < segments.length - 1 && v > segments[index + 1]!.x) index++;
      const segment = segments[index]!;
      const t = Math.max(0, Math.min(1, (v - segment.x) / segment.width));
      const s = 1 - t;
      table[i * columns.length + column] =
        s * s * (s * segment.from + 3 * t * segment.first) +
        t * t * (3 * s * segment.second + t * segment.to);
    }
  }
  return (sourceX: number, sourceY: number): Point => {
    const dx = sourceX - x;
    const dy = sourceY - y;
    const v = -dx * sin + dy * cos;
    if (v <= top || v >= bottom) return { x: sourceX, y: sourceY };
    const u = dx * cos + dy * sin;
    const row = (v - top) / pitch;
    const base = Math.min(samples - 1, Math.floor(row));
    const fraction = row - base;
    const at = base * columns.length;
    const value = (column: number) => {
      const first = table[at + column]!;
      return first + fraction * (table[at + columns.length + column]! - first);
    };
    const left = value(0);
    const right = value(1);
    const span = right - left;
    if (span <= 0 || u <= left - padding * 1.31 || u >= right + padding * 1.31)
      return { x: sourceX, y: sourceY };
    // Clamp between fitted rows as well so interpolated widths cannot cross.
    const coreLeft = Math.max(left + span * 0.15, Math.min(right - span * 0.15, value(2)));
    const coreRight = Math.max(coreLeft, Math.min(right - span * 0.15, value(3)));
    const shiftFor = (amount: number, room: number) => {
      const maximum = Math.min(span * 0.07, room * 0.22, padding * 0.22);
      return Math.max(-maximum, Math.min(maximum, amount));
    };
    let move = 0;
    if (u < coreLeft) {
      const shift = shiftFor(value(4), coreLeft - left);
      const edge = left + shift;
      move =
        -shift *
        (u < edge ? ease(1 - (edge - u) / padding) : ease((coreLeft - u) / (coreLeft - edge)));
    } else if (u > coreRight) {
      const shift = shiftFor(value(5), right - coreRight);
      const edge = right - shift;
      move =
        shift *
        (u > edge ? ease(1 - (u - edge) / padding) : ease((u - coreRight) / (edge - coreRight)));
    }
    return { x: sourceX + move * cos, y: sourceY + move * sin };
  };
}
