import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import {
  getEditorOutputDimensions,
  parseEditorRecipe,
  renderEditorRecipeTiled,
  renderCutout,
  MAX_CUTOUT_PIXELS,
} from '@ai-xiutu/editor';

sharp.concurrency(1);
sharp.cache(false);
const maxGifBytes = 16 * 1024 * 1024;
const maxGifPixels = 12_582_912;
const maxGifFramePixels = 2_097_152;
const bytes = (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength);

async function canonical(asset) {
  const source = sharp(bytes(asset.bytes), {
    limitInputPixels: MAX_CUTOUT_PIXELS,
    failOn: 'warning',
  });
  const metadata = await source.metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== asset.width ||
    metadata.height !== asset.height ||
    (metadata.pages ?? 1) !== 1
  )
    throw new Error('Canonical asset metadata mismatch');
  return source;
}

async function cutout(input, settings) {
  const raw = await (await canonical(input)).toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const { width, height } = input;
  const image = renderCutout(
    { width, height, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.length) },
    settings,
  );
  return {
    png: await sharp(image.data, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  };
}

async function collage(inputs, settings) {
  const parts = [];
  for (const cell of settings.cells) {
    const asset = inputs.find((input) => input.id === cell.assetId);
    const { width, height } = cell;
    let source = await canonical(asset);
    let left = cell.left,
      top = cell.top;
    if (cell.fit === 'cover') {
      const ratio = width / height;
      const cropWidth = Math.max(1, Math.min(asset.width, Math.round(asset.height * ratio)));
      const cropHeight = Math.max(1, Math.min(asset.height, Math.round(asset.width / ratio)));
      source = source
        .extract({
          left: Math.round((asset.width - cropWidth) * cell.focalX),
          top: Math.round((asset.height - cropHeight) * cell.focalY),
          width: cropWidth,
          height: cropHeight,
        })
        .resize(width, height, { fit: 'fill' });
    } else {
      const scale = Math.min(width / asset.width, height / asset.height);
      const fittedWidth = Math.max(1, Math.round(asset.width * scale));
      const fittedHeight = Math.max(1, Math.round(asset.height * scale));
      left += Math.round((width - fittedWidth) * cell.focalX);
      top += Math.round((height - fittedHeight) * cell.focalY);
      source = source.resize(fittedWidth, fittedHeight, { fit: 'fill' });
    }
    parts.push({ input: await source.toColourspace('srgb').png().toBuffer(), left, top });
  }
  const [r, g, b, a] = settings.background;
  const png = await sharp({
    create: {
      width: settings.width,
      height: settings.height,
      channels: 4,
      background: { r, g, b, alpha: a / 255 },
    },
  })
    .composite(parts)
    .png()
    .toBuffer();
  return { png };
}

async function animation(value, edit) {
  const sourceBytes = bytes(value);
  if (
    !/^GIF8[79]a$/.test(sourceBytes.subarray(0, 6).toString('ascii')) ||
    sourceBytes.length > maxGifBytes
  )
    throw new Error('GIF required');
  const source = sharp(sourceBytes, {
    animated: true,
    failOn: 'warning',
    limitInputPixels: maxGifPixels,
  });
  const info = await source.metadata();
  const width = info.width,
    height = info.pageHeight,
    frames = info.pages;
  if (!width || !height || !frames || frames < 2 || frames > 120 || info.height !== height * frames)
    throw new Error('Invalid animated frame layout');
  if (width * height > maxGifFramePixels || width * height * frames > maxGifPixels)
    throw new RangeError('GIF decode budget exceeded');
  const order = edit?.frames ?? Array.from({ length: frames }, (_, index) => index);
  if (order.some((index) => index >= frames) || (edit?.delay && edit.delay.length !== order.length))
    throw new Error('Frame index or delay count mismatch');
  const inputDelay = info.delay ?? Array(frames).fill(100);
  const delay = edit?.delay ?? order.map((index) => inputDelay[index]);
  const loop = edit?.loop ?? info.loop ?? 0;
  const recipe = edit?.recipe === undefined ? null : parseEditorRecipe(edit.recipe);
  if (
    recipe &&
    'imageLayers' in recipe &&
    recipe.imageLayers.some((layer) => layer.enabled && layer.opacity > 0)
  )
    throw new Error('Animated edit does not accept unresolved image layers');
  const out = recipe ? getEditorOutputDimensions({ width, height }, recipe) : { width, height };
  if (
    out.width * out.height > maxGifFramePixels ||
    out.width * out.height * order.length > maxGifPixels
  )
    throw new RangeError('GIF render budget exceeded');
  const raw = await source.toColourspace('srgb').ensureAlpha().raw().toBuffer();
  const frameBytes = width * height * 4;
  if (raw.length !== frameBytes * frames) throw new Error('Invalid decoded frame count');
  let gif = sourceBytes;
  if (edit) {
    const output = Buffer.alloc(out.width * out.height * order.length * 4);
    for (const [slot, frame] of order.entries()) {
      const data = new Uint8ClampedArray(
        raw.buffer,
        raw.byteOffset + frame * frameBytes,
        frameBytes,
      );
      const result = recipe
        ? renderEditorRecipeTiled({ width, height, data }, recipe, { maxPixels: maxGifFramePixels })
        : { data };
      output.set(result.data, slot * out.width * out.height * 4);
    }
    gif = await sharp(output, {
      raw: {
        width: out.width,
        height: out.height * order.length,
        pageHeight: out.height,
        channels: 4,
      },
    })
      .gif({ delay, loop, keepDuplicateFrames: true })
      .toBuffer();
  }
  if (gif.length > maxGifBytes) throw new RangeError('GIF output budget exceeded');
  const final = sharp(gif, { animated: true, limitInputPixels: maxGifPixels, failOn: 'warning' });
  const actual = await final.metadata();
  if (
    actual.pages !== order.length ||
    actual.width !== out.width ||
    actual.pageHeight !== out.height
  )
    throw new Error('GIF output does not match its frame plan');
  const png = await sharp(gif, {
    page: 0,
    pages: 1,
    limitInputPixels: maxGifPixels,
    failOn: 'warning',
  })
    .png()
    .toBuffer();
  return {
    png,
    gif,
    descriptor: {
      ...out,
      frames: actual.pages,
      delay: actual.delay ?? delay,
      loop: actual.loop ?? loop,
      format: 'gif',
      byteLength: gif.length,
    },
  };
}

try {
  const { kind, inputs, settings } = workerData;
  const result =
    kind === 'cutout'
      ? await cutout(inputs[0], settings)
      : kind === 'collage'
        ? await collage(inputs, settings)
        : await animation(inputs[0].bytes, settings);
  parentPort.postMessage(result);
} catch (error) {
  parentPort.postMessage({ error: error instanceof RangeError ? 'BUDGET' : 'INVALID' });
}
