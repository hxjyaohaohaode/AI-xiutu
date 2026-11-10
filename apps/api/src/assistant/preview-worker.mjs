import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { renderEditorRecipe, parseEditorRecipe } from '@ai-xiutu/editor';

async function decode(bytes) {
  const { data, info } = await sharp(Buffer.from(bytes), {
    limitInputPixels: 16777216,
    failOn: 'warning',
  })
    .autoOrient()
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
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
const before = renderEditorRecipe(input, base, { images, maxPixels: 1048576 });
const after = renderEditorRecipe(input, candidate, { images, maxPixels: 1048576 });
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
    fidelity:
      'sRGB RGBA8 preview rendered from source at <=512px; detail depends on resolution. Statistics are not an aesthetic score or a full-resolution guarantee.',
  },
});
