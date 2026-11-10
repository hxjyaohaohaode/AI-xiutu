import { sourceFrameSchema, type SourceFrame } from '@ai-xiutu/contracts';
import {
  compileSelectionMaskV3,
  parseSelectionMaskV3,
  validateImage,
  srgbToLinear,
  linearToSrgb,
  type RGBAImage,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';

export type PortraitPixelOperation = 'skin-detail' | 'blemish-removal' | 'portrait-relight';
export interface PortraitPixelDriver {
  id: string;
  algorithmVersion: string;
  configured: boolean;
  /** Deployment manifest; repository code licenses do not automatically license model weights. */
  model: { id: string; sha256: string; license: string };
  operations: readonly PortraitPixelOperation[];
  run(
    input: {
      image: RGBAImage;
      mask: Float32Array;
      operation: PortraitPixelOperation;
      strength: number;
      frame: SourceFrame;
    },
    options: { signal: AbortSignal },
  ): Promise<{ image: RGBAImage; sourceHash: string; algorithmVersion: string }>;
}
export interface PortraitPixelInput {
  image: RGBAImage;
  frame: SourceFrame;
  mask: SelectionMaskV3;
  protection: SelectionMaskV3 | null;
  operation: PortraitPixelOperation;
  strength: number;
}
const abort = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error('精修任务已取消。');
};
/** Optional real-executor boundary. This does not ship or claim a configured neural model. */
export function createPortraitPixelAdapter(driver: PortraitPixelDriver) {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(driver.id) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(driver.algorithmVersion) ||
    !/^[a-f0-9]{64}$/.test(driver.model.sha256) ||
    !driver.model.id ||
    driver.model.id.length > 120 ||
    !driver.model.license ||
    driver.model.license.length > 120 ||
    !driver.operations.length ||
    driver.operations.some(
      (operation) => !['skin-detail', 'blemish-removal', 'portrait-relight'].includes(operation),
    )
  )
    throw new Error('精修执行器的版本、能力或权重许可声明无效。');
  return {
    id: driver.id,
    get configured() {
      return driver.configured;
    },
    async run(input: PortraitPixelInput, options: { signal: AbortSignal }) {
      abort(options.signal);
      if (!driver.configured) throw new Error('尚未配置真实精修模型执行器。');
      if (!driver.operations.includes(input.operation))
        throw new Error('当前模型未注册此精修能力。');
      if (!Number.isFinite(input.strength) || input.strength < 0 || input.strength > 1)
        throw new Error('精修强度超界。');
      validateImage(input.image, { maxPixels: 4_194_304 });
      const frame = Object.freeze(sourceFrameSchema.parse(input.frame));
      if (frame.width !== input.image.width || frame.height !== input.image.height)
        throw new Error('精修必须绑定当前同分辨率图像，不能将低清预览伪装成完整原图。');
      const original = { ...input.image, data: input.image.data.slice() },
        prefix = new TextEncoder().encode(`${frame.width}x${frame.height}:srgb-rgba8:`),
        bytes = new Uint8Array(prefix.length + original.data.length);
      bytes.set(prefix);
      bytes.set(original.data, prefix.length);
      const actualHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      abort(options.signal);
      if (actualHash !== frame.contentHash) throw new Error('精修源像素与声明哈希不一致。');
      const mask = compileSelectionMaskV3(parseSelectionMaskV3(input.mask), original, original),
        protection = input.protection
          ? compileSelectionMaskV3(parseSelectionMaskV3(input.protection), original, original)
          : null,
        weights = new Float32Array(frame.width * frame.height);
      for (let y = 0; y < frame.height; y++)
        for (let x = 0; x < frame.width; x++) {
          const u = (x + 0.5) / frame.width,
            v = (y + 0.5) / frame.height;
          weights[y * frame.width + x] =
            original.data[(y * frame.width + x) * 4 + 3] === 0
              ? 0
              : mask(u, v) * (1 - (protection?.(u, v) ?? 0));
        }
      if (input.strength === 0 || !weights.some((n) => n > 0))
        return { image: original, sourceHash: actualHash, applied: false as const };
      const output = await driver.run(
        {
          image: { ...original, data: original.data.slice() },
          mask: weights.slice(),
          operation: input.operation,
          strength: input.strength,
          frame,
        },
        options,
      );
      abort(options.signal);
      validateImage(output.image, { maxPixels: 4_194_304 });
      if (
        output.sourceHash !== actualHash ||
        output.algorithmVersion !== driver.algorithmVersion ||
        output.image.width !== frame.width ||
        output.image.height !== frame.height
      )
        throw new Error('精修输出的源、版本或尺寸与请求不一致。');
      const data = original.data.slice();
      for (let i = 0; i < weights.length; i++) {
        const amount = weights[i]!;
        if (amount === 0) continue;
        for (let c = 0; c < 3; c++) {
          const before = srgbToLinear(original.data[i * 4 + c]! / 255),
            after = srgbToLinear(output.image.data[i * 4 + c]! / 255);
          data[i * 4 + c] = linearToSrgb(before + (after - before) * amount) * 255;
        }
        // Alpha and exact protected/outside/hidden bytes remain immutable even if a driver violates its requested mask.
      }
      return {
        image: { ...original, data },
        sourceHash: actualHash,
        applied: true as const,
        provenance: {
          driver: driver.id,
          algorithmVersion: driver.algorithmVersion,
          model: { ...driver.model },
          operation: input.operation,
          strength: input.strength,
        },
      };
    },
  };
}
