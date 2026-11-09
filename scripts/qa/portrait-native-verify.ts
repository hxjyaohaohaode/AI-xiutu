/** Verify actual native model output through the product's pure contract and render engine. */
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { FaceLandmarker } from '@mediapipe/tasks-vision';
import {
  createRasterMask,
  createRecipeV3,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  compileSelectionMaskV3,
  type RGBAImage,
  type Point,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
import {
  boundsOf,
  contourLoops,
  contourHull,
  validatePortraitAnalysis,
  createPortraitAnalysisAdapter,
  applyPortraitValues,
  portraitToolAvailability,
  PORTRAIT_TOOLS,
  type PortraitAnalysis,
  type PortraitTarget,
} from '@ai-xiutu/portrait';

const dir = resolve('artifacts/portrait-cpu');
const native = JSON.parse(await readFile(resolve(dir, 'native-evidence.json'), 'utf8'));
assert.equal(typeof native.runId, 'string');
assert.deepEqual(
  native.pinnedManifest,
  JSON.parse(await readFile('apps/web/public/vision/manifest.json', 'utf8')),
);
const connections = JSON.parse(await readFile(resolve(dir, 'connections.json'), 'utf8'));
for (const [key, edges] of Object.entries(connections))
  assert.deepEqual(
    edges,
    FaceLandmarker[key as keyof typeof FaceLandmarker],
    `Python/JS connections differ: ${key}`,
  );

function limitMask(
  data: Uint8Array,
  width: number,
  height: number,
  ids: number[],
): SelectionMaskV3 {
  let edge = 128;
  for (;;) {
    const w = Math.max(1, Math.round(edge * Math.min(1, width / height)));
    const h = Math.max(1, Math.round(edge * Math.min(1, height / width)));
    const pixels = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        pixels[y * w + x] = ids.includes(
          data[
            Math.min(height - 1, Math.floor(((y + 0.5) * height) / h)) * width +
              Math.min(width - 1, Math.floor(((x + 0.5) * width) / w))
          ]!,
        )
          ? 255
          : 0;
    try {
      return createRasterMask(w, h, pixels);
    } catch (error) {
      if (edge <= 32) throw error;
      edge /= 2;
    }
  }
}
function shape(points: Point[]) {
  const first = (key: string) => contourLoops(points, connections[key])[0] ?? [];
  const lips = contourLoops(points, connections.FACE_LANDMARKS_LIPS);
  return {
    oval: first('FACE_LANDMARKS_FACE_OVAL'),
    leftEye: first('FACE_LANDMARKS_LEFT_EYE'),
    rightEye: first('FACE_LANDMARKS_RIGHT_EYE'),
    leftBrow: contourHull(points, connections.FACE_LANDMARKS_LEFT_EYEBROW),
    rightBrow: contourHull(points, connections.FACE_LANDMARKS_RIGHT_EYEBROW),
    lips: lips[0] ?? [],
    innerLips: lips[1] ?? [],
  };
}
const hashPixels = (image: RGBAImage) =>
  createHash('sha256')
    .update(`${image.width}x${image.height}:srgb-rgba8:`)
    .update(image.data)
    .digest('hex');
const frames: { name: string; image: RGBAImage; analysis: PortraitAnalysis }[] = [];
const summary: Record<string, unknown>[] = [];
for (const name of ['portrait-hopper', 'mediapipe-portrait', 'mediapipe-pose']) {
  const raw = JSON.parse(await readFile(resolve(dir, `${name}.raw.json`), 'utf8'));
  assert.equal(raw.runId, native.runId, 'stale native result from another run');
  const image = {
    width: raw.width,
    height: raw.height,
    data: new Uint8ClampedArray(await readFile(resolve(dir, `${name}.rgba`))),
  };
  assert.equal(hashPixels(image), raw.contentHash);
  const frame = {
    coordinates: 'source-normalized' as const,
    orientation: 'normalized' as const,
    contentHash: raw.contentHash,
    width: image.width,
    height: image.height,
  };
  const faces = raw.faceLandmarks
    .map((landmarks: PortraitTarget['landmarks']) => {
      const contours = shape(landmarks);
      return { landmarks, contours, bounds: boundsOf(contours.oval) };
    })
    .sort(
      (a: PortraitTarget, b: PortraitTarget) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y,
    );
  const bodies = raw.poseLandmarks
    .map((landmarks: PortraitTarget['landmarks']) => ({
      landmarks,
      contours: {},
      bounds: boundsOf(landmarks.filter((p) => (p.visibility ?? 0) > 0.5)),
    }))
    .sort((a: PortraitTarget, b: PortraitTarget) => a.bounds.x - b.bounds.x);
  const targets: PortraitTarget[] = [
    ...faces.map((t: PortraitTarget, i: number) => ({
      ...t,
      kind: 'face' as const,
      id: `face-${raw.contentHash.slice(0, 12)}-${i + 1}`,
      label: `人物 ${i + 1}`,
    })),
    ...bodies.map((t: PortraitTarget, i: number) => ({
      ...t,
      kind: 'body' as const,
      id: `body-${raw.contentHash.slice(0, 12)}-${i + 1}`,
      label: `身形 ${i + 1}`,
    })),
  ];
  const mask = new Uint8Array(await readFile(resolve(dir, raw.categoryMask.file)));
  assert.equal(createHash('sha256').update(mask).digest('hex'), raw.categoryMask.sha256);
  const result: PortraitAnalysis = {
    schemaVersion: 1,
    provider: 'mediapipe',
    algorithmVersion: 'mediapipe-v1-selfie256',
    frame,
    targets,
    segmentation: {
      skin: limitMask(mask, raw.categoryMask.width, raw.categoryMask.height, [2, 3]),
      hair: limitMask(mask, raw.categoryMask.width, raw.categoryMask.height, [1]),
      background: limitMask(mask, raw.categoryMask.width, raw.categoryMask.height, [0]),
    },
    warnings: [
      '此标注来自同源规范图片的官方 MediaPipe 原生 CPU 推理，不代表当前浏览器自动推理已通过。',
    ],
  };
  const adapter = createPortraitAnalysisAdapter({
    id: 'mediapipe',
    algorithmVersion: result.algorithmVersion,
    configured: true,
    // Actual inference was recorded by infer.py; this verifies its canonical product boundary.
    async analyze() {
      return result;
    },
  });
  const analysis = await adapter.analyze(
    { image, contentHash: frame.contentHash, includeBody: true, includeSegmentation: true },
    { frame, signal: new AbortController().signal },
  );
  assert.deepEqual(validatePortraitAnalysis(analysis, frame), analysis);
  await writeFile(resolve(dir, `${name}.analysis.json`), JSON.stringify(analysis, null, 2) + '\n');
  const availability = analysis.targets.map((t) => ({
    id: t.id,
    kind: t.kind,
    landmarks: t.landmarks.length,
    bounds: t.bounds,
    controls: portraitToolAvailability(analysis, t.id),
  }));
  summary.push({ name, sourceFrame: frame, actualModelOutputAccepted: true, availability });
  frames.push({ name, image, analysis });
  console.log(
    JSON.stringify({
      phase: 'actual-analysis-validated',
      name,
      targets: availability.map((t) => ({
        kind: t.kind,
        landmarks: t.landmarks,
        enabled: t.controls.filter((x) => x.available).length,
        disabled: t.controls.filter((x) => !x.available).map((x) => x.id),
      })),
    }),
  );
}
await writeFile(resolve(dir, 'analysis-validation.json'), JSON.stringify(summary, null, 2) + '\n');
if (process.argv.includes('--annotations-only')) process.exit(0);

const pixelsChanged = (a: RGBAImage, b: RGBAImage) => {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let changed = 0,
    max = 0,
    sum = 0;
  for (let p = 0; p < a.data.length; p += 4) {
    assert.equal(a.data[p + 3], b.data[p + 3], 'alpha changed');
    let different = false;
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(a.data[p + c]! - b.data[p + c]!);
      max = Math.max(max, delta);
      sum += delta;
      different ||= delta > 0;
    }
    if (different) changed++;
  }
  return {
    changedPixels: changed,
    maxChannelDelta: max,
    meanChannelDelta: sum / (a.width * a.height * 3),
  };
};
const controls: Record<string, unknown>[] = [];
const validatedTools = new Set<string>();
await writeFile(resolve(dir, 'render-progress.ndjson'), '');
for (const f of frames.filter((f) => f.name !== 'portrait-hopper')) {
  const target = f.analysis.targets.find(
    (t) => t.kind === (f.name === 'mediapipe-portrait' ? 'face' : 'body'),
  )!;
  const available = new Map(
    portraitToolAvailability(f.analysis, target.id).map((t) => [t.id, t.available]),
  );
  for (const tool of PORTRAIT_TOOLS.filter((t) => t.target === target.kind)) {
    assert.equal(available.get(tool.id), true, `${f.name} unavailable real target for ${tool.id}`);
    const started = performance.now();
    const positiveRecipe = applyPortraitValues(createRecipeV3(), f.analysis, target.id, {
      [tool.id]: 55,
    });
    const positive = renderEditorRecipe(f.image, positiveRecipe);
    const tiled = renderEditorRecipeTiled(f.image, positiveRecipe, { tileSize: 113 });
    assert.deepEqual(tiled, positive, `actual full/tiled mismatch: ${tool.id}`);
    const positiveStats = pixelsChanged(f.image, positive);
    assert(positiveStats.changedPixels > 0, `${tool.id} produced no pixels`);
    let negativeStats: ReturnType<typeof pixelsChanged> | null = null;
    if (tool.min < 0) {
      const negative = renderEditorRecipe(
        f.image,
        applyPortraitValues(createRecipeV3(), f.analysis, target.id, { [tool.id]: -55 }),
      );
      negativeStats = pixelsChanged(f.image, negative);
      assert(negativeStats.changedPixels > 0, `${tool.id} negative produced no pixels`);
      assert.notEqual(hashPixels(negative), hashPixels(positive), `${tool.id} sign did not differ`);
    }
    const mask = positiveRecipe.regionEdits[0]?.mask ?? positiveRecipe.paintLayers[0]?.mask;
    let outsideMaskUnchanged: boolean | null = null;
    if (mask) {
      const sample = compileSelectionMaskV3(mask, f.image, f.image);
      for (let y = 0; y < f.image.height; y++)
        for (let x = 0; x < f.image.width; x++) {
          if (sample((x + 0.5) / f.image.width, (y + 0.5) / f.image.height) !== 0) continue;
          const at = (y * f.image.width + x) * 4;
          for (let c = 0; c < 4; c++) assert.equal(positive.data[at + c], f.image.data[at + c]);
        }
      outsideMaskUnchanged = true;
    }
    assert.equal(hashPixels(f.image), f.analysis.frame.contentHash, 'source pixels mutated');
    const result = {
      name: f.name,
      tool: tool.id,
      label: tool.label,
      sourceFrame: f.analysis.frame,
      targetId: target.id,
      positiveStats,
      negativeStats,
      fullTiledByteEqual: true,
      outsideMaskUnchanged,
      elapsedMs: Math.round((performance.now() - started) * 1000) / 1000,
    };
    controls.push(result);
    validatedTools.add(tool.id);
    await appendFile(resolve(dir, 'render-progress.ndjson'), JSON.stringify(result) + '\n');
    console.log(
      JSON.stringify({
        phase: 'real-pixels',
        tool: tool.id,
        ...positiveStats,
        elapsedMs: result.elapsedMs,
      }),
    );
  }
}
assert.equal(validatedTools.size, 46);
for (const f of frames) {
  let recipe = createRecipeV3();
  const face = f.analysis.targets.find((t) => t.kind === 'face');
  if (face)
    recipe = applyPortraitValues(recipe, f.analysis, face.id, {
      smooth: 30,
      texture: 12,
      skinLight: 15,
      lipstick: 35,
      faceSlim: 20,
      eyeLight: 15,
    });
  const body = f.analysis.targets.find((t) => t.kind === 'body');
  if (
    body &&
    portraitToolAvailability(f.analysis, body.id).find((t) => t.id === 'shoulders')?.available
  )
    recipe = applyPortraitValues(recipe, f.analysis, body.id, { shoulders: 18 });
  const output = renderEditorRecipe(f.image, recipe);
  const tiled = renderEditorRecipeTiled(f.image, recipe, { tileSize: 127 });
  assert.deepEqual(tiled, output);
  await writeFile(resolve(dir, `${f.name}.edited.rgba`), output.data);
  await writeFile(
    resolve(dir, `${f.name}.edited.recipe.json`),
    JSON.stringify(recipe, null, 2) + '\n',
  );
  summary.find((s) => s.name === f.name)!.combined = {
    ...pixelsChanged(f.image, output),
    fullTiledByteEqual: true,
    outputHash: hashPixels(output),
    regions: recipe.regionEdits.length,
    paintLayers: recipe.paintLayers.length,
    warpStrokes: recipe.warp.strokes.length,
  };
}
await writeFile(
  resolve(dir, 'pixel-validation.json'),
  JSON.stringify(
    {
      evidenceKind: 'actual-native-model-output-with-product-adapter-and-renderer',
      nativeRunId: native.runId,
      browserInferenceVerified: false,
      toolsPassed: validatedTools.size,
      controls,
      images: summary,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    phase: 'complete',
    toolsPassed: validatedTools.size,
    actualImages: frames.length,
  }),
);
