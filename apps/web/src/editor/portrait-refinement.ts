import { createRasterMask, MAX_RASTER_RUNS_PER_MASK, type Point } from '@ai-xiutu/editor';
import { boundsOf } from '@ai-xiutu/portrait';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';

type Landmarks = ReturnType<FaceLandmarker['detect']>['faceLandmarks'][number];
type Window = ReturnType<typeof boundsOf>;
type Face = { points: Landmarks; bounds: Window };

export function faceWindow(canvas: OffscreenCanvas, bounds: Window, padding: number): Window {
  const size = Math.min(
    Math.min(canvas.width, canvas.height),
    Math.max(bounds.width * canvas.width, bounds.height * canvas.height) * padding,
  );
  const width = size / canvas.width;
  const height = size / canvas.height;
  return {
    x: Math.max(0, Math.min(1 - width, bounds.x + (bounds.width - width) / 2)),
    y: Math.max(0, Math.min(1 - height, bounds.y + (bounds.height - height) / 2)),
    width,
    height,
  };
}

export function headWindow(bounds: Window): Window {
  const x = Math.max(0, bounds.x - bounds.width * 0.57);
  const y = Math.max(0, bounds.y - bounds.height * 0.72);
  return {
    x,
    y,
    width: Math.min(1, bounds.x + bounds.width * 1.57) - x,
    height: Math.min(1, bounds.y + bounds.height * 1.22) - y,
  };
}

export function confidenceSampler(
  values: Float32Array,
  width: number,
  height: number,
  bounds: Window = entireFrame,
) {
  return (p: Point) => {
    const u = (p.x - bounds.x) / bounds.width,
      v = (p.y - bounds.y) / bounds.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
    const x = Math.max(0, Math.min(width - 1, u * width - 0.5)),
      y = Math.max(0, Math.min(height - 1, v * height - 0.5));
    const i = Math.floor(x),
      j = Math.floor(y),
      a = x - i,
      b = y - j,
      i1 = Math.min(i + 1, width - 1),
      j1 = Math.min(j + 1, height - 1);
    return (
      ((values[j * width + i] ?? 0) * (1 - a) + (values[j * width + i1] ?? 0) * a) * (1 - b) +
      ((values[j1 * width + i] ?? 0) * (1 - a) + (values[j1 * width + i1] ?? 0) * a) * b
    );
  };
}

export function analysisCanvas(
  source: OffscreenCanvas,
  window: Window,
  maxEdge: number,
  rowAlignment = 1,
) {
  const width = source.width * window.width;
  const height = source.height * window.height;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = new OffscreenCanvas(
    Math.max(rowAlignment, Math.round((width * scale) / rowAlignment) * rowAlignment),
    Math.max(1, Math.round(height * scale)),
  );
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前设备不能创建分析画布。');
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    source,
    window.x * source.width,
    window.y * source.height,
    width,
    height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

export const entireFrame = { x: 0, y: 0, width: 1, height: 1 };

function sameFace(a: Window, b: Window) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return false;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  const larger = Math.max(a.width * a.height, b.width * b.height);
  return width * height > 0.56 * smaller && smaller > larger * 0.44;
}

export function detectFaceDetails(
  canvas: OffscreenCanvas,
  face: FaceLandmarker,
  oval: (points: Point[]) => Point[],
) {
  function detect(view: OffscreenCanvas, window: Window, cropped: boolean): Face[] {
    try {
      return face.detect(view).faceLandmarks.flatMap((landmarks) => {
        try {
          const local = boundsOf(oval(landmarks));
          // A crop may split a face and invent a partial contour. Permit contact
          // only at a corresponding edge of the original photograph.
          if (
            cropped &&
            ((window.x > 0 && local.x < 0.035) ||
              (window.y > 0 && local.y < 0.035) ||
              (window.x + window.width < 0.9999 && local.x + local.width > 0.965) ||
              (window.y + window.height < 0.9999 && local.y + local.height > 0.965))
          )
            return [];
          const points = landmarks.map((point) => ({
            ...point,
            x: window.x + point.x * window.width,
            y: window.y + point.y * window.height,
            z: point.z * window.width,
          }));
          return [{ points, bounds: boundsOf(oval(points)) }];
        } catch {
          return [];
        }
      });
    } finally {
      if (view !== canvas) view.width = view.height = 1;
    }
  }

  const faces = detect(canvas, entireFrame, false).sort(
    (a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y,
  );
  // Keep the full-frame targets in their original order. A new small-face
  // detection in a tile must not shift another person's saved edit binding.
  const primaryCount = faces.length;
  const shortEdge = Math.min(canvas.width, canvas.height);
  if (
    faces.length < 8 &&
    shortEdge >= 128 &&
    (!faces.length || faces.length > 1 || faces[0]!.bounds.width * faces[0]!.bounds.height < 0.1)
  ) {
    const extent = 0.64;
    const discovered: Face[] = [];
    for (const top of [0, 1 - extent])
      for (const left of [0, 1 - extent]) {
        const window = { x: left, y: top, width: extent, height: extent };
        for (const candidate of detect(analysisCanvas(canvas, window, 800), window, true)) {
          if (
            Math.min(
              candidate.bounds.width * canvas.width,
              candidate.bounds.height * canvas.height,
            ) < 12 ||
            faces.some(({ bounds }) => sameFace(bounds, candidate.bounds)) ||
            discovered.some(({ bounds }) => sameFace(bounds, candidate.bounds))
          )
            continue;
          discovered.push(candidate);
        }
      }
    discovered.sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
    faces.push(...discovered.slice(0, 8 - faces.length));
  }

  return faces.map((base, index) => {
    if (index >= primaryCount) return base.points;
    const { bounds } = base;
    const faceSize = Math.max(bounds.width * canvas.width, bounds.height * canvas.height);
    const window = faceWindow(canvas, bounds, 1.75);
    if (
      faceSize < 28 ||
      Math.min(window.width * canvas.width, window.height * canvas.height) < 1.18 * faceSize ||
      window.width * window.height > 0.86
    )
      return base.points;
    const candidates = detect(analysisCanvas(canvas, window, 640), window, true);
    const refined = candidates
      .filter(({ bounds }) => sameFace(bounds, base.bounds))
      .sort(
        (a, b) => anchorDistance(a.points, base.points) - anchorDistance(b.points, base.points),
      )[0];
    // Require agreement at the eye corners, nose, mouth and chin before
    // replacing the initial detection with the higher effective face scale.
    if (
      !refined ||
      anchorDistance(refined.points, base.points) > 0.09 * Math.max(bounds.width, bounds.height)
    )
      return base.points;
    return refined.points;
  });
}

function anchorDistance(a: Landmarks, b: Landmarks) {
  const anchors = [33, 133, 263, 362, 1, 61, 291, 152];
  return (
    anchors.reduce((distance, index) => {
      const first = a[index]!,
        second = b[index]!;
      return distance + Math.hypot(first.x - second.x, first.y - second.y);
    }, 0) / anchors.length
  );
}

/** A confidence map expressed in the oriented source frame, with a bounded recipe representation. */
export function confidenceRaster(
  width: number,
  height: number,
  weight: (index: number) => number,
  edge: number,
  maxRuns = MAX_RASTER_RUNS_PER_MASK,
  bounds?: Window,
) {
  for (let size = edge; size >= 24; size = Math.floor(size * 0.78)) {
    const w = Math.max(1, Math.round(size * Math.min(1, width / height)));
    const h = Math.max(1, Math.round(size * Math.min(1, height / width)));
    const pixels = new Uint8Array(w * h);
    let runs = 1;
    let nonzero = false;
    for (let y = 0; y < h; y++) {
      const y0 = Math.floor((y * height) / h);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / h));
      for (let x = 0; x < w; x++) {
        const x0 = Math.floor((x * width) / w);
        const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / w));
        let sum = 0;
        for (let sy = y0; sy < y1; sy++)
          for (let sx = x0; sx < x1; sx++) sum += weight(sy * width + sx);
        const index = y * w + x;
        const alpha = Math.round(Math.max(0, Math.min(1, sum / ((x1 - x0) * (y1 - y0)))) * 7) / 7;
        pixels[index] = Math.round(alpha * 255);
        nonzero ||= pixels[index]! > 0;
        if (index && pixels[index] !== pixels[index - 1]) runs++;
      }
    }
    if (!nonzero) return undefined;
    if (runs <= maxRuns)
      return createRasterMask(w, h, pixels, false, {
        sampling: 'bilinear-v1',
        ...(bounds ? { bounds } : {}),
      });
  }
  return undefined;
}

export function confidenceWeight(value: number, low: number, high: number) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

/** Bounded distance transform around the observed person, in source pixels. */
export function poseEditCorridor(
  weights: Float32Array,
  width: number,
  height: number,
  pixelWidth: number,
  pixelHeight: number,
  shoulderSpan: number,
) {
  const distance = Float32Array.from(weights, (value) => (value >= 0.52 ? 0 : Infinity));
  if (!distance.some((value) => value === 0)) return;
  const dx = pixelWidth / width,
    dy = pixelHeight / height,
    diagonal = Math.hypot(dx, dy);
  for (const reverse of [false, true]) {
    const step = reverse ? -1 : 1;
    for (let iy = 0; iy < height; iy++)
      for (let ix = 0; ix < width; ix++) {
        const y = reverse ? height - 1 - iy : iy,
          x = reverse ? width - 1 - ix : ix;
        const i = y * width + x,
          prevX = x - step,
          prevY = y - step;
        let d = distance[i]!;
        if (prevX >= 0 && prevX < width) d = Math.min(d, distance[y * width + prevX]! + dx);
        if (prevY >= 0 && prevY < height) {
          d = Math.min(d, distance[prevY * width + x]! + dy);
          if (x > 0) d = Math.min(d, distance[prevY * width + x - 1]! + diagonal);
          if (x + 1 < width) d = Math.min(d, distance[prevY * width + x + 1]! + diagonal);
        }
        distance[i] = d;
      }
  }
  const margin = Math.max(Math.max(dx, dy) * 2.2, shoulderSpan * 0.2);
  return (i: number) => 1 - confidenceWeight(distance[i]!, margin * 0.4, margin);
}
