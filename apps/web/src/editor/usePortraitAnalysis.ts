import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPortraitAnalysisAdapter,
  OBSERVED_PORTRAIT_ANALYSIS,
  PRECISE_PORTRAIT_ANALYSIS,
  REFINED_PORTRAIT_ANALYSIS,
  validatePortraitAnalysis,
  type PortraitAnalysis,
} from '@ai-xiutu/portrait';
import {
  MAX_CUTOUT_PIXELS,
  type CutoutAlphaPrior,
  type RGBAImage,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
import { downloadBlob } from '../lib/api';
import type {
  PortraitMatteMethod,
  PortraitMatteReply,
  PortraitMatteRequest,
} from './portrait-matte.worker';
import {
  PORTRAIT_ANALYSIS_TIMEOUT_MESSAGE,
  portraitAnalysisErrorMessage,
} from './portrait-analysis-errors';

const ALGORITHM = 'mediapipe-v1-selfie256';
export function usePortraitAnalysis(
  source: RGBAImage | null,
  dimensions: { width: number; height: number } | null,
  contentHash: string | null,
) {
  const [analysis, setAnalysis] = useState<PortraitAnalysis | null>(null),
    [activeTargetId, setTarget] = useState<string | null>(null);
  const [showLandmarks, setShowLandmarks] = useState(false);
  const [faceFocus, setFaceFocus] = useState<{ id: string } | null>(null);
  const focusFace = useCallback((id: string) => setFaceFocus({ id }), []);
  const [progress, setProgress] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null),
    request = useRef(0),
    sourceRef = useRef(source);
  const controller = useRef<AbortController | null>(null);
  const matte = useRef<
    Partial<
      Record<
        PortraitMatteMethod,
        {
          image: RGBAImage;
          subject: SelectionMaskV3;
          prior: CutoutAlphaPrior;
        }
      >
    >
  >({});
  sourceRef.current = source;
  const stop = useCallback(() => {
    request.current++;
    controller.current?.abort();
    controller.current = null;
    worker.current?.terminate();
    worker.current = null;
    setProgress(null);
  }, []);
  useEffect(() => {
    stop();
    matte.current = {};
    setAnalysis(null);
    setTarget(null);
    setShowLandmarks(false);
    setFaceFocus(null);
    setError(null);
    return stop;
  }, [source, stop]);
  const analyze = useCallback(
    async (body = false) => {
      if (!source || !dimensions || !contentHash) return;
      stop();
      setError(null);
      setProgress('正在加载本地分析模型');
      const id = ++request.current,
        sourceAtStart = source,
        abort = new AbortController();
      controller.current = abort;
      const timer = setTimeout(
        () => abort.abort(new Error(PORTRAIT_ANALYSIS_TIMEOUT_MESSAGE)),
        60000,
      );
      try {
        const adapter = createPortraitAnalysisAdapter({
          id: 'mediapipe',
          algorithmVersion: OBSERVED_PORTRAIT_ANALYSIS,
          configured: true,
          analyze: async (input, options) =>
            new Promise((resolve, reject) => {
              if (options.signal.aborted) {
                reject(options.signal.reason);
                return;
              }
              const w = new Worker(new URL('./portrait.worker.ts', import.meta.url), {
                type: 'module',
              });
              worker.current = w;
              const cleanup = () => {
                options.signal.removeEventListener('abort', cancel);
                w.terminate();
                if (worker.current === w) worker.current = null;
              };
              const cancel = () => {
                cleanup();
                reject(options.signal.reason ?? new Error('分析已取消'));
              };
              options.signal.addEventListener('abort', cancel, { once: true });
              w.onmessage = (
                event: MessageEvent<{
                  id: number;
                  progress?: string;
                  result?: unknown;
                  error?: string;
                  diagnostic?: string;
                }>,
              ) => {
                const message = event.data;
                if (import.meta.env.DEV && message.diagnostic)
                  console.error('Portrait analysis diagnostic', message.diagnostic);
                if (message.id !== id) return;
                if (message.progress) {
                  if (request.current === id) setProgress(message.progress);
                  return;
                }
                cleanup();
                if (message.error) reject(new Error(message.error));
                else resolve(message.result);
              };
              w.onerror = () => {
                cleanup();
                reject(new Error('本地分析进程未能运行，请检查模型与 WASM 资源。'));
              };
              const pixels = new Uint8ClampedArray(input.image.data);
              w.postMessage(
                {
                  id,
                  image: { ...input.image, data: pixels },
                  width: options.frame.width,
                  height: options.frame.height,
                  contentHash: input.contentHash,
                  body: input.includeBody,
                  segmentation: input.includeSegmentation,
                },
                [pixels.buffer],
              );
            }),
        });
        const result = await adapter.analyze(
          { image: source, contentHash, includeBody: body, includeSegmentation: true },
          {
            signal: abort.signal,
            frame: {
              coordinates: 'source-normalized',
              orientation: 'normalized',
              width: dimensions.width,
              height: dimensions.height,
              contentHash,
            },
          },
        );
        if (request.current !== id || sourceRef.current !== sourceAtStart) return;
        setAnalysis(result);
        setTarget((selected) =>
          result.targets.some(
            (target) => target.id === selected && target.kind === (body ? 'body' : 'face'),
          )
            ? selected
            : (result.targets.find((target) => target.kind === (body ? 'body' : 'face'))?.id ??
              result.targets[0]?.id ??
              null),
        );
        if (!result.targets.length && !result.segmentation?.subject)
          setError('未找到可信的人像目标；可使用手动局部、绘制或液化。');
        return result;
      } catch (failure) {
        if (request.current === id && sourceRef.current === sourceAtStart)
          setError(portraitAnalysisErrorMessage(failure));
      } finally {
        clearTimeout(timer);
        if (request.current === id) {
          setProgress(null);
          controller.current = null;
          worker.current?.terminate();
          worker.current = null;
        }
      }
    },
    [source, dimensions, contentHash, stop],
  );
  const prepareCutoutPrior = useCallback(
    async (subject: SelectionMaskV3, method: PortraitMatteMethod = 'standard') => {
      if (
        !source ||
        !dimensions ||
        subject.type !== 'raster' ||
        dimensions.width * dimensions.height > MAX_CUTOUT_PIXELS
      )
        return undefined;
      const cached = matte.current[method];
      if (cached?.image === source && cached.subject === subject) return cached.prior;
      stop();
      const id = request.current;
      const abort = new AbortController();
      controller.current = abort;
      setProgress('正在精修透明边缘');
      const timer = setTimeout(() => abort.abort(), method === 'fine' ? 135_000 : 60_000);
      try {
        const w =
          method === 'fine'
            ? new Worker(new URL('./portrait-fine-matte.worker.ts', import.meta.url), {
                type: 'module',
              })
            : new Worker(new URL('./portrait-matte.worker.ts', import.meta.url), {
                type: 'module',
              });
        worker.current = w;
        const prior = await new Promise<CutoutAlphaPrior | undefined>((resolve, reject) => {
          abort.signal.addEventListener('abort', () => reject(abort.signal.reason), { once: true });
          w.onmessage = ({ data }: MessageEvent<PortraitMatteReply>) => resolve(data.prior);
          w.onerror = () => resolve(undefined);
          w.postMessage({
            image: source,
            source: dimensions,
            subject,
          } satisfies PortraitMatteRequest);
        });
        if (request.current !== id || sourceRef.current !== source)
          throw new DOMException('Portrait cutout was cancelled', 'AbortError');
        if (prior) matte.current[method] = { image: source, subject, prior };
        return prior;
      } finally {
        clearTimeout(timer);
        if (request.current === id) stop();
      }
    },
    [source, dimensions, stop],
  );
  const importAnalysis = useCallback(
    async (file: File) => {
      if (!source || !dimensions || !contentHash) throw new Error('请先打开对应的原图。');
      if (file.size > 2 * 1024 * 1024) throw new Error('人物标注文件上限为 2MiB。');
      const sourceAtStart = source,
        generation = request.current;
      const text = await file.text();
      if (sourceRef.current !== sourceAtStart || request.current !== generation)
        throw new Error('读取标注期间图片或分析任务已改变，请重新选择。');
      const result = validatePortraitAnalysis(JSON.parse(text), {
        coordinates: 'source-normalized',
        orientation: 'normalized',
        width: dimensions.width,
        height: dimensions.height,
        contentHash,
      });
      if (
        result.provider !== 'mediapipe' ||
        (result.algorithmVersion !== ALGORITHM &&
          result.algorithmVersion !== REFINED_PORTRAIT_ANALYSIS &&
          result.algorithmVersion !== PRECISE_PORTRAIT_ANALYSIS &&
          result.algorithmVersion !== OBSERVED_PORTRAIT_ANALYSIS)
      )
        throw new Error('人物标注的关键点协议不受当前版本支持，请先通过对应分析适配器转换。');
      stop();
      setError(null);
      setAnalysis(result);
      setTarget(result.targets[0]?.id ?? null);
      if (!result.targets.length && !result.segmentation?.subject)
        setError('标注中没有人物目标，可以继续手动精修。');
    },
    [source, dimensions, contentHash, stop],
  );
  const exportAnalysis = useCallback(() => {
    if (!analysis) throw new Error('请先识别或导入人物标注。');
    downloadBlob(
      new Blob([JSON.stringify(analysis)], { type: 'application/json' }),
      'portrait.analysis.json',
    );
  }, [analysis]);
  return {
    analysis,
    activeTargetId,
    setTarget,
    showLandmarks,
    setShowLandmarks,
    faceFocus,
    focusFace,
    progress,
    error,
    analyze,
    prepareCutoutPrior,
    cancel: stop,
    importAnalysis,
    exportAnalysis,
  };
}
