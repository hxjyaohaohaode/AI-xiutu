/** Optional real-photo edge review; uses the already documented public native-inference fixtures.
 * No network, model download or paid calls. node --import tsx scripts/qa/portrait-v4-boundaries.ts
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  compileSelectionMaskV3,
  createRecipeV4,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  type RGBAImage,
} from '../../packages/editor/src/index.js';
import {
  applyPortraitValues,
  facialMasks,
  facialMasksV4,
  validatePortraitAnalysis,
} from '../../packages/portrait/src/index.js';

const output = resolve('artifacts/v4-portrait-edge-review');
await mkdir(output, { recursive: true });
const sha = (bytes: string | Uint8Array | Uint8ClampedArray) =>
  createHash('sha256').update(bytes).digest('hex');
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const evidence: Record<string, unknown>[] = [];
for (const id of ['portrait-hopper', 'mediapipe-portrait']) {
  const path = `artifacts/portrait-cpu/${id}.canonical.png`,
    encoded = await readFile(path),
    decoded = await sharp(encoded)
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true }),
    image: RGBAImage = {
      width: decoded.info.width,
      height: decoded.info.height,
      data: new Uint8ClampedArray(decoded.data),
    },
    a = validatePortraitAnalysis(
      JSON.parse(await readFile(`artifacts/portrait-cpu/${id}.analysis.json`, 'utf8')),
    ),
    target = a.targets.find((t) => t.kind === 'face')!;
  assert.ok(target, 'Real detected face is required');
  assert.equal(
    a.frame.contentHash,
    createHash('sha256')
      .update(`${image.width}x${image.height}:srgb-rgba8:`)
      .update(image.data)
      .digest('hex'),
  );
  const oldMasks = facialMasks(target, a.segmentation?.skin ?? null),
    newMasks = facialMasksV4(target, a.segmentation?.skin ?? null, a.frame),
    oldWeight = compileSelectionMaskV3(oldMasks.skin, image),
    newWeight = compileSelectionMaskV3(newMasks.skin, image),
    oldFace = compileSelectionMaskV3(oldMasks.face, image),
    newFace = compileSelectionMaskV3(newMasks.face, image),
    top = target.contours.oval!.reduce((p, q) => (p.y < q.y ? p : q)),
    count = Math.ceil(target.bounds.height * image.height * 0.4),
    profile = Array.from({ length: count }, (_, i) => ({
      offsetPx: i,
      before: oldWeight(top.x, top.y + i / image.height),
      after: newWeight(top.x, top.y + i / image.height),
      faceBefore: oldFace(top.x, top.y + i / image.height),
      faceAfter: newFace(top.x, top.y + i / image.height),
    })),
    jump = (key: 'before' | 'after' | 'faceBefore' | 'faceAfter') =>
      Math.max(...profile.slice(1).map((v, i) => Math.abs(v[key] - profile[i]![key])));
  const samples: { image: RGBAImage; label: string; rgbaSha256: string }[] = [];
  for (const [mode, value] of [
    ['before', -100],
    ['after', -100],
    ['neutral', 0],
    ['before', 100],
    ['after', 100],
  ] as const) {
    const recipe = applyPortraitValues(createRecipeV4(), a, target.id, { skinLight: value });
    if (mode === 'before')
      for (const region of recipe.regionEdits)
        if (region.origin?.parameterId === 'skin') region.mask = oldMasks.skin;
    const result = renderEditorRecipe(image, recipe);
    assert.deepEqual(renderEditorRecipeTiled(image, recipe, { tileSize: 128 }), result);
    samples.push({
      image: result,
      label: `${mode} skinLight ${value}`,
      rgbaSha256: sha(result.data),
    });
  }
  const width = 240,
    height = 280,
    label = 28,
    title = 40,
    layers: sharp.OverlayOptions[] = [],
    b = target.bounds;
  for (const [i, sample] of samples.entries()) {
    for (let row = 0; row < 2; row++) {
      const crop =
        row === 0
          ? {
              x: b.x - b.width * 0.14,
              y: b.y - b.height * 0.14,
              width: b.width * 1.28,
              height: b.height * 1.28,
            }
          : {
              x: b.x + b.width * 0.1,
              y: b.y - b.height * 0.06,
              width: b.width * 0.8,
              height: b.height * 0.4,
            };
      const left = Math.max(0, Math.floor(crop.x * image.width)),
        top = Math.max(0, Math.floor(crop.y * image.height)),
        picture = await sharp(Buffer.from(sample.image.data), {
          raw: { width: image.width, height: image.height, channels: 4 },
        })
          .extract({
            left,
            top,
            width: Math.min(image.width - left, Math.ceil(crop.width * image.width)),
            height: Math.min(image.height - top, Math.ceil(crop.height * image.height)),
          })
          .resize(width, height, { fit: 'contain', background: '#d8d6d1' })
          .png()
          .toBuffer(),
        y = title + row * (height + label);
      layers.push({ input: picture, left: i * width, top: y });
      layers.push({
        input: Buffer.from(
          `<svg width="${width}" height="${label}"><text x="8" y="18" font-family="DejaVu Sans" font-size="12">${esc(sample.label)}${row ? ' / forehead' : ''}</text></svg>`,
        ),
        left: i * width,
        top: y + height,
      });
    }
  }
  layers.push({
    input: Buffer.from(
      `<svg width="${width * samples.length}" height="${title}"><text x="10" y="25" font-family="DejaVu Sans" font-size="16">${id} / same full-resolution pixels / inward face-edge falloff</text></svg>`,
    ),
    left: 0,
    top: 0,
  });
  const sheet = await sharp({
      create: {
        width: width * samples.length,
        height: title + 2 * (height + label),
        channels: 3,
        background: '#f1f0ec',
      },
    })
      .composite(layers)
      .png()
      .toBuffer(),
    sheetPath = `${id}-skin-boundary.png`;
  await writeFile(join(output, sheetPath), sheet);
  evidence.push({
    id,
    source: path,
    encodedSha256: sha(encoded),
    frame: a.frame,
    method:
      'Before uses unchanged published fixed-0.009 face mask; after uses new V4 face-size-dependent inward mask. Same unchanged exposure range and exact source pixels, actual stored MediaPipe analysis. Both full/tiled paths checked.',
    maskFeather: {
      before: oldMasks.face.type === 'polygon' ? oldMasks.face.feather : null,
      after: newMasks.face.type === 'polygon' ? newMasks.face.feather : null,
    },
    maximumAdjacentMaskJump: { before: jump('before'), after: jump('after') },
    maximumAdjacentFaceContourJump: { before: jump('faceBefore'), after: jump('faceAfter') },
    profile,
    samples: samples.map(({ label, rgbaSha256 }) => ({ label, rgbaSha256, fullTiledEqual: true })),
    sheet: { path: sheetPath, sha256: sha(sheet) },
  });
}
await writeFile(
  join(output, 'edge-evidence.json'),
  JSON.stringify({ completedAt: new Date().toISOString(), cases: evidence }, null, 2),
);
console.log(
  JSON.stringify(
    evidence.map((item) => ({
      id: item.id,
      maskFeather: item.maskFeather,
      maximumAdjacentMaskJump: item.maximumAdjacentMaskJump,
      sheet: item.sheet,
    })),
  ),
);
