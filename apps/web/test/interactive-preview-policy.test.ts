import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createRecipeV4,
  createAdjustmentRegionV3,
  renderEditorRecipe,
  type RGBAImage,
} from '@ai-xiutu/editor';
import {
  InteractivePreviewPolicy,
  INTERACTIVE_POLICY,
  MAX_INTERACTIVE_SOURCE_PIXELS,
  previewFamily,
  type PreviewFamily,
} from '../src/editor/interactive-preview-policy.ts';

const step = (
  policy: InteractivePreviewPolicy,
  family: PreviewFamily,
  start: number,
  duration: number,
) => {
  const plan = policy.begin(family, start);
  policy.complete(plan, duration, start + duration);
  return plan.pixels;
};

test('an expensive operation cannot permanently reduce another tool, idle work or a new source', () => {
  const policy = new InteractivePreviewPolicy();
  assert.equal(step(policy, 'color', 0, 120), 131_072);
  assert.equal(step(policy, 'color', 130, 120), 65_536);
  assert.equal(step(policy, 'color', 260, 120), 32_768);
  assert.equal(step(policy, 'warp', 390, 120), 131_072);
  assert.equal(step(policy, 'warp', 520, 120), 65_536);
  assert.equal(step(policy, 'color', 650, 120), 131_072);
  assert.equal(step(policy, 'color', 780, 120), 65_536);
  assert.equal(step(policy, 'color', 910, 120), 32_768);
  assert.equal(
    step(policy, 'color', 1_830, 120),
    131_072,
    '800ms after completion restores the default',
  );
  const old = policy.begin('color', 1_960);
  policy.reset();
  policy.complete(old, 10_000, 11_960);
  assert.equal(step(policy, 'color', 12_000, 5), 131_072, 'late old-source timings are discarded');
});

test('one marginally slow frame does not collapse quality and sustained fast work recovers with hysteresis', () => {
  const policy = new InteractivePreviewPolicy();
  assert.equal(step(policy, 'color', 0, 52), 131_072);
  assert.equal(step(policy, 'color', 60, 52), 131_072);
  for (const start of [120, 190, 260, 340]) assert.equal(step(policy, 'color', start, 10), 65_536);
  // Recovery waits for the cooldown as well as four cheap completed frames.
  assert.equal(step(policy, 'color', 360, 10), 65_536);
  assert.equal(step(policy, 'color', 380, 30), 131_072);
  assert.equal(step(policy, 'color', 420, 52), 131_072);
  assert.equal(step(policy, 'color', 480, 30), 131_072);
  assert.equal(step(policy, 'color', 520, 52), 131_072);
  assert.equal(step(policy, 'color', 580, 30), 131_072);
});

test('spatial detail floors and recovery ceilings remain bounded even under extreme timing sequences', () => {
  for (const family of Object.keys(INTERACTIVE_POLICY.budgets) as PreviewFamily[]) {
    const policy = new InteractivePreviewPolicy();
    let now = 0;
    const budget = INTERACTIVE_POLICY.budgets[family];
    for (let i = 0; i < 12; i++) {
      const pixels = step(policy, family, now, 150);
      now += 160;
      assert.ok(pixels >= budget.minimum && pixels <= budget.maximum);
    }
    assert.equal(step(policy, family, now, 150), budget.minimum);
    now += 160;
    for (let i = 0; i < 32; i++) {
      const pixels = step(policy, family, now, 5);
      now += 80;
      assert.ok(pixels >= budget.minimum && pixels <= MAX_INTERACTIVE_SOURCE_PIXELS);
    }
    assert.equal(step(policy, family, now, 5), budget.maximum);
  }
});

test('render time is not idle time and an old or invalid completion cannot tune the current frame', () => {
  const policy = new InteractivePreviewPolicy();
  step(policy, 'color', 0, 2_000);
  const current = policy.begin('color', 2_001);
  assert.equal(current.pixels, 65_536, 'slow frame does not manufacture an idle recovery');
  const newer = policy.begin('geometry', 2_002);
  policy.complete(current, 10_000, 12_001);
  policy.complete(newer, NaN, 2_003);
  assert.equal(step(policy, 'geometry', 2_004, 10), 131_072);
});

test('family detection follows the changed operation, including scoped color after an existing warp', () => {
  const base = createRecipeV4();
  const warp = createRecipeV4({
    warp: {
      enabled: true,
      strokes: [
        {
          id: 'warp',
          mode: 'push',
          algorithm: 'flow-v1',
          from: { x: 0.4, y: 0.5 },
          to: { x: 0.44, y: 0.5 },
          radius: 0.2,
          feather: 0.7,
          strength: 0.3,
        },
      ],
    },
  });
  assert.equal(previewFamily(base, warp), 'warp');
  const colored = structuredClone(warp);
  colored.adjustments.exposure = 0.2;
  assert.equal(previewFamily(warp, colored, 'warp'), 'color');
  const detailed = structuredClone(colored);
  detailed.adjustments.sharpness = 20;
  assert.equal(previewFamily(colored, detailed), 'detail');
  const rotated = structuredClone(detailed);
  rotated.transform.rotationDegrees = 0.1;
  assert.equal(previewFamily(detailed, rotated), 'geometry');
  const region = createAdjustmentRegionV3({
    id: 'region',
    name: 'Region',
    mask: {
      type: 'polygon',
      points: [
        { x: 0.3, y: 0.3 },
        { x: 0.6, y: 0.3 },
        { x: 0.5, y: 0.6 },
      ],
      feather: 0,
      invert: false,
    },
  });
  const local = { ...colored, regionEdits: [region] };
  const localColor = structuredClone(local);
  localColor.regionEdits[0]!.color.adjustments.exposure = 0.7;
  assert.equal(previewFamily(local, localColor, 'warp'), 'color');
  const localShape = structuredClone(localColor);
  localShape.regionEdits[0]!.mask = { ...region.mask, invert: true };
  assert.equal(previewFamily(localColor, localShape), 'spatial');
  assert.deepEqual(base, createRecipeV4(), 'classification never rewrites source recipe semantics');
});

test('real worker recovers from coarse color to spatial work and exports untouched full-source semantics', async () => {
  // Only the clock is deterministic. The dispatcher, downsampling, transferable
  // replies and reference pixels are real; this is not a device latency claim.
  const replies: any[] = [];
  const scope = {
    onmessage: null as null | ((event: { data: any }) => void | Promise<void>),
    postMessage(value: any, options: Transferable[] | StructuredSerializeOptions = []) {
      replies.push(
        structuredClone(value, { transfer: Array.isArray(options) ? options : options.transfer }),
      );
    },
  };
  const previousSelf = Object.getOwnPropertyDescriptor(globalThis, 'self');
  const previousClock = Object.getOwnPropertyDescriptor(performance, 'now');
  let clock = 0;
  let elapsed = 150;
  Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => {
      clock += elapsed;
      return clock;
    },
  });
  try {
    await import('../src/editor/render.worker.ts');
    const send = async (message: any) => {
      await scope.onmessage!({ data: message });
      return replies.at(-1);
    };
    const source: RGBAImage = {
      width: 640,
      height: 480,
      data: Uint8ClampedArray.from({ length: 640 * 480 * 4 }, (_, i) =>
        i % 4 === 3 ? 255 : (i * 37) % 256,
      ),
    };
    const original = new Uint8ClampedArray(source.data);
    await send({ type: 'source', image: source, original: source });
    const recipe = createRecipeV4();
    let coarse: any;
    for (let i = 0; i < 3; i++) {
      recipe.adjustments.exposure = i * 0.1;
      coarse = await send({ type: 'interactive-preview', id: i, recipe: structuredClone(recipe) });
      assert.equal(coarse.error, undefined);
    }
    const coarsePixels = coarse.result.width * coarse.result.height;
    assert.ok(coarsePixels <= 32_768);
    recipe.warp.enabled = true;
    recipe.warp.strokes.push({
      id: 'flow',
      algorithm: 'flow-v1',
      mode: 'push',
      from: { x: 0.4, y: 0.5 },
      to: { x: 0.44, y: 0.5 },
      radius: 0.2,
      feather: 0.7,
      strength: 0.3,
    });
    const spatial = await send({
      type: 'interactive-preview',
      id: 10,
      recipe: structuredClone(recipe),
    });
    assert.equal(spatial.error, undefined);
    assert.ok(
      spatial.result.width * spatial.result.height > coarsePixels * 3,
      'another family receives a genuinely larger source raster',
    );
    recipe.adjustments.exposure = 0.5;
    const restoredColor = await send({
      type: 'interactive-preview',
      id: 11,
      recipe: structuredClone(recipe),
    });
    assert.ok(restoredColor.result.width * restoredColor.result.height > coarsePixels * 3);
    const exported = await send({ type: 'export', id: 12, recipe });
    assert.equal(exported.error, undefined);
    assert.deepEqual(exported.result, renderEditorRecipe(source, recipe));
    assert.deepEqual(source.data, original);

    // A live-only worker must retain enough source pixels for earned recovery.
    // Raising an output budget over an already discarded 131k source cannot pass this.
    elapsed = 5;
    await send({ type: 'interactive-source', image: source, sourceDimensions: source });
    const geometry = createRecipeV4();
    let clearer: any;
    for (let i = 0; i < 8; i++) {
      clock += 80;
      geometry.transform.rotationDegrees = (i + 1) * 0.1;
      clearer = await send({
        type: 'interactive-preview',
        id: 20 + i,
        recipe: structuredClone(geometry),
      });
      assert.equal(clearer.error, undefined);
      assert.ok(clearer.result.width * clearer.result.height <= MAX_INTERACTIVE_SOURCE_PIXELS);
    }
    assert.ok(
      clearer.result.width * clearer.result.height > 230_000,
      'cheap geometry recovers actual retained source detail',
    );
    assert.deepEqual(source.data, original);
  } finally {
    if (previousSelf) Object.defineProperty(globalThis, 'self', previousSelf);
    else Reflect.deleteProperty(globalThis, 'self');
    if (previousClock) Object.defineProperty(performance, 'now', previousClock);
    else Reflect.deleteProperty(performance, 'now');
  }
});
