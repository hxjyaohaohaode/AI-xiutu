import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { renderEditorRecipeTiled, parseEditorRecipe } from '@ai-xiutu/editor';

const fullResolution = workerData.fullResolution === true;
if (fullResolution) {
  // Bound decoded buffers before any full-size image is materialized. The
  // browser uses the same aggregate layer limit, independent of compressed bytes.
  let layerPixels = 0;
  for (const entry of workerData.layers) {
    const metadata = await sharp(Buffer.from(entry.bytes), {
      limitInputPixels: 16777216,
      failOn: 'warning',
    }).metadata();
    layerPixels += metadata.width * metadata.height;
    if ((metadata.pages ?? 1) !== 1 || layerPixels > 16777216)
      throw new Error('NATIVE_PREVIEW_LAYER_BUDGET');
  }
}

async function decode(bytes) {
  let pipeline = sharp(Buffer.from(bytes), {
    limitInputPixels: 16777216,
    failOn: 'warning',
  }).autoOrient();
  if (!fullResolution)
    pipeline = pipeline.resize(512, 512, { fit: 'inside', withoutEnlargement: true });
  const { data, info } = await pipeline
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}
function measure(image) {
  let weight = 0,
    sum = 0,
    squared = 0,
    shadows = 0,
    highlights = 0;
  for (let at = 0; at < image.data.length; at += 4) {
    const a = image.data[at + 3] / 255;
    if (!a) continue;
    const y =
      (0.2126 * image.data[at] + 0.7152 * image.data[at + 1] + 0.0722 * image.data[at + 2]) / 255;
    weight += a;
    sum += y * a;
    squared += y * y * a;
    if (y <= 1 / 255) shadows += a;
    if (y >= 254 / 255) highlights += a;
  }
  return {
    width: image.width,
    height: image.height,
    visiblePixels: weight,
    meanLuma: weight ? sum / weight : 0,
    lumaDeviation: weight ? Math.sqrt(Math.max(0, squared / weight - (sum / weight) ** 2)) : 0,
    blackFraction: weight ? shadows / weight : 0,
    whiteFraction: weight ? highlights / weight : 0,
  };
}
const input = await decode(workerData.source),
  images = new Map();
for (const entry of workerData.layers) images.set(entry.id, await decode(entry.bytes));
const base = parseEditorRecipe(workerData.base),
  candidate = parseEditorRecipe(workerData.candidate);
const options = { images, maxPixels: fullResolution ? 16777216 : 1048576, tileSize: 128 };
const before = renderEditorRecipeTiled(input, base, options);
const after = renderEditorRecipeTiled(input, candidate, options);
let changedPixels = null,
  meanAbsoluteDelta = null;
if (before.width === after.width && before.height === after.height) {
  changedPixels = 0;
  let sum = 0;
  for (let at = 0; at < before.data.length; at += 4) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(before.data[at + c] - after.data[at + c]);
      sum += delta;
      changed ||= delta > 0;
    }
    if (changed) changedPixels++;
  }
  meanAbsoluteDelta = sum / before.data.length;
}
const bytes = await sharp(after.data, {
  raw: { width: after.width, height: after.height, channels: 4 },
})
  .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
  .flatten({ background: '#e8e8e8' })
  .jpeg({ quality: 85 })
  .toBuffer();
parentPort.postMessage({
  bytes,
  observation: {
    before: measure(before),
    after: measure(after),
    changedPixels,
    meanAbsoluteDelta,
    imageSha256: createHash('sha256').update(bytes).digest('hex'),
    fullResolutionChecked: fullResolution,
    fidelity: fullResolution
      ? 'sRGB RGBA8 editor render at original source resolution; measurements cover full rendered images. The supplied JPEG is reduced to <=512px. Render success is not an aesthetic or high-bit-depth guarantee.'
      : 'sRGB RGBA8 preview rendered from source at <=512px; detail depends on resolution. Statistics are not an aesthetic score or a full-resolution guarantee.',
  },
});
