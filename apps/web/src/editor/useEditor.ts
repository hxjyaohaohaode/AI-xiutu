import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRecipe,
  parseRecipe,
  readImageHeader,
  MAX_HEADER_BYTES,
  type RecipeV1,
  type RGBAImage,
} from '@ai-xiutu/editor';
import { downloadBlob, filenameBase } from '../lib/api';

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
export const PIXEL_BUDGETS = [4_194_304, 16_777_216, 40_000_000, 67_108_864] as const;
export function localPixelBudget() {
  const small = window.matchMedia('(pointer: coarse) and (max-width: 959px)').matches;
  try {
    const saved = Number(localStorage.getItem('editor:pixel-budget:v2'));
    if (PIXEL_BUDGETS.includes(saved as (typeof PIXEL_BUDGETS)[number]))
      return small ? Math.min(saved, 16_777_216) : saved;
  } catch {}
  return small ? 4_194_304 : 16_777_216;
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
type HistoryItem = { recipe: RecipeV1; label: string };
type ExportResult = { image?: RGBAImage; blob?: Blob };
type PendingExport = { resolve: (value: ExportResult) => void; reject: (error: Error) => void };

export function useEditor() {
  const [pixelBudget, setBudget] = useState(localPixelBudget);
  const [sourceFormat, setSourceFormat] = useState('');
  const setPixelBudget = useCallback((value: number) => {
    if (!PIXEL_BUDGETS.includes(value as (typeof PIXEL_BUDGETS)[number])) return;
    setBudget(value);
    try {
      localStorage.setItem('editor:pixel-budget:v2', String(value));
    } catch {}
  }, []);
  const initial = useRef(createRecipe());
  const [recipe, setRecipe] = useState<RecipeV1>(initial.current);
  const recipeRef = useRef(recipe);
  const [history, setHistory] = useState<HistoryItem[]>([
    { recipe: initial.current, label: '原始照片' },
  ]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyRef = useRef(history);
  const indexRef = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [originalPreview, setOriginalPreview] = useState<RGBAImage | null>(null);
  const [rendered, setRendered] = useState<RGBAImage | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<{ width: number; height: number } | null>(null);
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const latestPreviewId = useRef(0);
  const loadGeneration = useRef(0);
  const loadBusy = useRef(false);
  const sourceIdentity = useRef(0);
  const isLoading = useCallback(() => loadBusy.current, []);
  const getSourceIdentity = useCallback(() => sourceIdentity.current, []);
  const pending = useRef(new Map<number, PendingExport>());

  useEffect(() => {
    const w = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (
      event: MessageEvent<{
        id: number;
        type: string;
        result?: RGBAImage;
        blob?: Blob;
        error?: string;
      }>,
    ) => {
      const { id, type, result, blob, error: failure } = event.data;
      if (type === 'export') {
        const p = pending.current.get(id);
        pending.current.delete(id);
        if (failure || (!result && !blob)) p?.reject(new Error(failure ?? '导出失败'));
        else p?.resolve({ image: result, blob });
      } else if (id === latestPreviewId.current) {
        setRendering(false);
        if (failure) setError(failure);
        else if (result) {
          setRendered(result);
          setError(null);
        }
      }
    };
    w.onerror = () => {
      setRendering(false);
      setError('图像处理暂时中断。请重新导入照片，已下载的配方仍可恢复。');
      for (const p of pending.current.values()) p.reject(new Error('图像处理进程已中断'));
      pending.current.clear();
    };
    return () => {
      w.terminate();
      worker.current = null;
      for (const p of pending.current.values()) p.reject(new Error('编辑器已关闭'));
      pending.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!originalPreview || !worker.current) return;
    setRendering(true);
    const timer = setTimeout(() => {
      const id = ++requestId.current;
      latestPreviewId.current = id;
      worker.current?.postMessage({ type: 'preview', id, recipe });
    }, 65);
    return () => clearTimeout(timer);
  }, [recipe, originalPreview]);

  const replaceRecipe = useCallback((next: RecipeV1) => {
    recipeRef.current = next;
    setRecipe(next);
  }, []);
  const resetHistory = useCallback(
    (next: RecipeV1) => {
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
    async (incoming: File, existingRecipe?: RecipeV1, isCurrent: () => boolean = () => true) => {
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
          header = readImageHeader(bytes, { maxPixels: 67_108_864, maxDimension: 16384 });
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
        const maxPixels = Math.min(pixelBudget, localPixelBudget());
        const maxDimension = maxPixels > 16_777_216 ? 16384 : 8192;
        if (
          header.width * header.height > maxPixels ||
          header.width > maxDimension ||
          header.height > maxDimension
        )
          throw new LocalImportError(
            'LOCAL_SIZE_LIMIT',
            `原图 ${header.width}×${header.height}，超过当前 ${(maxPixels / 1e6).toFixed(1)} 百万像素 / 单边 ${maxDimension}px 预算。可在导入设置中明确调整设备预算；不会自动缩小原图。`,
          );
        if (generation !== loadGeneration.current || !isCurrent()) return;
        const safeRecipe = existingRecipe ? parseRecipe(existingRecipe) : createRecipe();
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
            `当前浏览器无法解码这张 ${header.format.toUpperCase()} 图片。可明确选择上传并规范化为PNG；没有自动上传。`,
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
        if (generation !== loadGeneration.current || !isCurrent()) return;
        const scale = Math.min(
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
        if (generation !== loadGeneration.current || !isCurrent()) return;
        if (!worker.current) throw new Error('本地图像处理器尚未就绪，请重试。');
        sourceRef.current = { width: full.width, height: full.height };
        const preview = { width: pixels.width, height: pixels.height, data: pixels.data };
        worker.current.postMessage(
          {
            type: 'source',
            image: preview,
            original: { width: full.width, height: full.height, data: full.data },
          },
          [full.data.buffer],
        );
        sourceIdentity.current += 1;
        latestPreviewId.current = ++requestId.current;
        setFile(typedSource);
        setSourceFormat(header.format);
        setDimensions({ width: full.width, height: full.height });
        setOriginalPreview(preview);
        setRendered(preview);
        resetHistory(safeRecipe);
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
    [resetHistory, pixelBudget],
  );

  const commit = useCallback(
    (next: RecipeV1, label = '调整照片') => {
      const safe = parseRecipe(next);
      replaceRecipe(safe);
      if (JSON.stringify(historyRef.current[indexRef.current]?.recipe) === JSON.stringify(safe))
        return;
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
  const commitCurrent = useCallback(
    (label = '调整照片') => commit(recipeRef.current, label),
    [commit],
  );
  const undo = useCallback(() => {
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
    async (format: 'png' | 'jpeg' | 'webp', quality = 0.94, originalOnly = false) => {
      if (!sourceRef.current || !worker.current) throw new Error('请先导入图片。');
      const id = ++requestId.current;
      const output = await new Promise<ExportResult>((resolve, reject) => {
        pending.current.set(id, { resolve, reject });
        worker.current!.postMessage({
          type: 'export',
          id,
          recipe: recipeRef.current,
          format,
          quality,
          originalOnly,
        });
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
          throw new Error(`当前浏览器未提供${format.toUpperCase()}编码，请选择其他格式。`);
        return blob;
      } finally {
        canvas.width = 1;
        canvas.height = 1;
      }
    },
    [],
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
      const next = parseRecipe(JSON.parse(text));
      commit(next, '导入配方');
    },
    [commit],
  );

  return {
    file,
    dimensions,
    sourceFormat,
    pixelBudget,
    setPixelBudget,
    getCloudUploadFile,
    recipe,
    history,
    historyIndex,
    rendered,
    originalPreview,
    rendering,
    loading,
    isLoading,
    getSourceIdentity,
    error,
    canUndo: historyIndex > 0,
    canRedo: historyIndex < history.length - 1,
    cancelPendingLoad,
    loadFile,
    preview: replaceRecipe,
    commit,
    commitCurrent,
    undo,
    redo,
    exportImage,
    exportRecipe,
    importRecipe,
    reset: () => commit(createRecipe(), '恢复原图'),
  };
}
export type EditorState = ReturnType<typeof useEditor>;
