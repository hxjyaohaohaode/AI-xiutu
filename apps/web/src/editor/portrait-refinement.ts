import { createRasterMask, MAX_RASTER_RUNS_PER_MASK, type Point } from '@ai-xiutu/editor';
import { boundsOf } from '@ai-xiutu/portrait';
import type { FaceDetector, FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { FaceCandidate } from './yunet';

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

/** Lift a bounded analysis crop only. Part evidence still reads the original pixels. */
function liftShadows(canvas: OffscreenCanvas, recovery = false) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const histogram = new Uint32Array(256);
  const luma = (i: number) =>
    Math.round(
      0.2126 * pixels.data[i]! + 0.7152 * pixels.data[i + 1]! + 0.0722 * pixels.data[i + 2]!,
    );
  let count = 0,
    opaque = 0;
  for (let i = 0; i < pixels.data.length; i += 28) {
    if (pixels.data[i + 3]! < 220) continue;
    opaque++;
    const level = luma(i);
    if (level > 6) {
      histogram[level] = histogram[level]! + 1;
      count++;
    }
  }
  if (count < pixels.data.length / 800) return false;
  let seen = 0,
    middle = 0,
    high = 0;
  for (let level = 7; level < histogram.length; level++) {
    seen += histogram[level]!;
    if (!middle && seen >= count * 0.58) middle = level;
    if (seen >= count * 0.93) {
      high = level;
      break;
    }
  }
  if (middle >= (recovery ? 102 : 76) || high < 17 || high - middle < 5) return false;
  const gain = Math.min(4.2, Math.max(1.26, 132 / Math.max(21, middle)));
  const curve = Float32Array.from({ length: 256 }, (_, y) => 1 + (gain - 1) * (1 - y / 255) ** 2);
  const deepShadows = count < opaque * 0.24;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const y = luma(i);
    // Retain a black floor. A toe with a softer contrast curve can expose
    // shape in near-black inputs without clipping an isolated reflection.
    const multiplier = deepShadows ? Math.min(9.2, 12 / (1 + Math.sqrt(y / 25))) : curve[y]!;
    for (let channel = 0; channel < 3; channel++) {
      const at = i + channel;
      pixels.data[at] = deepShadows
        ? (y * 0.83 + pixels.data[at]! * 0.17) * multiplier
        : pixels.data[at]! * multiplier;
    }
  }
  context.putImageData(pixels, 0, 0);
  return true;
}

export async function recoverDistantFaces(
  source: OffscreenCanvas,
  landmarker: FaceLandmarker,
  openDetector: () => Promise<FaceDetector>,
  primary: Landmarks[],
  oval: (points: Point[]) => Point[],
) {
  const bounds = primary.map((points) => boundsOf(oval(points)));
  if (primary.length >= 8 || (primary.length === 1 && bounds[0]!.width * bounds[0]!.height >= 0.12))
    return primary;
  const detector = await openDetector();
  const found: { bounds: Window; score: number }[] = [];
  function scan(window: Window, lift: boolean) {
    const view = analysisCanvas(source, window, 720);
    try {
      if (lift && !liftShadows(view)) return;
      for (const item of detector.detect(view).detections) {
        const box = item.boundingBox;
        const score = item.categories[0]?.score ?? 0;
        if (!box || score < (lift ? 0.65 : 0.6)) continue;
        const x = window.x + (box.originX / view.width) * window.width;
        const y = window.y + (box.originY / view.height) * window.height;
        const w = (box.width / view.width) * window.width;
        const h = (box.height / view.height) * window.height;
        if (
          Math.min(w * source.width, h * source.height) < 12 ||
          x + w * 0.25 < window.x ||
          y + h * 0.25 < window.y ||
          x + w * 0.75 > window.x + window.width ||
          y + h * 0.75 > window.y + window.height
        )
          continue;
        const candidate = { x, y, width: w, height: h };
        if (bounds.some((b) => sameFace(b, candidate))) continue;
        const duplicate = found.findIndex((other) => sameFace(other.bounds, candidate));
        if (duplicate === -1) found.push({ bounds: candidate, score });
        else if (score > found[duplicate]!.score) found[duplicate] = { bounds: candidate, score };
      }
    } finally {
      view.width = view.height = 1;
    }
  }
  try {
    scan(entireFrame, false);
    if (!primary.length && found.length < 2) scan(entireFrame, true);
    if (
      Math.min(source.width, source.height) >= 256 &&
      !found.some((item) => item.bounds.width * item.bounds.height > 0.11)
    ) {
      const extent = 0.58;
      const windows = [0, 1 - extent].flatMap((y) =>
        [0, 1 - extent].map((x) => ({ x, y, width: extent, height: extent })),
      );
      for (const window of windows) scan(window, false);
      if (!primary.length && !found.length) for (const window of windows) scan(window, true);
    }
    const small = [...bounds, ...found.map(({ bounds }) => bounds)]
      .filter((b) => b.width < 0.075 && b.height < 0.13)
      .map((b) => b.y + b.height / 2)
      .sort((a, b) => a - b);
    // A row of distant faces gives a smaller search area for the others.
    const row = small.filter((y) => Math.abs(y - small[Math.floor(small.length / 2)]!) < 0.085);
    if (row.length >= 2 && primary.length + found.length < 10) {
      const width = 0.34;
      const height = Math.min(0.52, (width * source.width) / source.height);
      const center = row.reduce((total, y) => total + y, 0) / row.length;
      const y = Math.max(0, Math.min(1 - height, center - height * 0.5));
      for (const x of [0, 0.22, 0.44, 1 - width]) scan({ x, y, width, height }, false);
    }
    const recovered: Face[] = [];
    for (const candidate of found.sort((a, b) => b.score - a.score).slice(0, 10)) {
      if (recovered.length + primary.length >= 8) break;
      const window = faceWindow(source, candidate.bounds, 2.05);
      const view = analysisCanvas(source, window, 640);
      try {
        for (const useLift of [false, true]) {
          if (useLift && !liftShadows(view, true)) break;
          const usable = landmarker
            .detect(view)
            .faceLandmarks.flatMap((points) => {
              const projected = points.map((p) => ({
                ...p,
                x: window.x + p.x * window.width,
                y: window.y + p.y * window.height,
                z: p.z * window.width,
              }));
              try {
                const measured = boundsOf(oval(projected));
                return sameFace(measured, candidate.bounds) &&
                  !bounds.some((other) => sameFace(other, measured)) &&
                  !recovered.some((other) => sameFace(other.bounds, measured))
                  ? [{ points: projected, bounds: measured }]
                  : [];
              } catch {
                return [];
              }
            })
            .sort(
              (a, b) =>
                Math.abs(a.bounds.x - candidate.bounds.x) -
                Math.abs(b.bounds.x - candidate.bounds.x),
            );
          if (usable[0]) {
            recovered.push(usable[0]);
            break;
          }
        }
      } finally {
        view.width = view.height = 1;
      }
    }
    // A tightly framed dark profile may miss both detectors at original
    // contrast. Ask the dense model again on a contrast-normalized source.
    if (!primary.length && !recovered.length) {
      const view = analysisCanvas(source, entireFrame, 800);
      try {
        if (liftShadows(view, true)) {
          await landmarker.setOptions({
            minFaceDetectionConfidence: 0.44,
            minFacePresenceConfidence: 0.53,
          });
          const candidates = landmarker.detect(view).faceLandmarks;
          for (const points of candidates) {
            try {
              const measured = boundsOf(oval(points));
              if (Math.min(measured.width * source.width, measured.height * source.height) < 34)
                continue;
              const second = faceWindow(source, measured, 2.12);
              if (second.width * second.height > 0.9) continue;
              const crop = analysisCanvas(source, second, 640);
              try {
                if (!liftShadows(crop, true)) continue;
                const confirmed = landmarker
                  .detect(crop)
                  .faceLandmarks.map((points) =>
                    points.map((p) => ({
                      ...p,
                      x: second.x + p.x * second.width,
                      y: second.y + p.y * second.height,
                      z: p.z * second.width,
                    })),
                  )
                  .find(
                    (candidate) =>
                      sameFace(measured, boundsOf(oval(candidate))) &&
                      anchorDistance(candidate, points) <
                        Math.max(measured.width, measured.height) * 0.1,
                  );
                if (confirmed)
                  recovered.push({ points: confirmed, bounds: boundsOf(oval(confirmed)) });
              } finally {
                crop.width = crop.height = 1;
              }
            } catch {
              /* A clipped contour cannot be edited. */
            }
            if (recovered.length >= 4) break;
          }
        }
      } finally {
        view.width = view.height = 1;
      }
    }
    recovered.sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
    return [...primary, ...recovered.map((face) => face.points)];
  } finally {
    detector.close();
  }
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

/** Non-destructive exposure normalization for detector input. */
function liftedForDetection(pixels: ImageData) {
  const data = pixels.data;
  const hist = new Uint32Array(256);
  const luminance = (i: number) =>
    Math.round(0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!);
  let count = 0, dark = 0;
  for (let i = 0; i < data.length; i += 12) {
    if (data[i + 3]! < 224) continue;
    const y = luminance(i);
    if (y < 9) dark++;
    else {
      hist[y]!++;
      count++;
    }
  }
  if (count < 64 || dark / (dark + count) < 0.23) return false;
  let white = 9, sum = 0;
  for (; white < 255; white++) {
    sum += hist[white]!;
    if (sum >= 0.9 * count) break;
  }
  white = Math.max(24, white);
  if (white > 210 && dark / (dark + count) < 0.68) return false;
  const gain = Float32Array.from({ length: 256 }, (_, y) =>
    Math.min(8, Math.max(1, 255 * Math.min(y / white, 1) ** 0.72 / Math.max(1, y))),
  );
  for (let i = 0; i < data.length; i += 4) {
    const g = gain[luminance(i)]!;
    for (let c = 0; c < 3; c++) data[i + c] = data[i + c]! * g;
  }
  return true;
}

export async function recoverYuNetFaces(
  source: OffscreenCanvas,
  face: FaceLandmarker,
  existing: Landmarks[],
  oval: (points: Point[]) => Point[],
  excluded: (candidate: FaceCandidate) => boolean,
) {
  const { openYuNet } = await import('./yunet');
  const detector = await openYuNet();
  const view = analysisCanvas(source, entireFrame, 960);
  const initial = existing.map((points) => boundsOf(oval(points)));
  const recovered: Face[] = [];
  try {
    const ctx = view.getContext('2d', { willReadFrequently: true })!;
    const pixels = ctx.getImageData(0, 0, view.width, view.height);
    const boxes = await detector.detect(pixels);
    if (!existing.length && liftedForDetection(pixels)) {
      for (const candidate of await detector.detect(pixels)) {
        const previous = boxes.findIndex(({ bounds }) => sameFace(bounds, candidate.bounds));
        if (previous === -1) boxes.push(candidate);
        else if (boxes[previous]!.score < candidate.score) boxes[previous] = candidate;
      }
    }
    for (const candidate of boxes.sort((a, b) => b.score - a.score)) {
      if (existing.length + recovered.length >= 12) break;
      if (initial.some((b) => sameFace(b, candidate.bounds)) ||
          recovered.some(({ bounds }) => sameFace(bounds, candidate.bounds)) ||
          excluded(candidate)) continue;
      const size = Math.max(candidate.bounds.width * source.width, candidate.bounds.height * source.height) * 1.65;
      const { x, y, width, height } = candidate.bounds;
      const left = Math.max(0, x + width * 0.5 - size * 0.5 / source.width);
      const top = Math.max(0, y + height * 0.5 - size * 0.5 / source.height);
      const window = { x: left, y: top,
        width: Math.min(1, x + width * 0.5 + size * 0.5 / source.width) - left,
        height: Math.min(1, y + height * 0.5 + size * 0.5 / source.height) - top,
      };
      const scale = 480 / Math.max(window.width * source.width, window.height * source.height);
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(window.width * source.width * scale)),
        Math.max(1, Math.round(window.height * source.height * scale)));
      try {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, window.x * source.width, window.y * source.height,
          window.width * source.width, window.height * source.height, 0, 0, canvas.width, canvas.height);
        const candidates = (adjusted: boolean) => {
          if (adjusted) {
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
            if (!liftedForDetection(pixels)) return [];
            ctx.putImageData(pixels, 0, 0);
          }
          return face.detect(canvas).faceLandmarks.flatMap((landmarks) => {
            const points = landmarks.map((p) => ({ ...p,
              x: window.x + p.x * window.width, y: window.y + p.y * window.height,
              z: p.z * window.width,
            }));
            try {
              const bounds = boundsOf(oval(points));
              const box = candidate.bounds;
              const overlapWidth = Math.max(0, Math.min(bounds.x + bounds.width, box.x + box.width) - Math.max(bounds.x, box.x));
              const overlapHeight = Math.max(0, Math.min(bounds.y + bounds.height, box.y + box.height) - Math.max(bounds.y, box.y));
              const intersection = overlapWidth * overlapHeight;
              const agreement = intersection / (bounds.width * bounds.height + box.width * box.height - intersection);
              const nose = points[1];
              if (!nose || nose.x < 0 || nose.x > 1 || nose.y < 0 || nose.y > 1 || agreement < 0.24 ||
                initial.some((b) => sameFace(b, bounds)) ||
                recovered.some((other) => sameFace(other.bounds, bounds))) return [];
              return [{ bounds, points, agreement }];
            } catch {
              return [];
            }
          });
        };
        const raw = candidates(false);
        const best = (raw.length ? raw : candidates(true)).sort((a, b) => b.agreement - a.agreement)[0];
        if (best) recovered.push(best);
      } finally {
        canvas.width = canvas.height = 1;
      }
    }
  } finally {
    view.width = view.height = 1;
    await detector.close();
  }
  return [...existing, ...recovered.sort((a, b) =>
    a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y).map(({ points }) => points)];
}

type PoseOutput = ReturnType<PoseLandmarker['detect']>;
type BodyObservation = {
  points: PoseOutput['landmarks'][number];
  sample?: (p: Point) => number;
};

function sharesTorso(a: BodyObservation, b: BodyObservation, distance: (a: Point, b: Point) => number) {
  const p = a.points, q = b.points;
  const width = Math.max(8, Math.min(distance(p[11]!, p[12]!), distance(q[11]!, q[12]!)));
  const center = (points: typeof p, first: number) => ({
    x: (points[first]!.x + points[first + 1]!.x) / 2,
    y: (points[first]!.y + points[first + 1]!.y) / 2,
  });
  if ([11, 12, 23, 24].some((i) => Math.min(p[i]!.visibility, q[i]!.visibility) < 0.58))
    return false;
  return distance(center(p, 23), center(q, 23)) < 0.34 * width &&
    distance(center(p, 11), center(q, 11)) < 0.49 * width;
}

export function observeBodies(
  source: OffscreenCanvas,
  pose: PoseLandmarker,
  legacyFaces: readonly Window[],
  confirmedFaces: readonly Window[],
) {
  function detect(window: Window): BodyObservation[] {
    // The native float callback requires aligned rows at the inference size.
    const view = analysisCanvas(source, window, 896, 4);
    let found: BodyObservation[] = [];
    try {
      pose.detect(view, (output) => {
        found = output.landmarks.flatMap((points, i) => {
          if (points.length < 33 || !points.some((p) => p.visibility >= 0.56)) return [];
          const mask = output.segmentationMasks?.[i];
          const original =
            mask && confidenceSampler(mask.getAsFloat32Array(), mask.width, mask.height);
          // Copy a bounded grid while the callback owns the mask.
          const scale = Math.min(1, 288 / Math.max(view.width, view.height));
          const w = Math.max(1, Math.round(view.width * scale));
          const h = Math.max(1, Math.round(view.height * scale));
          const values =
            original &&
            Float32Array.from({ length: w * h }, (_, index) =>
              original({ x: ((index % w) + 0.5) / w, y: (Math.floor(index / w) + 0.5) / h }),
            );
          return [
            {
              points: points.map((p) => ({
                ...p,
                x: window.x + p.x * window.width,
                y: window.y + p.y * window.height,
                z: p.z * window.width,
                visibility:
                  p.x < 0.012 || p.x > 0.988 || p.y < 0.012 || p.y > 0.988 ? 0 : p.visibility,
              })),
              sample: values ? confidenceSampler(values, w, h, window) : undefined,
            },
          ];
        });
      });
      return found;
    } finally {
      view.width = view.height = 1;
    }
  }
  const distance = (a: Point, b: Point) =>
    Math.hypot((a.x - b.x) * source.width, (a.y - b.y) * source.height);
  function compatible(a: BodyObservation, b: BodyObservation) {
    const first = a.points[0]!,
      second = b.points[0]!;
    const shoulder = Math.max(12, distance(a.points[11]!, a.points[12]!));
    if (
      first.visibility > 0.55 &&
      second.visibility > 0.55 &&
      distance(first, second) > shoulder * 0.35
    )
      return false;
    const common = [0, 11, 12, 23, 24].filter(
      (i) => Math.min(a.points[i]!.visibility, b.points[i]!.visibility) >= 0.52,
    );
    return (
      common.length >= 2 &&
      common.reduce((total, i) => total + distance(a.points[i]!, b.points[i]!), 0) / common.length <
        shoulder * 0.38
    );
  }
  const quality = (body: BodyObservation) =>
    [0, 11, 12, 13, 14, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32].reduce(
      (score, i) => score + body.points[i]!.visibility,
      0,
    );
  const leftEdge = (observation: BodyObservation) =>
    Math.min(...observation.points.filter((p) => p.visibility > 0.5).map((p) => p.x));
  // Keep the previous full-frame order so a recovered target never reuses a
  // slot previously assigned to another person in a saved recipe.
  const bodies = detect(entireFrame).sort((a, b) => leftEdge(a) - leftEdge(b));
  const originalCount = bodies.length;
  const headContext = (face: Window) => face.height < 0.19 && face.y + face.height * 3 < 1;
  function matchesHead(body: BodyObservation, head: Window, margin: number) {
    const nose = body.points[0]!;
    return (
      nose.visibility >= 0.51 &&
      nose.x >= head.x - head.width * margin &&
      nose.x <= head.x + head.width * (1 + margin) &&
      nose.y >= head.y - head.height * 0.3 &&
      nose.y <= head.y + head.height * 1.23
    );
  }
  function refineHead(head: Window, limit: number) {
    const x = head.x + head.width * 0.5;
    const y = Math.max(0, head.y - head.height * 0.65);
    const height = Math.min(1 - y, head.height * 10.85);
    const halfWidth = Math.min(((height * source.height) / source.width) * 0.39, head.width * 3.1);
    const left = Math.max(0, x - halfWidth),
      right = Math.min(1, x + halfWidth);
    const sameHead = (body: BodyObservation) => matchesHead(body, head, 0.3);
    const existing = bodies.findIndex(sameHead);
    if (existing >= 0 && head.height >= 0.105 && quality(bodies[existing]!) > 12) return;
    if (existing < 0 && bodies.length >= limit) return;
    const alternatives = detect({ x: left, y, width: right - left, height }).filter(sameHead);
    const best = alternatives.sort((a, b) => quality(b) - quality(a))[0];
    if (!best || quality(best) < 7 || !best.sample || best.sample(best.points[0]!) < 0.3) return;
    const same = existing >= 0 ? existing : bodies.findIndex((body) => compatible(body, best));
    if (same < 0) bodies.push(best);
    else if (quality(best) >= quality(bodies[same]!) - 0.16) bodies[same] = best;
  }
  // Run the historical search before adding new proposals. A new face must
  // never cause a previously saved pose slot to refer to a different person.
  for (const head of legacyFaces.filter(headContext).sort((a, b) => b.height - a.height).slice(0, 8))
    refineHead(head, 8);
  bodies.splice(originalCount, bodies.length - originalCount,
    ...bodies.slice(originalCount).sort((a, b) => a.points[0]!.x - b.points[0]!.x));
  const legacyCount = bodies.length;
  for (const head of confirmedFaces.filter(headContext).sort((a, b) => b.height - a.height))
    if (!bodies.some((body) => matchesHead(body, head, 0.3))) refineHead(head, 12);
  const ordered = [
    ...bodies.slice(0, legacyCount),
    ...bodies.slice(legacyCount).sort((a, b) => a.points[0]!.x - b.points[0]!.x),
  ];
  const faceMatch = (body: BodyObservation) =>
    confirmedFaces.some((head) => matchesHead(body, head, 0.25));
  function sharesLegWithoutHead(candidate: BodyObservation, known: BodyObservation) {
    const shoulder = Math.max(8, distance(known.points[11]!, known.points[12]!));
    if (distance(candidate.points[0]!, known.points[0]!) > 0.76 * shoulder) return false;
    // A mixed pose may borrow one person's leg and another person's shoulder.
    // Prefer a pose tied to a real face if both the ankle and its heel or toe agree.
    return [[27, 29, 31], [28, 30, 32]].some(([ankle, heel, toe]) => {
      const agrees = (i: number) =>
        Math.min(candidate.points[i]!.visibility, known.points[i]!.visibility) > 0.62 &&
        distance(candidate.points[i]!, known.points[i]!) < 0.22 * shoulder;
      return agrees(ankle!) && (agrees(heel!) || agrees(toe!));
    });
  }
  // Preserve slots. Two noisy noses can land on different sides of the same
  // turned head, even when shoulders and hips point to the same torso.
  return ordered
    .map((body, slot) => ({ ...body, slot, confirmed: faceMatch(body) }))
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || quality(b) - quality(a))
    // Reject a duplicate only against a keeper, not a candidate already
    // rejected for being a weaker match.
    .reduce<Array<BodyObservation & { slot: number; confirmed: boolean }>>((kept, body) => {
      if (!kept.some((other) =>
        compatible(body, other) || sharesTorso(body, other, distance) ||
        (!body.confirmed && other.confirmed && sharesLegWithoutHead(body, other))))
        kept.push(body);
      return kept;
    }, [])
    .sort((a, b) => a.slot - b.slot);
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
