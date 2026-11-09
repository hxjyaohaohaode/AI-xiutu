/** Publish only non-sensitive measurements; never copies photos, landmarks, models, or local paths. */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { availableParallelism, cpus, platform, arch } from 'node:os';
import assert from 'node:assert/strict';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const native = await readJson('artifacts/portrait-cpu/native-evidence.json');
const pixels = await readJson('artifacts/portrait-cpu/pixel-validation.json');
const inputs = await readJson('scripts/qa/portrait-native-inputs.json');
assert.equal(native.runId, pixels.nativeRunId, 'Native and render evidence must come from one run');
assert.equal(pixels.toolsPassed, 46);
assert.equal(pixels.controls.length, 46);
assert.equal(new Set(pixels.controls.map((c) => c.tool)).size, 46);
assert(pixels.controls.every((c) => c.fullTiledByteEqual && c.positiveStats.changedPixels > 0));
assert(
  pixels.controls.filter((c) => c.negativeStats).every((c) => c.negativeStats.changedPixels > 0),
);
assert.deepEqual(native.pinnedManifest, await readJson('apps/web/public/vision/manifest.json'));
for (const input of inputs.inputs) {
  const recorded = native.inputs.find((i) => i.name === input.name);
  assert(recorded);
  assert.equal(recorded.sourceJpegSha256, input.sha256);
  assert.equal(recorded.sourceUrl, input.url);
}
const digest = async (path) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
const codeFiles = [
  ...(await readdir('packages/editor/src'))
    .filter((p) => p.endsWith('.ts'))
    .map((p) => `packages/editor/src/${p}`),
  ...(await readdir('packages/portrait/src'))
    .filter((p) => p.endsWith('.ts'))
    .map((p) => `packages/portrait/src/${p}`),
  'scripts/qa/portrait-native-infer.py',
  'scripts/qa/portrait-native-verify.ts',
  'scripts/qa/portrait-native-requirements.txt',
  'scripts/qa/portrait-native-inputs.json',
  'package-lock.json',
];
const codeFileSha256 = Object.fromEntries(
  await Promise.all(codeFiles.sort().map(async (p) => [p, await digest(p)])),
);
const durations = pixels.controls.map((c) => c.elapsedMs).sort((a, b) => a - b);
const report = {
  schemaVersion: 1,
  evidenceKind: 'actual-native-cpu-inference-and-product-adapter-render-validation',
  recordedAt: native.recordedAt,
  nativeRunId: native.runId,
  browserAutomaticInferenceVerified: false,
  limits: [
    'Three public photographs are a smoke test, not a representative population accuracy study.',
    'The 46 controls are deterministic landmark/mask editing primitives, not industrial automatic defect detection.',
    'Native CPU inference does not establish browser WebGL support or mobile latency.',
    'Model inference timing excludes initial model loading; editing check timing includes full/tiled/reverse renders, assertions and hashes.',
    'Visual checks of canonical images, landmark overlays and rendered crops are qualitative, not pixel-perfect landmark ground truth.',
  ],
  runtime: {
    os: native.operatingSystem,
    machine: native.machine,
    python: native.nativePython,
    mediapipe: native.nativeMediapipe,
    numpy: native.numpyVersion,
    pillow: native.pillowVersion,
    node: process.version,
    nodePlatform: platform(),
    nodeArch: arch(),
    reportedCpuModel: cpus()[0]?.model ?? null,
    reportedAvailableParallelism: availableParallelism(),
    delegate: 'CPU / TensorFlow Lite XNNPACK',
    systemDependencyNote:
      'Official Ubuntu libgles2 1.7.0-1build1 was extracted to an isolated directory for libGLESv2.so.2; no product dependency was changed.',
    modelRuntimeWarning:
      'MediaPipe logged disabled optional feedback tensors and a NORM_RECT/IMAGE_DIMENSIONS projection warning. Actual inference completed; geometric accuracy is not established by successful execution alone.',
  },
  models: native.pinnedManifest,
  modelSources: [
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
  ],
  sourceHashFormula:
    'SHA256(UTF8(width + "x" + height + ":srgb-rgba8:") || full normalized RGBA bytes)',
  inputs: native.inputs.map((i) => ({
    ...i,
    fixedJpegBytes: inputs.inputs.find((s) => s.name === i.name).bytes,
  })),
  summary: {
    individualToolsPassed: pixels.toolsPassed,
    signedPositiveAndNegativeCases: pixels.controls.filter((c) => c.negativeStats).length,
    exactFullTiledComparisons: pixels.controls.length,
    exactOutsideMaskChecks: pixels.controls.filter((c) => c.outsideMaskUnchanged).length,
    immutableSourceHashChecks: pixels.controls.length,
    controlValidationElapsedMs: {
      min: durations[0],
      median: durations[Math.floor(durations.length / 2)],
      max: durations.at(-1),
    },
    positiveParameterValue: 55,
    negativeParameterValueForSignedControls: -55,
  },
  controls: pixels.controls,
  images: pixels.images.map(
    ({ name, sourceFrame, actualModelOutputAccepted, availability, combined }) => ({
      name,
      sourceFrame,
      actualModelOutputAccepted,
      availability: availability.map(({ id, kind, landmarks, controls }) => ({
        id,
        kind,
        landmarks,
        controls,
      })),
      combined,
    }),
  ),
  defectsFoundByActualInference: [
    {
      issue:
        'Previously downloaded pose bundle was truncated to 3207168 bytes, while an earlier fixed hash matched that incomplete file.',
      correction:
        'The complete official 5777746-byte bundle was obtained and SHA256/ZIP structure checks were fixed before final inference.',
      completeSha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
    },
    {
      issue:
        'Cropped upper-body photos yielded invisible leg estimates outside the previous y<=2 validation range (actual y=2.642005681991577).',
      correction:
        'Body landmark data retains bounded [-8,8] estimates; every tool still requires its own visible, in-frame joints. Face limits remain [-1,2].',
    },
  ],
  reproduction: {
    guide: 'scripts/qa/README.md',
    sourceManifest: 'scripts/qa/portrait-native-inputs.json',
    requirements: 'scripts/qa/portrait-native-requirements.txt',
    nativeScript: 'scripts/qa/portrait-native-infer.py',
    validationScript: 'scripts/qa/portrait-native-verify.ts',
    visualScript: 'scripts/qa/portrait-native-visuals.py',
    reportScript: 'scripts/qa/portrait-native-report.mjs',
    normalNpmTestDownloadsModelsOrImages: false,
    usesBillableAIAPI: false,
  },
  codeFileSha256,
};
await writeFile(
  'docs/verification/v3-portrait-native.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  `Published non-sensitive native evidence: ${report.summary.individualToolsPassed} controls; no photos/landmark arrays/model binaries copied.`,
);
