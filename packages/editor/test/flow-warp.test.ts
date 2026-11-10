import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  parseEditorRecipe,
  type WarpStrokeV3,
} from '../src/index.js';
import { compileWarpFieldV3 } from '../src/v3-warp.js';

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
