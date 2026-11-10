import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecipeV3, createRecipeV4, compileEditorCoordinateMap } from '@ai-xiutu/editor';
import {
  editorGeometryKey,
  sourcePointer,
  projectOverlayPoint,
  projectOverlayPath,
} from '../src/editor/coordinates';

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

test('paint and sampling reject pixels removed by an intermediate V4 viewport, but accept transparent source pixels', () => {
  const dimensions = { width: 100, height: 100 };
  const recipe = createRecipeV4({
    transform: { translateX: 0.5, fit: 'crop' },
    projective: {
      enabled: true,
      fit: 'crop',
      corners: [
        { x: -0.5, y: 0 },
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
        { x: -0.5, y: 1 },
      ],
    },
  });
  const map = compileEditorCoordinateMap(dimensions, recipe);
  const frame = { left: 20, top: 50, width: 200, height: 200 };
  assert.equal(sourcePointer({ x: 170, y: 150 }, frame, map, false, 'strict'), null);
  assert.ok(sourcePointer({ x: 70, y: 150 }, frame, map, false, 'strict'));
  const transparent = { ...dimensions, data: new Uint8ClampedArray(100 * 100 * 4) };
  assert.ok(
    sourcePointer(
      { x: 120, y: 150 },
      frame,
      compileEditorCoordinateMap(dimensions, createRecipeV4(), transparent),
      true,
      'strict',
    ),
  );
});

test('valid quad with a cropped source horizon omits impossible UI points without changing the render map', () => {
  const map = compileEditorCoordinateMap(
    { width: 32, height: 32 },
    createRecipeV4({
      geometry: { crop: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 } },
      projective: {
        enabled: true,
        fit: 'contain',
        corners: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 / 3 },
          { x: 0, y: 1 },
        ],
      },
    }),
  );
  const horizon = { x: 0, y: 0.5 },
    valid = { x: 0.5, y: 0.5 };
  assert.throws(() => map.toOutput(horizon), /horizon/);
  assert.equal(projectOverlayPoint(horizon, map.toOutput), null);
  assert.equal(projectOverlayPath([valid, horizon], map.toOutput), null);
  assert.deepEqual(projectOverlayPoint(valid, map.toOutput), map.toOutput(valid));
  assert.deepEqual(projectOverlayPath([valid], map.toOutput), [map.toOutput(valid)]);
  assert.deepEqual(
    projectOverlayPoint({ x: -0.1, y: 0.5 }, (p) => p),
    { x: -0.1, y: 0.5 },
    'ordinary off-frame handles stay movable',
  );
  assert.equal(
    projectOverlayPoint(valid, () => ({ x: Infinity, y: NaN })),
    null,
  );
});
