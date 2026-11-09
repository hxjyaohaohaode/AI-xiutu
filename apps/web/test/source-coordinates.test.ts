import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeV3, compileEditorCoordinateMap } from '@ai-xiutu/editor';
import { editorGeometryKey, sourcePointer } from '../src/editor/coordinates';

test('render readiness includes active displacement and protection but excludes disabled warp edits', () => {
  const base = createRecipeV3();
  const stroke = {
    id: 'stroke',
    mode: 'push' as const,
    from: { x: 0.4, y: 0.5 },
    to: { x: 0.6, y: 0.5 },
    radius: 0.2,
    feather: 0.7,
    strength: 0.5,
  };
  const disabled = createRecipeV3({ warp: { enabled: false, strokes: [stroke] } });
  assert.equal(editorGeometryKey(base), editorGeometryKey(disabled));
  const active = createRecipeV3({ warp: { enabled: true, strokes: [stroke] } });
  assert.notEqual(editorGeometryKey(base), editorGeometryKey(active));
  const protectedRecipe = createRecipeV3({
    warp: {
      ...active.warp,
      protection: {
        type: 'radial',
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.2,
        radiusY: 0.2,
        feather: 0.2,
        invert: false,
      },
    },
  });
  assert.notEqual(editorGeometryKey(active), editorGeometryKey(protectedRecipe));
});

test('painting and source sampling reject transparent contain corners while shape handles can clamp', () => {
  const recipe = createRecipeV3({ transform: { rotationDegrees: 45 } });
  const map = compileEditorCoordinateMap({ width: 200, height: 100 }, recipe);
  const frame = { left: 30, top: 70, width: 600, height: 600 };
  assert.equal(sourcePointer({ x: 31, y: 71 }, frame, map, true, 'strict'), null);
  const center = sourcePointer({ x: 330, y: 370 }, frame, map, true, 'strict')!;
  assert(Math.abs(center.x - 0.5) < 0.01 && Math.abs(center.y - 0.5) < 0.01);
  const corner = sourcePointer({ x: 31, y: 71 }, frame, map, false, 'clamp')!;
  assert(corner.x >= 0 && corner.x <= 1 && corner.y >= 0 && corner.y <= 1);
  assert.equal(sourcePointer({ x: 0, y: 0 }, frame, map, false, 'strict'), null);
  assert.equal(sourcePointer({ x: 0, y: 0 }, { ...frame, width: 0 }, map, false, 'strict'), null);
});

test('layer handles retain off-frame freedom and pixel painting follows inverse displacement', () => {
  const frame = { left: 0, top: 0, width: 200, height: 200 };
  const neutral = compileEditorCoordinateMap({ width: 200, height: 200 }, createRecipeV3());
  assert.equal(sourcePointer({ x: -50, y: 100 }, frame, neutral, false, 'unbounded')!.x, -0.25);
  const warped = compileEditorCoordinateMap(
    { width: 200, height: 200 },
    createRecipeV3({
      warp: {
        enabled: true,
        strokes: [
          {
            id: 'push',
            mode: 'push',
            from: { x: 0.4, y: 0.5 },
            to: { x: 0.6, y: 0.5 },
            radius: 0.4,
            feather: 0.7,
            strength: 0.8,
          },
        ],
      },
    }),
  );
  const content = sourcePointer({ x: 120, y: 100 }, frame, warped, true, 'strict')!;
  const geometry = sourcePointer({ x: 120, y: 100 }, frame, warped, false, 'strict')!;
  assert.notEqual(content.x, geometry.x);
  assert.equal(geometry.x, 0.6);
});
