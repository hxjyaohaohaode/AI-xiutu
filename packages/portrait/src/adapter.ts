import { sourceFrameSchema, type AnalysisAdapter, type SourceFrame } from '@ai-xiutu/contracts';
import type { RGBAImage } from '@ai-xiutu/editor';
import type { PortraitAnalysis } from './types.js';
import { freezePortraitAnalysis, validatePortraitAnalysis } from './validation.js';

export interface PortraitAnalysisInput {
  image: RGBAImage;
  /** Hash of the full normalized source, not the reduced analysis preview. */
  contentHash: string;
  includeBody: boolean;
  includeSegmentation: boolean;
}
export interface PortraitAnalysisDriver {
  readonly id: string;
  readonly algorithmVersion: string;
  readonly configured: boolean;
  analyze(
    input: PortraitAnalysisInput,
    options: { signal: AbortSignal; frame: SourceFrame },
  ): Promise<unknown>;
}
function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new Error('人像分析已取消。');
}
/** Provider-independent validation boundary; the injected driver owns actual inference and cancellation. */
export function createPortraitAnalysisAdapter(
  driver: PortraitAnalysisDriver,
): AnalysisAdapter<PortraitAnalysisInput, PortraitAnalysis> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(driver.id) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(driver.algorithmVersion)
  )
    throw new Error('分析器声明无效。');
  return {
    id: driver.id,
    algorithmVersion: driver.algorithmVersion,
    get configured() {
      return driver.configured;
    },
    async analyze(input, options) {
      checkAbort(options.signal);
      if (!driver.configured) throw new Error('人像分析器尚未配置。');
      const frame = Object.freeze(sourceFrameSchema.parse(options.frame)),
        image = input.image;
      if (frame.width * frame.height > 67_108_864) throw new Error('人像原图尺寸超出预算。');
      if (typeof input.includeBody !== 'boolean' || typeof input.includeSegmentation !== 'boolean')
        throw new Error('人像分析能力选项无效。');
      if (input.contentHash !== frame.contentHash) throw new Error('分析预览未绑定当前原图。');
      if (
        !Number.isSafeInteger(image.width) ||
        !Number.isSafeInteger(image.height) ||
        image.width < 1 ||
        image.height < 1 ||
        image.width * image.height > 4_194_304 ||
        !(image.data instanceof Uint8ClampedArray) ||
        image.data.length !== image.width * image.height * 4
      )
        throw new Error('人像分析预览超出预算。');
      if (
        Math.abs(image.width * frame.height - image.height * frame.width) >
        Math.max(frame.width, frame.height)
      )
        throw new Error('分析预览与原图方向或比例不一致。');
      const result = await driver.analyze(input, { signal: options.signal, frame });
      checkAbort(options.signal);
      const checked = validatePortraitAnalysis(result, frame);
      if (checked.provider !== driver.id || checked.algorithmVersion !== driver.algorithmVersion)
        throw new Error('分析模型版本与已注册适配器不一致。');
      return freezePortraitAnalysis(checked);
    },
  };
}
