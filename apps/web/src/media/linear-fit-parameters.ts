import type { PrecisionEdit } from '@ai-xiutu/editor';
import type { MediaPrecisionWindow } from '@ai-xiutu/media';

export interface LinearFitArea {
  region?: MediaPrecisionWindow;
  maxEdge: number;
}

export const CURVE_OFFSET = 16;
export const CURVE_STRIDE = 32;
export const REGION_OFFSET = CURVE_OFFSET + 4 * CURVE_STRIDE;
export const REGION_STRIDE = 20;
export const FIT_GRADE_WORDS = REGION_OFFSET + 8 * REGION_STRIDE;

type GlobalAdjustments = Partial<
  Pick<
    PrecisionEdit,
    'exposure' | 'temperature' | 'tint' | 'shadows' | 'highlights' | 'contrast' | 'saturation'
  >
>;

function adjustmentValues(edit: GlobalAdjustments) {
  const exposure = edit.exposure ?? 0;
  const temperature = edit.temperature ?? 0;
  const tint = edit.tint ?? 0;
  return [
    2 ** (exposure + 0.0035 * temperature + 0.0012 * tint),
    2 ** (exposure - 0.0018 * tint),
    2 ** (exposure - 0.0035 * temperature + 0.0012 * tint),
    (edit.shadows ?? 0) / 100,
    (edit.highlights ?? 0) / 100,
    2 ** ((edit.contrast ?? 0) / 100) - 1,
    1 + (edit.saturation ?? 0) / 100,
  ];
}

export function fitGradeParameters(
  edit: PrecisionEdit,
  width: number,
  height: number,
  displayHdr: boolean,
) {
  const values = new Float32Array(FIT_GRADE_WORDS);
  values.set(adjustmentValues(edit));
  values[7] = Number(displayHdr || edit.toneMap === 'reinhard');
  if ('curves' in edit) {
    const channels = ['luminance', 'red', 'green', 'blue'] as const;
    for (const [channel, name] of channels.entries()) {
      const points = edit.curves[name];
      if (!points || points.every(([input, output]) => input === output)) continue;
      values[8 + channel] = points.length;
      const offset = CURVE_OFFSET + channel * CURVE_STRIDE;
      for (const [index, [input, output]] of points.entries())
        values.set([input, output - input], offset + index * 2);
    }
  }
  if ('regions' in edit) {
    let count = 0;
    for (const region of edit.regions) {
      if (!region.enabled || !region.opacity || !Object.values(region.adjustments).some(Boolean))
        continue;
      const offset = REGION_OFFSET + count++ * REGION_STRIDE;
      const mask = region.mask;
      values[offset + 1] = region.opacity;
      values[offset + 2] = Number(mask.invert);
      if (mask.type === 'linear') {
        const short = Math.min(width, height);
        const xScale = width / short;
        const yScale = height / short;
        const dx = (mask.end.x - mask.start.x) * xScale;
        const dy = (mask.end.y - mask.start.y) * yScale;
        const squaredLength = dx * dx + dy * dy;
        values[offset] = 1;
        values[offset + 3] = Number(mask.smooth);
        values.set(
          [
            mask.start.x,
            mask.start.y,
            (xScale * dx) / squaredLength,
            (yScale * dy) / squaredLength,
          ],
          offset + 4,
        );
      } else {
        const angle = mask.rotationDegrees ?? 0;
        const radians = (angle * Math.PI) / 180;
        const cosine = angle % 90 === 0 ? Math.round(Math.cos(radians)) : Math.cos(radians);
        const sine = angle % 90 === 0 ? Math.round(Math.sin(radians)) : Math.sin(radians);
        values[offset] = mask.shape === 'rectangle' ? 3 : mask.shape === 'diamond' ? 4 : 2;
        values.set(
          [
            mask.centerX,
            mask.centerY,
            cosine / mask.radiusX,
            (sine * height) / (mask.radiusX * width),
            (-sine * width) / (mask.radiusY * height),
            cosine / mask.radiusY,
            mask.feather,
          ],
          offset + 4,
        );
      }
      values.set(adjustmentValues(region.adjustments), offset + 12);
    }
    values[12] = count;
  }
  return values;
}

const sinc = (value: number) => {
  const phase = value * Math.PI;
  return phase === 0 ? 1 : Math.sin(phase) / phase;
};

/** Match libvips 8.18 RGB16 resize. Gap two uses a centered integer average
 * before each residual Lanczos3 axis. The coefficients are Q12 at 64 phases. */
function resizeAxis(input: number, target: number, scale: number) {
  const average = Math.max(1, Math.floor(input / target / 2));
  const reduced = Math.ceil(input / average);
  const step = scale / average;
  const excess = (target * scale - input) / average;
  const taps = step === 1 ? 1 : Math.round(3 * step) * 2 + 1;
  const table = new Int32Array(target * (taps + 1));
  for (let index = 0; index < target; index++) {
    const at = index * (taps + 1);
    if (step === 1) {
      table[at] = index;
      table[at + 1] = 4096;
      continue;
    }
    const center = (index + 0.5) * step - excess / 2;
    const phase = Math.round((center - Math.floor(center)) * 64) / 64;
    const kernelCenter = taps / 2 - 1 + phase;
    table[at] = Math.floor(center) - (taps - 1) / 2;
    const weights = Array.from({ length: taps }, (_, tap) => {
      const distance = (tap - kernelCenter) / step;
      return Math.abs(distance) <= 3 ? sinc(distance) * sinc(distance / 3) : 0;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    for (let tap = 0; tap < taps; tap++)
      table[at + tap + 1] = Math.trunc((weights[tap]! / total) * 4096);
  }
  return { average, reduced, taps, table };
}

export function linearFitGeometry(width: number, height: number, maxEdge: number) {
  const scale = Math.max(1, Math.max(width, height) / maxEdge);
  const outputWidth = Math.max(1, Math.round(width / scale));
  const outputHeight = Math.max(1, Math.round(height / scale));
  return {
    outputWidth,
    outputHeight,
    x: resizeAxis(width, outputWidth, Math.min(scale, width)),
    y: resizeAxis(height, outputHeight, Math.min(scale, height)),
  };
}
