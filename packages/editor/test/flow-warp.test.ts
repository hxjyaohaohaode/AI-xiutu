import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV4,
  createRetouchRegionV4,
  WarpPreviewCache,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  parseEditorRecipe,
  linearToSrgb,
  srgbToLinear,
  type RGBAImage,
  type FaceWarpAnchorV3,
  type FaceContourV3,
  type WarpStrokeV3,
} from '../src/index.js';
import { applyWarpV3, compileWarpFieldV3 } from '../src/v3-warp.js';
import { compileFaceWarp, compilePortraitWarp } from '../src/face-warp.js';
import { compileFaceContour, faceContourBounds } from '../src/face-contour.js';
import { sampleBilinearV3, sampleBoundedCubicV3 } from '../src/v3-pixels.js';
import { flowWarpPoint, flowWarpPointV2 } from '../src/v3-flow.js';

const dimensions = { width: 300, height: 220 };
function stroke(mode: WarpStrokeV3['mode'], strength: number, feather = 0.7): WarpStrokeV3 {
  return {
    id: 'test-flow',
    algorithm: 'flow-v1',
    mode,
    from: { x: 0.5, y: 0.5 },
    to: { x: 0.95, y: 0.9 },
    radius: 0.32,
    feather,
    strength,
  };
}
const field = (s: WarpStrokeV3) =>
  compileWarpFieldV3({ enabled: true, protection: null, strokes: [s] }, dimensions);

test('flow strokes remain locally orientation-preserving at both extremes and reverse with opposite strength', () => {
  const h = 1e-6;
  for (const mode of ['push', 'pinch', 'bulge', 'twirl'] as const)
    for (const strength of [-1, 1])
      for (const feather of [0, 0.01, 0.7, 1]) {
        const map = field(stroke(mode, strength, feather)),
          inverse = field(stroke(mode, -strength, feather));
        for (let y = 0.15; y <= 0.85; y += 0.02)
          for (let x = 0.15; x <= 0.85; x += 0.02) {
            const p = map({ x, y }),
              dx = map({ x: x + h, y }),
              dy = map({ x, y: y + h });
            const determinant =
              ((dx.x - p.x) * (dy.y - p.y) - (dy.x - p.x) * (dx.y - p.y)) / (h * h);
            assert.ok(
              determinant > 0.1,
              `${mode}/${strength}/${feather}: foldover at ${x},${y}: ${determinant}`,
            );
            const restored = inverse(p);
            assert.ok(
              Math.hypot(restored.x - x, restored.y - y) < 0.000002,
              `inverse error: ${mode}/${feather}`,
            );
          }
        assert.deepEqual(map({ x: 0.01, y: 0.01 }), { x: 0.01, y: 0.01 });
      }
});

test('flow preserves transparency, geometry composition, tiled bytes and explicit full protection', () => {
  const source = {
    width: 73,
    height: 51,
    data: Uint8ClampedArray.from({ length: 73 * 51 * 4 }, (_, i) =>
      i % 4 === 3 ? (i % 20 === 3 ? 0 : 180) : (i * 39) % 256,
    ),
  };
  const original = source.data.slice();
  for (const mode of ['push', 'pinch', 'bulge', 'twirl'] as const) {
    const recipe = createRecipeV4({
      warp: { enabled: true, protection: null, strokes: [stroke(mode, 1)] },
      geometry: { rotation: 90, flipX: true, crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } },
    });
    assert.deepEqual(
      renderEditorRecipeTiled(source, recipe, { tileSize: 17 }),
      renderEditorRecipe(source, recipe),
    );
    const neutral = createRecipeV4({
      warp: { enabled: true, protection: null, strokes: [stroke(mode, 0)] },
    });
    assert.deepEqual(renderEditorRecipe(source, neutral).data, source.data);
    neutral.warp.strokes[0]!.strength = 1;
    neutral.warp.protection = {
      type: 'radial',
      centerX: 0.5,
      centerY: 0.5,
      radiusX: 1,
      radiusY: 1,
      feather: 0,
      invert: false,
    };
    assert.deepEqual(renderEditorRecipe(source, neutral).data, source.data);
  }
  assert.deepEqual(source.data, original);
});

test('old displacement strokes keep their exact serialized contract and unknown algorithms are rejected', () => {
  const s = stroke('push', 1);
  delete s.algorithm;
  const legacy = createRecipeV4({ warp: { enabled: true, protection: null, strokes: [s] } });
  const parsed = parseEditorRecipe(legacy);
  assert.ok('warp' in parsed && !Object.hasOwn(parsed.warp.strokes[0]!, 'algorithm'));
  const bad = structuredClone(legacy);
  (bad.warp.strokes[0] as any).algorithm = 'unknown';
  assert.throws(() => parseEditorRecipe(bad), /algorithm/);
});

test('scalar flow follows the reference field within a subpixel at the largest supported edge', () => {
  let error = 0;
  for (const mode of ['push', 'pinch', 'bulge', 'twirl'] as const)
    for (const strength of [-1, -0.01, 0, 0.01, 1])
      for (const feather of [0, 0.005, 0.1, 0.7, 1])
        for (let y = -1; y <= 1; y += 0.05)
          for (let x = -1; x <= 1; x += 0.05) {
            const baseline = flowWarpPoint(x, y, 1.6, -0.8, mode, strength, feather);
            const fast = flowWarpPointV2(x, y, 1.6, -0.8, mode, strength, feather);
            error = Math.max(error, Math.hypot(baseline.x - fast.x, baseline.y - fast.y));
          }
  assert.ok(error * 16_384 < 1e-6, `pixel displacement delta: ${error * 16_384}`);
});

test('the expanded warp count accepts compact edits and preserves the total support limit', () => {
  const strokes = (count: number, radius: number) =>
    Array.from({ length: count }, (_, i) => ({
      ...stroke('push', 0.5),
      id: `compact-${i}`,
      radius,
    }));
  const recipe = (count: number, radius: number) =>
    createRecipeV4({
      warp: {
        enabled: true,
        protection: null,
        strokes: strokes(count, radius),
      },
    });
  assert.equal(recipe(64, 1).warp.strokes.length, 64);
  assert.equal(recipe(128, 0.09).warp.strokes.length, 128);
  assert.throws(() => recipe(65, 1), /combined brush support/);
  assert.throws(() => recipe(129, 0.09), /warp\.strokes/);
});

test('sparse scan is byte exact with full traversal of mixed overlapping signed warps', () => {
  const source = {
    width: 133,
    height: 85,
    data: Uint8ClampedArray.from(
      { length: 133 * 85 * 4 },
      (_, index) => (index * 57 + (index >> 5)) % 256,
    ),
  };
  const strokes = Array.from({ length: 43 }, (_, i) => {
    const item = stroke(
      ['push', 'pinch', 'bulge', 'twirl'][i % 4] as WarpStrokeV3['mode'],
      i % 2 ? -0.81 : 0.75,
    );
    if (i % 3 === 0) delete item.algorithm;
    return {
      ...item,
      id: `step-${i}`,
      radius: 0.008 + (i % 11) / 90,
      from: { x: ((i * 17) % 43) / 42, y: ((i * 13) % 37) / 36 },
    };
  });
  const warp = createRecipeV4({
    warp: {
      enabled: true,
      strokes,
      protection: {
        type: 'radial',
        centerX: 0.43,
        centerY: 0.53,
        radiusX: 0.15,
        radiusY: 0.07,
        feather: 0.8,
        shape: 'diamond',
        rotationDegrees: -32,
        invert: false,
      },
    },
  }).warp;
  const mapping = compileWarpFieldV3(warp, source, source),
    expected = source.data.slice();
  const sample = new Float64Array(4);
  for (let y = 0; y < source.height; y++)
    for (let x = 0; x < source.width; x++) {
      const p = { x: (x + 0.5) / source.width, y: (y + 0.5) / source.height };
      const q = mapping(p);
      if (Math.abs(q.x - p.x) < 1e-15 && Math.abs(q.y - p.y) < 1e-15) continue;
      sampleBilinearV3(source, q.x * source.width, q.y * source.height, sample, 'clamp');
      for (let c = 0; c < 4; c++) expected[(y * source.width + x) * 4 + c] = sample[c]!;
    }
  assert.deepEqual(applyWarpV3(source, warp, source, {}).data, expected);
});

test('detail reconstruction retains more line contrast with a bounded color and alpha envelope', () => {
  const width = 151;
  const signal = (x: number) => 0.42 + 0.36 * Math.sin((2 * Math.PI * x) / 5.4);
  const data = new Uint8ClampedArray(width * 4);
  for (let x = 0; x < width; x++) {
    data.fill(linearToSrgb(signal(x)) * 255, x * 4, x * 4 + 3);
    data[x * 4 + 3] = 255;
  }
  const source = { width, height: 1, data },
    sample = new Float64Array(4),
    weights = new Float64Array(8);
  let linearError = 0,
    cubicError = 0;
  for (let x = 3; x < width - 3; x++)
    for (const shift of [0.23, 0.48, 0.69]) {
      const expected = signal(x + shift);
      sampleBilinearV3(source, x + 0.5 + shift, 0.5, sample, 'clamp');
      linearError += Math.abs(srgbToLinear(sample[0]! / 255) - expected);
      sampleBoundedCubicV3(source, x + 0.5 + shift, 0.5, sample, weights);
      cubicError += Math.abs(srgbToLinear(sample[0]! / 255) - expected);
      assert.equal(sample[3], 255);
    }
  assert.ok(cubicError < linearError * 0.85, `${cubicError} / ${linearError}`);
  const edge = {
    width: 5,
    height: 1,
    data: new Uint8ClampedArray([
      255, 0, 0, 0, 255, 0, 0, 0, 0, 40, 255, 32, 0, 40, 255, 194, 0, 40, 255, 255,
    ]),
  };
  for (let x = 1.03; x < 3.96; x += 0.07) {
    sampleBoundedCubicV3(edge, x + 0.5, 0.5, sample, weights);
    if (sample[3]! > 0) {
      assert.ok(Math.abs(sample[0]!) < 1e-10);
      assert.ok(Math.abs(sample[1]! - 40) < 1e-10);
      assert.ok(Math.abs(sample[2]! - 255) < 1e-10);
    }
  }
  const detailed = createRecipeV4({
    warp: {
      enabled: true,
      protection: null,
      strokes: [{ ...stroke('push', 1), resampling: 'bounded-cubic-v1' }],
    },
  });
  assert.equal(
    (parseEditorRecipe(detailed) as typeof detailed).warp.strokes[0]!.resampling,
    'bounded-cubic-v1',
  );
  const invalid = structuredClone(detailed);
  Object.assign(invalid.warp.strokes[0]!, { resampling: 'unknown' });
  assert.throws(() => parseEditorRecipe(invalid), /resampling/);
});

test('high-detail preview reuses only the immutable pre-warp source and invalidates changing edits', () => {
  let builds = 0;
  class CountingCache extends WarpPreviewCache {
    override beforeWarp(...args: Parameters<WarpPreviewCache['beforeWarp']>): RGBAImage {
      const prepare = args[4];
      return super.beforeWarp(args[0], args[1], args[2], args[3], () => {
        builds++;
        return prepare();
      });
    }
  }
  const warpPreviewCache = new CountingCache();
  const source = {
    width: 41,
    height: 31,
    data: Uint8ClampedArray.from({ length: 41 * 31 * 4 }, (_, i) => (i * 71) % 256),
  };
  const original = source.data.slice();
  const recipe = createRecipeV4({
    retouch: [createRetouchRegionV4({ smoothing: 38, texture: -19 })],
    warp: {
      enabled: true,
      protection: null,
      strokes: [{ ...stroke('push', 0.7), resampling: 'bounded-cubic-v1' }],
    },
  });
  for (const strength of [-0.75, 0.12, 1]) {
    recipe.warp.strokes[0]!.strength = strength;
    assert.deepEqual(
      renderEditorRecipe(source, recipe, { warpPreviewCache }),
      renderEditorRecipe(source, recipe),
    );
  }
  assert.equal(builds, 1);
  recipe.retouch[0]!.texture = 41;
  assert.deepEqual(
    renderEditorRecipe(source, recipe, { warpPreviewCache }),
    renderEditorRecipe(source, recipe),
  );
  assert.equal(builds, 2);
  recipe.geometry.rotation = 90;
  assert.deepEqual(
    renderEditorRecipe(source, recipe, { warpPreviewCache }),
    renderEditorRecipe(source, recipe),
  );
  assert.equal(builds, 2);
  assert.deepEqual(
    renderEditorRecipeTiled(source, recipe, { tileSize: 17, warpPreviewCache }),
    renderEditorRecipe(source, recipe),
  );
  assert.equal(builds, 3);
  assert.deepEqual(source.data, original);
  const replacement = { ...source, data: source.data.slice() };
  replacement.data[1] = 42;
  assert.deepEqual(
    renderEditorRecipe(replacement, recipe, { warpPreviewCache }),
    renderEditorRecipe(replacement, recipe),
  );
  assert.equal(builds, 4);
});

test('updating the latest brush window replays overlapping histories exactly, including inverse and protection edits', () => {
  const source = {
    width: 91,
    height: 69,
    data: Uint8ClampedArray.from({ length: 91 * 69 * 4 }, (_, i) =>
      i % 4 === 3 && i % 7 === 0 ? 0 : (i * 43) % 256,
    ),
  };
  const warpPreviewCache = new WarpPreviewCache();
  const first = {
    ...stroke('push', 0.91),
    algorithm: 'flow-v2' as const,
    resampling: 'bounded-cubic-v1' as const,
  };
  const earlier = Array.from({ length: 12 }, (_, i) => ({
    ...stroke(i % 2 ? 'twirl' : 'pinch', 0.26),
    id: `earlier-${i}`,
    from: { x: 0.25 + i * 0.045, y: 0.4 + (i % 3) * 0.06 },
    radius: 0.23,
  }));
  const recipe = createRecipeV4({
    adjustments: { exposure: 0.3 },
    warp: {
      enabled: true,
      protection: null,
      strokes: [...earlier, first, { ...first, id: 'last' }],
    },
  });
  const last = recipe.warp.strokes.at(-1)!;
  const compare = () =>
    assert.deepEqual(
      renderEditorRecipe(source, recipe, { warpPreviewCache }),
      renderEditorRecipe(source, recipe),
    );
  for (const strength of [0.84, 0.009, 0, -0.009, -0.91, -1]) {
    last.strength = strength;
    compare();
  }
  last.from = { x: 0.95, y: 0.04 };
  last.to = { x: 0.31, y: 0.82 };
  last.radius = 0.07;
  compare();
  recipe.warp.strokes[4]!.strength *= -1;
  compare();
  recipe.warp.protection = {
    type: 'radial',
    centerX: 0.55,
    centerY: 0.45,
    radiusX: 0.23,
    radiusY: 0.18,
    feather: 0.6,
    rotationDegrees: 64,
    shape: 'diamond',
    invert: true,
  };
  compare();
  recipe.geometry.crop = { x: 0.05, y: 0.2, width: 0.82, height: 0.67 };
  recipe.geometry.rotation = 90;
  compare();
});

test('overlapping face controls share a bounded field and protect unrelated features', () => {
  const anchors: FaceWarpAnchorV3[] = [
    {
      from: { x: 0.31, y: 0.56 },
      to: { x: 0.43, y: 0.55 },
      radius: 0.3,
      strength: 1,
      mode: 'push',
    },
    { from: { x: 0.35, y: 0.65 }, to: { x: 0.49, y: 0.6 }, radius: 0.3, strength: 1, mode: 'push' },
    {
      from: { x: 0.38, y: 0.4 },
      to: { x: 0.38, y: 0.4 },
      radius: 0.19,
      strength: 1,
      mode: 'bulge',
    },
    {
      from: { x: 0.44, y: 0.51 },
      to: { x: 0.44, y: 0.51 },
      radius: 0.15,
      strength: 1,
      mode: 'pin',
    },
  ];
  const mapping = compileFaceWarp(anchors, dimensions);
  const unpinned = compileFaceWarp(anchors.slice(0, -1), dimensions);
  const reversed = compileFaceWarp(anchors.slice().reverse(), dimensions);
  const sameShapeAtHalfScale = compileFaceWarp(anchors, { width: 150, height: 110 });
  const change = (x: number, y: number) => {
    const point = mapping(x, y);
    return { x: point.x - x, y: point.y - y };
  };
  for (let y = 20; y < 200; y += 3)
    for (let x = 25; x < 190; x += 3) {
      const a = change(x, y),
        b = change(x + 1, y),
        c = change(x, y + 1);
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.x - c.x, a.y - c.y) <= 0.451);
      const forward = mapping(x, y),
        reorder = reversed(x, y);
      assert.ok(Math.hypot(forward.x - reorder.x, forward.y - reorder.y) < 1e-9);
      const smaller = sameShapeAtHalfScale(x / 2, y / 2);
      assert.ok(Math.hypot(forward.x - 2 * smaller.x, forward.y - 2 * smaller.y) < 1e-9);
    }
  const x = 0.44 * dimensions.width,
    y = 0.51 * dimensions.height;
  const locked = mapping(x, y),
    free = unpinned(x, y);
  assert.ok(Math.hypot(locked.x - x, locked.y - y) < Math.hypot(free.x - x, free.y - y));
  assert.deepEqual(mapping(260, 30), { x: 260, y: 30 });
  assert.deepEqual(
    compileFaceWarp(
      anchors.map((a) => ({ ...a, strength: 0 })),
      dimensions,
    )(100, 100),
    { x: 100, y: 100 },
  );
});

test('an eye transform preserves the jaw displacement and shares a bounded inverse map', () => {
  const jaw: FaceWarpAnchorV3[] = [
    {
      mode: 'push',
      from: { x: 0.34, y: 0.67 },
      to: { x: 0.39, y: 0.67 },
      radius: 0.19,
      strength: 1,
    },
    {
      mode: 'push',
      from: { x: 0.66, y: 0.67 },
      to: { x: 0.61, y: 0.67 },
      radius: 0.19,
      strength: 1,
    },
  ];
  const eye: FaceWarpAnchorV3 = {
    mode: 'affine',
    from: { x: 0.39, y: 0.42 },
    to: { x: 0.39, y: 0.42 },
    radius: 0.09,
    strength: 1,
    affine: { radiusY: 0.037, axis: -12, scaleX: 1.23, scaleY: 1.26, rotation: 6 },
  };
  const contour = compileFaceWarp(jaw, dimensions);
  const feature = compileFaceWarp([eye], dimensions);
  const combined = compileFaceWarp([...jaw, eye], dimensions);
  const [jawX, jawY] = [jaw[0]!.from.x * dimensions.width, jaw[0]!.from.y * dimensions.height];
  const [eyeX, eyeY] = [eye.from.x * dimensions.width + 7, eye.from.y * dimensions.height - 2];
  assert.ok(contour(jawX, jawY).x < jawX - 5);
  assert.ok(Math.abs(combined(jawX, jawY).x - contour(jawX, jawY).x) < 0.25);
  assert.ok(feature(eyeX, eyeY).x < eyeX - 0.5);
  assert.ok(Math.abs(combined(eyeX, eyeY).x - feature(eyeX, eyeY).x) < 0.25);
  for (let y = 66; y < 175; y += 2) {
    for (let x = 58; x < 240; x += 2) {
      const a = combined(x, y);
      const b = combined(x + 1, y);
      const c = combined(x, y + 1);
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      assert.ok(area > 0.05, 'the combined field must preserve local orientation');
    }
  }
});

test('scene protection pins a background line without flattening a distant eye adjustment', () => {
  const eye: FaceWarpAnchorV3 = {
    mode: 'affine',
    from: { x: 0.43, y: 0.34 },
    to: { x: 0.43, y: 0.34 },
    radius: 0.11,
    strength: 1,
    affine: { radiusY: 0.057, axis: 0, scaleX: 1.1, scaleY: 1.13, rotation: 0 },
  };
  const jaw: FaceWarpAnchorV3 = {
    mode: 'push',
    from: { x: 0.38, y: 0.70 },
    to: { x: 0.48, y: 0.70 },
    radius: 0.19,
    strength: 1,
  };
  const line = (x: number, y: number) =>
    y > 0.52 ? Math.max(0, 1 - Math.max(0, Math.abs(x - 0.38) - 0.003) / 0.012) : 0;
  const feature = compilePortraitWarp([eye], undefined, dimensions, line);
  const combined = compilePortraitWarp([eye, jaw], undefined, dimensions, line);
  const top = { x: 129, y: 69 };
  const foot = { x: 114, y: 156 };
  assert.deepEqual(combined(foot.x, foot.y), foot);
  const expected = feature(top.x, top.y).y - top.y;
  const retained = combined(top.x, top.y).y - top.y;
  assert.ok(expected > 0.5 && retained > expected * 0.65);
  for (let y = 100; y < 185; y += 2)
    for (let x = 70; x < 158; x += 2) {
      const a = combined(x, y), b = combined(x + 1, y), c = combined(x, y + 1);
      assert.ok((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) > 0.05);
    }
});

test('face contour is signed, preserves the central features and reaches the fitted outline without folding', () => {
  const contour: FaceContourV3 = {
    center: { x: 0.52, y: 0.37 },
    axis: 24,
    rows: [
      {
        y: -0.12,
        left: -0.24,
        right: 0.21,
        leftCore: -0.13,
        rightCore: 0.12,
        leftShift: 0,
        rightShift: 0,
      },
      {
        y: 0.06,
        left: -0.26,
        right: 0.23,
        leftCore: -0.13,
        rightCore: 0.12,
        leftShift: 0.012,
        rightShift: 0.009,
      },
      {
        y: 0.23,
        left: -0.2,
        right: 0.18,
        leftCore: -0.1,
        rightCore: 0.1,
        leftShift: 0.009,
        rightShift: 0.011,
      },
      {
        y: 0.31,
        left: -0.07,
        right: 0.08,
        leftCore: -0.035,
        rightCore: 0.043,
        leftShift: 0,
        rightShift: 0,
      },
    ],
  };
  for (const sign of [-1, 1]) {
    const profile = {
      ...contour,
      rows: contour.rows.map((row) => ({
        ...row,
        leftShift: row.leftShift * sign,
        rightShift: row.rightShift * sign,
      })),
    };
    const map = compileFaceContour(profile, dimensions);
    const half = compileFaceContour(profile, { width: 150, height: 110 });
    const bounds = faceContourBounds(profile, dimensions);
    const angle = (contour.axis * Math.PI) / 180;
    const axis = { x: Math.cos(angle), y: Math.sin(angle) };
    const pixel = (u: number, v: number) => ({
      x: contour.center.x * dimensions.width + dimensions.height * (axis.x * u - axis.y * v),
      y: contour.center.y * dimensions.height + dimensions.height * (axis.y * u + axis.x * v),
    });
    const sample = (u: number, v: number) => {
      const p = pixel(u, v);
      return map(p.x, p.y);
    };
    const row = profile.rows[1]!;
    const left = sample(row.left + row.leftShift, row.y);
    const original = pixel(row.left, row.y);
    assert.ok(Math.hypot(left.x - original.x, left.y - original.y) < 0.05);
    assert.deepEqual(sample(0, row.y), pixel(0, row.y));
    assert.deepEqual(sample(0.45, row.y), pixel(0.45, row.y));
    for (let v = -0.13; v <= 0.33; v += 0.013) {
      for (let u = -0.36; u <= 0.34; u += 0.007) {
        const p = pixel(u, v);
        const a = map(p.x, p.y);
        const b = sample(u + 0.001, v);
        assert.ok((b.x - a.x) * axis.x + (b.y - a.y) * axis.y > 0.1);
        const small = half(p.x / 2, p.y / 2);
        assert.ok(Math.hypot(a.x - 2 * small.x, a.y - 2 * small.y) < 1e-8);
        if (a.x !== p.x || a.y !== p.y) {
          assert.ok(
            p.x > bounds.left && p.x < bounds.right && p.y > bounds.top && p.y < bounds.bottom,
          );
        }
      }
    }
  }
  const operation: WarpStrokeV3 = {
    ...stroke('push', 1),
    algorithm: 'face-field-v2',
    anchors: [],
    contour,
    resampling: 'bounded-cubic-v1',
  };
  const recipe = createRecipeV4({
    warp: { enabled: true, protection: null, strokes: [operation] },
  });
  const source: RGBAImage = {
    ...dimensions,
    data: Uint8ClampedArray.from({ length: dimensions.width * dimensions.height * 4 }, (_, i) =>
      i % 4 === 3 ? 255 : (i * 13) % 251,
    ),
  };
  assert.deepEqual(
    renderEditorRecipeTiled(source, recipe, { tileSize: 65 }),
    renderEditorRecipe(source, recipe),
  );
  assert.deepEqual(parseEditorRecipe(JSON.parse(JSON.stringify(recipe))), recipe);
  assert.throws(
    () =>
      createRecipeV4({
        warp: { ...recipe.warp, strokes: [{ ...operation, algorithm: 'face-field-v1' }] },
      }),
    /contour: requires face-field-v2/,
  );
  const rows = [...contour.rows].reverse();
  assert.throws(
    () =>
      createRecipeV4({
        warp: { ...recipe.warp, strokes: [{ ...operation, contour: { ...contour, rows } }] },
      }),
    /strictly increasing/,
  );
});
