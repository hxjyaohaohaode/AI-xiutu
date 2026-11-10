import { blendRgbaV3 } from './v3-blend.js';
import { compileSelectionMaskV3 } from './v3-mask.js';
import { checkV3, sampleBilinearV3, clamp01 } from './v3-pixels.js';
import { MAX_V3_PAINT_INDEX_REFERENCES, MAX_V3_PAINT_WORK } from './v3-registry.js';
import type { PaintLayerV3, PaintStrokeV3, ImageLayerV3 } from './v3-types.js';
import type { RGBAImage, RenderOptions, Dimensions } from './types.js';

interface PreparedStroke {
  stroke: PaintStrokeV3;
  points: { x: number; y: number }[];
  radius: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  cellSize: number;
  columns: number;
  grid: Map<number, number[]>;
  ends: number[];
  radii?: number[];
}
interface PreparedLayer {
  layer: PaintLayerV3;
  prepared: PreparedStroke[];
}
interface PreparationBudget {
  references: number;
  work: number;
}
function prepare(
  stroke: PaintStrokeV3,
  image: Dimensions,
  options: RenderOptions,
  budget: PreparationBudget,
): PreparedStroke {
  const brushRadius = stroke.radius * Math.min(image.width, image.height),
    radius = brushRadius + (stroke.sampling?.antialias ? Math.SQRT1_2 : 0),
    points = stroke.points.map((p) => ({ x: p.x * image.width, y: p.y * image.height }));
  const radii = stroke.sampling?.pressure.map((pressure) => brushRadius * (0.2 + 0.8 * pressure));
  const breaks = new Set(stroke.sampling?.breaks);
  const ends: number[] = [];
  // Spatial bins avoid scanning a long freehand path for every covered pixel.
  const cellSize = Math.max(8, radius * 2),
    columns = Math.ceil(image.width / cellSize),
    rows = Math.ceil(image.height / cellSize),
    grid = new Map<number, number[]>();
  for (let i = 0; i < points.length; i++) {
    if ((i & 15) === 0) checkV3(options);
    const joinsNext = i + 1 < points.length && !breaks.has(i + 1);
    if (!joinsNext && i > 0 && !breaks.has(i)) continue;
    const end = joinsNext ? i + 1 : i;
    ends[i] = end;
    const a = points[i]!,
      b = points[end]!,
      steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / cellSize)),
      cells = new Set<number>();
    for (let k = 0; k <= steps; k++) {
      if ((k & 255) === 0) checkV3(options);
      const x = Math.floor((a.x + ((b.x - a.x) * k) / steps) / cellSize),
        y = Math.floor((a.y + ((b.y - a.y) * k) / steps) / cellSize);
      // Radius <= cellSize/2; adjacent bins cover the capsule and its interpolation between DDA samples.
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const cx = x + dx,
            cy = y + dy;
          if (cx >= 0 && cy >= 0 && cx < columns && cy < rows) cells.add(cy * columns + cx);
        }
    }
    for (const key of cells) {
      budget.references++;
      if (budget.references > MAX_V3_PAINT_INDEX_REFERENCES)
        throw new RangeError(
          'Paint spatial-index budget exceeded; reduce the path complexity or split into a new version',
        );
      const x = key % columns,
        y = Math.floor(key / columns);
      budget.work +=
        Math.ceil(Math.min(cellSize, image.width - x * cellSize)) *
        Math.ceil(Math.min(cellSize, image.height - y * cellSize)) *
        (stroke.sampling?.antialias ? 16 : 1);
      if (budget.work > MAX_V3_PAINT_WORK)
        throw new RangeError(
          'Paint workload budget exceeded; reduce the active stroke area or split into a new version',
        );
      const list = grid.get(key);
      if (list) list.push(i);
      else grid.set(key, [i]);
    }
  }
  return {
    stroke,
    points,
    radius: brushRadius,
    left: Math.min(...points.map((p) => p.x)) - radius,
    right: Math.max(...points.map((p) => p.x)) + radius,
    top: Math.min(...points.map((p) => p.y)) - radius,
    bottom: Math.max(...points.map((p) => p.y)) + radius,
    cellSize,
    columns,
    grid,
    ends,
    radii,
  };
}
/** Admission happens before image-sized intermediates and is bounded across all active layers. */
export function preparePaintLayersV3(
  layers: PaintLayerV3[],
  dimensions: Dimensions,
  options: RenderOptions,
): PreparedLayer[] {
  const budget: PreparationBudget = { references: 0, work: 0 };
  return layers
    .filter((layer) => layer.enabled && layer.opacity > 0 && layer.strokes.length > 0)
    .map((layer) => ({
      layer,
      prepared: layer.strokes
        .filter((stroke) => stroke.opacity > 0)
        .map((stroke) => prepare(stroke, dimensions, options, budget)),
    }))
    .filter((entry) => entry.prepared.length > 0);
}
function weight(p: PreparedStroke, x: number, y: number): number {
  if (x < p.left || x > p.right || y < p.top || y > p.bottom) return 0;
  let nearest = Infinity;
  const candidates =
    p.grid.get(Math.floor(y / p.cellSize) * p.columns + Math.floor(x / p.cellSize)) ?? [];
  if (p.radii) {
    if (!p.stroke.sampling!.antialias) return sweptCoverage(p, candidates, x, y) * p.stroke.opacity;
    let covered = 0;
    for (const dy of [-0.375, -0.125, 0.125, 0.375])
      for (const dx of [-0.375, -0.125, 0.125, 0.375])
        covered += sweptCoverage(p, candidates, x + dx, y + dy);
    return (covered / 16) * p.stroke.opacity;
  }
  for (const i of candidates) {
    const a = p.points[i]!,
      b = p.points[Math.min(i + 1, p.points.length - 1)]!,
      dx = b.x - a.x,
      dy = b.y - a.y,
      n = dx * dx + dy * dy;
    const t = n === 0 ? 0 : clamp01(((x - a.x) * dx + (y - a.y) * dy) / n);
    nearest = Math.min(nearest, (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2);
  }
  const d = Math.sqrt(nearest) / p.radius;
  if (d >= 1) return 0;
  if (p.stroke.feather === 0 || d <= 1 - p.stroke.feather) return p.stroke.opacity;
  const t = (1 - d) / p.stroke.feather;
  return t * t * (3 - 2 * t) * p.stroke.opacity;
}

/** Minimize squared distance divided by squared linearly interpolated radius.
 * The derivative numerator is linear, so endpoints and its one minimum give
 * the continuous sweep. No gaps or opacity pile-up depend on sample cadence. */
function sweptCoverage(p: PreparedStroke, candidates: number[], x: number, y: number): number {
  let nearest = Infinity;
  for (const index of candidates) {
    const end = p.ends[index]!;
    const a = p.points[index]!,
      b = p.points[end]!;
    const ra = p.radii![index]!,
      rb = p.radii![end]!;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dr = rb - ra;
    const px = x - a.x,
      py = y - a.y;
    const d0 = px * px + py * py;
    const dot = px * dx + py * dy;
    const lengthSquared = dx * dx + dy * dy;
    nearest = Math.min(nearest, d0 / (ra * ra), ((x - b.x) ** 2 + (y - b.y) ** 2) / (rb * rb));
    const slope = lengthSquared * ra + dot * dr;
    if (slope > 0) {
      const t = (dot * ra + dr * d0) / slope;
      if (t > 0 && t < 1) {
        const r = ra + dr * t;
        nearest = Math.min(nearest, ((px - dx * t) ** 2 + (py - dy * t) ** 2) / (r * r));
      }
    }
  }
  if (nearest >= 1) return 0;
  const feather = p.stroke.feather;
  if (!feather) return 1;
  const t = Math.min(1, (1 - Math.sqrt(nearest)) / feather);
  return t * t * (3 - 2 * t);
}
/** Mutates only an engine-owned destination. Every paint layer is isolated and erasable. */
export function applyPaintLayersV3(
  destination: RGBAImage,
  layers: PaintLayerV3[],
  original: RGBAImage,
  options: RenderOptions,
  tileSize = 256,
  preparedInput?: PreparedLayer[],
): RGBAImage {
  const active = layers.filter((l) => l.enabled && l.opacity > 0 && l.strokes.length > 0);
  if (!active.length) return destination;
  const preparedLayers = preparedInput ?? preparePaintLayersV3(active, destination, options);
  if (!preparedLayers.length) return destination;
  const cloneSource = preparedLayers.some((entry) =>
    entry.prepared.some((p) => p.stroke.mode === 'clone'),
  )
    ? { ...destination, data: new Uint8ClampedArray(destination.data) }
    : destination;
  const tile = new Float32Array(
    Math.min(tileSize, destination.width) * Math.min(tileSize, destination.height) * 4,
  );
  const rgba = new Float64Array(4),
    paint = new Float64Array(4),
    mixed = new Float64Array(4);
  for (const { layer, prepared } of preparedLayers) {
    const mask = layer.mask ? compileSelectionMaskV3(layer.mask, destination, original) : null;
    for (let ty = 0; ty < destination.height; ty += tileSize)
      for (let tx = 0; tx < destination.width; tx += tileSize) {
        checkV3(options);
        const tw = Math.min(tileSize, destination.width - tx),
          th = Math.min(tileSize, destination.height - ty);
        tile.fill(0, 0, tw * th * 4);
        for (const p of prepared) {
          if (p.right < tx || p.left > tx + tw || p.bottom < ty || p.top > ty + th) continue;
          const left = Math.max(tx, Math.floor(p.left)),
            right = Math.min(tx + tw, Math.ceil(p.right)),
            top = Math.max(ty, Math.floor(p.top)),
            bottom = Math.min(ty + th, Math.ceil(p.bottom));
          for (let y = top; y < bottom; y++) {
            if ((y & 15) === 0) checkV3(options);
            for (let x = left; x < right; x++) {
              const strength = weight(p, x + 0.5, y + 0.5);
              if (strength <= 0) continue;
              const at = ((y - ty) * tw + x - tx) * 4;
              if (p.stroke.mode === 'erase') {
                tile[at + 3] = tile[at + 3]! * (1 - strength);
                continue;
              }
              if (p.stroke.mode === 'clone') {
                const first = p.stroke.points[0]!,
                  source = p.stroke.source!;
                sampleBilinearV3(
                  cloneSource,
                  x + 0.5 + (source.x - first.x) * destination.width,
                  y + 0.5 + (source.y - first.y) * destination.height,
                  paint,
                  'transparent',
                );
                paint[3] = (paint[3]! * p.stroke.color[3]) / 255;
              } else for (let c = 0; c < 4; c++) paint[c] = p.stroke.color[c]!;
              for (let c = 0; c < 4; c++) rgba[c] = tile[at + c]!;
              blendRgbaV3(rgba, paint, 'normal', strength, mixed);
              for (let c = 0; c < 4; c++) tile[at + c] = mixed[c]!;
            }
          }
        }
        for (let y = 0; y < th; y++) {
          if ((y & 31) === 0) checkV3(options);
          for (let x = 0; x < tw; x++) {
            const at = (y * tw + x) * 4;
            if (tile[at + 3] === 0) continue;
            const dst = ((ty + y) * destination.width + tx + x) * 4,
              opacity =
                layer.opacity *
                (mask
                  ? mask((tx + x + 0.5) / destination.width, (ty + y + 0.5) / destination.height)
                  : 1);
            if (opacity === 0) continue;
            for (let c = 0; c < 4; c++) {
              rgba[c] = destination.data[dst + c]!;
              paint[c] = tile[at + c]!;
            }
            blendRgbaV3(rgba, paint, layer.blendMode, opacity, mixed);
            for (let c = 0; c < 4; c++) destination.data[dst + c] = mixed[c]!;
          }
        }
      }
  }
  return destination;
}
export function applyImageLayersV3(
  destination: RGBAImage,
  layers: ImageLayerV3[],
  images: ReadonlyMap<string, RGBAImage> | undefined,
  original: RGBAImage,
  options: RenderOptions,
): RGBAImage {
  const rgba = new Float64Array(4),
    sample = new Float64Array(4),
    mixed = new Float64Array(4);
  for (const layer of layers) {
    if (!layer.enabled || layer.opacity === 0) continue;
    const image = images?.get(layer.sourceId);
    if (!image) throw new Error(`Missing resolved image layer: ${layer.sourceId}`);
    const angle = (layer.rotationDegrees * Math.PI) / 180,
      c = Math.cos(angle),
      s = Math.sin(angle),
      w = layer.width * destination.width,
      h = layer.height * destination.height;
    const cx = (layer.x + layer.width / 2) * destination.width,
      cy = (layer.y + layer.height / 2) * destination.height;
    const rx = (Math.abs(c) * w + Math.abs(s) * h) / 2,
      ry = (Math.abs(s) * w + Math.abs(c) * h) / 2;
    const mask = layer.mask ? compileSelectionMaskV3(layer.mask, destination, original) : null;
    for (
      let y = Math.max(0, Math.floor(cy - ry));
      y < Math.min(destination.height, Math.ceil(cy + ry));
      y++
    ) {
      if ((y & 31) === 0) checkV3(options);
      for (
        let x = Math.max(0, Math.floor(cx - rx));
        x < Math.min(destination.width, Math.ceil(cx + rx));
        x++
      ) {
        const dx = x + 0.5 - cx,
          dy = y + 0.5 - cy;
        let u = (c * dx + s * dy) / w + 0.5,
          v = (-s * dx + c * dy) / h + 0.5;
        if (u < 0 || v < 0 || u > 1 || v > 1) continue;
        if (layer.flipX) u = 1 - u;
        if (layer.flipY) v = 1 - v;
        sampleBilinearV3(image, u * image.width, v * image.height, sample, 'clamp');
        if (sample[3] === 0) continue;
        const opacity =
          layer.opacity *
          (mask ? mask((x + 0.5) / destination.width, (y + 0.5) / destination.height) : 1);
        if (opacity === 0) continue;
        const at = (y * destination.width + x) * 4;
        for (let k = 0; k < 4; k++) rgba[k] = destination.data[at + k]!;
        blendRgbaV3(rgba, sample, layer.blendMode, opacity, mixed);
        for (let k = 0; k < 4; k++) destination.data[at + k] = mixed[k]!;
      }
    }
  }
  return destination;
}
