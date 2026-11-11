import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createRecipeV4,
  createRecipeV3,
  createAdjustmentRegionV3,
  createHealingOperationV4,
  migrateRecipeToV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  parseRecipeV4,
  type RGBAImage,
} from '@ai-xiutu/editor';
import {
  applyPortraitValues,
  portraitValues,
  detachPortraitTarget,
  createPortraitPixelAdapter,
  PORTRAIT_TOOLS,
  type PortraitPixelDriver,
} from '../src/index.js';
import { analysis, faceTarget } from './fixtures.js';
const source = (): RGBAImage => ({
  width: 40,
  height: 50,
  data: Uint8ClampedArray.from({ length: 40 * 50 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 11 + 73) % 256,
  ),
});

test('new V4 skin signal edits omit duplicate neutral color masks and use guided-v4 after color-only edits', () => {
  const a = analysis(),
    id = a.targets[0]!.id,
    pixels = source();
  const values = { smooth: 50, texture: -15, wrinkles: 25, even: 37 };
  const edited = applyPortraitValues(createRecipeV4(), a, id, values);
  assert.equal(edited.regionEdits.length, 0);
  assert.equal(edited.retouch.length, 1);
  assert.equal(edited.retouch[0]!.algorithm, 'guided-v4');
  assert.deepEqual(portraitValues(edited, id), values);
  const previousShape = createRecipeV4({
    ...edited,
    regionEdits: [
      createAdjustmentRegionV3({ id: 'old-neutral-skin', mask: edited.retouch[0]!.mask }),
    ],
  });
  assert.deepEqual(renderEditorRecipe(pixels, edited), renderEditorRecipe(pixels, previousShape));
  const color = applyPortraitValues(createRecipeV4(), a, id, { skinLight: 40 });
  assert.equal(color.regionEdits.length, 1);
  assert.equal(color.retouch.length, 0);
  const combined = applyPortraitValues(color, a, id, {
    ...values,
    skinLight: 40,
    skinColorSpot: 65,
  });
  assert.equal(combined.regionEdits.length, 1);
  assert.equal(combined.retouch.length, 1);
  assert.equal(combined.retouch[0]!.algorithm, 'guided-v4');
  assert.equal(combined.retouch[0]!.chromaSpots, 65);
});

test('V4 portrait edits retain homography/healing, use distinct versioned retouch primitives, and detach freezes everything', () => {
  const a = analysis(),
    id = a.targets[0]!.id,
    base = createRecipeV4({
      projective: {
        enabled: true,
        corners: [
          { x: 0.05, y: 0.1 },
          { x: 1.1, y: 0 },
          { x: 0.9, y: 1 },
          { x: 0.1, y: 0.9 },
        ],
      },
      healing: [createHealingOperationV4({ id: 'manual-heal', enabled: false })],
    });
  const values = { smooth: 30, texture: -20, wrinkles: 55, even: 40, skinLight: -20, faceSlim: 15 },
    r = applyPortraitValues(base, a, id, values);
  assert.equal(r.schemaVersion, 4);
  assert.deepEqual(r.projective, base.projective);
  assert.deepEqual(r.healing, base.healing);
  assert.equal(r.retouch.length, 1);
  assert.equal(r.retouch[0]!.origin?.moduleId, 'portrait.basic.v2');
  assert.equal(r.retouch[0]!.smoothing, 30);
  assert.equal(r.retouch[0]!.texture, -20);
  assert.equal(r.retouch[0]!.fineLines, 55);
  assert.equal(r.retouch[0]!.uniformity, 40);
  const skin = r.regionEdits.find((region) => region.origin?.parameterId === 'skin')!;
  assert.equal(skin.color.adjustments.soften, 0);
  assert.equal(skin.color.detail.texture, 0);
  assert.deepEqual(portraitValues(r, id), values);
  const pixels = source(),
    rendered = renderEditorRecipe(pixels, r);
  assert.deepEqual(renderEditorRecipeTiled(pixels, r, { tileSize: 16 }), rendered);
  const detached = detachPortraitTarget(r, id);
  assert.equal(detached.retouch[0]!.origin?.moduleId, 'portrait.manual.v1');
  assert.deepEqual(renderEditorRecipe(pixels, detached), rendered);
  assert.deepEqual(portraitValues(detached, id), {});
  const next = applyPortraitValues(detached, a, id, { smooth: 20 });
  assert.equal(next.retouch.length, 2);
  assert.notEqual(next.retouch[0]!.id, next.retouch[1]!.id);
  const modified = parseRecipeV4(r);
  modified.retouch[0]!.radius *= 2;
  assert.throws(() => applyPortraitValues(modified, a, id, values), /手动修改/);
});

test('V3 portrait semantics replay unchanged after V4 migration until an explicit new portrait edit', () => {
  const a = analysis(),
    id = a.targets[0]!.id,
    old = applyPortraitValues(createRecipeV3(), a, id, {
      smooth: 30,
      wrinkles: 25,
      texture: 10,
      even: 10,
    }),
    pixels = source();
  const migrated = migrateRecipeToV4(old);
  assert.deepEqual(renderEditorRecipe(pixels, old), renderEditorRecipe(pixels, migrated));
  const edited = applyPortraitValues(migrated, a, id, {
    ...portraitValues(migrated, id),
    smooth: 40,
  });
  assert.equal(edited.retouch.length, 1);
  assert.notDeepEqual(
    renderEditorRecipe(pixels, edited).data,
    renderEditorRecipe(pixels, old).data,
  );
});

test('two full face control vectors remain separate and bounded with dedicated V4 skin operations', () => {
  const a = analysis([faceTarget(1, 0.27, 0.43, 0.5), faceTarget(2, 0.73, 0.43, 0.5)]),
    values = Object.fromEntries(
      PORTRAIT_TOOLS.filter((tool) => tool.target === 'face').map((tool) => [tool.id, 20]),
    );
  let recipe = createRecipeV4();
  for (const face of a.targets) recipe = applyPortraitValues(recipe, a, face.id, values);
  assert.equal(recipe.retouch.length, 2);
  assert.ok(recipe.warp.strokes.length > 64, 'both full face controls coexist');
  assert.doesNotThrow(() => parseRecipeV4(recipe));
  const other = JSON.stringify(recipe.retouch[1]);
  recipe = applyPortraitValues(recipe, a, a.targets[0]!.id, { smooth: 15 });
  assert.equal(JSON.stringify(recipe.retouch[1]), other);
  recipe = applyPortraitValues(recipe, a, a.targets[0]!.id, {});
  assert.equal(recipe.retouch.length, 1);
});

test('optional pixel executor binds actual full source hash and enforces protected pixels against an overbroad driver', async () => {
  const image = source(),
    hash = createHash('sha256')
      .update(`${image.width}x${image.height}:srgb-rgba8:`)
      .update(image.data)
      .digest('hex'),
    frame = {
      width: image.width,
      height: image.height,
      contentHash: hash,
      coordinates: 'source-normalized' as const,
      orientation: 'normalized' as const,
    },
    signal = new AbortController().signal;
  const driver: PortraitPixelDriver = {
    id: 'test-real-boundary',
    algorithmVersion: 'test-v1',
    configured: true,
    model: { id: 'test-double-not-a-model', sha256: '1'.repeat(64), license: 'test-only' },
    operations: ['skin-detail'],
    async run(input) {
      input.image.data.fill(250);
      return { image: input.image, sourceHash: hash, algorithmVersion: 'test-v1' };
    },
  };
  const adapter = createPortraitPixelAdapter(driver),
    before = image.data.slice(),
    mask = {
      type: 'radial' as const,
      centerX: 0.5,
      centerY: 0.5,
      radiusX: 0.25,
      radiusY: 0.25,
      feather: 0,
      invert: false,
    },
    request = {
      image,
      frame,
      mask,
      protection: { ...mask, radiusX: 0.05, radiusY: 0.05 },
      operation: 'skin-detail' as const,
      strength: 0.7,
    };
  const result = await adapter.run(request, { signal });
  assert.equal(result.applied, true);
  assert.deepEqual(image.data, before);
  assert.deepEqual(result.image.data.subarray(0, 4), before.subarray(0, 4));
  const center = (25 * 40 + 20) * 4;
  assert.deepEqual(
    result.image.data.subarray(center, center + 4),
    before.subarray(center, center + 4),
  );
  for (let i = 3; i < result.image.data.length; i += 4)
    assert.equal(result.image.data[i], before[i]);
  await assert.rejects(
    () => adapter.run({ ...request, frame: { ...frame, contentHash: 'b'.repeat(64) } }, { signal }),
    /哈希/,
  );
  driver.configured = false;
  await assert.rejects(() => adapter.run(request, { signal }), /尚未配置/);
  driver.configured = true;
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(() => adapter.run(request, { signal: cancellation.signal }), /取消/);
});
