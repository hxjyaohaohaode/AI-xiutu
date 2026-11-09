import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV3,
  createRecipeV2,
  createRecipe,
  migrateRecipeToV3,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  getEditorOutputDimensions,
  mapEditorSourceToOutput,
  mapEditorOutputToSource,
  compileEditorCoordinateMap,
  MAX_V3_PIXELS,
  RenderAbortedError,
  type RGBAImage,
} from '../src/index.js';
const image = (w: number, h: number): RGBAImage => ({
  width: w,
  height: h,
  data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) =>
    i % 4 === 3 ? (Math.floor(i / 4) % 3 === 0 ? 128 : 255) : (i * 31 + 7) % 256,
  ),
});
const close = (a: number, b: number) => assert(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('v3 neutral migration reproduces original v1/v2 bytes including legacy locals, crop and alpha', () => {
  const source = image(35, 21);
  const inputs = [
    createRecipe({
      adjustments: { exposure: 0.3, sharpness: 5 },
      geometry: { rotation: 270, flipX: true, crop: { x: 0.1, y: 0.1, width: 0.7, height: 0.8 } },
    }),
    createRecipeV2({
      hsl: { orange: { hue: 13 } },
      effects: { grain: { amount: 12 } },
      geometry: { rotation: 90, flipY: true },
    }),
  ];
  for (const old of inputs) {
    const expected = renderEditorRecipe(source, old),
      r = migrateRecipeToV3(old);
    assert.deepEqual(renderEditorRecipe(source, r), expected);
    assert.deepEqual(renderEditorRecipeTiled(source, r, { tileSize: 16 }), expected);
  }
});
test('all-angle affine/projective source/output mappings round-trip through integer crop and quarter turns', () => {
  const dimensions = { width: 300, height: 240 };
  for (const angle of [-137.82, -5.25, 0, 47.19, 180])
    for (const rotation of [0, 90, 180, 270] as const) {
      const r = createRecipeV3({
        geometry: {
          crop: { x: 0.123, y: 0.2, width: 0.6, height: 0.7 },
          rotation,
          flipX: rotation === 90,
          flipY: rotation === 180,
        },
        transform: {
          rotationDegrees: angle,
          perspectiveX: 21.4,
          perspectiveY: -12.5,
          skewX: 8.3,
          skewY: 4.1,
          scaleX: 1.1,
          scaleY: 0.9,
        },
      });
      for (const point of [
        { x: 0.2, y: 0.3 },
        { x: 0.5, y: 0.5 },
        { x: 0.7, y: 0.8 },
      ]) {
        const q = mapEditorSourceToOutput(point, dimensions, r),
          back = mapEditorOutputToSource(q, dimensions, r);
        close(back.x, point.x);
        close(back.y, point.y);
      }
    }
});
test('fine exact quarter-turn rotation swaps dimensions and produces no extra border pixels', () => {
  const source = image(4, 3),
    fine = createRecipeV3({ transform: { rotationDegrees: 90 } }),
    legacy = createRecipeV3({ geometry: { rotation: 90 } });
  assert.deepEqual(getEditorOutputDimensions(source, fine), { width: 3, height: 4 });
  assert.deepEqual(renderEditorRecipe(source, fine), renderEditorRecipe(source, legacy));
  const square = image(3, 3);
  assert.deepEqual(getEditorOutputDimensions(square, fine), { width: 3, height: 3 });
  assert.deepEqual(renderEditorRecipe(square, fine), renderEditorRecipe(square, legacy));
});
test('fine fractional rotation adds real transparent support and crop mode retains the chosen output frame', () => {
  const source = { width: 20, height: 10, data: new Uint8ClampedArray(20 * 10 * 4).fill(255) };
  const contain = createRecipeV3({ transform: { rotationDegrees: 35.25 } }),
    crop = createRecipeV3({ transform: { rotationDegrees: 35.25, fit: 'crop' } });
  const expanded = renderEditorRecipe(source, contain);
  assert(expanded.width > 20);
  assert(expanded.height > 10);
  assert.equal(expanded.data[3], 0);
  assert.deepEqual(getEditorOutputDimensions(source, crop), { width: 20, height: 10 });
  assert(renderEditorRecipe(source, crop).data.some((v, i) => i % 4 === 3 && v < 255));
});
test('fine quarter turns preserve hidden transparent RGB across round-off in both rotation directions', () => {
  for (const [width, height] of [
    [4, 3],
    [3, 4],
    [7, 9],
    [9, 7],
    [1, 4],
  ]) {
    const source = image(width!, height!);
    for (let i = 3; i < source.data.length; i += 8) source.data[i] = 0;
    for (const angle of [-90, 90, 180] as const) {
      const expected = renderEditorRecipe(
        source,
        createRecipeV3({ geometry: { rotation: angle === -90 ? 270 : angle } }),
      );
      assert.deepEqual(
        renderEditorRecipe(source, createRecipeV3({ transform: { rotationDegrees: angle } })),
        expected,
      );
    }
  }
});
test('compiled frame mapping retains exact legacy crop quantization and every quarter-turn/flip convention', () => {
  const dimensions = { width: 123, height: 91 };
  for (const rotation of [0, 90, 180, 270] as const)
    for (const flipX of [false, true])
      for (const flipY of [false, true]) {
        const recipe = createRecipeV3({
          geometry: {
            crop: { x: 0.113, y: 0.219, width: 0.627, height: 0.581 },
            rotation,
            flipX,
            flipY,
          },
          transform: { rotationDegrees: 12.51, perspectiveX: 13.4, perspectiveY: -7.2 },
        });
        const compiled = compileEditorCoordinateMap(dimensions, recipe);
        for (const point of [
          { x: 0.1, y: 0.2 },
          { x: 0.5, y: 0.7 },
          { x: 1.1, y: -0.1 },
        ]) {
          const expected = mapEditorSourceToOutput(point, dimensions, recipe),
            actual = compiled.toOutput(point),
            inverse = compiled.toSource(expected);
          close(actual.x, expected.x);
          close(actual.y, expected.y);
          close(inverse.x, point.x);
          close(inverse.y, point.y);
        }
        assert.throws(() => compiled.toSource({ x: NaN, y: 0 }), /finite/);
      }
});
test('translation and independent axis scales are real geometric operations with invertible hit testing', () => {
  const source = image(10, 10),
    r = createRecipeV3({
      transform: { fit: 'crop', translateX: 0.2, translateY: -0.1, scaleX: 1.2, scaleY: 0.8 },
    });
  const p = mapEditorSourceToOutput({ x: 0.5, y: 0.5 }, source, r);
  close(p.x, 0.7);
  close(p.y, 0.4);
  assert.notDeepEqual(renderEditorRecipe(source, r).data, source.data);
  assert.equal(renderEditorRecipe(source, r).data.at(-1), 0);
});
test('v3 geometry validates allocation budgets and singular or horizon-crossing transforms before rendering', () => {
  const source = image(50, 50);
  assert.throws(
    () =>
      renderEditorRecipe(source, createRecipeV3({ transform: { scaleX: 4, scaleY: 4 } }), {
        maxPixels: 10000,
      }),
    /budget/,
  );
  assert.throws(
    () => renderEditorRecipeTiled(source, createRecipeV3(), { maxPixels: MAX_V3_PIXELS + 1 }),
    /V3 render/,
  );
  assert.throws(() => createRecipeV3({ transform: { skewX: 45, skewY: 45 } }), /singular/);
  assert.throws(
    () =>
      getEditorOutputDimensions(
        source,
        createRecipeV3({ transform: { perspectiveX: 60, skewX: 60, scaleX: 4, scaleY: 4 } }),
      ),
    /horizon/,
  );
});
test('premultiplied linear reconstruction excludes hidden transparent colors and preserves neutral transparent data', () => {
  const source = {
    width: 2,
    height: 1,
    data: new Uint8ClampedArray([255, 0, 0, 0, 0, 0, 255, 255]),
  };
  assert.deepEqual(renderEditorRecipe(source, createRecipeV3()).data, source.data);
  const rendered = renderEditorRecipe(
    source,
    createRecipeV3({ transform: { fit: 'crop', translateX: 0.25 } }),
  );
  assert.equal(rendered.data[4], 0);
  assert.equal(rendered.data[6], 255);
  assert(rendered.data[7]! > 0 && rendered.data[7]! < 255);
});
test('v3 rendering is cancellable at admission and through repeated pixel-row checks', () => {
  const source = image(50, 40),
    r = createRecipeV3({ transform: { rotationDegrees: 22.5 } });
  assert.throws(
    () => renderEditorRecipe(source, r, { signal: { aborted: true } }),
    RenderAbortedError,
  );
  let reads = 0;
  assert.throws(
    () =>
      renderEditorRecipeTiled(source, r, {
        signal: {
          get aborted() {
            return ++reads > 5;
          },
        },
      }),
    RenderAbortedError,
  );
  assert(reads > 5);
});

test('compiled gesture coordinates distinguish frame controls from inverse-warp content picking', async () => {
  const { compileEditorCoordinateMap } = await import('../src/index.js');
  const source = image(20, 20),
    r = createRecipeV3({
      warp: {
        strokes: [
          {
            id: 'move',
            mode: 'push',
            from: { x: 0.5, y: 0.5 },
            to: { x: 0.6, y: 0.5 },
            radius: 0.3,
            feather: 0.3,
            strength: 0.5,
          },
        ],
      },
      transform: { rotationDegrees: 12.5 },
    });
  const map = compileEditorCoordinateMap(source, r, source),
    display = map.toOutput({ x: 0.5, y: 0.5 });
  close(map.toSource(display).x, 0.5);
  assert(map.toContent(display).x < 0.5);
});
