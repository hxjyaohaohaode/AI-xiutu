import {
  compileSelectionMaskV3,
  createRasterMask,
  MAX_RASTER_RUNS_PER_MASK,
  type Dimensions,
  type Point,
  type RGBAImage,
} from '@ai-xiutu/editor';
import { center, combine, polygon, unit } from './geometry.js';
import type { PortraitTarget } from './types.js';

type TargetParts = Pick<PortraitTarget, 'contours' | 'featureMasks'>;
type Bounds = PortraitTarget['bounds'];
type Sample = (p: Point) => number;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (n: number) => {
  const t = unit(n);
  return t * t * (3 - 2 * t);
};
const inFrame = (p: Point) => p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1;
const quantile = (values: number[], q: number) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)] ?? 0;
};
const distance = (a: Point, b: Point, size: Dimensions) =>
  Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height);
function signedDistance(p: Point, outline: Point[], size: Dimensions) {
  let inside = false,
    closest = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!,
      b = outline[(i + 1) % outline.length]!;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y))
      inside = !inside;
    const x = (p.x - a.x) * size.width,
      y = (p.y - a.y) * size.height;
    const dx = (b.x - a.x) * size.width,
      dy = (b.y - a.y) * size.height;
    const t = unit((x * dx + y * dy) / Math.max(1e-12, dx * dx + dy * dy));
    closest = Math.min(closest, (x - t * dx) ** 2 + (y - t * dy) ** 2);
  }
  return Math.sqrt(closest) * (inside ? 1 : -1);
}
function frame(target: PortraitTarget, size: Dimensions) {
  const { leftEye, rightEye, lips } = target.contours;
  if (!leftEye?.length || !rightEye?.length || !lips?.length) return;
  const a = center(leftEye),
    b = center(rightEye);
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const dx = (b.x - a.x) * size.width,
    dy = (b.y - a.y) * size.height;
  const span = Math.hypot(dx, dy);
  if (span < 7) return;
  let ux = dx / span,
    uy = dy / span;
  const mouth = center(lips);
  if ((mouth.y - middle.y) * size.height * ux < (mouth.x - middle.x) * size.width * uy) {
    ux = -ux;
    uy = -uy;
  }
  const local = (p: Point) => ({
    x: ((p.x - middle.x) * size.width * ux + (p.y - middle.y) * size.height * uy) / span,
    y: ((p.y - middle.y) * size.height * ux - (p.x - middle.x) * size.width * uy) / span,
  });
  const point = (x: number, y: number) => ({
    x: middle.x + ((x * ux - y * uy) * span) / size.width,
    y: middle.y + ((x * uy + y * ux) * span) / size.height,
  });
  return { local, point, span };
}
type FaceFrame = NonNullable<ReturnType<typeof frame>>;
function slice(poly: Point[], at: number, axis: 'x' | 'y') {
  const other = axis === 'x' ? 'y' : 'x',
    hits: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!,
      b = poly[(i + 1) % poly.length]!;
    if (a[axis] > at !== b[axis] > at)
      hits.push(lerp(a[other], b[other], (at - a[axis]) / (b[axis] - a[axis])));
  }
  return hits.length >= 2 ? ([Math.min(...hits), Math.max(...hits)] as const) : undefined;
}
function color(image: RGBAImage, p: Point) {
  if (!inFrame(p)) return;
  const at = (Math.floor(p.y * image.height) * image.width + Math.floor(p.x * image.width)) * 4;
  if (image.data[at + 3]! < 230) return;
  const r = image.data[at]! / 255,
    g = image.data[at + 1]! / 255,
    b = image.data[at + 2]! / 255;
  return { y: 0.2126 * r + 0.7152 * g + 0.0722 * b, r, g, b };
}
const lightness = (image: RGBAImage, p: Point) => color(image, p)?.y;
function crop(size: Dimensions, points: Point[], cap: number, margin = 1) {
  const x = Math.max(0, Math.floor(Math.min(...points.map((p) => p.x * size.width)) - margin));
  const y = Math.max(0, Math.floor(Math.min(...points.map((p) => p.y * size.height)) - margin));
  const w =
    Math.min(size.width, Math.ceil(Math.max(...points.map((p) => p.x * size.width)) + margin)) - x;
  const h =
    Math.min(size.height, Math.ceil(Math.max(...points.map((p) => p.y * size.height)) + margin)) -
    y;
  if (w <= 0 || h <= 0) return;
  const scale = Math.min(1, cap / Math.max(w, h));
  const width = Math.max(1, Math.ceil(w * scale)),
    height = Math.max(1, Math.ceil(h * scale));
  const bounds = {
    x: x / size.width,
    y: y / size.height,
    width: w / size.width,
    height: h / size.height,
  };
  const at = (index: number) => ({
    x: bounds.x + (((index % width) + 0.5) / width) * bounds.width,
    y: bounds.y + ((Math.floor(index / width) + 0.5) / height) * bounds.height,
  });
  return { width, height, bounds, at, cell: Math.max(w / width, h / height) };
}
function localRaster(grid: NonNullable<ReturnType<typeof crop>>, pixels: Uint8Array) {
  if (!pixels.some((p) => p > 0)) return;
  const count = (bytes: Uint8Array) =>
    bytes.reduce((sum, value, i) => sum + Number(!i || value !== bytes[i - 1]), 0);
  let weights = pixels;
  if (count(weights) > MAX_RASTER_RUNS_PER_MASK)
    weights = Uint8Array.from(weights, (v) => Math.round(v / 51) * 51);
  if (count(weights) > MAX_RASTER_RUNS_PER_MASK) return;
  return createRasterMask(grid.width, grid.height, weights, false, {
    bounds: grid.bounds,
    sampling: 'bilinear-v1',
  });
}

/** Use source-pixel samples in the oral aperture, with a local contrast
 * threshold and connected arch support. A tongue or one reflection cannot
 * enable the control, even when it is as bright as the teeth. */
export function toothArch(image: RGBAImage, target: PortraitTarget, axes = frame(target, image)) {
  const outline = target.contours.innerLips;
  if (!axes || !outline || outline.length < 6) return;
  const oral = outline.map(axes.local);
  const xs = oral.map((p) => p.x);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    span = right - left;
  if (span * axes.span < 12 || oral.some((p) => !Number.isFinite(p.x + p.y))) return;
  const aperture = slice(oral, (left + right) / 2, 'x');
  if (!aperture || (aperture[1] - aperture[0]) * axes.span < 3.4) return;
  const grid = crop(image, outline, 112);
  if (!grid) return;
  const samples: {
    index: number;
    x: number;
    depth: number;
    clearance: number;
    luma: number;
    neutral: number;
  }[] = [];
  const { width, height } = grid;
  for (let index = 0; index < width * height; index++) {
    const point = grid.at(index),
      p = axes.local(point);
    const limits = slice(oral, p.x, 'x');
    if (!limits || p.y <= limits[0] || p.y >= limits[1]) continue;
    const clearance = signedDistance(point, outline, image);
    if (clearance <= Math.max(0.35, grid.cell * 0.35)) continue;
    const pixel = color(image, point);
    if (!pixel) continue;
    const { r, g, b, y } = pixel;
    const red = smooth((0.26 - (r - g)) / 0.15) * smooth((0.25 - (r - (g + b) / 2)) / 0.14);
    const tint = smooth((0.42 - (Math.max(r, g, b) - Math.min(r, g, b))) / 0.19);
    samples.push({
      index,
      x: (p.x - left) / span,
      depth: (p.y - limits[0]) / (limits[1] - limits[0]),
      clearance,
      luma: y,
      neutral: red * tint,
    });
  }
  if (samples.length < 17) return;
  const dark = quantile(
    samples.map((p) => p.luma),
    0.22,
  );
  const plausible = samples.filter((p) => p.neutral >= 0.46);
  const bright = quantile(
    plausible.map((p) => p.luma),
    0.85,
  );
  if (bright < 0.36 || bright - dark < 0.09) return;
  const weights = new Float32Array(width * height);
  const byIndex = new Map(samples.map((p) => [p.index, p]));
  for (const p of plausible) {
    const contrast = smooth(
      (p.luma - Math.max(0.245, dark + 0.048)) / Math.max(0.075, (bright - dark) * 0.68),
    );
    weights[p.index] =
      contrast * p.neutral * smooth((p.clearance - 0.22) / Math.max(0.7, grid.cell * 0.64));
  }
  const visited = new Uint8Array(weights.length),
    result = new Uint8Array(weights.length);
  for (const seed of plausible) {
    if (visited[seed.index] || weights[seed.index]! < 0.33) continue;
    const cluster = [seed.index];
    visited[seed.index] = 1;
    for (let cursor = 0; cursor < cluster.length; cursor++) {
      const i = cluster[cursor]!,
        x = i % width;
      for (const j of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, i - width, i + width]) {
        if (j < 0 || j >= weights.length || visited[j] || weights[j]! < 0.33) continue;
        visited[j] = 1;
        cluster.push(j);
      }
    }
    const part = cluster.map((i) => byIndex.get(i)!);
    const across = part.map((p) => p.x);
    const strong = cluster.filter((i) => weights[i]! >= 0.65).length;
    const edge = quantile(
      part.map((p) => p.depth),
      0.22,
    );
    const lowerEdge = quantile(
      part.map((p) => p.depth),
      0.78,
    );
    const upper = edge <= 0.48;
    const lower = lowerEdge >= 0.79 && edge >= 0.48;
    if (
      (!upper && !lower) ||
      Math.max(...across) - Math.min(...across) < (upper ? 0.22 : 0.29) ||
      strong < Math.max(4, samples.length * 0.037) ||
      cluster.length > samples.length * 0.93
    )
      continue;
    for (const i of cluster) {
      const p = byIndex.get(i)!;
      const depth = upper ? 1 - 0.45 * smooth((p.depth - 0.66) / 0.27) : 0.78;
      result[i] = Math.round(smooth((weights[i]! - 0.29) / 0.61) * depth * 15) * 17;
    }
  }
  const mask = localRaster(grid, result);
  return mask ? combine('intersection', [mask, polygon(outline, 0)]) : undefined;
}

function pupil(
  image: RGBAImage,
  eye: Point[],
  centers: { point: Point; radius: number }[],
  occlusion?: Sample,
) {
  if (eye.length < 6) return;
  const prior = centers.find(
    ({ point, radius }) => radius >= 3.1 && signedDistance(point, eye, image) > radius * 0.32,
  );
  if (!prior) return;
  const step = Math.max(0.6, prior.radius * 0.13),
    radius = prior.radius;
  const offset = (p: Point, x: number, y: number) => ({
    x: p.x + x / image.width,
    y: p.y + y / image.height,
  });
  const directions = Array.from({ length: 16 }, (_, i) => {
    const angle = (i * Math.PI) / 8;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  let best: { center: Point; radius: number; score: number } | undefined;
  for (const dx of [-step, 0, step])
    for (const dy of [-step, 0, step]) {
      const candidate = offset(prior.point, dx, dy);
      if ((occlusion?.(candidate) ?? 0) > 0.48) continue;
      const clearance = signedDistance(candidate, eye, image);
      for (const ratio of [0.28, 0.36, 0.44, 0.52, 0.6, 0.68]) {
        const core = radius * ratio;
        if (core < 1.15 || clearance < core * 1.12) continue;
        const contrast: number[] = [];
        const cores: number[] = [];
        const hit: Point[] = [];
        for (const direction of directions) {
          const at = (r: number) => offset(candidate, r * direction.x, r * direction.y);
          const outside = at(Math.min(radius * 0.93, core + radius * 0.22));
          const inside = at(core * 0.65);
          if (signedDistance(outside, eye, image) < 0.32 || (occlusion?.(outside) ?? 0) > 0.48)
            continue;
          const a = lightness(image, inside),
            b = lightness(image, outside);
          if (a === undefined || b === undefined) continue;
          cores.push(a);
          contrast.push(b - a);
          if (b - a >= 0.045) hit.push(direction);
        }
        // Reject crescent-shaped iris estimates, eyelashes and one-sided glare.
        if (
          contrast.length < 9 ||
          hit.length < 7 ||
          !hit.some((p) => p.x > 0.5) ||
          !hit.some((p) => p.x < -0.5) ||
          !hit.some((p) => p.y > 0.5) ||
          !hit.some((p) => p.y < -0.5)
        )
          continue;
        const median = quantile(contrast, 0.5);
        const score =
          median * 0.7 + quantile(contrast, 0.32) * 0.3 - (Math.hypot(dx, dy) / radius) * 0.06;
        if (median < 0.063 || score < 0.044 || quantile(cores, 0.62) > 0.53) continue;
        if (!best || score > best.score) best = { center: candidate, radius: core, score };
      }
    }
  if (!best) return;
  // A pair stores the detected center and physical radius, rather than an
  // invented eye width or a second copy of the MediaPipe iris ring.
  return [best.center, offset(best.center, best.radius, 0)].filter(inFrame);
}

function nostrilPixels(image: RGBAImage, target: PortraitTarget, axes: FaceFrame) {
  const { landmarks } = target;
  const masks = [];
  const points: Point[] = [];
  for (const [outerId, innerId, roofId] of [
    [98, 97, 79],
    [327, 326, 309],
  ] as const) {
    const outer = landmarks[outerId],
      inner = landmarks[innerId],
      roof = landmarks[roofId];
    if (!outer || !inner || !roof || ![outer, inner, roof].every(inFrame)) continue;
    const span = distance(outer, inner, image);
    if (span < 4 || span > axes.span * 0.3) continue;
    const [a, b, c] = [outer, inner, roof].map(axes.local) as [Point, Point, Point];
    const cx = lerp(a.x, b.x, 0.53),
      cy = lerp(lerp(a.y, b.y, 0.45), c.y, 0.35);
    const rx = Math.abs(b.x - a.x) * 0.66;
    const ry = Math.max(rx * 0.54, Math.abs(c.y - (a.y + b.y) / 2) * 1.4);
    if (rx < 0.011 || ry > rx * 1.35) continue;
    const support = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ].map(([x, y]) => axes.point(cx + x! * rx, cy + y! * ry));
    if (support.some((p) => !inFrame(p))) continue;
    const grid = crop(image, support, 38);
    if (!grid) continue;
    const samples = [];
    const shell = [];
    for (let index = 0; index < grid.width * grid.height; index++) {
      const p = grid.at(index),
        q = axes.local(p);
      const radial = Math.hypot((q.x - cx) / rx, (q.y - cy) / ry);
      const pixel = color(image, p);
      if (!pixel || radial > 1.34) continue;
      if (radial >= 0.82) shell.push(pixel.y);
      if (radial < 1) samples.push({ index, p, radial, y: pixel.y });
    }
    if (samples.length < 9 || shell.length < 7) continue;
    const lo = quantile(
      samples.filter((p) => p.radial < 0.72).map((p) => p.y),
      0.22,
    );
    const hi = quantile(shell, 0.54);
    if (hi - lo < Math.max(0.07, hi * 0.18)) continue;
    const core = samples.filter((p) => p.radial < 0.85 && p.y < lo + (hi - lo) * 0.32);
    if (core.length < 3 || core.length > samples.length * 0.6) continue;
    const q = center(core.map((p) => p.p));
    if (!inFrame(q)) continue;
    const result = new Uint8Array(grid.width * grid.height);
    for (const { index, radial, y } of samples) {
      const alpha =
        smooth((hi - y - 0.025) / Math.max(0.045, (hi - lo) * 0.7)) * smooth((1 - radial) / 0.39);
      result[index] = Math.round(alpha * 15) * 17;
    }
    const mask = localRaster(grid, result);
    if (mask) {
      masks.push(mask);
      points.push(q);
    }
  }
  return { points, mask: masks.length ? combine('union', masks) : undefined };
}

export function analyzeFacePixels(image: RGBAImage, target: PortraitTarget): TargetParts {
  const contours: PortraitTarget['contours'] = {};
  const featureMasks: NonNullable<PortraitTarget['featureMasks']> = {};
  const axes = frame(target, image);
  if (!axes) return { contours, featureMasks };
  const teeth = toothArch(image, target, axes);
  if (teeth) featureMasks.teeth = teeth;
  const protectedAt = target.featureMasks?.accessories
    ? compileSelectionMaskV3(target.featureMasks.accessories, image)
    : undefined;
  const centers = [468, 473].flatMap((i) => {
    const point = target.landmarks[i],
      ring = target.landmarks.slice(i + 1, i + 5);
    if (!point || ring.length < 4 || !inFrame(point)) return [];
    const radii = ring.map((p) => distance(point, p, image));
    if (Math.max(...radii) > Math.min(...radii) * 2.4) return [];
    return [{ point, radius: quantile(radii, 0.5) }];
  });
  for (const side of ['left', 'right'] as const) {
    const eye = target.contours[side + 'Eye'];
    if (eye?.length && protectedAt) {
      const p = center(eye);
      const visibleEdge = [p, ...eye];
      // A frame or lens glare can supply a convincing radial contrast.
      if (visibleEdge.filter((q) => protectedAt(q.x, q.y) > 0.44).length >= 3) continue;
    }
    const found = eye && pupil(image, eye, centers, protectedAt && ((p) => protectedAt(p.x, p.y)));
    if (found?.length === 2) contours[side + 'Pupil'] = found;
  }
  const nostrils = nostrilPixels(image, target, axes);
  if (nostrils.mask) {
    featureMasks.nostrils = nostrils.mask;
    contours.nostrilCenters = nostrils.points;
  }
  return { contours, featureMasks };
}

/** Confidence maps are sampled while the MediaPipe callback still owns them.
 * Hairline needs hair on one side and forehead on the other. A crown
 * contour needs real background beyond the hair, even for a dark hairstyle. */
export function analyzeHeadBoundaries(
  target: PortraitTarget,
  size: Dimensions,
  window: Bounds,
  sample: (index: 0 | 1 | 2 | 3 | 5, p: Point) => number,
  otherFaces: readonly Bounds[] = [],
): PortraitTarget['contours'] {
  const axes = frame(target, size),
    oval = target.contours.oval;
  if (!axes || !oval?.length || axes.span < 15) return {};
  const outline = oval.map(axes.local);
  const brow = [...(target.contours.leftBrow ?? []), ...(target.contours.rightBrow ?? [])].map(
    axes.local,
  );
  const edge = Math.min(...outline.map((p) => p.y));
  const forehead = brow.length ? Math.min(...brow.map((p) => p.y)) - 0.085 : -0.28;
  const safe = (p: Point) =>
    inFrame(p) &&
    p.x > window.x + 0.006 * window.width &&
    p.x < window.x + 0.994 * window.width &&
    p.y > window.y + 0.006 * window.height &&
    p.y < window.y + 0.994 * window.height &&
    !otherFaces.some(
      (b) =>
        p.x > b.x - b.width * 0.13 &&
        p.x < b.x + b.width * 1.13 &&
        p.y > b.y - b.height * 0.3 &&
        p.y < b.y + b.height * 1.08,
    );
  const hair: Point[] = [],
    crown: Point[] = [];
  const rows = [-0.7, -0.47, -0.23, 0, 0.23, 0.47, 0.7];
  const step = Math.max(0.025, 0.65 / axes.span);
  for (const x of rows) {
    let supported = 0;
    for (let y = edge - 0.52; y < forehead; y += step) {
      const p = axes.point(x, y),
        ahead = axes.point(x, y + step * 2),
        behind = axes.point(x, y - step * 2);
      if (![p, ahead, behind].every(safe)) {
        supported = 0;
        continue;
      }
      if (sample(1, behind) > 0.57) supported++;
      else if (sample(1, p) < 0.42) supported = 0;
      if (
        supported >= 2 &&
        sample(1, p) < 0.47 &&
        sample(3, p) > 0.35 &&
        sample(3, ahead) > 0.55 &&
        sample(1, ahead) < 0.33 &&
        sample(5, p) < 0.36
      ) {
        hair.push({ x, y });
        break;
      }
    }
    for (let y = edge - 0.18; y > edge - 1.55; y -= step) {
      const inside = axes.point(x, y + step * 3),
        p = axes.point(x, y),
        outside = axes.point(x, y - step * 3);
      if (![inside, p, outside].every(safe)) continue;
      if (
        sample(1, inside) > 0.66 &&
        sample(1, p) < 0.52 &&
        sample(0, p) > 0.27 &&
        sample(0, outside) > 0.63 &&
        sample(1, outside) < 0.27
      ) {
        crown.push({ x, y });
        break;
      }
    }
  }
  const adjacent = (points: Point[], maxJump: number, minimum: number) => {
    let best: Point[] = [],
      run: Point[] = [];
    for (const p of points) {
      const last = run.at(-1);
      if (last && (Math.abs(p.y - last.y) > maxJump || p.x - last.x > 0.48)) run = [];
      run.push(p);
      if (run.length > best.length) best = run.slice();
    }
    return best.length >= minimum ? best.map((p) => axes.point(p.x, p.y)) : [];
  };
  const contours: PortraitTarget['contours'] = {};
  const hairline = adjacent(hair, 0.22, 3),
    hairCrown = adjacent(crown, 0.28, 4);
  if (hairline.length) contours.hairline = hairline;
  if (hairCrown.length) contours.hairCrown = hairCrown;
  for (const side of [-1, 1]) {
    const band: { y: number; edge: number; protrusion: number }[] = [];
    for (let y = -0.04; y <= 0.7; y += 0.075) {
      const limits = slice(outline, y, 'y');
      if (!limits) continue;
      const x = side < 0 ? limits[0] : limits[1];
      const observed = (p: Point) => Math.max(sample(2, p), sample(3, p));
      let beyond = 0,
        gap = 0;
      for (let d = 0; d < 0.49; d += step) {
        const p = axes.point(x + side * d, y);
        if (!safe(p)) break;
        if (observed(p) > 0.47 && sample(1, p) < 0.48 && sample(5, p) < 0.42) {
          beyond = d;
          gap = 0;
        } else if (++gap >= 2) break;
      }
      const outer = axes.point(x + side * (beyond + step * 3), y);
      if (
        beyond >= 0.08 &&
        beyond <= 0.37 &&
        safe(outer) &&
        observed(outer) < 0.32 &&
        Math.max(sample(0, outer), sample(1, outer)) > 0.47
      )
        band.push({ y, edge: x + side * beyond, protrusion: beyond });
    }
    if (band.length < 3) continue;
    const peak = band.reduce((a, b) => (a.protrusion > b.protrusion ? a : b));
    const near = band.filter(
      (p) => Math.abs(p.y - peak.y) <= 0.235 && Math.abs(p.edge - peak.edge) < 0.24,
    );
    if (
      near.length < 3 ||
      peak.y < 0.025 ||
      peak.y > 0.54 ||
      Math.max(...near.map((p) => p.y)) - Math.min(...near.map((p) => p.y)) < 0.14 ||
      peak.protrusion < Math.max(0.11, step * 3)
    )
      continue;
    const top = near[0]!,
      bottom = near.at(-1)!;
    const p = axes.point(
      peak.edge - side * peak.protrusion * 0.32,
      (top.y + bottom.y + peak.y) / 3,
    );
    const outlinePoints = [
      p,
      axes.point(top.edge, top.y),
      axes.point(peak.edge, peak.y),
      axes.point(bottom.edge, bottom.y),
    ];
    if (outlinePoints.every(safe)) contours[side < 0 ? 'earA' : 'earB'] = outlinePoints;
  }
  return contours;
}
