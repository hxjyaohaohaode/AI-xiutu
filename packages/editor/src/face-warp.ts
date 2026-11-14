import type { Dimensions, Point } from './types.js';
import type { FaceContourV3, FaceWarpAnchorV3 } from './v3-types.js';
import { compileFaceContour, faceContourBounds } from './face-contour.js';

function movingAnchors(anchors: FaceWarpAnchorV3[], dimensions: Dimensions) {
  const short = Math.min(dimensions.width, dimensions.height);
  return anchors
    .filter((anchor) => anchor.strength !== 0)
    .map((anchor) => {
      const x = anchor.from.x * dimensions.width;
      const y = anchor.from.y * dimensions.height;
      const radius = anchor.radius * short;
      const dx = (anchor.to.x - anchor.from.x) * dimensions.width;
      const dy = (anchor.to.y - anchor.from.y) * dimensions.height;
      const scale = Math.min(1, (radius * 0.24) / Math.max(1e-12, Math.hypot(dx, dy)));
      const affine = anchor.affine;
      const angle = ((affine?.axis ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle),
        sin = Math.sin(angle);
      const radiusY = affine ? affine.radiusY * short : radius;
      const rotation = ((affine?.rotation ?? 0) * Math.PI) / 180;
      const inverseX = 1 / (affine?.scaleX ?? 1);
      const inverseY = 1 / (affine?.scaleY ?? 1);
      const inverseCos = Math.cos(rotation),
        inverseSin = Math.sin(rotation);
      return {
        x,
        y,
        radius,
        radiusY,
        cos,
        sin,
        extentX: Math.hypot(cos * radius, sin * radiusY),
        extentY: Math.hypot(sin * radius, cos * radiusY),
        affine: affine
          ? {
              inverseX,
              inverseY,
              inverseCos,
              inverseSin,
              support: Math.min(
                1,
                (Math.abs(1 - inverseX) + Math.abs(1 - inverseY)) * 2.5 +
                  Math.abs(rotation) +
                  Math.hypot(dx, dy) / radius,
              ),
            }
          : undefined,
        dx: dx * scale,
        dy: dy * scale,
        mode: anchor.mode,
        strength: anchor.strength,
      };
    });
}

function constraintBounds(constraints: ReturnType<typeof movingAnchors>) {
  const active = constraints.filter((anchor) => anchor.mode !== 'pin');
  if (!active.length) return { left: 0, right: 0, top: 0, bottom: 0 };
  return {
    left: Math.min(...active.map((anchor) => anchor.x - anchor.extentX)),
    right: Math.max(...active.map((anchor) => anchor.x + anchor.extentX)),
    top: Math.min(...active.map((anchor) => anchor.y - anchor.extentY)),
    bottom: Math.max(...active.map((anchor) => anchor.y + anchor.extentY)),
  };
}

export function faceWarpBounds(anchors: FaceWarpAnchorV3[], dimensions: Dimensions) {
  return constraintBounds(movingAnchors(anchors, dimensions));
}

/** Sample contour and feature requests into one photo-space displacement grid.
 * Photograph edges and other subjects are soft pins in the solve itself, so
 * protection cannot introduce a new sharp gradient after the grid is fitted. */
export function compilePortraitWarp(
  anchors: FaceWarpAnchorV3[],
  contour: FaceContourV3 | undefined,
  dimensions: Dimensions,
  protection: (x: number, y: number) => number,
) {
  const detail = anchors.length ? compileFaceWarp(anchors, dimensions, true) : undefined;
  const outline = contour ? compileFaceContour(contour, dimensions) : undefined;
  const boxes = [
    ...(anchors.length ? [faceWarpBounds(anchors, dimensions)] : []),
    ...(contour ? [faceContourBounds(contour, dimensions)] : []),
  ];
  const left = Math.max(0, Math.min(...boxes.map((b) => b.left)));
  const right = Math.min(dimensions.width, Math.max(...boxes.map((b) => b.right)));
  const top = Math.max(0, Math.min(...boxes.map((b) => b.top)));
  const bottom = Math.min(dimensions.height, Math.max(...boxes.map((b) => b.bottom)));
  if (!(right > left && bottom > top)) return (x: number, y: number): Point => ({ x, y });
  const pitch = Math.max(0.45, Math.min(right - left, bottom - top) / 66);
  const cols = Math.min(144, Math.max(8, Math.ceil((right - left) / pitch) + 1));
  const rows = Math.min(144, Math.max(8, Math.ceil((bottom - top) / pitch) + 1));
  const stepX = (right - left) / (cols - 1), stepY = (bottom - top) / (rows - 1);
  const displacement = new Float64Array(cols * rows * 2);
  const mobility = new Float32Array(cols * rows);
  for (let row = 1; row < rows - 1; row++) {
    const y = top + row * stepY;
    for (let col = 1; col < cols - 1; col++) {
      const x = left + col * stepX;
      const middle = detail?.(x, y) ?? { x, y };
      const mapped = outline?.(middle.x, middle.y) ?? middle;
      const at = row * cols + col;
      const weight = 1 - Math.min(1, Math.max(0, protection(x / dimensions.width, y / dimensions.height)));
      mobility[at] = weight;
      displacement[at * 2] = (mapped.x - x) * weight;
      displacement[at * 2 + 1] = (mapped.y - y) * weight;
    }
  }
  // Local regularization has a stronger effect where protection cuts across
  // a requested movement. The source displacement remains the data term.
  const field = displacement.slice();
  const stride = 2 * cols;
  for (let pass = 0; pass < 3; pass++) {
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const at = row * cols + col, i = at * 2;
        const move = mobility[at]!;
        if (move < 0.01) continue;
        const mix = move * 0.21;
        for (let c = 0; c < 2; c++) {
          const p = i + c;
          const mean = (field[p - 2]! + field[p + 2]! + field[p - stride]! + field[p + stride]!) * 0.25;
          field[p] = displacement[p]! * (1 - mix) + mean * mix;
        }
      }
    }
  }
  // Relieve high strain where it occurs before applying a global bound. A
  // narrow pin at the cheek or jaw must not flatten the distant eye movement.
  const limit = 0.72;
  let safe = derivativeScale(field, cols, rows, stepX, stepY, limit);
  if (safe < 1) {
    constrainContour(field, cols, rows, stepX, stepY, limit, mobility);
    safe = derivativeScale(field, cols, rows, stepX, stepY, limit);
  }
  return (x: number, y: number): Point => {
    if (x <= left || x >= right || y <= top || y >= bottom) return { x, y };
    const u = (x - left) / stepX, v = (y - top) / stepY;
    const col = Math.min(cols - 2, Math.floor(u)), row = Math.min(rows - 2, Math.floor(v));
    const fx = u - col, fy = v - row, index = (row * cols + col) * 2;
    const movement = Math.min(1, (1 - protection(x / dimensions.width, y / dimensions.height)) * 3);
    const sample = (at: number) =>
      ((field[at]! * (1 - fx) + field[at + 2]! * fx) * (1 - fy) +
        (field[at + stride]! * (1 - fx) + field[at + stride + 2]! * fx) * fy) * safe * movement;
    return { x: x + sample(index), y: y + sample(index + 1) };
  };
}

function derivativeScale(
  field: Float64Array,
  cols: number,
  rows: number,
  stepX: number,
  stepY: number,
  limit: number,
) {
  // Bound the derivative within each bilinear cell by its parallel edge slopes.
  const stride = cols * 2;
  const slopeSquared = (a: number, b: number, step: number) =>
    ((field[b]! - field[a]!) ** 2 + (field[b + 1]! - field[a + 1]!) ** 2) / (step * step);
  let gradientSquared = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = (row * cols + col) * 2;
      const b = a + 2;
      const c = a + stride;
      const d = c + 2;
      gradientSquared = Math.max(
        gradientSquared,
        Math.max(slopeSquared(a, b, stepX), slopeSquared(c, d, stepX)) +
          Math.max(slopeSquared(a, c, stepY), slopeSquared(b, d, stepY)),
      );
    }
  }
  return Math.min(1, limit / Math.sqrt(gradientSquared));
}

function constrainContour(
  field: Float64Array,
  cols: number,
  rows: number,
  stepX: number,
  stepY: number,
  limit: number,
  mobility?: Float32Array,
) {
  const stride = cols * 2;
  const project = (a: number, b: number, maximum: number, moveA: boolean, moveB: boolean) => {
    const du = field[b]! - field[a]!;
    const dv = field[b + 1]! - field[a + 1]!;
    const distanceSquared = du * du + dv * dv;
    if (distanceSquared <= maximum * maximum) return;
    const weightA = moveA ? (mobility?.[a / 2] ?? 1) : 0;
    const weightB = moveB ? (mobility?.[b / 2] ?? 1) : 0;
    if (weightA + weightB === 0) return;
    const fraction = (1 - maximum / Math.sqrt(distanceSquared)) / (weightA + weightB);
    if (weightA) {
      field[a]! += fraction * du * weightA;
      field[a + 1]! += fraction * dv * weightA;
    }
    if (weightB) {
      field[b]! -= fraction * du * weightB;
      field[b + 1]! -= fraction * dv * weightB;
    }
  };
  // Repair excessive strain in the affected neighborhood. Alternating sweeps
  // distribute it across the neighboring cells while the boundary stays fixed.
  const xLimit = stepX * limit * Math.SQRT1_2;
  const yLimit = stepY * limit * Math.SQRT1_2;
  for (let pass = 0; pass < 16; pass++) {
    const forward = pass % 2 === 0;
    for (let y = 1; y < rows - 1; y++) {
      const row = forward ? y : rows - 1 - y;
      for (let x = 1; x < cols - 1; x++) {
        const col = forward ? x : cols - 1 - x;
        const i = (row * cols + col) * 2;
        if (forward) {
          project(i - 2, i, xLimit, col > 1, true);
          project(i - stride, i, yLimit, row > 1, true);
        } else {
          project(i, i + 2, xLimit, true, col < cols - 2);
          project(i, i + stride, yLimit, true, row < rows - 2);
        }
      }
    }
  }
}

/** Compose contour changes and complete-feature transforms in one inverse map.
 * Store source-pixel displacements on a scale-independent grid for preview/export parity. */
export function compileFaceWarp(
  anchors: FaceWarpAnchorV3[], dimensions: Dimensions, singleField = false,
) {
  const constraints = movingAnchors(anchors, dimensions);
  const bounds = constraintBounds(constraints);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (!width || !height) return (x: number, y: number): Point => ({ x, y });

  const cells = singleField ? 48 : 64;
  const pitch = Math.min(width, height) / cells;
  const cols = Math.min(144, Math.max(cells + 1, Math.ceil(width / pitch) + 1));
  const rows = Math.min(144, Math.max(cells + 1, Math.ceil(height / pitch) + 1));
  const stepX = width / (cols - 1);
  const stepY = height / (rows - 1);
  const field = new Float64Array(cols * rows * 2);
  const hasContour = constraints.some((anchor) => !anchor.affine && anchor.mode !== 'pin');
  const featureField = constraints.some((anchor) => anchor.affine)
    ? new Float64Array(field.length)
    : null;
  for (let row = 1; row < rows - 1; row++) {
    const y = bounds.top + row * stepY;
    const active = constraints.filter((anchor) => Math.abs(y - anchor.y) < anchor.extentY);
    for (let col = 1; col < cols - 1; col++) {
      const x = bounds.left + col * stepX;
      let u = 0,
        v = 0,
        support = 0,
        pins = 0;
      let featureX = 0,
        featureY = 0,
        featureSupport = 0;
      for (const anchor of active) {
        const dx = x - anchor.x,
          dy = y - anchor.y;
        if (Math.abs(dx) >= anchor.extentX) continue;
        const affine = anchor.affine;
        if (affine) {
          const localX = dx * anchor.cos + dy * anchor.sin;
          const localY = -dx * anchor.sin + dy * anchor.cos;
          const r2 = (localX / anchor.radius) ** 2 + (localY / anchor.radiusY) ** 2;
          if (r2 >= 1) continue;
          const fade = Math.max(0, (r2 - 0.29) / 0.71);
          const weight = 1 - fade * fade * (3 - 2 * fade);
          const tx = localX - anchor.dx * anchor.cos - anchor.dy * anchor.sin;
          const ty = localY + anchor.dx * anchor.sin - anchor.dy * anchor.cos;
          const du = (tx * affine.inverseCos + ty * affine.inverseSin) * affine.inverseX - localX;
          const dv = (-tx * affine.inverseSin + ty * affine.inverseCos) * affine.inverseY - localY;
          const amount = weight * anchor.strength;
          featureX += (du * anchor.cos - dv * anchor.sin) * amount;
          featureY += (du * anchor.sin + dv * anchor.cos) * amount;
          featureSupport += Math.abs(amount) * affine.support;
          continue;
        }
        const radius2 = (dx * dx + dy * dy) / (anchor.radius * anchor.radius);
        if (radius2 >= 1) continue;
        const weight = (1 - radius2) ** 3;
        if (anchor.mode === 'pin') {
          pins += weight * anchor.strength * 7;
          continue;
        }
        const amount = weight * anchor.strength;
        support += weight * Math.abs(anchor.strength);
        if (anchor.mode === 'push') {
          u -= anchor.dx * amount;
          v -= anchor.dy * amount;
        } else if (anchor.mode === 'twirl') {
          const angle = -amount * Math.PI * 0.3;
          const c = Math.cos(angle) - 1;
          const s = Math.sin(angle);
          u += c * dx - s * dy;
          v += s * dx + c * dy;
        } else {
          const scale = (anchor.mode === 'pinch' ? 1 : -1) * amount * 0.36;
          u += dx * scale;
          v += dy * scale;
        }
      }
      const index = (row * cols + col) * 2;
      const denominator = Math.max(1, support * 0.82) + pins;
      field[index] = u / denominator;
      field[index + 1] = v / denominator;
      if (featureField) {
        const featureDenominator = Math.max(1, featureSupport * 0.82);
        featureField[index] = featureX / featureDenominator;
        featureField[index + 1] = featureY / featureDenominator;
      }
    }
  }
  // An eye or lip with tight support must never lower the strength of the
  // distant cheek or jaw. The combined displacement still has slope below one.
  let contourScale = hasContour ? derivativeScale(field, cols, rows, stepX, stepY, 0.45) : 1;
  if (contourScale < 1) {
    constrainContour(field, cols, rows, stepX, stepY, 0.45);
    contourScale = derivativeScale(field, cols, rows, stepX, stepY, 0.45);
  }
  const featureScale = featureField
    ? derivativeScale(featureField, cols, rows, stepX, stepY, 0.45)
    : 1;
  for (let i = 0; i < field.length; i++) {
    field[i] = field[i]! * contourScale + (featureField?.[i] ?? 0) * featureScale;
  }
  const rowStride = cols * 2;

  return (x: number, y: number): Point => {
    if (x <= bounds.left || x >= bounds.right || y <= bounds.top || y >= bounds.bottom)
      return { x, y };
    const u = (x - bounds.left) / stepX,
      v = (y - bounds.top) / stepY;
    const col = Math.min(cols - 2, Math.floor(u)),
      row = Math.min(rows - 2, Math.floor(v));
    const i = (row * cols + col) * 2;
    const fx = u - col,
      fy = v - row;
    const interpolate = (index: number) => {
      const a = field[index]! * (1 - fx) + field[index + 2]! * fx;
      const b = field[index + rowStride]! * (1 - fx) + field[index + rowStride + 2]! * fx;
      return a * (1 - fy) + b * fy;
    };
    return { x: x + interpolate(i), y: y + interpolate(i + 1) };
  };
}
