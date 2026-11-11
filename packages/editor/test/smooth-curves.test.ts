import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compileCurveFunction,
  createRecipeV4,
  createAdjustmentRegionV3,
  parseEditorRecipe,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  smoothCurveSegments,
  withCurve,
  type CurvePoint,
} from '@ai-xiutu/editor';

test('smooth curve passes through nonuniform knots, joins with one tangent and keeps extrema bounded', () => {
  const knots: CurvePoint[] = [
    [0, 0.04],
    [0.17, 0.02],
    [0.51, 0.82],
    [0.72, 0.86],
    [1, 0.67],
  ];
  const sample = compileCurveFunction(knots, 'pchip-v1');
  for (const [x, y] of knots) assert.ok(Math.abs(sample(x) - y) < 1e-13);
  const segments = smoothCurveSegments(knots);
  for (let i = 1; i < segments.length; i++) {
    const previous = segments[i - 1]!,
      next = segments[i]!;
    assert.ok(
      Math.abs(
        (previous.to - previous.second) / previous.width - (next.first - next.from) / next.width,
      ) < 1e-12,
    );
  }
  for (const { x, width, from, to } of segments)
    for (let i = 0; i <= 100; i++) {
      const y = sample(x + (width * i) / 100);
      assert.ok(y >= Math.min(from, to) - 1e-13 && y <= Math.max(from, to) + 1e-13);
    }
  const narrow = compileCurveFunction(
    [
      [0, 0],
      [Number.MIN_VALUE, 0.75],
      [0.4, 0.2],
      [1, 1],
    ],
    'pchip-v1',
  );
  assert.equal(narrow(Number.MIN_VALUE), 0.75);
  assert.ok(Number.isFinite(narrow(0.00001)));
});

test('smooth curves affect the full global frame and remain confined to an explicit local mask', () => {
  const image = {
    width: 96,
    height: 32,
    data: Uint8ClampedArray.from({ length: 96 * 32 * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : 52 + (Math.floor(i / 4) % 96),
    ),
  };
  const points: CurvePoint[] = [
    [0, 0],
    [0.21, 0.37],
    [0.68, 0.83],
    [1, 1],
  ];
  const base = createRecipeV4();
  const curves = withCurve(base.curves, 'rgb', points, 'pchip-v1');
  const smooth = parseEditorRecipe({ ...base, curves });
  const legacy = parseEditorRecipe({
    ...base,
    curves: withCurve(base.curves, 'rgb', points, 'linear'),
  });
  const edited = renderEditorRecipe(image, smooth);
  assert.deepEqual(renderEditorRecipeTiled(image, smooth, { tileSize: 17 }), edited);
  assert.notDeepEqual(renderEditorRecipe(image, legacy).data, edited.data);
  for (let at = 0; at < image.data.length; at += 4) assert.ok(edited.data[at]! > image.data[at]!);
  const region = createAdjustmentRegionV3({
    id: 'subject',
    color: { curves },
    mask: {
      type: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
        { x: 0, y: 1 },
      ],
      feather: 0,
      invert: false,
    },
  });
  const local = createRecipeV4({ regionEdits: [region] });
  const localPixels = renderEditorRecipeTiled(image, local, { tileSize: 19 }).data;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++) {
      const at = (y * image.width + x) * 4;
      assert.equal(localPixels[at], x < image.width / 2 ? edited.data[at] : image.data[at]);
    }
  assert.throws(
    () => parseEditorRecipe({ ...smooth, curves: { ...curves, interpolation: { rgb: 'future' } } }),
    /unsupported algorithm/,
  );
});
