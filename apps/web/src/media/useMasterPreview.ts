import { useEffect, useRef, useState } from 'react';
import type { MediaPrecisionWindow } from '@ai-xiutu/media';

type Frame = { assetId: string; url: string; key: string; region?: MediaPrecisionWindow };
type PreviewRequest = { key: string; attempt: 0 | 1; nativeWindow: boolean };

export function useMasterPreview(
  assetId: string,
  body: string | null,
  enabled: boolean,
  nativeWindow: boolean,
) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const current = useRef<Frame | null>(null);
  const offer = useRef<(body: string | null, nativeWindow: boolean) => void>(() => {});
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current.url);
      current.current = null;
    },
    [assetId],
  );
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    let desired: string | null = null;
    let pending: PreviewRequest | null = null;
    let running: string | null = null;
    let nextStart = 0;
    let timer: number | undefined;
    function pump() {
      if (signal.aborted || running !== null || pending === null || timer !== undefined) return;
      const delay = nextStart - performance.now();
      if (delay > 0) {
        timer = window.setTimeout(() => {
          timer = undefined;
          pump();
        }, delay);
        return;
      }
      const request = pending;
      pending = null;
      running = request.key;
      nextStart = performance.now() + (request.nativeWindow ? 80 : 160);
      setFailed(null);
      void render(request);
    }
    async function render({ key, attempt, nativeWindow }: PreviewRequest) {
      try {
        const region: MediaPrecisionWindow | undefined = JSON.parse(key).region;
        const response = await fetch(`/v1/assets/${assetId}/media/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal,
          body: key,
        });
        if (response.status === 429 && attempt === 0) {
          await response.body?.cancel();
          if (!signal.aborted && desired !== null) {
            nextStart = performance.now() + 350;
            if (desired === key) pending = { key, attempt: 1, nativeWindow };
          }
          return;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('Media preview failed');
        }
        const blob = await response.blob();
        if (signal.aborted || desired === null) return;
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.src = url;
        try {
          await image.decode();
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }
        if (signal.aborted || desired === null) {
          URL.revokeObjectURL(url);
          return;
        }
        if (current.current) URL.revokeObjectURL(current.current.url);
        current.current = { assetId, url, key, region };
        setFrame(current.current);
      } catch {
        if (!signal.aborted) setFailed(key);
      } finally {
        running = null;
        // Keep drawing completed frames in order during a continuous drag.
        // The next request uses the newest value without interrupting this one.
        pump();
      }
    }
    offer.current = (key, nativeWindow) => {
      desired = key;
      const visible = current.current?.assetId === assetId && current.current.key === key;
      pending =
        key && key !== running && (!visible || running !== null)
          ? { key, attempt: 0, nativeWindow }
          : null;
      pump();
    };
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      offer.current = () => {};
    };
  }, [assetId, enabled]);
  useEffect(() => {
    offer.current(body, nativeWindow);
  }, [assetId, body, enabled, nativeWindow]);
  return {
    frame: body && frame?.assetId === assetId ? frame : null,
    pending:
      !!body && enabled && (frame?.key !== body || frame.assetId !== assetId) && failed !== body,
    failed: !!body && failed === body,
  };
}
