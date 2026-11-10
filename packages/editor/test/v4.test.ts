import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV3,
  createRecipeV4,
  migrateRecipeToV4,
  migrateRecipeToV3,
  parseEditorRecipe,
  parseRecipeV4,
  setEditorParameter,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  compileProjectiveTransformV4,
  applyProjectiveMatrixV4,
  compileEditorCoordinateMap,
  compileFineTransformV3,
  mapProjectiveOutputToCornerFrame,
  mapProjectiveCornerFrameToOutput,
  getEditorPreProjectiveDimensions,
  createHealingOperationV4,
  createRetouchRegionV4,
  createAdjustmentRegionV3,
  RenderAbortedError,
  type RGBAImage,
  type SelectionMaskV3,
} from '../src/index.js';

function image(width = 48, height = 37): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      data.set([50 + x * 3 + (y % 5) * 4, 40 + y * 3, 110 + ((x + y) % 7) * 8, 255], at);
    }
  return { width, height, data };
}
const radial = (x = 0.5, y = 0.5, radius = 0.12): SelectionMaskV3 => ({
  type: 'radial',
  centerX: x,
  centerY: y,
  radiusX: radius,
  radiusY: radius,
  feather: 0,
  invert: false,
});
const close = (actual: number, expected: number, eps = 1e-8) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} != ${expected}`);

test('V4 migration is exact for old colors, masks, integer/fine geometry, paint and warp, and generic edits retain additions', () => {
  const source = image(),
    before = structuredClone(source.data),
    r3 = createRecipeV3({
      adjustments: { exposure: 0.4, shadows: -12 },
      geometry: { crop: { x: 0.07, y: 0.12, width: 0.8, height: 0.77 }, rotation: 90, flipX: true },
      transform: { rotationDegrees: 12.37, perspectiveX: 9, skewY: -3 },
      regionEdits: [
        createAdjustmentRegionV3({ id: 'a', color: { adjustments: { temperature: 12 } } }),
      ],
      warp: {
        enabled: true,
        protection: null,
        strokes: [
          {
            id: 'w',
            mode: 'push',
            from: { x: 0.5, y: 0.5 },
            to: { x: 0.55, y: 0.5 },
            radius: 0.25,
            feather: 0.4,
            strength: -0.3,
          },
        ],
      },
    });
  const r4 = migrateRecipeToV4(r3);
  assert.deepEqual(renderEditorRecipe(source, r4), renderEditorRecipe(source, r3));
  assert.deepEqual(
    renderEditorRecipeTiled(source, r4, { tileSize: 16 }),
    renderEditorRecipe(source, r3),
  );
  assert.deepEqual(source.data, before);
  r4.projective.enabled = true;
  r4.projective.corners[1].y = 0.1;
  r4.healing.push(createHealingOperationV4({ method: 'diffusion' }));
  r4.retouch.push(createRetouchRegionV4({ texture: 22 }));
  const edited = setEditorParameter(r4, 'adjustments.brightness', 15);
  assert.equal(edited.schemaVersion, 4);
  if (edited.schemaVersion !== 4) throw new Error('v4 expected');
  assert.deepEqual(edited.projective, r4.projective);
  assert.deepEqual(edited.healing, r4.healing);
  assert.deepEqual(edited.retouch, r4.retouch);
  assert.throws(() => migrateRecipeToV3(r4), /downgraded/);
  assert.deepEqual(parseEditorRecipe(JSON.parse(JSON.stringify(r4))), r4);
});

test('true homography maps all four arbitrary corners and its inverse exactly rather than an affine fit', () => {
  const r = createRecipeV4({
    projective: {
      enabled: true,
      fit: 'crop',
      corners: [
        { x: 0.03, y: 0.19 },
        { x: 0.9, y: -0.06 },
        { x: 1.08, y: 0.88 },
        { x: 0.21, y: 1.06 },
      ],
    },
  });
  const dimensions = { width: 1500, height: 900 },
    compiled = compileProjectiveTransformV4(dimensions, r.projective);
  assert.ok(Math.abs(compiled.matrix[6]) + Math.abs(compiled.matrix[7]) > 1e-7);
  for (const [i, p] of [
    { x: 0, y: 0 },
    { x: 1500, y: 0 },
    { x: 1500, y: 900 },
    { x: 0, y: 900 },
  ].entries()) {
    const result = applyProjectiveMatrixV4(compiled.matrix, p),
      back = applyProjectiveMatrixV4(compiled.inverse, result);
    close(result.x, r.projective.corners[i]!.x * 1500);
    close(result.y, r.projective.corners[i]!.y * 900);
    close(back.x, p.x);
    close(back.y, p.y);
  }
});

test('four-corner coordinates compose with old crop, rotations, flips, fine transform and content warp', () => {
  const r = createRecipeV4({
    geometry: { crop: { x: 0.15, y: 0.1, width: 0.7, height: 0.8 }, rotation: 270, flipY: true },
    transform: { rotationDegrees: -17.01, scaleX: 1.12, perspectiveX: 7, skewY: -4 },
    projective: {
      enabled: true,
      corners: [
        { x: -0.1, y: 0.05 },
        { x: 1.2, y: 0.13 },
        { x: 0.93, y: 1.1 },
        { x: 0.08, y: 0.9 },
      ],
    },
    warp: {
      enabled: true,
      strokes: [
        {
          id: 'push',
          mode: 'push',
          from: { x: 0.5, y: 0.5 },
          to: { x: 0.6, y: 0.5 },
          radius: 0.3,
          strength: 0.3,
          feather: 0.5,
        },
      ],
    },
  });
  const source = image(97, 63),
    map = compileEditorCoordinateMap(source, r, source);
  for (const p of [
    { x: 0.2, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.87, y: 0.9 },
  ]) {
    const back = map.toSource(map.toOutput(p));
    close(back.x, p.x);
    close(back.y, p.y);
  }
  assert.notDeepEqual(map.toContent(map.toOutput({ x: 0.5, y: 0.5 })), { x: 0.5, y: 0.5 });
  const pre = getEditorPreProjectiveDimensions(source, r);
  for (const corner of r.projective.corners) {
    const shown = mapProjectiveCornerFrameToOutput(corner, pre, r.projective),
      back = mapProjectiveOutputToCornerFrame(shown, pre, r.projective);
    close(back.x, corner.x);
    close(back.y, corner.y);
  }
  const result = renderEditorRecipe(source, r);
  assert.equal(result.width, map.dimensions.width);
  assert.equal(result.height, map.dimensions.height);
  assert.deepEqual(renderEditorRecipeTiled(source, r, { tileSize: 16 }), result);
});

test('crossed, concave, collapsed, mirrored, unknown and oversized quadrilaterals fail before pixel allocation', () => {
  for (const corners of [
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.2, y: 0.2 },
      { x: 0, y: 1 },
    ],
    [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    [
      { x: 1, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
  ])
    assert.throws(
      () => createRecipeV4({ projective: { corners: corners as never } }),
      /quad|cross|collapse/,
    );
  const tooLarge = createRecipeV4({
    projective: {
      enabled: true,
      corners: [
        { x: -2, y: -2 },
        { x: 3, y: -2 },
        { x: 3, y: 3 },
        { x: -2, y: 3 },
      ],
    },
  });
  assert.throws(
    () => compileEditorCoordinateMap({ width: 4096, height: 4096 }, tooLarge),
    /budget|dimension|pixels|16384/,
  );
  let invoked = false;
  const bad = Object.defineProperty({}, 'radius', {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    },
  });
  assert.throws(() => createHealingOperationV4(bad));
  assert.equal(invoked, false);
  assert.throws(() => parseRecipeV4({ ...createRecipeV4(), hallucination: true }), /unknown/);
});

test('integer corner translation is a real transparent relocation and contain fitting retains the complete image', () => {
  const source = image(16, 12),
    recipe = createRecipeV4({
      projective: {
        enabled: true,
        fit: 'crop',
        corners: [
          { x: 0.25, y: 0 },
          { x: 1.25, y: 0 },
          { x: 1.25, y: 1 },
          { x: 0.25, y: 1 },
        ],
      },
    });
  const moved = renderEditorRecipe(source, recipe);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 16; x++)
      assert.deepEqual(
        [...moved.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)],
        x < 4
          ? [0, 0, 0, 0]
          : [...source.data.slice((y * 16 + x - 4) * 4, (y * 16 + x - 4) * 4 + 4)],
      );
  recipe.projective.fit = 'contain';
  assert.deepEqual(renderEditorRecipe(source, recipe), source);
});

test('unused projective horizons are transparent and hit testing respects each clipped viewport without rejecting source transparency', () => {
  const source = image(16, 16),
    r = createRecipeV4({
      projective: {
        enabled: true,
        fit: 'crop',
        corners: [
          { x: 0.375, y: 0.375 },
          { x: 0.625, y: 0.25 },
          { x: 0.875, y: 1 },
          { x: 0.25, y: 0.875 },
        ],
      },
    });
  const out = renderEditorRecipe(source, r),
    map = compileEditorCoordinateMap(source, r);
  assert.deepEqual(renderEditorRecipeTiled(source, r, { tileSize: 16 }), out);
  assert.equal(map.containsOutput({ x: 0, y: 0 }), false);
  assert.equal(map.containsOutput(map.toOutput({ x: 0.5, y: 0.5 })), true);
  // Source x=.05 is inside the original, but outside the retained legacy crop.
  const crop = createRecipeV4({
    geometry: { crop: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 } },
    transform: { scaleX: 0.5, fit: 'crop' },
  });
  const clipped = compileEditorCoordinateMap(source, crop);
  assert.equal(clipped.containsOutput(clipped.toOutput({ x: 0.05, y: 0.5 })), false);
  assert.equal(clipped.containsOutput(clipped.toOutput({ x: 0.5, y: 0.5 })), true);
  // Fine crop precedes projective relocation, even when inverse source is valid.
  const intermediate = createRecipeV4({
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
  const middle = compileEditorCoordinateMap(source, intermediate);
  assert.equal(middle.containsOutput({ x: 0.75, y: 0.5 }), false);
  assert.equal(middle.containsOutput({ x: 0.25, y: 0.5 }), true);
  source.data.fill(0);
  assert.equal(
    compileEditorCoordinateMap(source, createRecipeV4()).containsOutput({ x: 0.5, y: 0.5 }),
    true,
  );
});

test('a valid fine-transform inverse horizon followed by a corner transform stays transparent instead of aborting the complete render', () => {
  const source = image(32, 32),
    r = createRecipeV4({
      transform: {
        rotationDegrees: 6.323717840166623,
        perspectiveX: 55.15049312037904,
        perspectiveY: 34.337874210596965,
        skewX: 36.65185750306205,
        skewY: 47.76905396383677,
        scaleX: 2.108166170077476,
        scaleY: 0.7488204921357429,
      },
    });
  const fine = compileFineTransformV3(source, r.transform),
    y = 50.5,
    x = -(fine.inverse[7] * y + fine.inverse[8]) / fine.inverse[6],
    shift = (1.5 - x) / fine.dimensions.width;
  r.projective = {
    enabled: true,
    fit: 'crop',
    corners: [
      { x: shift, y: 0 },
      { x: 1 + shift, y: 0 },
      { x: 1 + shift, y: 1 },
      { x: shift, y: 1 },
    ],
  };
  const rendered = renderEditorRecipe(source, r),
    at = (50 * rendered.width + 1) * 4;
  assert.deepEqual([...rendered.data.subarray(at, at + 4)], [0, 0, 0, 0]);
  assert.deepEqual(renderEditorRecipeTiled(source, r, { tileSize: 16 }), rendered);
  assert.equal(
    compileEditorCoordinateMap(source, r).containsOutput({
      x: 1.5 / rendered.width,
      y: y / rendered.height,
    }),
    false,
  );
  assert.ok(
    rendered.data.some((v, i) => i % 4 === 3 && v > 0),
    'the valid image region still renders',
  );
});

test('diffusion genuinely removes an isolated defect while exact unselected/protected pixels and source remain intact', () => {
  const source = image(31, 31);
  for (let y = 0; y < 31; y++)
    for (let x = 0; x < 31; x++)
      source.data.set([80 + x + y, 80 + x + y, 80 + x + y, 255], (y * 31 + x) * 4);
  const center = (15 * 31 + 15) * 4;
  source.data.set([5, 5, 5, 255], center);
  const before = source.data.slice();
  const r = createRecipeV4({
    healing: [
      createHealingOperationV4({
        method: 'diffusion',
        mask: radial(0.5, 0.5, 0.12),
        iterations: 160,
      }),
    ],
  });
  const result = renderEditorRecipe(source, r);
  assert.ok(Math.abs(result.data[center]! - 110) <= 2);
  assert.deepEqual(source.data, before);
  for (let i = 0; i < source.data.length; i += 4)
    if (Math.hypot(((i / 4) % 31) - 15, Math.floor(i / 4 / 31) - 15) > 4)
      assert.deepEqual(result.data.slice(i, i + 4), source.data.slice(i, i + 4));
  r.healing[0]!.protection = radial(0.5, 0.5, 0.04);
  const protectedResult = renderEditorRecipe(source, r);
  assert.equal(protectedResult.data[center], 5);
  r.healing[0]!.opacity = 0;
  assert.deepEqual(renderEditorRecipe(source, r), source);
});

test('patch-Poisson transfers donor gradients while matching target boundary instead of cloning donor brightness', () => {
  const source = image(64, 32);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 64; x++) {
      const v = x < 32 ? 160 : 65 + Math.round(Math.cos(y * 1.3) * 15 + Math.sin(x * 1.1) * 8);
      source.data.set([v, v, v, 255], (y * 64 + x) * 4);
    }
  const r = createRecipeV4({
    healing: [
      createHealingOperationV4({
        mask: radial(0.25, 0.5, 0.12),
        source: { x: 0.75, y: 0.5 },
        iterations: 240,
        texture: 1,
      }),
    ],
  });
  const rendered = renderEditorRecipe(source, r),
    at = (16 * 64 + 16) * 4;
  assert.ok(rendered.data[at]! > 100, 'boundary compensates the donor brightness');
  assert.notEqual(rendered.data[at], source.data[at], 'donor texture changes actual target pixels');
  assert.deepEqual(renderEditorRecipeTiled(source, r, { tileSize: 16 }), rendered);
  r.healing[0]!.source = { x: 0.25, y: 0.5 };
  assert.throws(() => renderEditorRecipe(source, r), /donor/);
  r.healing[0]!.source = null;
  r.healing[0]!.searchRadius = 1.2;
  assert.doesNotThrow(() => renderEditorRecipe(source, r));
});

test('dedicated retouch operators have distinct pixel effects, signed detail, exact neutrality and protection', () => {
  const source = image(47, 39),
    data = source.data;
  for (let y = 4; y < 35; y++)
    for (let x = 4; x < 43; x++) {
      const at = (y * 47 + x) * 4,
        noise = ((x * 13 + y * 7) % 11) - 5;
      data.set([180 + noise * 2, 126 + noise, 103 - noise, 255], at);
      if (x === 23 && y > 13 && y < 27) data.set([112, 79, 70, 255], at);
    }
  data.set([255, 242, 215, 255], (15 * 47 + 20) * 4);
  data.set([15, 5, 5, 255], (20 * 47 + 20) * 4);
  const signatures = new Set<string>();
  for (const key of [
    'smoothing',
    'texture',
    'uniformity',
    'shine',
    'speckle',
    'fineLines',
  ] as const) {
    const r = createRecipeV4({
      retouch: [createRetouchRegionV4({ mask: radial(0.5, 0.5, 0.4), radius: 0.1, [key]: 90 })],
    });
    const result = renderEditorRecipe(source, r);
    assert.notDeepEqual(result.data, source.data, key);
    assert.deepEqual(renderEditorRecipeTiled(source, r, { tileSize: 16 }), result);
    signatures.add(Buffer.from(result.data).toString('base64'));
    assert.deepEqual(result.data.subarray(0, 4), source.data.subarray(0, 4));
    if (key === 'texture') {
      r.retouch[0]!.texture = -90;
      assert.notDeepEqual(renderEditorRecipe(source, r).data, result.data);
    }
    r.retouch[0]![key] = 0;
    assert.deepEqual(renderEditorRecipe(source, r), source);
    r.retouch[0]![key] = 90;
    r.retouch[0]!.protection = r.retouch[0]!.mask;
    assert.deepEqual(renderEditorRecipe(source, r), source);
  }
  assert.equal(signatures.size, 6);
});

test('repair rejects unsupported transparent neighbourhood and oversized targets, and cancellation is observed inside the solver', () => {
  const source = image(39, 39),
    r = createRecipeV4({
      healing: [createHealingOperationV4({ method: 'diffusion', mask: radial(), iterations: 128 })],
    });
  source.data[(19 * 39 + 19) * 4 + 3] = 0;
  assert.throws(() => renderEditorRecipe(source, r), /opaque/);
  source.data[(19 * 39 + 19) * 4 + 3] = 255;
  let checks = 0;
  assert.throws(
    () =>
      renderEditorRecipe(source, r, {
        signal: {
          get aborted() {
            return ++checks > 18;
          },
        } as AbortSignal,
      }),
    RenderAbortedError,
  );
  const large = image(700, 700);
  r.healing[0]!.mask = radial(0.5, 0.5, 0.48);
  assert.throws(() => renderEditorRecipe(large, r), /target budget/);
  const donorEdge = image(64, 32),
    donorRecipe = createRecipeV4({
      healing: [
        createHealingOperationV4({
          mask: radial(0.25, 0.5, 0.1),
          source: { x: 0.75, y: 0.5 },
          iterations: 16,
        }),
      ],
    });
  donorEdge.data[(16 * 64 + 41) * 4 + 3] = 0; // Outside shifted target, inside its gradient neighbourhood.
  assert.throws(() => renderEditorRecipe(donorEdge, donorRecipe), /donor/);
});
