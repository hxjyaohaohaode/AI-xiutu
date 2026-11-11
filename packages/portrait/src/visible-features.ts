import {
  createRasterMask,
  type Point,
  type RGBAImage,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
import { center } from './geometry.js';
import type { PortraitTarget } from './types.js';

const unit = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const t = unit(n);
  return t * t * (3 - 2 * t);
};
function inside(p: Point, outline: Point[]) {
  let hit = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]!,
      b = outline[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y))
      hit = !hit;
  }
  return hit;
}
const dimensions = (source: { width: number; height: number }, edge: number) => {
  const scale = Math.min(1, edge / Math.max(source.width, source.height));
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
};
function boundedMask(
  grid: { width: number; height: number },
  values: Uint8Array,
): SelectionMaskV3 | undefined {
  if (!values.some((value) => value > 0)) return;
  try {
    return createRasterMask(grid.width, grid.height, values);
  } catch {
    return undefined;
  }
}

/** Candidate teeth pixels are constrained by the observed mouth aperture and local contrast. */
export function visibleTeeth(image: RGBAImage, target: PortraitTarget) {
  const outline = target.contours.innerLips ?? [];
  if (outline.length < 6) return;
  const minX = Math.min(...outline.map((p) => p.x)),
    maxX = Math.max(...outline.map((p) => p.x));
  const minY = Math.min(...outline.map((p) => p.y)),
    maxY = Math.max(...outline.map((p) => p.y));
  if ((maxX - minX) * image.width < 16 || (maxY - minY) * image.height < 5) return;
  const grid = dimensions(image, 256),
    values = new Uint8Array(grid.width * grid.height);
  const samples: { index: number; y: number; neutral: number }[] = [];
  for (
    let y = Math.max(0, Math.floor(minY * grid.height));
    y < Math.min(grid.height, Math.ceil(maxY * grid.height));
    y++
  ) {
    for (
      let x = Math.max(0, Math.floor(minX * grid.width));
      x < Math.min(grid.width, Math.ceil(maxX * grid.width));
      x++
    ) {
      const p = { x: (x + 0.5) / grid.width, y: (y + 0.5) / grid.height };
      if (!inside(p, outline)) continue;
      const at = (Math.floor(p.y * image.height) * image.width + Math.floor(p.x * image.width)) * 4;
      if (image.data[at + 3]! < 230) continue;
      const r = image.data[at]! / 255,
        g = image.data[at + 1]! / 255,
        b = image.data[at + 2]! / 255;
      samples.push({
        index: y * grid.width + x,
        y: 0.2126 * r + 0.7152 * g + 0.0722 * b,
        neutral:
          smooth((0.28 - (r - g)) / 0.14) *
          smooth((0.36 - (Math.max(r, g, b) - Math.min(r, g, b))) / 0.16),
      });
    }
  }
  if (samples.length < 12) return;
  const sorted = samples.map((p) => p.y).sort((a, b) => a - b);
  const dark = sorted[Math.floor(sorted.length * 0.18)]!;
  const bright = sorted[Math.floor(sorted.length * 0.88)]!;
  if (bright < 0.4 || bright - dark < 0.11) return;
  let strong = 0;
  for (const p of samples) {
    const weight =
      p.neutral *
      smooth((p.y - Math.max(0.27, dark + 0.045)) / Math.max(0.08, (bright - dark) * 0.68));
    values[p.index] = Math.round(weight * 15) * 17;
    if (weight > 0.7) strong++;
  }
  return strong >= Math.max(3, samples.length * 0.065) ? boundedMask(grid, values) : undefined;
}

/** The semantic accessories class is restricted to the observed binocular area. */
export function visibleEyeAccessories(
  probability: Float32Array,
  source: { width: number; height: number },
  target: PortraitTarget,
) {
  const left = center(target.contours.leftEye ?? []),
    right = center(target.contours.rightEye ?? []);
  const dx = (right.x - left.x) * source.width,
    dy = (right.y - left.y) * source.height;
  const distance = Math.hypot(dx, dy);
  if (!(distance >= 7)) return;
  const origin = { x: (left.x + right.x) * 0.5, y: (left.y + right.y) * 0.5 };
  const grid = dimensions(source, 224),
    values = new Uint8Array(grid.width * grid.height);
  let peak = 0,
    supported = 0;
  for (let y = 0; y < grid.height; y++)
    for (let x = 0; x < grid.width; x++) {
      const u = (x + 0.5) / grid.width,
        v = (y + 0.5) / grid.height;
      const a = (u - origin.x) * source.width,
        b = (v - origin.y) * source.height;
      const horizontal = (a * dx + b * dy) / (distance * distance);
      const vertical = (b * dx - a * dy) / (distance * distance);
      if (Math.abs(horizontal) > 0.98 || Math.abs(vertical) > 0.44) continue;
      const sx = Math.floor(u * source.width),
        sy = Math.floor(v * source.height);
      const at = sy * source.width + sx,
        direct = probability[at]!;
      if (!Number.isFinite(direct)) continue;
      const adjacent = Math.max(
        sx > 0 ? probability[at - 1]! : 0,
        sx + 1 < source.width ? probability[at + 1]! : 0,
        sy > 0 ? probability[at - source.width]! : 0,
        sy + 1 < source.height ? probability[at + source.width]! : 0,
      );
      const p = Math.max(direct, adjacent * 0.85);
      peak = Math.max(peak, direct);
      if (direct >= 0.32) supported++;
      values[y * grid.width + x] = Math.round(smooth((p - 0.12) / 0.32) * 15) * 17;
    }
  return peak >= 0.42 && supported >= 4 ? boundedMask(grid, values) : undefined;
}

type Edge = { start: number; end: number };
/** Screen-projected, z-buffered face mesh shading. Z is in MediaPipe's x units. */
export function visibleMeshLighting(
  target: PortraitTarget,
  source: { width: number; height: number },
  mesh: readonly Edge[],
) {
  if (target.bounds.width * source.width < 40 || target.bounds.height * source.height < 40) return;
  const grid = dimensions(source, 160);
  const geometry = target.landmarks.map((p) => ({
    x: p.x * grid.width,
    y: p.y * grid.height,
    z: (p.z ?? NaN) * grid.width,
  }));
  if (geometry.slice(0, 468).some((p) => !Number.isFinite(p.z))) return;
  const triangles: [number, number, number][] = [];
  const normals = geometry.map(() => [0, 0, 0]);
  for (let i = 0; i + 2 < mesh.length; i += 3) {
    const a = mesh[i]!,
      b = mesh[i + 1]!,
      c = mesh[i + 2]!;
    if (a.end !== b.start || b.end !== c.start || c.end !== a.start) continue;
    const ids: [number, number, number] = [a.start, b.start, c.start];
    const [p, q, r] = ids.map((index) => geometry[index]!);
    if (!p || !q || !r) continue;
    const ux = q.x - p.x,
      uy = q.y - p.y,
      uz = q.z - p.z;
    const vx = r.x - p.x,
      vy = r.y - p.y,
      vz = r.z - p.z;
    const nz = ux * vy - uy * vx;
    if (Math.abs(nz) < 1e-5) continue;
    // Normalize orientation to the viewer; later triangles win only when nearer.
    const sign = Math.sign(nz);
    for (const id of ids) {
      const n = normals[id]!;
      n[0]! += (uy * vz - uz * vy) * sign;
      n[1]! += (uz * vx - ux * vz) * sign;
      n[2]! += Math.abs(nz);
    }
    triangles.push(ids);
  }
  if (triangles.length < 300) return;
  const light = new Uint8Array(grid.width * grid.height),
    shade = new Uint8Array(light.length);
  const depths = new Float32Array(light.length).fill(Infinity);
  const terms = normals.map(
    ([x, y, z]) =>
      (0.64 * x! + 0.48 * y! + 0.25 * z!) / Math.max(1e-8, Math.hypot(x!, y!, z!)) - 0.25,
  );
  for (const [i, j, k] of triangles) {
    const p = geometry[i]!,
      q = geometry[j]!,
      r = geometry[k]!;
    const ax = q.x - p.x,
      ay = q.y - p.y,
      bx = r.x - p.x,
      by = r.y - p.y;
    const determinant = ax * by - ay * bx;
    for (
      let y = Math.max(0, Math.floor(Math.min(p.y, q.y, r.y)));
      y < Math.min(grid.height, Math.ceil(Math.max(p.y, q.y, r.y)));
      y++
    ) {
      for (
        let x = Math.max(0, Math.floor(Math.min(p.x, q.x, r.x)));
        x < Math.min(grid.width, Math.ceil(Math.max(p.x, q.x, r.x)));
        x++
      ) {
        const u = ((x + 0.5 - p.x) * by - (y + 0.5 - p.y) * bx) / determinant;
        const v = (ax * (y + 0.5 - p.y) - ay * (x + 0.5 - p.x)) / determinant;
        const w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;
        const depth = w * p.z + u * q.z + v * r.z,
          at = y * grid.width + x;
        if (depth >= depths[at]!) continue;
        depths[at] = depth;
        const value = w * terms[i]! + u * terms[j]! + v * terms[k]!;
        light[at] = Math.round(unit(value * 1.45) * 15) * 17;
        shade[at] = Math.round(unit(-value * 1.45) * 15) * 17;
      }
    }
  }
  const bright = boundedMask(grid, light),
    dark = boundedMask(grid, shade);
  return bright && dark ? { light: bright, shade: dark } : undefined;
}
