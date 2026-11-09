import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileSelectionMask,
  createRasterMask,
  parseSelectionMask,
  RecipeValidationError,
  radialMaskWeight,
} from '../src/index.js';
import type { ColorRangeMaskV2, RGBAImage, SelectionMaskV2 } from '../src/index.js';
const close = (actual: number, expected: number, tolerance = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test('compiled radial masks preserve the old radial mathematical convention', () => {
  const mask = {
    type: 'radial' as const,
    centerX: 0.5,
    centerY: 0.4,
    radiusX: 0.3,
    radiusY: 0.2,
    feather: 0.7,
    invert: false,
  };
  for (const invert of [false, true]) {
    const value = { ...mask, invert },
      sample = compileSelectionMask(value, { width: 300, height: 100 });
    for (const [x, y] of [
      [0.5, 0.4],
      [0.7, 0.4],
      [0.5, 0.7],
      [0, 0],
      [1, 1],
    ])
      close(sample(x!, y!), radialMaskWeight(value, x!, y!));
  }
});

test('linear gradient projection uses source pixel aspect, bounded endpoints and optional smoothing', () => {
  const mask = {
    type: 'linear' as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
    smooth: false,
    invert: false,
  };
  const sample = compileSelectionMask(mask, { width: 200, height: 100 });
  close(sample(0.5, 0), 0.4);
  close(sample(0, 0), 0);
  close(sample(1, 1), 1);
  const smooth = compileSelectionMask(
    { ...mask, start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 }, smooth: true },
    { width: 200, height: 100 },
  );
  close(smooth(0.25, 0.2), 0.15625);
  const inverted = compileSelectionMask({ ...mask, invert: true }, { width: 200, height: 100 });
  close(sample(0.3, 0.7) + inverted(0.3, 0.7), 1);
});

test('polygon selection has pixel-aspect-aware inward feather and exact zero exterior', () => {
  const mask = {
    type: 'polygon' as const,
    points: [
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.75, y: 0.75 },
      { x: 0.25, y: 0.75 },
    ],
    feather: 0.1,
    invert: false,
  };
  const sample = compileSelectionMask(mask, { width: 200, height: 100 });
  close(sample(0.5, 0.5), 1);
  close(sample(0.2, 0.5), 0);
  close(sample(0.25, 0.5), 0);
  close(sample(0.275, 0.5), 0.5);
  close(sample(0.5, 0.3), 0.5);
  const hard = compileSelectionMask({ ...mask, feather: 0 }, { width: 200, height: 100 });
  close(hard(0.25, 0.5), 1);
  const inverted = compileSelectionMask({ ...mask, invert: true }, { width: 200, height: 100 });
  close(inverted(0.2, 0.5), 1);
  close(inverted(0.5, 0.5), 0);
});

test('brush capsules are continuous between samples and maintain circular source-pixel radii', () => {
  const mask = {
    type: 'brush' as const,
    strokes: [
      {
        points: [
          { x: 0.2, y: 0.5 },
          { x: 0.8, y: 0.5 },
        ],
        radius: 0.1,
        feather: 1,
        opacity: 1,
        mode: 'add' as const,
      },
    ],
    invert: false,
  };
  const sample = compileSelectionMask(mask, { width: 200, height: 100 });
  close(sample(0.5, 0.5), 1);
  close(sample(0.5, 0.55), 0.5);
  close(sample(0.175, 0.5), 0.5);
  close(sample(0.5, 0.61), 0);
  close(sample(0.1, 0.5), 0);
});

test('brush additive/subtractive strokes compose ordered coverage without point-density buildup', () => {
  const dab = {
    points: [{ x: 0.5, y: 0.5 }],
    radius: 0.2,
    feather: 0,
    opacity: 0.5,
    mode: 'add' as const,
  };
  const add = compileSelectionMask(
    { type: 'brush', strokes: [dab, dab], invert: false },
    { width: 100, height: 100 },
  );
  close(add(0.5, 0.5), 0.75);
  const erase = compileSelectionMask(
    { type: 'brush', strokes: [dab, dab, { ...dab, mode: 'subtract' }], invert: false },
    { width: 100, height: 100 },
  );
  close(erase(0.5, 0.5), 0.375);
  const dense = compileSelectionMask(
    {
      type: 'brush',
      strokes: [{ ...dab, points: Array.from({ length: 64 }, () => ({ x: 0.5, y: 0.5 })) }],
      invert: false,
    },
    { width: 100, height: 100 },
  );
  close(dense(0.5, 0.5), 0.5);
  const empty = compileSelectionMask(
    { type: 'brush', strokes: [], invert: true },
    { width: 100, height: 100 },
  );
  close(empty(0.5, 0.5), 1);
});

test('a half-pixel brush selects exactly one pixel center at the maximum admitted square dimensions', () => {
  // 8192² is the actual 64MP budget; a 16384² image is deliberately not admitted.
  const side = 8192,
    px = 4131,
    py = 2720;
  const mask = {
    type: 'brush' as const,
    strokes: [
      {
        points: [{ x: (px + 0.5) / side, y: (py + 0.5) / side }],
        radius: 0.5 / side,
        feather: 0,
        opacity: 1,
        mode: 'add' as const,
      },
    ],
    invert: false,
  };
  const sample = compileSelectionMask(mask, { width: side, height: side });
  for (let dy = -2; dy <= 2; dy += 1)
    for (let dx = -2; dx <= 2; dx += 1) {
      assert.equal(
        sample((px + dx + 0.5) / side, (py + dy + 0.5) / side),
        dx === 0 && dy === 0 ? 1 : 0,
      );
    }
  // A radius suitable for a future 16K short edge is representable, without
  // changing the current dimensions gate or any v1 radial-mask semantics.
  assert.doesNotThrow(() =>
    parseSelectionMask({ ...mask, strokes: [{ ...mask.strokes[0], radius: 0.5 / 16384 }] }),
  );
  assert.throws(
    () => parseSelectionMask({ ...mask, strokes: [{ ...mask.strokes[0], radius: 0.0000009 }] }),
    RecipeValidationError,
  );
});

test('RLE masks preserve every byte weight at source cell centers and explicit normalized resizing', () => {
  const bytes = Uint8Array.of(0, 0, 128, 255, 0, 255);
  const mask = createRasterMask(3, 2, bytes);
  assert.deepEqual(mask.runs, [2, 0, 1, 128, 1, 255, 1, 0, 1, 255]);
  const sample = compileSelectionMask(mask, { width: 300, height: 200 });
  for (let y = 0; y < 2; y += 1)
    for (let x = 0; x < 3; x += 1)
      close(sample((x + 0.5) / 3, (y + 0.5) / 2), bytes[y * 3 + x]! / 255);
  const inverted = compileSelectionMask({ ...mask, invert: true }, { width: 300, height: 200 });
  close(inverted(5 / 6, 0.25), 1 - 128 / 255);
  assert.throws(() => createRasterMask(2, 2, new Uint8Array(3)), RecipeValidationError);
  assert.throws(
    () =>
      createRasterMask(
        4097,
        1,
        Uint8Array.from({ length: 4097 }, (_, i) => i % 2),
      ),
    /budget/,
  );
});

const rangeMask = (overrides: Partial<ColorRangeMaskV2> = {}): ColorRangeMaskV2 => ({
  type: 'color-range',
  hue: 0,
  hueWidth: 10,
  saturationMin: 0,
  saturationMax: 1,
  luminanceMin: 0,
  luminanceMax: 1,
  feather: 0,
  invert: false,
  ...overrides,
});
const colors: RGBAImage = {
  width: 6,
  height: 1,
  data: new Uint8ClampedArray([
    255, 0, 4, 255, 255, 4, 0, 255, 0, 255, 0, 255, 128, 128, 128, 255, 255, 0, 0, 0, 128, 64, 64,
    128,
  ]),
};

test('continuous source color selection wraps hue, distinguishes grey and preserves transparent exclusion under inversion', () => {
  const sample = compileSelectionMask(rangeMask({ hueWidth: 2 }), colors, colors);
  const weights = Array.from({ length: 6 }, (_, x) => sample((x + 0.5) / 6, 0.5));
  assert.deepEqual(weights.slice(0, 5), [1, 1, 0, 0, 0]);
  const inverted = compileSelectionMask(rangeMask({ hueWidth: 2, invert: true }), colors, colors);
  close(inverted(0.75, 0.5), 0);
  close(inverted(3.5 / 6, 0.5), 1);
  const allHues = compileSelectionMask(rangeMask({ hueWidth: 180 }), colors, colors);
  close(allHues(3.5 / 6, 0.5), 1);
  assert.throws(() => compileSelectionMask(rangeMask(), colors), /source RGBA/);
});

test('continuous color saturation and encoded-luminance bands feather independently', () => {
  const saturation = compileSelectionMask(rangeMask({ saturationMin: 0.75 }), colors, colors);
  close(saturation(5.5 / 6, 0.5), 0);
  close(saturation(0.5 / 6, 0.5), 1);
  const luminance = compileSelectionMask(
    rangeMask({ hueWidth: 180, luminanceMin: 0.4, luminanceMax: 0.6 }),
    colors,
    colors,
  );
  close(luminance(3.5 / 6, 0.5), 1);
  close(luminance(0.5 / 6, 0.5), 0);
  const soft = compileSelectionMask(
    rangeMask({ hue: 30, hueWidth: 60, feather: 1 }),
    { width: 1, height: 1 },
    { width: 1, height: 1, data: new Uint8ClampedArray([255, 0, 0, 255]) },
  );
  close(soft(0.5, 0.5), 0.5);
  const exact = compileSelectionMask(rangeMask({ hueWidth: 0 }), colors, colors);
  close(exact(5.5 / 6, 0.5), 1);
  close(exact(0.5 / 6, 0.5), 0);
});

test('color overlay can explicitly sample a smaller original preview through normalized coordinates', () => {
  const preview: RGBAImage = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]),
  };
  const sample = compileSelectionMask(rangeMask(), { width: 4000, height: 2000 }, preview);
  close(sample(0.25, 0.5), 1);
  close(sample(0.75, 0.5), 0);
});

test('compiled mask domain rejects non-finite samples and bounds inverse selection to the actual source image', () => {
  const mask: SelectionMaskV2 = { type: 'brush', strokes: [], invert: true };
  const sample = compileSelectionMask(mask, { width: 1, height: 1 });
  assert.equal(sample(-0.01, 0.5), 0);
  assert.equal(sample(1.01, 0.5), 0);
  assert.throws(() => sample(NaN, 0.5), RangeError);
  assert.throws(() => compileSelectionMask(mask, { width: 0, height: 1 }), RangeError);
});
