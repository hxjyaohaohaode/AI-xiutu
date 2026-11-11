import type { PortraitAnalysis, PortraitTarget } from '../src/index.js';
import type { Point } from '@ai-xiutu/editor';
export const hash = 'a'.repeat(64);
export const frame = {
  coordinates: 'source-normalized' as const,
  orientation: 'normalized' as const,
  contentHash: hash,
  width: 400,
  height: 500,
};
/** Pure synthetic landmark fixture, not evidence of model detection or cosmetic quality. */
export function faceTarget(index = 1, cx = 0.5, cy = 0.43, scale = 1, angle = 0): PortraitTarget {
  const project = (x: number, y: number): Point => {
    const px = x * 400 * scale,
      py = y * 500 * scale,
      c = Math.cos(angle),
      s = Math.sin(angle);
    return { x: cx + (c * px - s * py) / 400, y: cy + (s * px + c * py) / 500 };
  };
  const ring = (x: number, y: number, rx: number, ry: number, n = 16) =>
    Array.from({ length: n }, (_, i) =>
      project(x + rx * Math.cos((i * Math.PI * 2) / n), y + ry * Math.sin((i * Math.PI * 2) / n)),
    );
  const contours = {
    oval: ring(0, 0, 0.22, 0.27, 36),
    leftEye: ring(-0.085, -0.065, 0.04, 0.018),
    rightEye: ring(0.085, -0.065, 0.04, 0.018),
    leftBrow: ring(-0.085, -0.11, 0.052, 0.012),
    rightBrow: ring(0.085, -0.11, 0.052, 0.012),
    lips: ring(0, 0.12, 0.07, 0.025, 20),
    innerLips: ring(0, 0.12, 0.045, 0.008, 20),
  };
  const landmarks = Array.from({ length: 478 }, () => project(0, 0));
  landmarks[1] = project(0, 0.035);
  for (const [index, x] of [
    [468, -0.085],
    [473, 0.085],
  ] as const) {
    landmarks[index] = project(x, -0.065);
    ring(x, -0.065, 0.008, 0.0064, 4).forEach((p, offset) => {
      landmarks[index + offset + 1] = p;
    });
  }
  const xs = contours.oval.map((p) => p.x),
    ys = contours.oval.map((p) => p.y),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return {
    id: `face-${hash.slice(0, 12)}-${index}`,
    kind: 'face',
    label: `人物 ${index}`,
    landmarks,
    contours,
    bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y },
  };
}
export function bodyTarget(index = 1): PortraitTarget {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.1, z: 0, visibility: 1 }));
  const pairs: Record<number, [number, number]> = {
    0: [0.5, 0.1],
    7: [0.46, 0.1],
    8: [0.54, 0.1],
    11: [0.35, 0.25],
    12: [0.65, 0.25],
    13: [0.28, 0.4],
    14: [0.72, 0.4],
    15: [0.25, 0.55],
    16: [0.75, 0.55],
    23: [0.42, 0.55],
    24: [0.58, 0.55],
    25: [0.42, 0.73],
    26: [0.58, 0.73],
    27: [0.42, 0.93],
    28: [0.58, 0.93],
  };
  for (const [id, [x, y]] of Object.entries(pairs))
    landmarks[Number(id)] = { x, y, z: 0, visibility: 1 };
  return {
    id: `body-${hash.slice(0, 12)}-${index}`,
    kind: 'body',
    label: `身形 ${index}`,
    landmarks,
    contours: {},
    bounds: { x: 0.25, y: 0.1, width: 0.5, height: 0.83 },
  };
}
export const analysis = (targets: PortraitTarget[] = [faceTarget()]): PortraitAnalysis => ({
  schemaVersion: 1,
  provider: 'mediapipe',
  algorithmVersion: 'fixture-v1',
  frame: { ...frame },
  targets,
  segmentation: null,
  warnings: [],
});
