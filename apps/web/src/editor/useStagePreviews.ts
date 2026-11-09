import { useEffect, useMemo, useRef, useState } from 'react';
import { createRecipe, type EditorRecipe, type RGBAImage } from '@ai-xiutu/editor';

type PreviewKind = 'compare' | 'crop';
type PreviewJob = {
  id: number;
  kind: PreviewKind;
  key: string;
  source: RGBAImage;
  recipe: EditorRecipe;
};
type PreviewResult = { source: RGBAImage; image: RGBAImage; key: string };

/** One in-flight operation, at most one latest job per purpose; obsolete frames never label as current. */
export function useStagePreviews(
  source: RGBAImage | null,
  recipe: EditorRecipe,
  cropOpen: boolean,
) {
  const worker = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const latest = useRef({ compare: 0, crop: 0 });
  const pending = useRef<{ compare: PreviewJob | null; crop: PreviewJob | null }>({
    compare: null,
    crop: null,
  });
  const inFlight = useRef<PreviewJob | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [compare, setCompare] = useState<PreviewResult | null>(null);
  const [crop, setCrop] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const geometryKey = JSON.stringify(recipe.geometry);
  const uncropped = useMemo(
    () => ({ ...recipe, geometry: { ...recipe.geometry, crop: null } }),
    [recipe],
  );
  const cropKey = JSON.stringify(uncropped);
  function pump() {
    if (inFlight.current || !worker.current) return;
    const job = pending.current.crop ?? pending.current.compare;
    if (!job) return;
    pending.current[job.kind] = null;
    inFlight.current = job;
    worker.current.postMessage({ type: `${job.kind}-preview`, id: job.id, recipe: job.recipe });
  }
  function enqueue(kind: PreviewKind, key: string, value: EditorRecipe) {
    if (!source) return;
    const job = { id: ++nextId.current, kind, key, source, recipe: value };
    latest.current[kind] = job.id;
    pending.current[kind] = job;
    pump();
  }
  useEffect(() => {
    const w = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (event: MessageEvent<{ id: number; result?: RGBAImage; error?: string }>) => {
      const { id, result, error: failure } = event.data;
      const job = inFlight.current;
      if (!job || job.id !== id) return;
      inFlight.current = null;
      if (id === latest.current[job.kind] && job.source === sourceRef.current) {
        if (failure) setError(failure);
        else if (result) {
          setError(null);
          (job.kind === 'compare' ? setCompare : setCrop)({
            source: job.source,
            image: result,
            key: job.key,
          });
        }
      }
      pump();
    };
    w.onerror = () => {
      setError('辅助预览中断，可重新打开图片；原件未被修改。');
      inFlight.current = null;
      pending.current = { crop: null, compare: null };
    };
    return () => {
      w.terminate();
      worker.current = null;
      inFlight.current = null;
      pending.current = { compare: null, crop: null };
    };
  }, []);
  useEffect(() => {
    latest.current = { compare: 0, crop: 0 };
    pending.current = { compare: null, crop: null };
    setCrop(null);
    setCompare(null);
    setError(null);
    // Keep the old in-flight slot until its response. This source message is processed before new jobs.
    worker.current?.postMessage({ type: 'source', image: source });
  }, [source]);
  useEffect(() => {
    if (source) enqueue('compare', geometryKey, createRecipe({ geometry: recipe.geometry }));
  }, [source, geometryKey]);
  useEffect(() => {
    if (!source || !cropOpen) {
      pending.current.crop = null;
      return;
    }
    // Crop movement alone does not redraw: this key excludes the crop rectangle.
    enqueue('crop', cropKey, uncropped);
  }, [source, cropOpen, cropKey]);
  return {
    compare: compare?.source === source && compare.key === geometryKey ? compare.image : null,
    crop: crop?.source === source && crop.key === cropKey ? crop.image : null,
    error,
  };
}
