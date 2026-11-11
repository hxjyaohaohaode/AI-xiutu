import { t } from '../i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SourceFrame } from '@ai-xiutu/contracts';
import {
  createRecipe,
  createRecipeV2,
  createRecipeV3,
  createRecipeV4,
  migrateRecipeToV4,
  type Point,
  type PaintStrokeV3,
  type WarpStrokeV3,
  parseEditorRecipe,
  readImageHeader,
  MAX_HEADER_BYTES,
  MAX_TILED_DIMENSION,
  MAX_TILED_PIXELS,
  MAX_V4_PIXELS,
  localEditorSourceLimits,
  type EditorRecipe,
  type RGBAImage,
  type CutoutSettings,
} from '@ai-xiutu/editor';
import { downloadBlob, filenameBase } from '../lib/api';
import { secureUuid } from '../lib/uuid';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { usePortraitAnalysis } from './usePortraitAnalysis';
import { decodeImageSource } from './imageSources';
import { editorGeometryKey } from './coordinates';
import { ensureWorker, releaseWorker } from './workerLifecycle';
export { editorGeometryKey } from './coordinates';

const MAX_PREVIEW_PIXELS = 4_194_304;
function previewEdge() {
  return Math.min(
    4096,
    Math.max(
      1280,
      Math.max(window.innerWidth, window.innerHeight) * Math.min(window.devicePixelRatio || 1, 2),
    ),
  );
}
export const MAX_LOCAL_FILE_BYTES = 128 * 1024 * 1024;
export const PIXEL_BUDGETS = [4_194_304, MAX_V4_PIXELS, 40_000_000, MAX_TILED_PIXELS] as const;
const smallDevice = () => window.matchMedia('(pointer: coarse) and (max-width: 959px)').matches;
export function localImportLimits(
  version: EditorRecipe['schemaVersion'],
  requested: number,
  mobile = smallDevice(),
) {
  const source = localEditorSourceLimits(version);
  const ceiling = Math.min(mobile ? MAX_V4_PIXELS : MAX_TILED_PIXELS, source.maxPixels);
  return {
    ceiling,
    maxPixels: Math.min(requested, ceiling),
    maxDimension: source.maxDimension,
  };
}
export function localPixelBudget() {
  const small = smallDevice();
  try {
    const saved = Number(localStorage.getItem('editor:pixel-budget:v2'));
    if (PIXEL_BUDGETS.includes(saved as (typeof PIXEL_BUDGETS)[number]))
      return small ? Math.min(saved, MAX_V4_PIXELS) : saved;
  } catch {}
  return small ? 4_194_304 : MAX_V4_PIXELS;
}
export class LocalImportError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LocalImportError';
  }
}
export type BrushSettings = {
  radius: number;
  feather: number;
  opacity: number;
  mode: 'add' | 'subtract';
};
const DEFAULT_BRUSH: BrushSettings = { radius: 0.05, feather: 0.65, opacity: 1, mode: 'add' };

export type PaintSettings = Omit<PaintStrokeV3, 'points' | 'sampling'> & {
  choosingSource: boolean;
  pressureSensitive: boolean;
};
export type WarpSettings = Pick<WarpStrokeV3, 'mode' | 'radius' | 'feather' | 'strength'> & {
  protecting: boolean;
};
export type CropGuide = 'thirds' | 'golden' | 'center' | 'diagonal' | 'none';
const INITIAL_PAINT: PaintSettings = {
  mode: 'paint',
  color: [227, 97, 81, 255],
  radius: 0.025,
  feather: 0.6,
  opacity: 1,
  source: null,
  choosingSource: false,
  pressureSensitive: true,
};
const INITIAL_WARP: WarpSettings = {
  mode: 'push',
  radius: 0.12,
  feather: 0.7,
  strength: 0.5,
  protecting: false,
};
type HistoryItem = { recipe: EditorRecipe; label: string };
type ExportResult = { image?: RGBAImage; blob?: Blob };
type PendingExport = { resolve: (value: ExportResult) => void; reject: (error: Error) => void };
type PreviewQuality = 'fast' | 'warp';
type PreviewJob = {
  version: number;
  source: number;
  recipe: EditorRecipe;
  quality: PreviewQuality;
  prewarmWarp?: boolean;
};
type PreviewRequest = PreviewJob & { id: number };
type PreviewLane = { inFlight: PreviewRequest | null; pending: PreviewJob | null };
type RenderReply = { id: number; type: string; result?: RGBAImage; blob?: Blob; error?: string };
const SETTLE_DELAY_MS = 140;

export function useEditor() {
  const [pixelBudget, setBudget] = useState(localPixelBudget);
  const [sourceFormat, setSourceFormat] = useState('');
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [brushSettings, setBrushState] = useState<BrushSettings>({ ...DEFAULT_BRUSH });
  const [maskOverlay, setMaskOverlay] = useState(false);
  const [activeMaskPath, setActiveMaskPath] = useState<number[]>([]);
  const [activePaintLayerId, setActivePaintLayerId] = useState<string | null>(null);
  const [activeImageLayerId, setActiveImageLayerId] = useState<string | null>(null);
  const [activeRepairId, setActiveRepairId] = useState<string | null>(null);
  const [repairMode, setRepairMode] = useState<'healing' | 'retouch'>('healing');
  const [repairProtection, setRepairProtection] = useState(false);
  const [repairChoosingSource, setRepairChoosingSource] = useState(false);
  const [paintSettings, setPaintSettings] = useState<PaintSettings>({ ...INITIAL_PAINT });
  const [warpSettings, setWarpSettings] = useState<WarpSettings>({ ...INITIAL_WARP });
  const [layerImages, setLayerImages] = useState<ReadonlyMap<string, RGBAImage>>(new Map());
  const layerFiles = useRef(new Map<string, File>());
  const layerDimensions = useRef(new Map<string, { width: number; height: number }>());
  const [sourceHash, setSourceHash] = useState<string | null>(null);
  const setBrushSettings = useCallback(
    (next: BrushSettings | ((previous: BrushSettings) => BrushSettings)) => {
      setBrushState((previous) => {
        const value = typeof next === 'function' ? next(previous) : next;
        const clamp = (v: number, min: number, max: number, fallback: number) =>
          Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
        return {
          radius: clamp(value.radius, 0.000001, 0.5, previous.radius),
          feather: clamp(value.feather, 0, 1, previous.feather),
          opacity: clamp(value.opacity, 0, 1, previous.opacity),
          mode: value.mode === 'subtract' ? 'subtract' : 'add',
        };
      });
    },
    [],
  );
  const setPixelBudget = useCallback((value: number) => {
    if (!PIXEL_BUDGETS.includes(value as (typeof PIXEL_BUDGETS)[number])) return;
    setBudget(value);
    try {
      localStorage.setItem('editor:pixel-budget:v2', String(value));
    } catch {}
  }, []);
  const initial = useRef(createRecipeV4());
  const [recipe, setRecipe] = useState<EditorRecipe>(initial.current);
  const recipeRef = useRef(recipe);
  const getRecipe = useCallback(() => recipeRef.current, []);
  const [history, setHistory] = useState<HistoryItem[]>([
    { recipe: initial.current, label: '原始照片' },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyRef = useRef(history);
  const indexRef = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [originalPreview, setOriginalPreview] = useState<RGBAImage | null>(null);
  const [rendered, setRendered] = useState<RGBAImage | null>(null);
  const [renderedRecipe, setRenderedRecipe] = useState<EditorRecipe | null>(null);
  const [liveFrame, setLiveFrame] = useState<{
    image: RGBAImage;
    recipe: EditorRecipe;
    quality: PreviewQuality;
  } | null>(null);
  const [geometryMode, setGeometryMode] = useState<
    'crop' | 'transform' | 'projective' | 'placement'
  >('crop');
  const [cropGuide, setCropGuide] = useState<CropGuide>('thirds');
  const [cropRatio, setCropRatio] = useState<number | null>(null);
  const [renderedGeometryKey, setRenderedGeometryKey] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const portrait = usePortraitAnalysis(originalPreview, dimensions, sourceHash);
  const [rendering, setRendering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<{ width: number; height: number } | null>(null);
  const worker = useRef<Worker | null>(null);
  const liveWorker = useRef<Worker | null>(null);
  // A newly created worker cannot render/export the source retained in React state.
  // It becomes ready only after its complete source message has been queued.
  const sourceWorker = useRef<Worker | null>(null);
  const mounted = useRef(false);
  const requestId = useRef(0);
  const previewVersion = useRef(0);
  const settledVersion = useRef(0);
  const interactiveInput = useRef<PreviewQuality | null>(null);
  const previewQuality = useRef<PreviewQuality>('fast');
  const eagerPreview = useRef<PreviewJob | null>(null);
  const settledLane = useRef<PreviewLane>({ inFlight: null, pending: null });
  const prewarmedWarp = useRef<EditorRecipe | null>(null);
  const liveLane = useRef<PreviewLane>({ inFlight: null, pending: null });
  const loadGeneration = useRef(0);
  const loadBusy = useRef(false);
  const sourceIdentity = useRef(0);
  const sourceFrame = useRef<SourceFrame | null>(null);
  const isLoading = useCallback(() => loadBusy.current, []);
  const getSourceIdentity = useCallback(() => sourceIdentity.current, []);
  const getSourceFrame = useCallback(() => (loadBusy.current ? null : sourceFrame.current), []);
  const pending = useRef(new Map<number, PendingExport>());
  const rejectExports = useCallback((failure: Error) => {
    const requests = [...pending.current.values()];
    pending.current.clear();
    for (const request of requests) request.reject(failure);
  }, []);
  const stopLiveWorker = useCallback(() => {
    releaseWorker(liveWorker);
    liveLane.current = { inFlight: null, pending: null };
    setLiveFrame(null);
  }, []);
  const failWorker = useCallback(() => {
    releaseWorker(worker);
    sourceWorker.current = null;
    stopLiveWorker();
    settledLane.current = { inFlight: null, pending: null };
    // Decodes already in progress belong to the failed processing session.
    loadGeneration.current += 1;
    loadBusy.current = false;
    sourceIdentity.current += 1;
    sourceRef.current = null;
    sourceFrame.current = null;
    settledVersion.current = 0;
    previewVersion.current += 1;
    setLoading(false);
    setRendering(false);
    setRenderedRecipe(null);
    setError('图像处理暂时中断。请重新导入照片，已下载的配方仍可恢复。');
    rejectExports(new Error('图像处理进程已中断'));
  }, [rejectExports, stopLiveWorker]);
  const pumpPreview = useCallback(
    (live: boolean) => {
      const target = live ? liveWorker.current : worker.current;
      const lane = live ? liveLane.current : settledLane.current;
      if (!target || !sourceWorker.current || lane.inFlight || !lane.pending) return;
      if (!live && target !== sourceWorker.current) return;
      const next = lane.pending;
      lane.pending = null;
      if (next.source !== sourceIdentity.current) return;
      const id = ++requestId.current;
      lane.inFlight = { ...next, id };
      try {
        target.postMessage({
          type: live ? 'interactive-preview' : 'preview',
          id,
          recipe: next.recipe,
          previewQuality: live ? next.quality : undefined,
          prewarmWarp: next.prewarmWarp,
        });
      } catch {
        if (live) stopLiveWorker();
        else failWorker();
      }
    },
    [failWorker, stopLiveWorker],
  );
  const ensureWorkers = useCallback(() => {
    if (!mounted.current) throw new Error('编辑器已关闭');
    const create = () =>
      new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    const main = ensureWorker(
      worker,
      create,
      ({ id, type, result, blob, error: failure }: RenderReply) => {
        if (type === 'export') {
          const p = pending.current.get(id);
          pending.current.delete(id);
          if (failure || (!result && !blob)) p?.reject(new Error(failure ?? '导出失败'));
          else p?.resolve({ image: result, blob });
        } else if (id === settledLane.current.inFlight?.id) {
          const completed = settledLane.current.inFlight;
          settledLane.current.inFlight = null;
          if (
            completed.version === previewVersion.current &&
            completed.source === sourceIdentity.current &&
            completed.recipe === recipeRef.current
          ) {
            settledVersion.current = completed.version;
            setLiveFrame(null);
            setRendering(false);
            if (failure) setError(failure);
            else if (result) {
              setRendered(result);
              setRenderedRecipe(completed.recipe);
              setRenderedGeometryKey(editorGeometryKey(completed.recipe));
              setError(null);
            }
          }
          pumpPreview(false);
        }
      },
      failWorker,
    );
    try {
      ensureWorker(
        liveWorker,
        create,
        ({ id, result }: RenderReply) => {
          const lane = liveLane.current;
          const completed = lane.inFlight;
          if (!completed || completed.id !== id) return;
          lane.inFlight = null;
          // Ordered feedback must never replace a settled frame or another source.
          if (
            result &&
            completed.source === sourceIdentity.current &&
            completed.version > settledVersion.current
          )
            setLiveFrame({ image: result, recipe: completed.recipe, quality: completed.quality });
          pumpPreview(true);
        },
        stopLiveWorker,
      );
    } catch {
      // The settled worker remains usable when the optional fast lane cannot start.
      stopLiveWorker();
    }
    return main;
  }, [failWorker, pumpPreview, stopLiveWorker]);

  useEffect(() => {
    mounted.current = true;
    // Fast Refresh may retain React state, but the terminated worker owned the
    // transferred original pixels. Keep the draft and require an explicit import.
    if (sourceRef.current) failWorker();
    setLoading(false);
    setRendering(false);
    try {
      ensureWorkers();
    } catch {
      failWorker();
    }
    return () => {
      mounted.current = false;
      releaseWorker(worker);
      releaseWorker(liveWorker);
      sourceWorker.current = null;
      loadGeneration.current += 1;
      loadBusy.current = false;
      settledLane.current = { inFlight: null, pending: null };
      liveLane.current = { inFlight: null, pending: null };
      rejectExports(new Error('编辑器已关闭'));
    };
  }, [ensureWorkers, failWorker, rejectExports]);

  useEffect(() => {
    const target = worker.current;
    if (
      !originalPreview ||
      !target ||
      target !== sourceWorker.current ||
      recipe !== recipeRef.current
    )
      return;
    setRendering(true);
    const eager = eagerPreview.current;
    eagerPreview.current = null;
    const alreadyDispatched = eager?.recipe === recipe && eager.source === sourceIdentity.current;
    const job = alreadyDispatched
      ? eager
      : {
          recipe,
          version: ++previewVersion.current,
          source: sourceIdentity.current,
          quality: previewQuality.current,
        };
    settledLane.current.pending = null;
    if (!alreadyDispatched && (settledVersion.current || interactiveInput.current)) {
      liveLane.current.pending = job;
      pumpPreview(true);
    }
    function settle() {
      if (
        worker.current !== target ||
        job.source !== sourceIdentity.current ||
        job.version !== previewVersion.current
      )
        return;
      settledLane.current.pending = job;
      pumpPreview(false);
    }
    if (!interactiveInput.current) settle();
    else {
      const timer = window.setTimeout(settle, SETTLE_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
  }, [recipe, originalPreview, layerImages, pumpPreview]);

  const replaceRecipe = useCallback(
    (next: EditorRecipe, interactive: PreviewQuality | null = null) => {
      if (next === recipeRef.current && interactive === interactiveInput.current) return;
      previewQuality.current =
        interactive ?? (interactiveInput.current === 'warp' ? 'warp' : 'fast');
      interactiveInput.current = interactive;
      recipeRef.current = next;
      eagerPreview.current = null;
      if (interactive && sourceRef.current && sourceWorker.current && liveWorker.current) {
        const job = {
          recipe: next,
          version: ++previewVersion.current,
          source: sourceIdentity.current,
          quality: interactive,
        };
        eagerPreview.current = job;
        settledLane.current.pending = null;
        liveLane.current.pending = job;
        pumpPreview(true);
      }
      setRecipe(next);
    },
    [pumpPreview],
  );
  const previewRecipe = useCallback(
    (next: EditorRecipe, quality: PreviewQuality = 'fast') => replaceRecipe(next, quality),
    [replaceRecipe],
  );
  const prepareWarpPreview = useCallback(
    (settled: EditorRecipe) => {
      const lane = liveLane.current;
      if (
        !liveWorker.current ||
        !sourceWorker.current ||
        !settledVersion.current ||
        settled !== recipeRef.current ||
        interactiveInput.current ||
        lane.inFlight ||
        lane.pending ||
        prewarmedWarp.current === settled ||
        (settled.schemaVersion !== 3 && settled.schemaVersion !== 4)
      )
        return;
      prewarmedWarp.current = settled;
      lane.pending = {
        recipe: settled,
        source: sourceIdentity.current,
        version: settledVersion.current,
        quality: 'warp',
        prewarmWarp: true,
      };
      pumpPreview(true);
    },
    [pumpPreview],
  );
  const resetHistory = useCallback(
    (next: EditorRecipe) => {
      const items = [{ recipe: next, label: '导入时状态' }];
      historyRef.current = items;
      indexRef.current = 0;
      setHistory(items);
      setHistoryIndex(0);
      replaceRecipe(next);
    },
    [replaceRecipe],
  );

  const cancelPendingLoad = useCallback(() => {
    loadGeneration.current += 1;
    loadBusy.current = false;
    setLoading(false);
  }, []);
  const loadFile = useCallback(
    async (
      incoming: File,
      existingRecipe?: EditorRecipe,
      isCurrent: () => boolean = () => true,
      references: ReadonlyMap<string, File> = new Map(),
    ) => {
      if (!mounted.current) throw new Error('编辑器已关闭');
      if (incoming.size > MAX_LOCAL_FILE_BYTES)
        throw new LocalImportError(
          'LOCAL_SIZE_LIMIT',
          '本地文件上限为 128MiB。请选择较小副本，或在已配置的服务端导入流程中处理。',
        );
      const generation = ++loadGeneration.current;
      loadBusy.current = true;
      setLoading(true);
      setError(null);
      let bitmap: ImageBitmap | null = null;
      let fullCanvas: HTMLCanvasElement | null = null;
      let mini: HTMLCanvasElement | null = null;
      try {
        const bytes = new Uint8Array(await incoming.slice(0, MAX_HEADER_BYTES).arrayBuffer());
        let header: ReturnType<typeof readImageHeader>;
        try {
          header = readImageHeader(bytes, {
            maxPixels: MAX_TILED_PIXELS,
            maxDimension: MAX_TILED_DIMENSION,
          });
        } catch {
          throw new LocalImportError(
            'LOCAL_FORMAT_UNSUPPORTED',
            '这份文件未通过当前本地静态图片头检查。TIFF、部分AVIF、较大的GIF或特殊编码需要明确选择服务端规范化；服务端仍会检查内容与资源限制。',
          );
        }
        if (header.animated)
          throw new LocalImportError(
            'ANIMATION_UNSUPPORTED',
            '当前仅处理静态图片，不能自动丢弃动画帧。请先明确导出单帧副本。',
          );
        const { maxPixels, maxDimension } = localImportLimits(
          existingRecipe?.schemaVersion ?? 4,
          pixelBudget,
        );
        if (
          header.width * header.height > maxPixels ||
          header.width > maxDimension ||
          header.height > maxDimension
        )
          throw new LocalImportError(
            'LOCAL_SIZE_LIMIT',
            t(
              '原图 {width}×{height}，超过当前 {pixels} 百万像素 / 单边 {dimension}px 预算。可在导入设置中明确调整设备预算；不会自动缩小原图。',
              {
                width: header.width,
                height: header.height,
                pixels: (maxPixels / 1e6).toFixed(1),
                dimension: maxDimension,
              },
            ),
          );
        if (generation !== loadGeneration.current || !isCurrent()) return false;
        const safeRecipe = existingRecipe ? parseEditorRecipe(existingRecipe) : createRecipeV4();
        const mime =
          header.format === 'jpeg'
            ? 'image/jpeg'
            : header.format === 'bmp'
              ? 'image/bmp'
              : `image/${header.format}`;
        const typedSource = new File([incoming], incoming.name, {
          type: mime,
          lastModified: incoming.lastModified,
        });
        try {
          bitmap = await createImageBitmap(typedSource, { imageOrientation: 'from-image' });
        } catch {
          throw new LocalImportError(
            'LOCAL_FORMAT_UNSUPPORTED',
            t('当前浏览器无法解码这张 {format} 图片。可明确选择上传并规范化为PNG；没有自动上传。', {
              format: header.format.toUpperCase(),
            }),
          );
        }
        const sameDimensions = bitmap.width === header.width && bitmap.height === header.height;
        const rotatedDimensions = bitmap.width === header.height && bitmap.height === header.width;
        if (
          (!sameDimensions && !rotatedDimensions) ||
          bitmap.width * bitmap.height > maxPixels ||
          bitmap.width > maxDimension ||
          bitmap.height > maxDimension
        )
          throw new LocalImportError(
            'LOCAL_DIMENSION_MISMATCH',
            '图片头部与实际解码尺寸不一致，或超过当前预算，请使用重新导出的静态副本。',
          );
        fullCanvas = document.createElement('canvas');
        fullCanvas.width = bitmap.width;
        fullCanvas.height = bitmap.height;
        const context = fullCanvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('当前浏览器无法创建图像画布。');
        context.drawImage(bitmap, 0, 0);
        const full = context.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
        if (generation !== loadGeneration.current || !isCurrent()) return false;
        const scale =
          bitmap.width * bitmap.height <= MAX_PREVIEW_PIXELS
            ? 1
            : Math.min(
                1,
                previewEdge() / Math.max(bitmap.width, bitmap.height),
                Math.sqrt(MAX_PREVIEW_PIXELS / (bitmap.width * bitmap.height)),
              );
        mini = document.createElement('canvas');
        mini.width = Math.max(1, Math.floor(bitmap.width * scale));
        mini.height = Math.max(1, Math.floor(bitmap.height * scale));
        const miniContext = mini.getContext('2d', { willReadFrequently: true });
        if (!miniContext) throw new Error('当前浏览器无法创建预览。');
        miniContext.drawImage(bitmap, 0, 0, mini.width, mini.height);
        const pixels = miniContext.getImageData(0, 0, mini.width, mini.height);
        if (generation !== loadGeneration.current || !isCurrent()) return false;
        const preview = { width: pixels.width, height: pixels.height, data: pixels.data };
        const resolved = new Map<string, Awaited<ReturnType<typeof decodeImageSource>>>();
        let layerPixelCount = 0;
        for (const layer of safeRecipe.schemaVersion === 3 || safeRecipe.schemaVersion === 4
          ? safeRecipe.imageLayers
          : []) {
          if (resolved.has(layer.sourceId)) continue;
          if (generation !== loadGeneration.current || !isCurrent()) return false;
          const reference = references.get(layer.sourceId);
          if (!reference)
            throw new Error('合成素材未能解析，请重新选择素材或从有权访问的项目中打开。');
          const decoded = await decodeImageSource(reference);
          layerPixelCount += decoded.original.width * decoded.original.height;
          if (layerPixelCount > 16_777_216)
            throw new Error('合成素材总像素超出当前设备的 16.8MP 预算。');
          resolved.set(layer.sourceId, decoded);
        }
        if (generation !== loadGeneration.current || !isCurrent()) return false;
        const sourceDimensions = { width: full.width, height: full.height };
        const fingerprint = sha256
          .create()
          .update(new TextEncoder().encode(`${full.width}x${full.height}:srgb-rgba8:`))
          .update(new Uint8Array(full.data.buffer, full.data.byteOffset, full.data.byteLength))
          .digest();
        const images = new Map([...resolved].map(([id, item]) => [id, item.preview]));
        // Recreate only for an explicit, fully decoded import. Posting the complete
        // source first preserves FIFO ordering with its first settled preview.
        try {
          const main = ensureWorkers();
          sourceWorker.current = null;
          main.postMessage(
            {
              type: 'source',
              image: preview,
              original: { width: full.width, height: full.height, data: full.data },
              images,
              originalImages: new Map([...resolved].map(([id, item]) => [id, item.original])),
            },
            [full.data.buffer],
          );
          sourceWorker.current = main;
        } catch {
          failWorker();
          throw new Error('本地图像处理器未能接收照片，请重新导入。');
        }
        try {
          liveWorker.current?.postMessage({
            type: 'interactive-source',
            image: preview,
            sourceDimensions,
            images,
          });
        } catch {
          stopLiveWorker();
        }
        sourceRef.current = sourceDimensions;
        setSourceHash(bytesToHex(fingerprint));
        layerFiles.current = new Map([...resolved].map(([id, item]) => [id, item.file]));
        layerDimensions.current = new Map(
          [...resolved].map(([id, item]) => [
            id,
            { width: item.original.width, height: item.original.height },
          ]),
        );
        setLayerImages(images);
        sourceIdentity.current += 1;
        setCropRatio(null);
        sourceFrame.current = Object.freeze({
          coordinates: 'source-normalized',
          orientation: 'normalized',
          width: full.width,
          height: full.height,
          contentHash: bytesToHex(fingerprint),
        });
        settledLane.current.pending = null;
        liveLane.current.pending = null;
        settledVersion.current = 0;
        prewarmedWarp.current = null;
        previewVersion.current += 1;
        setFile(typedSource);
        setSourceFormat(header.format);
        setDimensions({ width: full.width, height: full.height });
        setOriginalPreview(preview);
        setRendered(preview);
        setLiveFrame(null);
        setRenderedRecipe(null);
        setRenderedGeometryKey(editorGeometryKey(createRecipeV3()));
        resetHistory(safeRecipe);
        setActiveRegionId(null);
        setActiveMaskPath([]);
        setActivePaintLayerId(null);
        setActiveImageLayerId(null);
        setActiveRepairId(null);
        setRepairMode('healing');
        setRepairProtection(false);
        setRepairChoosingSource(false);
        setPaintSettings({ ...INITIAL_PAINT });
        setWarpSettings({ ...INITIAL_WARP });
        setBrushState({ ...DEFAULT_BRUSH });
        setMaskOverlay(false);
        setGeometryMode('crop');
        return true;
      } finally {
        bitmap?.close();
        if (fullCanvas) {
          fullCanvas.width = 1;
          fullCanvas.height = 1;
        }
        if (mini) {
          mini.width = 1;
          mini.height = 1;
        }
        if (generation === loadGeneration.current) {
          loadBusy.current = false;
          setLoading(false);
        }
      }
    },
    [resetHistory, pixelBudget, ensureWorkers, failWorker, stopLiveWorker],
  );

  const commit = useCallback(
    (next: EditorRecipe, label = '调整照片') => {
      const safe = parseEditorRecipe(next);
      const serialized = JSON.stringify(safe);
      const committed = historyRef.current[indexRef.current]?.recipe;
      const sameAsHistory = JSON.stringify(committed) === serialized;
      // Parameter navigation must not replace an unchanged recipe identity and
      // enqueue another fast/settled frame. An interactive preview still needs
      // immediate settlement, and a different visible draft must still restore.
      if (
        sameAsHistory &&
        !interactiveInput.current &&
        (recipeRef.current === committed || JSON.stringify(recipeRef.current) === serialized)
      )
        return;
      replaceRecipe(safe);
      if (sameAsHistory) return;
      const items = [
        ...historyRef.current.slice(0, indexRef.current + 1),
        { recipe: safe, label },
      ].slice(-80);
      historyRef.current = items;
      indexRef.current = items.length - 1;
      setHistory(items);
      setHistoryIndex(items.length - 1);
    },
    [replaceRecipe],
  );
  const importImageLayer = useCallback(
    async (incoming: File) => {
      const identity = sourceIdentity.current;
      if (!sourceRef.current) throw new Error('请先打开底图。');
      const decoded = await decodeImageSource(incoming);
      if (identity !== sourceIdentity.current || loadBusy.current)
        throw new Error('素材读取期间底图已改变，请重新添加。');
      const current =
        recipeRef.current.schemaVersion === 3
          ? recipeRef.current
          : migrateRecipeToV4(recipeRef.current);
      if (current.imageLayers.length >= 8) throw new Error('当前工作稿最多保留 8 个合成图层。');
      const uniqueFiles = new Set<File>();
      const total =
        [...layerDimensions.current].reduce((n, [id, d]) => {
          const f = layerFiles.current.get(id);
          if (!f || uniqueFiles.has(f)) return n;
          uniqueFiles.add(f);
          return n + d.width * d.height;
        }, 0) +
        decoded.original.width * decoded.original.height;
      if (total > 16_777_216)
        throw new Error(
          '本会话合成素材（含撤销历史）总像素上限为 16.8MP。可保存后重新打开，释放已删除素材。',
        );
      const sourceId = `local-${secureUuid()}`,
        id = secureUuid();
      layerFiles.current.set(sourceId, decoded.file);
      layerDimensions.current.set(sourceId, {
        width: decoded.original.width,
        height: decoded.original.height,
      });
      worker.current?.postMessage(
        { type: 'image-source', sourceId, image: decoded.preview, original: decoded.original },
        [decoded.original.data.buffer],
      );
      liveWorker.current?.postMessage({ type: 'image-source', sourceId, image: decoded.preview });
      setLayerImages((old) => new Map([...old, [sourceId, decoded.preview]]));
      const dims = sourceRef.current;
      const ratio = decoded.preview.width / decoded.preview.height;
      const width = Math.min(0.7, (0.7 * dims.height * ratio) / dims.width),
        height = (width * dims.width) / (ratio * dims.height);
      commit(
        {
          ...current,
          imageLayers: [
            ...current.imageLayers,
            {
              id,
              sourceId,
              name: incoming.name.slice(0, 120),
              enabled: true,
              opacity: 1,
              blendMode: 'normal',
              x: (1 - width) / 2,
              y: (1 - height) / 2,
              width,
              height,
              rotationDegrees: 0,
              flipX: false,
              flipY: false,
              mask: null,
            },
          ],
        },
        '添加合成素材',
      );
      setActiveImageLayerId(id);
    },
    [commit],
  );
  /** Attach verified shared image sources without reopening or replacing the base photograph. */
  const ensureLayerSources = useCallback(
    async (references: ReadonlyMap<string, File>, isCurrent: () => boolean = () => true) => {
      const identity = sourceIdentity.current;
      const decoded = new Map<string, Awaited<ReturnType<typeof decodeImageSource>>>();
      for (const [sourceId, incoming] of references) {
        if (layerFiles.current.has(sourceId)) continue;
        const value = await decodeImageSource(incoming);
        if (identity !== sourceIdentity.current || loadBusy.current || !isCurrent())
          throw new Error('合成素材载入期间作品已改变。');
        decoded.set(sourceId, value);
      }
      const files = new Set<File>();
      let total = 0;
      for (const [id, dims] of layerDimensions.current) {
        const file = layerFiles.current.get(id);
        if (!file || files.has(file)) continue;
        files.add(file);
        total += dims.width * dims.height;
      }
      for (const value of decoded.values()) total += value.original.width * value.original.height;
      if (total > 16_777_216)
        throw new Error('共享图层超出本次会话 16.8MP 素材预算，请保存草稿后重新打开作品。');
      if (identity !== sourceIdentity.current || loadBusy.current || !isCurrent())
        throw new Error('共享素材已失效，请重试。');
      for (const [sourceId, value] of decoded) {
        layerFiles.current.set(sourceId, value.file);
        layerDimensions.current.set(sourceId, {
          width: value.original.width,
          height: value.original.height,
        });
        worker.current?.postMessage(
          { type: 'image-source', sourceId, image: value.preview, original: value.original },
          [value.original.data.buffer],
        );
        liveWorker.current?.postMessage({ type: 'image-source', sourceId, image: value.preview });
      }
      if (decoded.size)
        setLayerImages(
          (old) =>
            new Map([...old, ...[...decoded].map(([id, value]) => [id, value.preview] as const)]),
        );
    },
    [],
  );
  const getLayerFiles = useCallback(() => new Map(layerFiles.current), []);
  const rekeyImageSources = useCallback(
    (mapping: ReadonlyMap<string, string>) => {
      if (!mapping.size) return;
      for (const [from, to] of mapping) {
        const file = layerFiles.current.get(from),
          dim = layerDimensions.current.get(from);
        if (file) layerFiles.current.set(to, file);
        if (dim) layerDimensions.current.set(to, dim);
      }
      worker.current?.postMessage({ type: 'rekey-sources', mapping });
      liveWorker.current?.postMessage({ type: 'rekey-sources', mapping });
      setLayerImages((old) => {
        const next = new Map(old);
        for (const [from, to] of mapping) {
          const value = old.get(from);
          if (value) next.set(to, value);
        }
        return next;
      });
      if (recipeRef.current.schemaVersion === 3 || recipeRef.current.schemaVersion === 4)
        commit(
          {
            ...recipeRef.current,
            imageLayers: recipeRef.current.imageLayers.map((layer) => ({
              ...layer,
              sourceId: mapping.get(layer.sourceId) ?? layer.sourceId,
            })),
          },
          '保存合成素材引用',
        );
    },
    [commit],
  );
  const cancelPreview = useCallback(() => {
    const current = historyRef.current[indexRef.current];
    if (current) replaceRecipe(current.recipe);
  }, [replaceRecipe]);
  const commitCurrent = useCallback(
    (label = '调整照片') => commit(recipeRef.current, label),
    [commit],
  );
  const undo = useCallback(() => {
    const committed = historyRef.current[indexRef.current]?.recipe;
    if (committed && JSON.stringify(recipeRef.current) !== JSON.stringify(committed)) {
      replaceRecipe(committed);
      return;
    }
    if (indexRef.current <= 0) return;
    indexRef.current -= 1;
    setHistoryIndex(indexRef.current);
    replaceRecipe(historyRef.current[indexRef.current]!.recipe);
  }, [replaceRecipe]);
  const redo = useCallback(() => {
    if (indexRef.current >= historyRef.current.length - 1) return;
    indexRef.current += 1;
    setHistoryIndex(indexRef.current);
    replaceRecipe(historyRef.current[indexRef.current]!.recipe);
  }, [replaceRecipe]);

  const exportImage = useCallback(
    async (
      format: 'png' | 'jpeg' | 'webp',
      quality = 0.94,
      originalOnly = false,
      cutout?: CutoutSettings,
    ) => {
      if (loadBusy.current) throw new Error('照片正在导入，请等待完成后再导出。');
      const target = worker.current;
      if (!sourceRef.current || !target || target !== sourceWorker.current)
        throw new Error('请重新导入照片后再导出。');
      const id = ++requestId.current;
      const output = await new Promise<ExportResult>((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        try {
          target.postMessage({
            type: 'export',
            id,
            recipe: recipeRef.current,
            format,
            quality,
            originalOnly,
            cutout,
          });
        } catch {
          failWorker();
        }
      });
      if (output.blob) return output.blob;
      const image = output.image;
      if (!image) throw new Error('图像结果为空。');
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('无法创建导出画布。');
        const view = new Uint8ClampedArray(
          image.data.buffer as ArrayBuffer,
          image.data.byteOffset,
          image.data.byteLength,
        );
        context.putImageData(new ImageData(view, image.width, image.height), 0, 0);
        if (format === 'jpeg') {
          context.globalCompositeOperation = 'destination-over';
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error('浏览器未能编码导出图片。'))),
            `image/${format}`,
            quality,
          ),
        );
        if (blob.type !== `image/${format}`)
          throw new Error(
            t('当前浏览器未提供{format}编码，请选择其他格式。', { format: format.toUpperCase() }),
          );
        return blob;
      } finally {
        canvas.width = 1;
        canvas.height = 1;
      }
    },
    [failWorker],
  );
  const getCloudUploadFile = useCallback(
    async (forceNormalize = false) => {
      if (!file) throw new Error('请先导入图片。');
      if (sourceFormat === 'bmp' || forceNormalize) {
        const blob = await exportImage('png', 1, true);
        return new File([blob], `${filenameBase(file.name)}.png`, { type: 'image/png' });
      }
      return file;
    },
    [file, sourceFormat, exportImage],
  );

  const exportRecipe = useCallback(
    () =>
      downloadBlob(
        new Blob([JSON.stringify(recipeRef.current, null, 2)], { type: 'application/json' }),
        `${filenameBase(file?.name ?? '作品')}.recipe.json`,
      ),
    [file],
  );
  const importRecipe = useCallback(
    async (incoming: File) => {
      if (incoming.size > 1_000_000)
        throw new Error('配方文件过大，请选择本工作台导出的 JSON 配方。');
      const identity = sourceIdentity.current;
      const generation = loadGeneration.current;
      const text = await incoming.text();
      if (
        identity !== sourceIdentity.current ||
        generation !== loadGeneration.current ||
        loadBusy.current
      )
        throw new Error(
          '读取配方期间图片已切换，配方没有应用到新图。请在当前图片准备好后重新导入。',
        );
      const next = parseEditorRecipe(JSON.parse(text));
      if (
        (next.schemaVersion === 3 || next.schemaVersion === 4) &&
        next.imageLayers.some((l) => !layerFiles.current.has(l.sourceId))
      )
        throw new Error(
          '配方引用的合成素材不在本会话中。请从云端项目打开完整作品，或先恢复所引用的素材。',
        );
      if (
        (next.schemaVersion === 3 || next.schemaVersion === 4) &&
        sourceRef.current &&
        sourceRef.current.width * sourceRef.current.height > 16_777_216
      )
        throw new Error('这张原图超过 v3 编辑预算，请明确准备较小副本。');
      commit(next, '导入配方');
    },
    [commit],
  );

  const hasUncommittedPreview = useMemo(
    () => JSON.stringify(recipe) !== JSON.stringify(history[historyIndex]?.recipe),
    [recipe, history, historyIndex],
  );
  return {
    file,
    dimensions,
    sourceHash,
    portrait,
    activeMaskPath,
    setActiveMaskPath,
    activePaintLayerId,
    setActivePaintLayerId,
    activeImageLayerId,
    setActiveImageLayerId,
    activeRepairId,
    setActiveRepairId,
    repairMode,
    setRepairMode,
    repairProtection,
    setRepairProtection,
    repairChoosingSource,
    setRepairChoosingSource,
    paintSettings,
    setPaintSettings,
    warpSettings,
    setWarpSettings,
    layerImages,
    importImageLayer,
    getLayerFiles,
    ensureLayerSources,
    acceptRemoteRecipe: resetHistory,
    rekeyImageSources,
    sourceFormat,
    activeRegionId,
    setActiveRegionId,
    brushSettings,
    setBrushSettings,
    maskOverlay,
    setMaskOverlay,
    pixelBudget,
    prepareWarpPreview,
    setPixelBudget,
    getCloudUploadFile,
    recipe,
    getRecipe,
    history,
    historyIndex,
    rendered,
    renderedRecipe,
    liveFrame,
    geometryMode,
    cropGuide,
    setCropGuide,
    cropRatio,
    setCropRatio,
    setGeometryMode,
    renderedGeometryKey,
    originalPreview,
    rendering,
    loading,
    isLoading,
    getSourceIdentity,
    getSourceFrame,
    error,
    canUndo: hasUncommittedPreview || historyIndex > 0,
    canRedo: !hasUncommittedPreview && historyIndex < history.length - 1,
    cancelPendingLoad,
    loadFile,
    preview: previewRecipe,
    cancelPreview,
    commit,
    commitCurrent,
    undo,
    redo,
    exportImage,
    exportRecipe,
    importRecipe,
    reset: () =>
      commit(
        recipeRef.current.schemaVersion === 4
          ? createRecipeV4()
          : recipeRef.current.schemaVersion === 3
            ? createRecipeV3()
            : recipeRef.current.schemaVersion === 2
              ? createRecipeV2()
              : createRecipe(),
        '恢复原图',
      ),
  };
}
export type EditorState = ReturnType<typeof useEditor>;
