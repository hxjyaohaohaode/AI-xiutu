import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { renderEditorRecipeTiled, parseEditorRecipe, MAX_V4_PIXELS } from '@ai-xiutu/editor';

const fullResolution = workerData.fullResolution === true;
async function decode({ width, height, bytes }) {
  let pipeline = sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
    limitInputPixels: workerData.decodeLimit,
    failOn: 'warning',
    sequentialRead: true,
  });
  const metadata = await pipeline.metadata();
  if (
    metadata.format !== 'png' ||
    (metadata.pages ?? 1) !== 1 ||
    metadata.width !== width ||
    metadata.height !== height
  )
    throw new Error('PREVIEW_SOURCE_METADATA');
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
const images = new Map();
for (const entry of workerData.inputs) images.set(entry.id, await decode(entry));
const input = images.get(workerData.sourceId);
const base = parseEditorRecipe(workerData.base),
  candidate = parseEditorRecipe(workerData.candidate);
const options = { images, maxPixels: fullResolution ? MAX_V4_PIXELS : 1048576, tileSize: 128 };
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
      ? 'sRGB RGBA8 render at the editable source resolution; measurements cover full rendered images. The supplied JPEG is reduced to <=512px.'
      : 'sRGB RGBA8 preview rendered from source at <=512px; detail depends on resolution. Statistics are not an aesthetic score or a full-resolution guarantee.',
  },
});
