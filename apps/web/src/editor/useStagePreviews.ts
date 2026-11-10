import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createRecipeV3,
  createRecipeV4,
  createRecipe,
  type EditorRecipe,
  type RGBAImage,
} from '@ai-xiutu/editor';

import { editorGeometryKey } from './useEditor';

type PreviewKind = 'compare' | 'crop' | 'selection' | 'remote';
type PreviewJob = {
  id: number;
  kind: PreviewKind;
  key: string;
  source: RGBAImage;
  recipe: EditorRecipe;
};
type PreviewResult = { source: RGBAImage; image: RGBAImage; key: string; geometryKey: string };

/** One in-flight operation, at most one latest job per purpose; obsolete frames never label as current. */
export function useStagePreviews(
  source: RGBAImage | null,
  recipe: EditorRecipe,
  cropOpen: boolean,
  images: ReadonlyMap<string, RGBAImage>,
  selectionOpen = false,
  remoteRecipe: EditorRecipe | null = null,
) {
  const worker = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const latest = useRef({ compare: 0, crop: 0, selection: 0, remote: 0 });
  const pending = useRef<Record<PreviewKind, PreviewJob | null>>({
    compare: null,
    crop: null,
    selection: null,
    remote: null,
  });
  const inFlight = useRef<PreviewJob | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const [compare, setCompare] = useState<PreviewResult | null>(null);
  const [crop, setCrop] = useState<PreviewResult | null>(null);
  const [selection, setSelection] = useState<PreviewResult | null>(null);
  const [remote, setRemote] = useState<PreviewResult | null>(null);
  const remoteKey = JSON.stringify(remoteRecipe);
  const [error, setError] = useState<string | null>(null);
  const geometryKey = editorGeometryKey(recipe);
  const uncropped = useMemo(
    () => ({ ...recipe, geometry: { ...recipe.geometry, crop: null } }),
    [recipe],
  );
  const cropKey = JSON.stringify(uncropped);
  const selectionRecipe = useMemo(
    () =>
      recipe.schemaVersion === 3 || recipe.schemaVersion === 4
        ? { ...recipe, warp: { ...recipe.warp, enabled: false } }
        : recipe,
    [recipe],
  );
  const selectionKey = JSON.stringify(selectionRecipe);
  function pump() {
    if (inFlight.current || !worker.current) return;
    const job =
      pending.current.remote ??
      pending.current.selection ??
      pending.current.crop ??
      pending.current.compare;
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
          (job.kind === 'remote'
            ? setRemote
            : job.kind === 'compare'
              ? setCompare
              : job.kind === 'crop'
                ? setCrop
                : setSelection)({
            source: job.source,
            image: result,
            key: job.key,
            geometryKey: editorGeometryKey(job.recipe),
          });
        }
      }
      pump();
    };
    w.onerror = () => {
      setError('辅助预览中断，可重新打开图片；原件未被修改。');
      inFlight.current = null;
      pending.current = { crop: null, compare: null, selection: null, remote: null };
    };
    return () => {
      w.terminate();
      worker.current = null;
      inFlight.current = null;
      pending.current = { compare: null, crop: null, selection: null, remote: null };
    };
  }, []);
  useEffect(() => {
    latest.current = { compare: 0, crop: 0, selection: 0, remote: 0 };
    pending.current = { compare: null, crop: null, selection: null, remote: null };
    setRemote(null);
    setCrop(null);
    setSelection(null);
    setCompare(null);
    setError(null);
    // Keep the old in-flight slot until its response. This source message is processed before new jobs.
    worker.current?.postMessage({ type: 'source', image: source, images });
  }, [source]);
  useEffect(() => {
    worker.current?.postMessage({ type: 'layer-sources', images: new Map(images) });
  }, [images]);
  useEffect(() => {
    if (source)
      enqueue(
        'compare',
        geometryKey,
        recipe.schemaVersion === 4
          ? createRecipeV4({
              geometry: recipe.geometry,
              transform: recipe.transform,
              projective: recipe.projective,
            })
          : recipe.schemaVersion === 3
            ? createRecipeV3({ geometry: recipe.geometry, transform: recipe.transform })
            : createRecipe({ geometry: recipe.geometry }),
      );
  }, [source, geometryKey]);
  useEffect(() => {
    if (!source || !cropOpen) {
      pending.current.crop = null;
      return;
    }
    // Crop movement alone does not redraw: this key excludes the crop rectangle.
    enqueue('crop', cropKey, uncropped);
  }, [source, cropOpen, cropKey, images]);
  useEffect(() => {
    if (source && selectionOpen) enqueue('selection', selectionKey, selectionRecipe);
    else pending.current.selection = null;
  }, [source, selectionOpen, selectionKey, images]);
  useEffect(() => {
    if (source && remoteRecipe) enqueue('remote', remoteKey, remoteRecipe);
    else {
      pending.current.remote = null;
      setRemote(null);
    }
  }, [source, remoteKey, images]);
  return {
    remote: remote?.source === source && remote.key === remoteKey ? remote.image : null,
    selection:
      selection?.source === source && selection.geometryKey === editorGeometryKey(selectionRecipe)
        ? selection.image
        : null,
    compare: compare?.source === source && compare.key === geometryKey ? compare.image : null,
    crop: crop?.source === source && crop.key === cropKey ? crop.image : null,
    error,
  };
}
