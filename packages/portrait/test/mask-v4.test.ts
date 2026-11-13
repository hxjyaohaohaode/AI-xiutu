import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compileSelectionMaskV3,
  createRecipeV3,
  createRecipeV4,
  migrateRecipeToV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  type Point,
  type RGBAImage,
} from '@ai-xiutu/editor';
import {
  applyPortraitValues,
  REFINED_PORTRAIT_ANALYSIS,
  facialMasks,
  facialMasksV4,
  portraitToolAvailability,
  portraitValues,
  type PortraitTarget,
} from '../src/index.js';
import { analysis, bodyTarget, faceTarget } from './fixtures.js';

const digest = (bytes: string | Uint8ClampedArray) =>
  createHash('sha256').update(bytes).digest('hex');
const uniform = (width = 400, height = 500): RGBAImage => ({
  width,
  height,
  data: Uint8ClampedArray.from({ length: width * height * 4 }, (_, i) => (i % 4 === 3 ? 255 : 128)),
});
const mean = (points: readonly Point[]) => ({
  x: points.reduce((n, p) => n + p.x, 0) / points.length,
  y: points.reduce((n, p) => n + p.y, 0) / points.length,
});

test('published V3 face-mask, compilation and pixel fingerprints stay unchanged', () => {
  const a = analysis(),
    t = a.targets[0]!,
    r = applyPortraitValues(createRecipeV3(), a, t.id, {
      smooth: 30,
      wrinkles: 25,
      texture: 10,
      even: 10,
      skinLight: 100,
    }),
    image = {
      width: 40,
      height: 50,
      data: Uint8ClampedArray.from({ length: 40 * 50 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (i * 11 + 73) % 256,
      ),
    };
  assert.equal(
    digest(JSON.stringify(facialMasks(t, null))),
    '5ac97a632cc69d3dd3744489336d5eba9957ceb7716e6dec63f2283145d45b53',
  );
  assert.equal(
    digest(JSON.stringify(r)),
    'b736227030ad2395ca49e4d96783581836c1f60c881a011afe92484814eea630',
  );
  assert.equal(
    digest(renderEditorRecipe(image, r).data),
    '0a80cbdfaf64aba6a69eb1cd6cbc8352b76408f9704bb14280f33a0a6737adf9',
  );
  assert.deepEqual(renderEditorRecipe(image, migrateRecipeToV4(r)), renderEditorRecipe(image, r));
});

test('V4 face falloff follows physical face size, rotation and image aspect instead of image short side', () => {
  const source = faceTarget(),
    originalDimensions = { width: 400, height: 500 },
    original = facialMasksV4(source, null, originalDimensions).face;
  assert.equal(original.type, 'polygon');
  if (original.type !== 'polygon') throw new Error('Expected explicit contour');
  const expectedPixels = original.feather * 400;
  for (const dimensions of [
    { width: 800, height: 500 },
    { width: 400, height: 1000 },
    { width: 800, height: 1000 },
  ]) {
    for (const scale of [0.25, 0.6, 1])
      for (const angle of [0, Math.PI / 3, Math.PI / 2]) {
        const project = (p: Point) => {
          const x = (p.x - 0.5) * 400 * scale,
            y = (p.y - 0.43) * 500 * scale;
          return {
            x: 0.5 + (x * Math.cos(angle) - y * Math.sin(angle)) / dimensions.width,
            y: 0.5 + (x * Math.sin(angle) + y * Math.cos(angle)) / dimensions.height,
          };
        };
        const target: PortraitTarget = {
          ...source,
          contours: Object.fromEntries(
            Object.entries(source.contours).map(([key, points]) => [key, points.map(project)]),
          ),
          landmarks: source.landmarks.map(project),
        };
        const mask = facialMasksV4(target, null, dimensions).face;
        if (mask.type !== 'polygon') throw new Error('Expected explicit contour');
        assert.ok(
          Math.abs(
            mask.feather * Math.min(dimensions.width, dimensions.height) - expectedPixels * scale,
          ) < 1e-8,
        );
        const base = compileSelectionMaskV3(original, originalDimensions),
          next = compileSelectionMaskV3(mask, dimensions);
        for (const point of [
          { x: 0.5, y: 0.164 },
          { x: 0.5, y: 0.18 },
          { x: 0.4, y: 0.4 },
        ]) {
          const p = project(point);
          assert.ok(Math.abs(next(p.x, p.y) - base(point.x, point.y)) < 1e-8);
        }
      }
  }
  assert.throws(() => facialMasksV4(source, null, { width: 0, height: 500 }), /尺寸/);
  assert.throws(() => facialMasksV4(source, null, { width: 400, height: NaN }), /尺寸/);
});

test('V4 face transition remains inward and never fills outside the supplied skin mask or protected features', () => {
  const t = faceTarget(),
    dims = { width: 400, height: 500 },
    skin = {
      type: 'radial' as const,
      centerX: 0.45,
      centerY: 0.43,
      radiusX: 0.18,
      radiusY: 0.3,
      feather: 0.2,
      invert: false,
    },
    next = compileSelectionMaskV3(facialMasksV4(t, skin, dims).skin, dims),
    safeFace = compileSelectionMaskV3(facialMasks(t, null).face, dims),
    allowedSkin = compileSelectionMaskV3(skin, dims);
  for (const key of ['leftEye', 'rightEye', 'leftBrow', 'rightBrow', 'lips']) {
    const p = mean(t.contours[key]!);
    assert.equal(next(p.x, p.y), 0, `${key} remains protected`);
  }
  for (let y = 0; y <= 100; y++)
    for (let x = 0; x <= 100; x++) {
      const p = { x: x / 100, y: y / 100 },
        weight = next(p.x, p.y);
      if (safeFace(p.x, p.y) === 0 || allowedSkin(p.x, p.y) === 0) assert.equal(weight, 0);
    }
});

test('V4 positive and negative skin exposure produce a wider smooth pixel transition without reducing the effect range', () => {
  const a = analysis(),
    t = a.targets[0]!,
    image = uniform(),
    oldMask = compileSelectionMaskV3(facialMasks(t, null).skin, image),
    newMask = compileSelectionMaskV3(facialMasksV4(t, null, image).skin, image);
  const profile = (sample: (x: number, y: number) => number) =>
    Array.from({ length: 40 }, (_, i) => sample(0.5, (75 + i + 0.5) / 500));
  const oldWeights = profile(oldMask),
    newWeights = profile(newMask),
    transition = (values: number[]) => values.filter((n) => n > 0 && n < 1).length,
    jump = (values: number[]) =>
      Math.max(...values.slice(1).map((n, i) => Math.abs(n - values[i]!)));
  assert.ok(transition(newWeights) > transition(oldWeights) * 4);
  assert.ok(jump(newWeights) < jump(oldWeights) * 0.4);
  for (const sign of [-100, 100]) {
    const legacy = renderEditorRecipe(
        image,
        applyPortraitValues(createRecipeV3(), a, t.id, { skinLight: sign }),
      ),
      recipe = applyPortraitValues(createRecipeV4(), a, t.id, { skinLight: sign }),
      next = renderEditorRecipe(image, recipe),
      line = (frame: RGBAImage) =>
        Array.from({ length: 40 }, (_, i) => frame.data[((75 + i) * 400 + 200) * 4]!);
    assert.ok(jump(line(next)) < jump(line(legacy)) * 0.5);
    const cheek = (235 * 400 + 180) * 4;
    assert.equal(
      next.data[cheek],
      legacy.data[cheek],
      'central fully selected exposure strength is preserved',
    );
    assert.ok(sign > 0 ? next.data[cheek]! > 128 : next.data[cheek]! < 128);
    for (const p of [
      { x: 0.1, y: 0.1 },
      ...['leftEye', 'rightEye', 'leftBrow', 'rightBrow', 'lips'].map((key) =>
        mean(t.contours[key]!),
      ),
    ]) {
      const at = (Math.floor(p.y * image.height) * image.width + Math.floor(p.x * image.width)) * 4;
      assert.deepEqual(next.data.subarray(at, at + 4), image.data.subarray(at, at + 4));
    }
    assert.deepEqual(renderEditorRecipeTiled(image, recipe, { tileSize: 64 }), next);
  }
  assert.deepEqual(
    renderEditorRecipe(image, applyPortraitValues(createRecipeV4(), a, t.id, { skinLight: 0 })),
    image,
  );
});

test('refined skin light is signed and rolls off before bright skin loses chroma', () => {
  const a = { ...analysis(), algorithmVersion: REFINED_PORTRAIT_ANALYSIS };
  const t = a.targets[0]!;
  const image = uniform();
  const middle = (230 * image.width + 182) * 4;
  const bright = middle + 4;
  image.data.set([155, 119, 103, 255], middle);
  image.data.set([248, 228, 215, 255], bright);
  const edit = (skinLight: number) => applyPortraitValues(createRecipeV4(), a, t.id, { skinLight });
  const lift = renderEditorRecipe(image, edit(100));
  const darken = renderEditorRecipe(image, edit(-100));
  assert.ok(lift.data[middle + 1]! >= image.data[middle + 1]! + 3);
  assert.ok(darken.data[middle + 1]! <= image.data[middle + 1]! - 3);
  assert.ok(lift.data[bright]! < 255, 'bright skin should retain channel headroom');
  assert.ok(Math.abs(lift.data[bright + 1]! - image.data[bright + 1]!) < 6);
  assert.equal(lift.data[bright]! - lift.data[bright + 2]!, 33);
  assert.deepEqual(renderEditorRecipeTiled(image, edit(100), { tileSize: 97 }), lift);
});

test('V4 rejects unimplemented anatomically constrained neck length while stored V3/V4 effects replay unchanged', () => {
  const a = analysis([bodyTarget()]),
    id = a.targets[0]!.id,
    image: RGBAImage = {
      width: 80,
      height: 100,
      data: Uint8ClampedArray.from({ length: 80 * 100 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (i * 11 + 73) % 256,
      ),
    },
    unavailable = portraitToolAvailability(a, id).find((tool) => tool.id === 'neckLength')!;
  assert.equal(unavailable.available, false);
  assert.match(unavailable.reason!, /自动颈长暂不可用/);
  assert.equal(
    portraitToolAvailability(a, id, 3).find((tool) => tool.id === 'neckLength')!.available,
    true,
  );
  assert.equal(
    portraitToolAvailability(a, id).find((tool) => tool.id === 'shoulders')!.available,
    true,
  );
  for (const neckLength of [-100, -0.1, 0.1, 100]) {
    assert.throws(
      () => applyPortraitValues(createRecipeV4(), a, id, { neckLength }),
      /自动颈长暂不可用/,
    );
    const legacy = applyPortraitValues(createRecipeV3(), a, id, { neckLength }),
      stored = migrateRecipeToV4(legacy);
    assert.equal(stored.warp.strokes.length, 1);
    assert.notDeepEqual(renderEditorRecipe(image, legacy).data, image.data);
    assert.deepEqual(renderEditorRecipe(image, stored), renderEditorRecipe(image, legacy));
    assert.equal(applyPortraitValues(stored, a, id, { neckLength: 0 }).warp.strokes.length, 0);
  }
  const previous = migrateRecipeToV4(
      applyPortraitValues(createRecipeV3(), a, id, {
        neckLength: 80,
        neckWidth: 15,
        shoulders: -25,
      }),
    ),
    cleared = applyPortraitValues(previous, a, id, {
      neckLength: 0,
      neckWidth: 15,
      shoulders: -25,
    }),
    expected = applyPortraitValues(
      migrateRecipeToV4(
        applyPortraitValues(createRecipeV3(), a, id, {
          neckWidth: 15,
          shoulders: -25,
        }),
      ),
      a,
      id,
      {
        neckLength: 0,
        neckWidth: 15,
        shoulders: -25,
      },
    );
  assert.deepEqual(
    cleared,
    expected,
    'clearing the old unsupported control preserves the complete other-body snapshot',
  );
  assert.deepEqual(renderEditorRecipe(image, cleared), renderEditorRecipe(image, expected));
});

test('new V4 portrait flows retain their algorithm during edits and legacy targets never switch silently', () => {
  const a = analysis(),
    id = a.targets[0]!.id;
  const next = applyPortraitValues(createRecipeV4(), a, id, { jaw: 100 });
  assert.ok(
    next.warp.strokes.length > 0 && next.warp.strokes.every((s) => s.algorithm === 'flow-v1'),
  );
  const updated = applyPortraitValues(next, a, id, { jaw: -100, eyeSize: 30 });
  assert.ok(updated.warp.strokes.every((s) => s.algorithm === 'flow-v1'));
  const legacy = migrateRecipeToV4(applyPortraitValues(createRecipeV3(), a, id, { jaw: 50 }));
  const preserved = applyPortraitValues(legacy, a, id, { jaw: 60, eyeSize: 30 });
  assert.ok(preserved.warp.strokes.every((s) => s.algorithm === undefined));
});

test('contour controls share a smooth width budget with explicit upgrade of existing automatic values', () => {
  const target = faceTarget();
  const before = analysis([target]);
  const latest = { ...before, algorithmVersion: REFINED_PORTRAIT_ANALYSIS };
  const values = { faceSlim: 90, faceNarrow: 90, vFace: 90, jaw: 90, faceSmall: 70, smooth: 40 };
  const saved = applyPortraitValues(createRecipeV4(), before, target.id, values);
  const keep = applyPortraitValues(saved, latest, target.id, values);
  assert.ok(keep.warp.strokes.every((stroke) => stroke.algorithm !== 'face-field-v2'));
  const upgraded = applyPortraitValues(saved, latest, target.id, values, undefined, {
    upgradeFace: true,
  });
  const created = applyPortraitValues(createRecipeV4(), latest, target.id, values);
  assert.deepEqual(upgraded.warp, created.warp);
  assert.deepEqual(portraitValues(upgraded, target.id), values);
  assert.equal(created.warp.strokes.length, 1);
  const contour = created.warp.strokes[0]!.contour!;
  assert.ok(contour.rows.some(({ leftShift, rightShift }) => leftShift > 0 && rightShift > 0));
  assert.ok(
    contour.rows.every(
      ({ leftShift, rightShift, left, right }) => (leftShift + rightShift) / (right - left) < 0.113,
    ),
  );
  const wide = applyPortraitValues(createRecipeV4(), latest, target.id, { faceSlim: -90 });
  assert.ok(wide.warp.strokes[0]?.contour?.rows.some(({ leftShift }) => leftShift < 0));
});
