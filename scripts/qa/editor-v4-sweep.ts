/** Optional photographic pixel/visual acceptance, not a replacement for subjective review.
 * Requires the documented public fixtures from the v3 native acceptance; no network/model calls.
 * node --import tsx scripts/qa/editor-v4-sweep.ts
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  TOOLS,
  V2_TOOLS,
  V3_TOOLS,
  BLEND_MODES_V3,
  createRecipeV4,
  createColorBlockV3,
  createAdjustmentRegionV3,
  createHealingOperationV4,
  createRetouchRegionV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  setEditorParameter,
  parseRecipeV4,
  type RecipeV4,
  type RGBAImage,
  type SelectionMaskV3,
  type CurveChannel,
} from '../../packages/editor/src/index.js';
import {
  PORTRAIT_TOOLS,
  applyPortraitValues,
  portraitToolAvailability,
  validatePortraitAnalysis,
  type PortraitAnalysis,
} from '../../packages/portrait/src/index.js';

const output = resolve('artifacts/editor-v4-sweep');
await mkdir(output, { recursive: true });
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const shaFrame = (image: RGBAImage) =>
  createHash('sha256')
    .update(`${image.width}x${image.height}:srgb-rgba8:`)
    .update(image.data)
    .digest('hex');
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
type Frame = {
  id: string;
  image: RGBAImage;
  path: string;
  originalSha256: string;
  analysis?: PortraitAnalysis;
};
const specs = [
  [
    'hopper',
    'artifacts/portrait-cpu/portrait-hopper.canonical.png',
    'artifacts/portrait-cpu/portrait-hopper.analysis.json',
  ],
  [
    'portrait',
    'artifacts/portrait-cpu/mediapipe-portrait.canonical.png',
    'artifacts/portrait-cpu/mediapipe-portrait.analysis.json',
  ],
  ['architecture', 'artifacts/browser-fixtures/architecture-china.jpg'],
  ['flower', 'artifacts/browser-fixtures/flower.jpg'],
  [
    'pose',
    'artifacts/portrait-cpu/mediapipe-pose.canonical.png',
    'artifacts/portrait-cpu/mediapipe-pose.analysis.json',
  ],
] as const;
const frames: Frame[] = [];
for (const [id, path, analysisPath] of specs) {
  const encoded = await readFile(path),
    full = await sharp(encoded)
      .autoOrient()
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    original = {
      width: full.info.width,
      height: full.info.height,
      data: new Uint8ClampedArray(full.data),
    };
  let analysis: PortraitAnalysis | undefined;
  if (analysisPath) {
    analysis = validatePortraitAnalysis(JSON.parse(await readFile(analysisPath, 'utf8')));
    assert.equal(
      analysis.frame.contentHash,
      shaFrame(original),
      'Actual model landmarks must belong to these exact source pixels',
    );
  }
  const preview = await sharp(encoded)
    .autoOrient()
    .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  frames.push({
    id,
    path,
    originalSha256: sha(encoded),
    image: {
      width: preview.info.width,
      height: preview.info.height,
      data: new Uint8ClampedArray(preview.data),
    },
    ...(analysis ? { analysis } : {}),
  });
}
const evidence: Record<string, unknown> = {
  protocol: 'editor-v4-photographic-sweep-v1',
  startedAt: new Date().toISOString(),
  node: process.version,
  method:
    'Actual sRGB RGBA8 photo renders at <=320px edge, five numeric samples per registered control; full/tiled equality checked on every rendered case. Sheets require human inspection, not a commercial-quality assertion.',
  fixtures: frames.map((f) => ({
    id: f.id,
    path: f.path,
    encodedSha256: f.originalSha256,
    previewWidth: f.image.width,
    previewHeight: f.image.height,
    analysisSourceHash: f.analysis?.frame.contentHash ?? null,
  })),
  samples: [] as Record<string, unknown>[],
  sheets: [] as { path: string; sha256: string }[],
  failures: [] as Record<string, unknown>[],
};
const samples = evidence.samples as Record<string, unknown>[],
  failures = evidence.failures as Record<string, unknown>[];
const sheets = evidence.sheets as { path: string; sha256: string }[];
const WIDTH = 160,
  HEIGHT = 128,
  LABEL = 28,
  COLS = 5;
type Cell = {
  image: RGBAImage;
  label: string;
  crop?: { x: number; y: number; width: number; height: number };
};
async function sheet(name: string, title: string, cells: Cell[]) {
  const rows = Math.ceil(cells.length / COLS),
    height = 40 + rows * (HEIGHT + LABEL),
    layers: sharp.OverlayOptions[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!,
      source = cell.image,
      left = (i % COLS) * WIDTH,
      top = 40 + Math.floor(i / COLS) * (HEIGHT + LABEL);
    let picture = sharp(Buffer.from(source.data), {
      raw: { width: source.width, height: source.height, channels: 4 },
    });
    if (cell.crop) {
      const x = Math.max(0, Math.min(source.width - 1, Math.floor(cell.crop.x * source.width))),
        y = Math.max(0, Math.min(source.height - 1, Math.floor(cell.crop.y * source.height)));
      picture = picture.extract({
        left: x,
        top: y,
        width: Math.max(1, Math.min(source.width - x, Math.ceil(cell.crop.width * source.width))),
        height: Math.max(
          1,
          Math.min(source.height - y, Math.ceil(cell.crop.height * source.height)),
        ),
      });
    }
    layers.push({
      input: await picture
        .resize(WIDTH, HEIGHT, { fit: 'contain', background: '#d8d6d1' })
        .png()
        .toBuffer(),
      left,
      top,
    });
    layers.push({
      input: Buffer.from(
        `<svg width="${WIDTH}" height="${LABEL}"><text x="6" y="17" fill="#282727" font-size="10" font-family="DejaVu Sans">${esc(cell.label.slice(0, 27))}</text></svg>`,
      ),
      left,
      top: top + HEIGHT,
    });
  }
  layers.push({
    input: Buffer.from(
      `<svg width="${WIDTH * COLS}" height="40"><text x="12" y="25" fill="#202020" font-size="16" font-family="DejaVu Sans">${esc(title)}</text></svg>`,
    ),
    left: 0,
    top: 0,
  });
  const bytes = await sharp({
    create: { width: WIDTH * COLS, height, channels: 3, background: '#f1f0ec' },
  })
    .composite(layers)
    .jpeg({ quality: 91 })
    .toBuffer();
  const path = `${name}.jpg`;
  await writeFile(join(output, path), bytes);
  sheets.push({ path, sha256: sha(bytes) });
}
function stats(original: RGBAImage, result: RGBAImage) {
  let changed = 0,
    absolute = 0,
    opaque = 0,
    clipped = 0;
  for (let i = 0; i < result.data.length; i += 4) {
    if (result.data[i + 3]) {
      opaque++;
      if ([0, 1, 2].some((c) => result.data[i + c] === 0 || result.data[i + c] === 255)) clipped++;
    }
    if (original.width === result.width && original.height === result.height) {
      let different = false;
      for (let c = 0; c < 4; c++) {
        const delta = Math.abs(result.data[i + c]! - original.data[i + c]!);
        if (delta) different = true;
        if (c < 3) absolute += delta;
      }
      if (different) changed++;
    }
  }
  return {
    width: result.width,
    height: result.height,
    rgbaSha256: sha(result.data),
    sameDimensions: original.width === result.width && original.height === result.height,
    changedPixels: changed,
    rgbMeanAbsoluteDelta: absolute / (result.width * result.height * 3),
    visiblePixels: opaque,
    channelClippedPixels: clipped,
  };
}
function render(frame: Frame, key: string, value: number | string, recipe: RecipeV4) {
  const before = sha(frame.image.data),
    started = performance.now();
  const result = renderEditorRecipe(frame.image, recipe, { maxPixels: 4_194_304 });
  const tiled = renderEditorRecipeTiled(frame.image, recipe, {
    maxPixels: 4_194_304,
    tileSize: 64,
  });
  assert.deepEqual(tiled, result, `${key} ${value} full/tiled mismatch`);
  assert.equal(sha(frame.image.data), before, 'Immutable source changed');
  samples.push({
    frame: frame.id,
    key,
    value,
    fullTiledEqual: true,
    sourceUnchanged: true,
    elapsedMs: Math.round(performance.now() - started),
    ...stats(frame.image, result),
  });
  return result;
}
type Numeric = {
  path: string;
  min: number;
  max: number;
  neutral: number;
  step: number;
  group: string;
};
const controls: Numeric[] = [
  ...TOOLS.map((t) => ({ path: `adjustments.${t.id}`, ...t })),
  ...V2_TOOLS,
  ...V3_TOOLS,
];
function values(t: Numeric): number[] {
  const a =
    t.neutral === t.min || t.neutral === t.max
      ? [
          t.min,
          t.min + (t.max - t.min) / 4,
          (t.min + t.max) / 2,
          t.min + ((t.max - t.min) * 3) / 4,
          t.max,
        ]
      : [t.min, (t.min + t.neutral) / 2, t.neutral, (t.neutral + t.max) / 2, t.max];
  return a.map((n, i) =>
    i === 0 ? t.min : i === 4 ? t.max : t.step === 1 ? Math.round(n) : Number(n.toFixed(6)),
  );
}
function context(path: string): RecipeV4 {
  const r = createRecipeV4();
  if (path.startsWith('grading.') && path.endsWith('.hue'))
    r.grading[path.split('.')[1] as 'shadows'].saturation = 65;
  if (path === 'grading.balance') {
    r.grading.shadows = { hue: 215, saturation: 60, luminance: -20 };
    r.grading.highlights = { hue: 35, saturation: 50, luminance: 20 };
  }
  if (path.startsWith('effects.vignette.') && !path.endsWith('amount'))
    r.effects.vignette.amount = 75;
  if (path.startsWith('effects.grain.') && !path.endsWith('amount')) r.effects.grain.amount = 50;
  if (path.startsWith('transform.translate')) r.transform.fit = 'crop';
  if (path.startsWith('optics.aberrationCenter')) {
    r.optics.aberrationRed = 8;
    r.optics.aberrationBlue = -8;
  }
  return r;
}
const radial = (x = 0.5, y = 0.5, rx = 0.34, ry = rx, feather = 0.5): SelectionMaskV3 => ({
  type: 'radial',
  centerX: x,
  centerY: y,
  radiusX: rx,
  radiusY: ry,
  feather,
  invert: false,
});
for (const frame of frames.filter((f) => f.id !== 'pose')) {
  const grouped = new Map<string, Numeric[]>();
  for (const t of controls) grouped.set(t.group, [...(grouped.get(t.group) ?? []), t]);
  for (const [group, entries] of grouped) {
    for (let offset = 0; offset < entries.length; offset += 12) {
      const cells: Cell[] = [];
      for (const t of entries.slice(offset, offset + 12))
        for (const value of values(t)) {
          try {
            const r = parseRecipeV4(setEditorParameter(context(t.path), t.path, value));
            cells.push({
              image: render(frame, t.path, value, r),
              label: `${t.path.replace('adjustments.', '')} ${value}`,
            });
          } catch (e) {
            failures.push({ frame: frame.id, key: t.path, value, error: String(e) });
            cells.push({ image: frame.image, label: 'FAILED — see evidence' });
          }
        }
      await sheet(
        `${frame.id}-${group}-${offset / 12 + 1}`,
        `${frame.id} / ${group} / five bounded samples`,
        cells,
      );
    }
  }
  console.log(
    JSON.stringify({
      phase: 'global',
      frame: frame.id,
      controls: controls.length,
      renders: samples.length,
      failures: failures.length,
    }),
  );
  await writeFile(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
}

// Every color/optics registry also traverses the real independent region route.
const localFrame = frames.find((f) => f.id === 'flower')!;
for (const [page, entries] of Array.from(
  { length: Math.ceil(controls.filter((t) => t.group !== 'transform').length / 12) },
  (_, i) =>
    [i, controls.filter((t) => t.group !== 'transform').slice(i * 12, (i + 1) * 12)] as const,
)) {
  const cells: Cell[] = [];
  for (const t of entries)
    for (const value of values(t)) {
      const global = parseRecipeV4(setEditorParameter(context(t.path), t.path, value));
      const color = createColorBlockV3(
        Object.fromEntries(
          ['adjustments', 'curves', 'levels', 'hsl', 'grading', 'detail', 'effects', 'optics'].map(
            (key) => [key, global[key as keyof RecipeV4]],
          ),
        ),
      );
      const r = createRecipeV4({
        regionEdits: [createAdjustmentRegionV3({ id: 'qa-local', mask: radial(), color })],
      });
      try {
        cells.push({
          image: render(localFrame, `local.${t.path}`, value, r),
          label: `${t.path.replace('adjustments.', '')} ${value}`,
        });
      } catch (e) {
        failures.push({ frame: localFrame.id, key: `local.${t.path}`, value, error: String(e) });
        cells.push({ image: localFrame.image, label: 'FAILED — see evidence' });
      }
    }
  await sheet(`local-${page + 1}`, 'flower / independent local color and optics', cells);
}

for (const frame of frames) {
  const cells: Cell[] = [],
    recipes: [string, RecipeV4][] = [['neutral', createRecipeV4()]];
  for (const channel of ['rgb', 'red', 'green', 'blue'] as CurveChannel[]) {
    const r = createRecipeV4();
    r.curves[channel] = [
      [0, 0],
      [0.18, 0.35],
      [0.47, 0.12],
      [0.76, 0.93],
      [1, 1],
    ];
    recipes.push([`curve.${channel}`, r]);
  }
  const grouped = createRecipeV4({
    regionEdits: [
      createAdjustmentRegionV3({ id: 'left', groupId: 'g', mask: radial(0.35, 0.5) }),
      createAdjustmentRegionV3({ id: 'right', groupId: 'g', mask: radial(0.65, 0.5) }),
    ],
    regionGroups: [
      {
        id: 'g',
        name: 'shared union',
        enabled: true,
        opacity: 1,
        color: createColorBlockV3({
          adjustments: { exposure: 0.8, saturation: 25 },
          curves: {
            rgb: [
              [0, 0],
              [0.3, 0.2],
              [0.7, 0.85],
              [1, 1],
            ],
          },
        }),
      },
    ],
  });
  recipes.push(['group.union', grouped]);
  for (const operation of ['union', 'intersection', 'subtract', 'xor'] as const)
    recipes.push([
      `mask.${operation}`,
      createRecipeV4({
        regionEdits: [
          createAdjustmentRegionV3({
            id: 'boolean',
            mask: {
              type: 'compound',
              operation,
              masks: [radial(0.35, 0.5), radial(0.65, 0.5)],
              invert: false,
            },
            color: { adjustments: { exposure: 1 } },
          }),
        ],
      }),
    ]);
  for (const mode of BLEND_MODES_V3)
    recipes.push([
      `paint.${mode}`,
      createRecipeV4({
        paintLayers: [
          {
            id: mode,
            name: mode,
            enabled: true,
            opacity: 0.7,
            blendMode: mode,
            mask: null,
            strokes: [
              {
                mode: 'paint',
                points: [
                  { x: 0.3, y: 0.3 },
                  { x: 0.68, y: 0.66 },
                ],
                radius: 0.12,
                feather: 0.7,
                opacity: 1,
                color: [209, 63, 112, 210],
                source: null,
              },
            ],
          },
        ],
      }),
    ]);
  for (const [name, recipe] of recipes) {
    try {
      cells.push({ image: render(frame, name, 'composition', recipe), label: name });
    } catch (e) {
      failures.push({ frame: frame.id, key: name, error: String(e) });
      cells.push({ image: frame.image, label: 'FAILED — see evidence' });
    }
  }
  await sheet(
    `${frame.id}-curve-mask-paint`,
    `${frame.id} / editable curves, groups, masks, 16 blends`,
    cells,
  );
}

// Anatomical controls use real previously recorded MediaPipe outputs, never hand-invented landmarks.
for (const frame of frames.filter((f) => f.analysis)) {
  for (const target of frame.analysis!.targets) {
    const available = new Map(
      portraitToolAvailability(frame.analysis!, target.id).map((t) => [t.id, t]),
    );
    const tools = PORTRAIT_TOOLS.filter((t) => t.target === target.kind),
      cells: Cell[] = [];
    for (const tool of tools) {
      if (!available.get(tool.id)?.available) {
        samples.push({
          frame: frame.id,
          key: `portrait.${tool.id}`,
          unavailable: true,
          reason: available.get(tool.id)?.reason,
        });
        continue;
      }
      for (const value of values({ path: tool.id, ...tool, neutral: 0 })) {
        try {
          const r = applyPortraitValues(createRecipeV4(), frame.analysis!, target.id, {
            [tool.id]: value,
          });
          const margin = 0.18,
            b = target.bounds,
            crop =
              target.kind === 'face'
                ? {
                    x: b.x - b.width * margin,
                    y: b.y - b.height * margin,
                    width: b.width * (1 + margin * 2),
                    height: b.height * (1 + margin * 2),
                  }
                : undefined;
          cells.push({
            image: render(frame, `portrait.${tool.id}`, value, r),
            label: `${tool.id} ${value}`,
            ...(crop ? { crop } : {}),
          });
        } catch (e) {
          failures.push({ frame: frame.id, key: `portrait.${tool.id}`, value, error: String(e) });
          cells.push({ image: frame.image, label: 'FAILED — see evidence' });
        }
      }
    }
    for (let i = 0; i < cells.length; i += 60)
      await sheet(
        `${frame.id}-${target.kind}-${target.id.slice(-1)}-${i / 60 + 1}`,
        `${frame.id} / ${target.kind} / real source landmarks`,
        cells.slice(i, i + 60),
      );
  }
}

const skinFrame = frames[0]!,
  textureFrame = frames.find((f) => f.id === 'architecture')!;
for (const frame of [skinFrame, textureFrame]) {
  const cells: Cell[] = [];
  for (const key of [
    'smoothing',
    'texture',
    'uniformity',
    'shine',
    'speckle',
    'fineLines',
  ] as const)
    for (const value of key === 'texture' ? [-100, -50, 0, 50, 100] : [0, 25, 50, 75, 100]) {
      const r = createRecipeV4({
        retouch: [
          createRetouchRegionV4({ mask: radial(0.52, 0.42, 0.25), radius: 0.03, [key]: value }),
        ],
      });
      cells.push({
        image: render(frame, `retouch.${key}`, value, r),
        label: `${key} ${value}`,
        crop: { x: 0.3, y: 0.2, width: 0.45, height: 0.5 },
      });
    }
  await sheet(`${frame.id}-retouch`, `${frame.id} / six distinct bounded signal operators`, cells);
}
const repairCells: Cell[] = [];
for (const method of ['diffusion', 'patch-poisson'] as const)
  for (const iterations of [1, 16, 64, 128, 512]) {
    const r = createRecipeV4({
      healing: [
        createHealingOperationV4({
          mask: radial(0.734, 0.643, 0.022, 0.025, 0.2),
          source: method === 'patch-poisson' ? { x: 0.82, y: 0.6 } : null,
          method,
          iterations,
        }),
      ],
    });
    try {
      repairCells.push({
        image: render(textureFrame, `healing.${method}`, iterations, r),
        label: `${method} i=${iterations}`,
        crop: { x: 0.64, y: 0.54, width: 0.25, height: 0.23 },
      });
    } catch (e) {
      failures.push({ key: `healing.${method}`, iterations, error: String(e) });
      repairCells.push({ image: textureFrame.image, label: 'FAILED — see evidence' });
    }
  }
await sheet(
  'photographic-repair',
  'architecture / tiny water detail repair, finite iterations',
  repairCells,
);

const geometryCells: Cell[] = [];
for (const strength of [-1, -0.5, 0, 0.5, 1]) {
  const r = createRecipeV4({
    projective: {
      enabled: true,
      corners: [
        { x: -0.2 * strength, y: 0.15 * strength },
        { x: 1, y: -0.1 * strength },
        { x: 1 - 0.12 * strength, y: 1 },
        { x: 0.18 * strength, y: 1 + 0.1 * strength },
      ],
    },
  });
  geometryCells.push({
    image: render(textureFrame, 'projective.sweep', strength, r),
    label: `quad strength ${strength}`,
  });
}
for (const mode of ['push', 'pinch', 'bulge', 'twirl'] as const)
  for (const strength of [-1, -0.5, 0, 0.5, 1]) {
    const r = createRecipeV4({
      warp: {
        enabled: true,
        protection: radial(0.31, 0.49, 0.15, 0.34, 0.15),
        strokes: [
          {
            id: 'qa',
            mode,
            from: { x: 0.55, y: 0.5 },
            to: { x: 0.62, y: 0.44 },
            radius: 0.3,
            feather: 0.65,
            strength,
          },
        ],
      },
    });
    geometryCells.push({
      image: render(textureFrame, `warp.${mode}.protected`, strength, r),
      label: `${mode} ${strength}`,
    });
  }
await sheet(
  'geometry-protection',
  'architecture / corner homography and protected displacement',
  geometryCells,
);

evidence.completedAt = new Date().toISOString();
evidence.summary = {
  numericControls: controls.length,
  photographicFrames: frames.length,
  renderComparisons: samples.filter((s) => s.fullTiledEqual).length,
  unavailableTools: samples.filter((s) => s.unavailable).length,
  sheets: sheets.length,
  failures: failures.length,
};
await writeFile(join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence.summary));
if (failures.length) process.exitCode = 1;
