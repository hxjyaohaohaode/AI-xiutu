import { env, InferenceSession, Tensor } from 'onnxruntime-web/webgpu';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createCutoutAlphaPrior, MAX_CUTOUT_PIXELS } from '@ai-xiutu/editor';
import { restoreOpaqueCutoutCore } from '@ai-xiutu/portrait';
import model from '../../../../third-party/portrait-fine-matting.json';
import { resizeMatteInput } from './portrait-matte-input';
import type { PortraitMatteReply, PortraitMatteRequest } from './portrait-matte.worker';

async function predict({ image, source, subject }: PortraitMatteRequest) {
  if (
    source.width * source.height > MAX_CUTOUT_PIXELS ||
    Math.abs(image.width * source.height - image.height * source.width) >
      Math.max(source.width, source.height)
  )
    return undefined;
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter || adapter.info.isFallbackAdapter || !adapter.features.has('shader-f16'))
    return undefined;
  const response = await fetch(`/vision/${model.file}`, {
    credentials: 'same-origin',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || Number(response.headers.get('content-length')) > model.bytes)
    throw new Error('Fine cutout model is unavailable');
  const bytes = await response.arrayBuffer();
  if (
    bytes.byteLength !== model.bytes ||
    bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))) !== model.sha256
  )
    throw new Error('Fine cutout model integrity check failed');
  env.wasm.numThreads = self.crossOriginIsolated ? 2 : 1;
  env.wasm.proxy = false;
  env.wasm.wasmPaths = new URL('/vision/wasm/', self.location.origin).href;
  env.webgpu.adapter = adapter;
  const session = await InferenceSession.create(bytes, { executionProviders: ['webgpu'] });
  try {
    const inputName = 'input_image';
    const outputName = 'output_image';
    if (session.inputNames.join() !== inputName || session.outputNames.join() !== outputName)
      throw new Error('Unexpected fine cutout graph');
    const edge = model.inputEdge;
    const rgba = resizeMatteInput(image, edge, edge);
    const count = edge * edge;
    const values = new Float32Array(count * 3);
    const mean = [0.485, 0.456, 0.406];
    const deviation = [0.229, 0.224, 0.225];
    for (let channel = 0; channel < 3; channel++)
      for (let index = 0; index < count; index++)
        values[channel * count + index] =
          (rgba[index * 4 + channel]! / 255 - mean[channel]!) / deviation[channel]!;
    const tensor = new Tensor('float32', values, [1, 3, edge, edge]);
    try {
      const output = (await session.run({ [inputName]: tensor }, [outputName]))[outputName];
      try {
        if (!(output?.data instanceof Float32Array) || output.dims.join() !== `1,1,${edge},${edge}`)
          throw new Error('Unexpected fine cutout output');
        const alpha = new Uint8Array(count);
        let foreground = false;
        for (let index = 0; index < count; index++) {
          const logit = output.data[index]!;
          if (!Number.isFinite(logit)) throw new Error('Invalid fine cutout probability');
          const coverage = Math.round(255 / (1 + Math.exp(-logit)));
          foreground ||= coverage >= 128;
          alpha[index] = coverage;
        }
        if (foreground) {
          const grid = { width: edge, height: edge };
          return createCutoutAlphaPrior(
            source,
            grid,
            restoreOpaqueCutoutCore(alpha, grid, subject),
          );
        }
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
