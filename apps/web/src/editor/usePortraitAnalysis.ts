import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createPortraitAnalysisAdapter,
  validatePortraitAnalysis,
  type PortraitAnalysis,
} from '@ai-xiutu/portrait';
import type { RGBAImage } from '@ai-xiutu/editor';
import { downloadBlob } from '../lib/api';
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
  const [progress, setProgress] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  const worker = useRef<Worker | null>(null),
    request = useRef(0),
    sourceRef = useRef(source);
  const controller = useRef<AbortController | null>(null);
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
    setAnalysis(null);
    setTarget(null);
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
        const manifestResponse = await fetch('/vision/manifest.json', {
          signal: abort.signal,
          credentials: 'same-origin',
        });
        if (!manifestResponse.ok || !manifestResponse.headers.get('content-type')?.includes('json'))
          throw new Error('本地人像模型尚未安装。仍可使用手动局部、绘制与液化。');
        const manifest = await manifestResponse.json();
        if (
          manifest.schemaVersion !== 1 ||
          manifest.sdkVersion !== '1.2.2' ||
          manifest.algorithmVersion !== ALGORITHM
        )
          throw new Error('人像模型资源版本与当前程序不一致。');
        const adapter = createPortraitAnalysisAdapter({
          id: 'mediapipe',
          algorithmVersion: ALGORITHM,
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
              w.postMessage({
                id,
                image: input.image,
                width: options.frame.width,
                height: options.frame.height,
                contentHash: input.contentHash,
                body: input.includeBody,
                segmentation: input.includeSegmentation,
              });
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
        setTarget(result.targets[0]?.id ?? null);
        if (!result.targets.length) setError('未找到可信的人像目标；可使用手动局部、绘制或液化。');
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
      if (result.provider !== 'mediapipe' || result.algorithmVersion !== ALGORITHM)
        throw new Error('人物标注的关键点协议不受当前版本支持，请先通过对应分析适配器转换。');
      stop();
      setError(null);
      setAnalysis(result);
      setTarget(result.targets[0]?.id ?? null);
      if (!result.targets.length) setError('标注中没有人物目标，可以继续手动精修。');
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
    progress,
    error,
    analyze,
    cancel: stop,
    importAnalysis,
    exportAnalysis,
  };
}
