/** Same-source CPU measurements. Timings are observations, never device/FPS promises. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import {
  createRecipeV4,
  createRetouchRegionV4,
  createRasterMask,
  renderEditorRecipeTiled,
} from '@ai-xiutu/editor';

if (process.env.CI !== 'true') throw new Error('Isolated QA only');
const output = resolve(process.env.PERFORMANCE_ARTIFACT_DIR ?? 'artifacts/editor-performance');
await mkdir(output, { recursive: true });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inputs = JSON.parse(await readFile('scripts/qa/portrait-native-inputs.json', 'utf8')).inputs;
const record = inputs.find((entry) => entry.name === 'mediapipe-portrait');
const bytes = await readFile(join('artifacts/browser-v4-source-cache', `${record.sha256}.jpg`));
if (sha(bytes) !== record.sha256) throw new Error('Public source digest mismatch');
const full = createRasterMask(1, 1, Uint8Array.of(255));
const cases = [
  ['exposure', createRecipeV4({ adjustments: { exposure: 0.73 } })],
  [
    'curves',
    createRecipeV4({
      curves: {
        rgb: [
          [0, 0],
          [0.18, 0.11],
          [0.65, 0.78],
          [1, 1],
        ],
      },
    }),
  ],
  [
    'mixed-color',
    createRecipeV4({
      adjustments: { exposure: -0.31, temperature: 21, saturation: 13, shadows: 35 },
      detail: { clarity: 11 },
    }),
  ],
  [
    'beauty',
    createRecipeV4({
      retouch: [
        createRetouchRegionV4({
          id: 'beauty',
          mask: full,
          algorithm: 'guided-v4',
          radius: 0.012,
          smoothing: 55,
          texture: 18,
          uniformity: 25,
        }),
      ],
    }),
  ],
];
const report = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runtime: process.version,
  source: record,
  warmups: 2,
  samples: 5,
  cases: [],
};
for (const edge of [512, 1024]) {
  const raw = await sharp(bytes)
    .autoOrient()
    .resize(edge, edge, { fit: 'inside' })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = {
    width: raw.info.width,
    height: raw.info.height,
    data: new Uint8ClampedArray(raw.data),
  };
  for (const [name, recipe] of cases) {
    const samples = [];
    let result;
    for (let round = 0; round < report.warmups + report.samples; round++) {
      const start = performance.now();
      result = renderEditorRecipeTiled(image, recipe);
      if (round >= report.warmups) samples.push(performance.now() - start);
    }
    const item = {
      name,
      width: image.width,
      height: image.height,
      pixels: image.width * image.height,
      recipe,
      sha256: sha(result.data),
      samplesMs: samples,
      medianMs: [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)],
    };
    report.cases.push(item);
    process.stdout.write(
      `${name} ${image.width}x${image.height} median ${item.medianMs.toFixed(2)} ms ${item.sha256}\n`,
    );
  }
}
await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
