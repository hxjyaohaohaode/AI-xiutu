import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecipeV3,
  createAdjustmentRegionV3,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  parseRecipeV3,
  compileSelectionMaskV3,
} from '@ai-xiutu/editor';
import {
  applyPortraitValues,
  portraitValues,
  portraitMakeupColors,
  portraitToolAvailability,
  detachPortraitTarget,
  validatePortraitAnalysis,
  validateTarget,
  contourLoops,
  contourHull,
  facialMasks,
  createPortraitAnalysisAdapter,
  PORTRAIT_TOOLS,
} from '../src/index.js';
import { analysis, faceTarget, bodyTarget, frame, hash } from './fixtures.js';

const rgba = () => ({
  width: 40,
  height: 50,
  data: Uint8ClampedArray.from({ length: 40 * 50 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 11 + 50) % 256,
  ),
});
test('portrait analysis is owned, strictly source-bound and rejects stale IDs, duplicate targets and unknown fields', () => {
  const a = analysis(),
    checked = validatePortraitAnalysis(a, frame);
  assert.deepEqual(checked, a);
  checked.targets[0]!.landmarks[0]!.x = 0.123;
  assert.notEqual(checked.targets[0]!.landmarks[0]!.x, a.targets[0]!.landmarks[0]!.x);
  assert.throws(
    () => validatePortraitAnalysis(a, { ...frame, contentHash: 'b'.repeat(64) }),
    /原图不一致/,
  );
  assert.throws(
    () => validatePortraitAnalysis({ ...a, targets: [a.targets[0]!, a.targets[0]!] }),
    /重复/,
  );
  assert.throws(() => validatePortraitAnalysis({ ...a, foo: 1 }), /未知/);
  assert.throws(
    () =>
      validatePortraitAnalysis({
        ...a,
        targets: [{ ...a.targets[0]!, id: 'face-bbbbbbbbbbbb-1' }],
      }),
    /未绑定/,
  );
});
test('portrait boundary rejects accessors, non-finite landmarks, sparse data and invalid visibility without executing them', () => {
  const a = analysis();
  let invoked = 0;
  Object.defineProperty(a, 'provider', {
    get() {
      invoked++;
      return 'mediapipe';
    },
  });
  assert.throws(() => validatePortraitAnalysis(a));
  assert.equal(invoked, 0);
  const t = faceTarget();
  t.landmarks[0]!.x = NaN;
  assert.throws(() => validateTarget(t));
  const b = bodyTarget();
  b.landmarks[23]!.visibility = 2;
  assert.throws(() => validateTarget(b));
  const sparse = analysis();
  sparse.targets[0]!.landmarks = Array(478);
  assert.throws(() => validatePortraitAnalysis(sparse));
});
test('bounded off-image pose estimates retain a valid face and visible shoulders without enabling invisible legs', () => {
  const body = bodyTarget(),
    face = faceTarget();
  for (const i of [25, 26, 27, 28]) {
    body.landmarks[i]!.y = 2.642;
    body.landmarks[i]!.visibility = 0.1;
  }
  const checked = validatePortraitAnalysis(analysis([face, body]), frame);
  assert.equal(checked.targets.length, 2);
  assert.equal(checked.targets[1]!.landmarks[27]!.y, 2.642);
  assert.doesNotThrow(() =>
    applyPortraitValues(createRecipeV3(), checked, face.id, { smooth: 30 }),
  );
  assert.doesNotThrow(() =>
    applyPortraitValues(createRecipeV3(), checked, body.id, { shoulders: 30 }),
  );
  assert.throws(
    () => applyPortraitValues(createRecipeV3(), checked, body.id, { legs: 30 }),
    /关键点不可见/,
  );
  for (const i of [25, 26, 27, 28]) body.landmarks[i]!.visibility = 1;
  assert.equal(
    portraitToolAvailability(analysis([body]), body.id).find((t) => t.id === 'legs')!.available,
    false,
  );
  body.landmarks[27]!.y = 8.001;
  assert.throws(() => validateTarget(body));
  face.landmarks[0]!.y = 2.642;
  assert.throws(() => validateTarget(face));
});
test('open eyebrow chains use all hull vertices while only actually closed edges form contour loops', () => {
  const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.5, y: 0.05 },
      { x: 0.9, y: 0.1 },
      { x: 0.1, y: 0.2 },
      { x: 0.5, y: 0.18 },
      { x: 0.9, y: 0.2 },
    ],
    edges = [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 4, end: 5 },
    ];
  assert.equal(contourLoops(points, edges).length, 0);
  const hull = contourHull(points, edges);
  assert(hull.some((p) => p.y === 0.05));
  assert(hull.some((p) => p.y === 0.2));
  assert.equal(
    contourLoops(points, [
      { start: 2, end: 0 },
      { start: 1, end: 2 },
      { start: 0, end: 1 },
    ])[0]!.length,
    3,
  );
});
test('face skin and lipstick masks protect eyes and the mouth cavity', () => {
  const t = faceTarget(),
    m = facialMasks(t, null),
    skin = compileSelectionMaskV3(m.skin, frame),
    lips = compileSelectionMaskV3(m.lips, frame);
  assert.equal(skin(0.415, 0.365), 0);
  assert.equal(skin(0.5, 0.55), 0);
  assert(skin(0.5, 0.3) > 0);
  assert.equal(lips(0.5, 0.55), 0);
  assert(lips(0.5, 0.57) > 0);
});
test('all registered face/body controls compile to real valid primitives with their own named targets', () => {
  const face = analysis(),
    body = analysis([bodyTarget()]);
  for (const tool of PORTRAIT_TOOLS) {
    const a = tool.target === 'face' ? face : body,
      r = applyPortraitValues(createRecipeV3(), a, a.targets[0]!.id, { [tool.id]: 50 });
    assert(r.regionEdits.length + r.paintLayers.length + r.warp.strokes.length > 0, tool.id);
    assert.equal(portraitValues(r, a.targets[0]!.id)[tool.id], 50);
    parseRecipeV3(r);
  }
});
test('every enabled portrait control produces real pixels, signed controls reverse, and tiled export matches the preview engine', () => {
  const face = analysis(),
    body = analysis([bodyTarget()]),
    source = rgba(),
    original = new Uint8ClampedArray(source.data);
  for (const tool of PORTRAIT_TOOLS) {
    const a = tool.target === 'face' ? face : body,
      id = a.targets[0]!.id,
      positive = applyPortraitValues(createRecipeV3(), a, id, { [tool.id]: 70 }),
      rendered = renderEditorRecipe(source, positive),
      tiled = renderEditorRecipeTiled(source, positive, { tileSize: 64 });
    assert.notDeepEqual(rendered.data, source.data, `${tool.id} must render a real effect`);
    assert.deepEqual(tiled, rendered, `${tool.id} tiled preview parity`);
    if (tool.min < 0) {
      const negative = applyPortraitValues(createRecipeV3(), a, id, { [tool.id]: -70 });
      assert.notDeepEqual(
        renderEditorRecipe(source, negative).data,
        rendered.data,
        `${tool.id} signed behavior`,
      );
    }
  }
  assert.deepEqual(source.data, original);
});
test('portrait controls replace their own operations without growing repeated slider changes or modifying other modules', () => {
  const a = analysis(),
    id = a.targets[0]!.id,
    manual = createAdjustmentRegionV3({ id: 'manual-region' });
  let r = createRecipeV3({ regionEdits: [manual] });
  r = applyPortraitValues(r, a, id, { smooth: 30, texture: 12, chin: 10 });
  const counts = [r.regionEdits.length, r.warp.strokes.length];
  r = applyPortraitValues(r, a, id, { smooth: 60, texture: -15, chin: -20 });
  assert.deepEqual([r.regionEdits.length, r.warp.strokes.length], counts);
  assert.deepEqual(r.regionEdits[0], manual);
  assert.equal(portraitValues(r, id).smooth, 60);
  r = applyPortraitValues(r, a, id, {});
  assert.deepEqual(r.regionEdits, [manual]);
  assert.equal(r.warp.strokes.length, 0);
});
test('detaching a whole person preserves pixels and provenance while allowing a new automatic pass without IDs colliding or manual edits being overwritten', () => {
  const a = analysis(),
    id = a.targets[0]!.id,
    source = rgba();
  const automatic = applyPortraitValues(createRecipeV3(), a, id, {
    smooth: 35,
    chin: 25,
    lipstick: 40,
  });
  const detached = detachPortraitTarget(automatic, id);
  assert.deepEqual(renderEditorRecipe(source, detached), renderEditorRecipe(source, automatic));
  assert.deepEqual(portraitValues(detached, id), {});
  assert.equal(detached.paintLayers[0]!.origin!.moduleId, 'portrait.manual.v1');
  assert.notEqual(detached.paintLayers[0]!.id, automatic.paintLayers[0]!.id);
  assert.equal(detached.paintLayers[0]!.origin!.parameters!.lipstick, 40);
  detached.regionEdits[0]!.color.adjustments.temperature = -40;
  const next = applyPortraitValues(detached, a, id, { smooth: 20, chin: 15, lipstick: 10 });
  assert.deepEqual(next.regionEdits[0], detached.regionEdits[0]);
  assert.deepEqual(next.paintLayers[0], detached.paintLayers[0]);
  assert.deepEqual(next.warp.strokes[0], detached.warp.strokes[0]);
  assert.equal(next.paintLayers.length, 2);
  assert.deepEqual(portraitValues(next, id), { smooth: 20, chin: 15, lipstick: 10 });
  assert.deepEqual(detachPortraitTarget(detached, id), detached);
});
test('makeup color is per tool and does not leak into numeric controls or recolor other tools on unrelated changes', () => {
  const a = analysis(),
    id = a.targets[0]!.id;
  let r = applyPortraitValues(
    createRecipeV3(),
    a,
    id,
    { lipstick: 70, browColor: 50 },
    [200, 30, 90, 255],
    { makeupColors: { lipstick: [180, 10, 20, 200], browColor: [40, 25, 20, 230] } },
  );
  assert.deepEqual(portraitValues(r, id), { lipstick: 70, browColor: 50 });
  assert.deepEqual(portraitMakeupColors(r, id).browColor, [40, 25, 20, 230]);
  r = applyPortraitValues(r, a, id, { ...portraitValues(r, id), smooth: 20 }, [0, 255, 0, 255]);
  assert.deepEqual(portraitMakeupColors(r, id).lipstick, [180, 10, 20, 200]);
  r = applyPortraitValues(r, a, id, portraitValues(r, id), undefined, {
    makeupColors: { lipstick: [230, 60, 80, 180] },
  });
  assert.deepEqual(portraitMakeupColors(r, id).browColor, [40, 25, 20, 230]);
  assert.deepEqual(portraitMakeupColors(r, id).lipstick, [230, 60, 80, 180]);
});
test('automatic recompilation refuses manual changes, deletion, ordering and missing checksums without losing the existing recipe', () => {
  const a = analysis(),
    id = a.targets[0]!.id;
  const original = applyPortraitValues(createRecipeV3(), a, id, {
    smooth: 20,
    chin: 30,
    lipstick: 50,
    browColor: 25,
  });
  const mutations = [
    (r: ReturnType<typeof createRecipeV3>) => {
      r.regionEdits[0]!.color.adjustments.exposure = 0.5;
    },
    (r: ReturnType<typeof createRecipeV3>) => {
      r.paintLayers[0]!.strokes[0]!.points[0]!.x = 0.1;
    },
    (r: ReturnType<typeof createRecipeV3>) => {
      r.paintLayers[0]!.enabled = false;
    },
    (r: ReturnType<typeof createRecipeV3>) => {
      r.warp.strokes[0]!.strength = -0.5;
    },
    (r: ReturnType<typeof createRecipeV3>) => {
      r.paintLayers.pop();
    },
    (r: ReturnType<typeof createRecipeV3>) => {
      r.paintLayers.reverse();
    },
    (r: ReturnType<typeof createRecipeV3>) => {
      delete r.regionEdits[0]!.origin!.parameters!.portraitSeal0;
    },
  ];
  for (const mutate of mutations) {
    const edited = structuredClone(original);
    mutate(edited);
    const before = structuredClone(edited);
    assert.throws(() => applyPortraitValues(edited, a, id, { smooth: 60 }), /独立精修/);
    assert.deepEqual(edited, before);
    assert.doesNotThrow(() =>
      applyPortraitValues(detachPortraitTarget(edited, id), a, id, { smooth: 10 }),
    );
  }
  const roundTrip = JSON.parse(JSON.stringify(original));
  assert.doesNotThrow(() => applyPortraitValues(roundTrip, a, id, { smooth: 60, lipstick: 40 }));
});
test('changing automatic values retains existing order relative to later independent layers', () => {
  const a = analysis(),
    id = a.targets[0]!.id;
  let recipe = applyPortraitValues(createRecipeV3(), a, id, { smooth: 20 });
  recipe.regionEdits.push(createAdjustmentRegionV3({ id: 'manual-after-person' }));
  const previousIds = recipe.regionEdits.map((r) => r.id);
  recipe = applyPortraitValues(recipe, a, id, { smooth: 40 });
  assert.deepEqual(
    recipe.regionEdits.map((r) => r.id),
    previousIds,
  );
});
test('two fully configured portrait targets fit published operation budgets and keep independent values', () => {
  const a = analysis([faceTarget(1, 0.27, 0.43, 0.75), faceTarget(2, 0.73, 0.43, 0.75)]),
    values = Object.fromEntries(
      PORTRAIT_TOOLS.filter((t) => t.target === 'face').map((t) => [t.id, 30]),
    );
  let r = applyPortraitValues(createRecipeV3(), a, a.targets[0]!.id, values);
  r = applyPortraitValues(r, a, a.targets[1]!.id, { ...values, smooth: 60 });
  assert.equal(r.regionEdits.length, 10);
  assert.equal(r.paintLayers.length, 14);
  assert.equal(r.warp.strokes.length, 64);
  assert.equal(portraitValues(r, a.targets[0]!.id).smooth, 30);
  assert.equal(portraitValues(r, a.targets[1]!.id).smooth, 60);
  assert.throws(
    () =>
      applyPortraitValues(
        r,
        analysis([...a.targets, faceTarget(3, 0.5, 0.5, 0.5)]),
        'face-aaaaaaaaaaaa-3',
        { faceSlim: 30 },
      ),
    /budget|0–64/,
  );
});
test('body tools check only the joints they need, retaining shoulder editing when lower-body joints are hidden', () => {
  const b = bodyTarget();
  for (const i of [0, 23, 24, 25, 26, 27, 28]) b.landmarks[i]!.visibility = 0;
  const a = analysis([b]);
  const availability = portraitToolAvailability(a, b.id);
  assert.equal(availability.find((t) => t.id === 'shoulders')?.available, true);
  assert.equal(availability.find((t) => t.id === 'legs')?.available, false);
  assert.equal(
    applyPortraitValues(createRecipeV3(), a, b.id, { shoulders: 30 }).warp.strokes.length,
    2,
  );
  assert.throws(() => applyPortraitValues(createRecipeV3(), a, b.id, { legs: 30 }), /关键点不可见/);
});
test('tilted non-square portraits push their chin along the actual pixel-space facial axis', () => {
  const angle = 0.4,
    t = faceTarget(1, 0.5, 0.45, 0.75, angle),
    a = analysis([t]),
    r = applyPortraitValues(createRecipeV3(), a, t.id, { chin: 60 }),
    w = r.warp.strokes[0]!;
  const dx = (w.to.x - w.from.x) * frame.width,
    dy = (w.to.y - w.from.y) * frame.height,
    length = Math.hypot(dx, dy);
  assert(Math.abs(dx / length + Math.sin(angle)) < 1e-8);
  assert(Math.abs(dy / length - Math.cos(angle)) < 1e-8);
});
test('sideways and inverted portraits retain a mouth-oriented facial axis instead of the screen vertical', () => {
  for (const angle of [Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const t = faceTarget(1, 0.5, 0.5, 0.65, angle),
      a = analysis([t]),
      r = applyPortraitValues(createRecipeV3(), a, t.id, { chin: 60 }),
      w = r.warp.strokes[0]!;
    const dx = (w.to.x - w.from.x) * frame.width,
      dy = (w.to.y - w.from.y) * frame.height,
      length = Math.hypot(dx, dy);
    assert(Math.abs(dx / length + Math.sin(angle)) < 1e-8);
    assert(Math.abs(dy / length - Math.cos(angle)) < 1e-8);
  }
});
test('makeup options and RGBA reject sparse data and accessors without running user code', () => {
  const a = analysis(),
    id = a.targets[0]!.id;
  let calls = 0;
  const color = [100, 20, 30, 255] as [number, number, number, number];
  Object.defineProperty(color, '0', {
    get() {
      calls++;
      return 100;
    },
  });
  assert.throws(() => applyPortraitValues(createRecipeV3(), a, id, { lipstick: 20 }, color));
  assert.equal(calls, 0);
  assert.throws(() =>
    applyPortraitValues(createRecipeV3(), a, id, {}, Array(4) as [number, number, number, number]),
  );
  assert.throws(
    () =>
      applyPortraitValues(createRecipeV3(), a, id, {}, undefined, { makeupColors: [] as never }),
    /普通键值/,
  );
});
test('a large face can receive masked makeup without an illegal paint radius or painting the mouth cavity', () => {
  const a = analysis(),
    id = a.targets[0]!.id,
    r = applyPortraitValues(createRecipeV3(), a, id, { lipstick: 70 }),
    source = rgba(),
    out = renderEditorRecipe(source, r);
  assert.equal(r.paintLayers[0]!.strokes[0]!.radius, 0.5);
  assert.notDeepEqual(out.data, source.data);
  assert.deepEqual(Array.from(out.data.subarray(0, 4)), Array.from(source.data.subarray(0, 4)));
});
test('semantic zero/reset remains identity and can remove a previous effect even if new contours are unavailable', () => {
  const a = analysis(),
    id = a.targets[0]!.id,
    r = applyPortraitValues(createRecipeV3(), a, id, { smooth: 50 });
  a.targets[0]!.contours = {};
  const removed = applyPortraitValues(r, a, id, {});
  assert.equal(removed.regionEdits.length, 0);
  assert.throws(() => applyPortraitValues(r, a, id, { smooth: 30 }), /轮廓不完整/);
});
test('analysis adapter validates configuration, source binding, preview ratio and response version before accepting inference', async () => {
  let calls = 0;
  const driver = {
      id: 'mediapipe',
      algorithmVersion: 'fixture-v1',
      configured: true,
      async analyze() {
        calls++;
        return analysis();
      },
    },
    adapter = createPortraitAnalysisAdapter(driver),
    signal = new AbortController().signal;
  const input = { image: rgba(), contentHash: hash, includeBody: false, includeSegmentation: true };
  assert.deepEqual(await adapter.analyze(input, { signal, frame }), analysis());
  assert.equal(calls, 1);
  await assert.rejects(
    () => adapter.analyze({ ...input, contentHash: 'b'.repeat(64) }, { signal, frame }),
    /未绑定/,
  );
  await assert.rejects(
    () =>
      adapter.analyze({ ...input, image: { ...rgba(), width: 50, height: 40 } }, { signal, frame }),
    /比例不一致/,
  );
  const inactive = createPortraitAnalysisAdapter({ ...driver, configured: false });
  await assert.rejects(() => inactive.analyze(input, { signal, frame }), /尚未配置/);
  const wrong = createPortraitAnalysisAdapter({ ...driver, algorithmVersion: 'different' });
  await assert.rejects(() => wrong.analyze(input, { signal, frame }), /版本/);
});
test('analysis adapter rejects cancelled work before and after inference and never treats partial output as success', async () => {
  const controller = new AbortController();
  let calls = 0;
  const driver = {
      id: 'test',
      algorithmVersion: 'fixture-v1',
      configured: true,
      async analyze() {
        calls++;
        controller.abort();
        return analysis();
      },
    },
    adapter = createPortraitAnalysisAdapter(driver),
    input = { image: rgba(), contentHash: hash, includeBody: false, includeSegmentation: false };
  await assert.rejects(() => adapter.analyze(input, { signal: controller.signal, frame }), /取消/);
  assert.equal(calls, 1);
  await assert.rejects(() => adapter.analyze(input, { signal: controller.signal, frame }), /取消/);
  assert.equal(calls, 1);
});
