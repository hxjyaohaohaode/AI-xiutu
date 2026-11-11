import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileSelectionMaskV3,
  createAdjustmentRegionV3,
  createColorBlockV3,
  createRecipeV4,
  getSelectionBoundsV3,
  linearToSrgb,
  parseSelectionMask,
  parseSelectionMaskV3,
  radialMaskFrameV3,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  srgbToLinear,
  type RadialMaskV3,
  type SelectionMaskV3,
} from '../src/index.js';

const mask: RadialMaskV3 = {
  type: 'radial',
  centerX: 0.5,
  centerY: 0.5,
  radiusX: 0.22,
  radiusY: 0.12,
  feather: 0.3,
  invert: false,
};
const size = { width: 117, height: 53 };
const source = {
  ...size,
  data: Uint8ClampedArray.from({ length: size.width * size.height * 4 }, (_, i) =>
    i % 4 === 3 ? (i % 11 === 0 ? 0 : 160 + (i % 96)) : (i * 37 + (i >> 8)) % 256,
  ),
};

test('radial profiles use clockwise source-pixel axes and retain legacy admission', () => {
  const vertical = { ...mask, rotationDegrees: 90 };
  const frame = radialMaskFrameV3(vertical, size);
  const point = frame.point(0.65, -0.23);
  assert.ok(Math.abs(frame.local(point).x - 0.65) < 1e-14);
  assert.ok(Math.abs(frame.local(point).y + 0.23) < 1e-14);
  assert.ok(Math.abs(frame.extent.x - (0.12 * size.height) / size.width) < 1e-14);
  assert.ok(Math.abs(frame.extent.y - (0.22 * size.width) / size.height) < 1e-14);
  for (const [shape, expected] of [
    ['ellipse', 1],
    ['rectangle', 1],
    ['diamond', 0],
  ] as const) {
    const hard = { ...mask, rotationDegrees: 37, shape, feather: 0 };
    const axes = radialMaskFrameV3(hard, size);
    const sample = axes.point(0.65, 0.65);
    const normal = compileSelectionMaskV3(hard, size);
    const inverse = compileSelectionMaskV3({ ...hard, invert: true }, size);
    assert.equal(normal(sample.x, sample.y), expected);
    assert.equal(inverse(sample.x, sample.y), 1 - expected);
    assert.equal(inverse(-0.01, 0.5), 0);
    assert.throws(() => inverse(NaN, 0), /finite/);
    const bounds = getSelectionBoundsV3(hard, size);
    for (let y = 0; y < size.height; y++)
      for (let x = 0; x < size.width; x++) {
        const u = (x + 0.5) / size.width,
          v = (y + 0.5) / size.height;
        if (normal(u, v))
          assert.ok(
            u >= bounds.x &&
              u <= bounds.x + bounds.width &&
              v >= bounds.y &&
              v <= bounds.y + bounds.height,
          );
      }
  }
  assert.deepEqual(parseSelectionMaskV3(mask), mask);
  assert.deepEqual(parseSelectionMaskV3(vertical), vertical);
  assert.deepEqual(parseSelectionMaskV3({ ...mask, shape: 'rectangle' }), {
    ...mask,
    shape: 'rectangle',
  });
  assert.throws(() => parseSelectionMask(vertical), /rotationDegrees/);
  for (const rotationDegrees of [-181, 181, '90'])
    assert.throws(() => parseSelectionMaskV3({ ...mask, rotationDegrees }), /rotationDegrees/);
  for (const rotationDegrees of [Infinity, NaN])
    assert.throws(() => parseSelectionMaskV3({ ...mask, rotationDegrees }), /finite acyclic JSON/);
  assert.throws(() => parseSelectionMaskV3({ ...mask, shape: 'free' }), /shape/);
  assert.throws(() => parseSelectionMaskV3({ ...mask, shape: ['rectangle'] }), /shape/);
});

test('cropped regional evaluation preserves every RGBA sample, including the filter halo and rotated support', () => {
  const color = createColorBlockV3({
    adjustments: { exposure: -0.43, sharpness: 27 },
    detail: { clarity: 56, texture: -33 },
  });
  const whole = renderEditorRecipe(source, createRecipeV4({ ...color }));
  const rectangle: SelectionMaskV3 = { ...mask, shape: 'rectangle', rotationDegrees: -38 };
  // Pixel x=58 lies exactly on the shared edge of two hard masks.
  const intersection: SelectionMaskV3 = {
    type: 'compound',
    operation: 'intersection',
    invert: false,
    masks: [
      {
        type: 'polygon',
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.5, y: 0.2 },
          { x: 0.5, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
        invert: false,
        feather: 0,
      },
      {
        type: 'polygon',
        points: [
          { x: 0.5, y: 0.3 },
          { x: 0.8, y: 0.3 },
          { x: 0.8, y: 0.7 },
          { x: 0.5, y: 0.7 },
        ],
        invert: false,
        feather: 0,
      },
    ],
  };
  const variants: SelectionMaskV3[] = [
    mask,
    { ...mask, shape: 'ellipse', rotationDegrees: 0 },
    rectangle,
    { ...rectangle, invert: true },
    { ...mask, shape: 'diamond', rotationDegrees: 90 },
    intersection,
    { type: 'compound', operation: 'xor', masks: [intersection, rectangle], invert: false },
  ];
  for (const selection of variants) {
    const region = createAdjustmentRegionV3({ mask: selection, color, opacity: 0.83 });
    const recipe = createRecipeV4({ regionEdits: [region] });
    const weight = compileSelectionMaskV3(selection, size, source);
    const expected = source.data.slice();
    let selected = 0;
    for (let y = 0; y < size.height; y++)
      for (let x = 0; x < size.width; x++) {
        const at = (y * size.width + x) * 4;
        const amount = 0.83 * weight((x + 0.5) / size.width, (y + 0.5) / size.height);
        if (amount === 0 || expected[at + 3] === 0) continue;
        selected++;
        for (let c = 0; c < 3; c++) {
          const a = srgbToLinear(source.data[at + c]! / 255),
            b = srgbToLinear(whole.data[at + c]! / 255);
          expected[at + c] = linearToSrgb(a + (b - a) * amount) * 255;
        }
      }
    assert.ok(selected > 0);
    const actual = renderEditorRecipe(source, recipe);
    assert.deepEqual(actual.data, expected, JSON.stringify(selection));
    const cropped = createRecipeV4({
      ...recipe,
      geometry: {
        crop: { x: 0.11, y: 0.2, width: 0.72, height: 0.7 },
        rotation: 90,
        flipX: true,
        flipY: false,
      },
    });
    assert.deepEqual(
      renderEditorRecipeTiled(source, cropped, { tileSize: 17 }),
      renderEditorRecipe(source, cropped),
    );
  }
});
