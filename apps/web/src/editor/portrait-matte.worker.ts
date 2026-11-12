import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { env, InferenceSession, Tensor } from 'onnxruntime-web/wasm';
import {
  MAX_CUTOUT_PIXELS,
  type CutoutAlphaPrior,
  type Dimensions,
  type RGBAImage,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
import { fusePortraitCutoutPrior } from '@ai-xiutu/portrait';
import model from '../../../../third-party/portrait-matting.json';

export interface PortraitMatteRequest {
  image: RGBAImage;
  source: Dimensions;
  subject: SelectionMaskV3;
}
export interface PortraitMatteReply {
  prior?: CutoutAlphaPrior;
  diagnostic?: string;
}

function modelInput(image: RGBAImage) {
  const scale = Math.min(
    512 / Math.min(image.width, image.height),
    1024 / Math.max(image.width, image.height),
  );
  const width = Math.max(32, Math.floor((image.width * scale) / 32) * 32);
  const height = Math.max(32, Math.floor((image.height * scale) / 32) * 32);
  const source = new OffscreenCanvas(image.width, image.height);
  const sourceContext = source.getContext('2d');
  const target = new OffscreenCanvas(width, height);
  const context = target.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!sourceContext || !context) throw new Error('Portrait matting canvas is unavailable');
  sourceContext.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  context.imageSmoothingQuality = 'high';
  context.fillStyle = '#808080';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  source.width = source.height = 1;
  const rgba = context.getImageData(0, 0, width, height).data;
  target.width = target.height = 1;
  const count = width * height;
  const values = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    for (let channel = 0; channel < 3; channel++)
      values[channel * count + i] = rgba[i * 4 + channel]! / 127.5 - 1;
  }
  return { width, height, rgba, tensor: new Tensor('float32', values, [1, 3, height, width]) };
}

async function predict({ image, source, subject }: PortraitMatteRequest) {
  if (
    subject.type !== 'raster' ||
    source.width * source.height > MAX_CUTOUT_PIXELS ||
    Math.abs(image.width * source.height - image.height * source.width) >
      Math.max(source.width, source.height)
  )
    return undefined;
  const response = await fetch(`/vision/${model.file}`, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(55_000),
  });
  if (!response.ok || Number(response.headers.get('content-length')) > model.bytes)
    throw new Error('Portrait matting model is unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== model.bytes || bytesToHex(sha256(bytes)) !== model.sha256)
    throw new Error('Portrait matting model integrity check failed');
  env.wasm.numThreads = self.crossOriginIsolated ? 2 : 1;
  env.wasm.proxy = false;
  env.wasm.wasmPaths = { wasm: new URL(`/vision/wasm/${model.runtimeFile}`, self.location.origin) };
  const session = await InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  try {
    const inputName = session.inputNames[0],
      outputName = session.outputNames[0];
    if (
      !inputName ||
      !outputName ||
      session.inputNames.length !== 1 ||
      session.outputNames.length !== 1
    )
      throw new Error('Unexpected portrait matting graph');
    const { width, height, rgba, tensor } = modelInput(image);
    try {
      const output = (await session.run({ [inputName]: tensor }, [outputName]))[outputName];
      try {
        if (
          !output ||
          !(output.data instanceof Float32Array) ||
          output.dims.join(',') !== `1,1,${height},${width}`
        )
          throw new Error('Unexpected portrait matting output');
        return fusePortraitCutoutPrior(output.data, { width, height }, subject, source, rgba);
      } finally {
        output?.dispose();
      }
    } finally {
      tensor.dispose();
    }
  } finally {
    await session.release();
  }
}

self.onmessage = async ({ data }: MessageEvent<PortraitMatteRequest>) => {
  try {
    self.postMessage({ prior: await predict(data) } satisfies PortraitMatteReply);
  } catch (error) {
    self.postMessage({
      diagnostic: import.meta.env.DEV && error instanceof Error ? error.message : undefined,
    } satisfies PortraitMatteReply);
  }
};
