import { useEffect, useRef, useState } from 'react';
import type { MediaPrecisionWindow } from '@ai-xiutu/media';

type Frame = { assetId: string; url: string; key: string; region?: MediaPrecisionWindow };

export function useMasterPreview(assetId: string, body: string | null, enabled: boolean) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const current = useRef<Frame | null>(null);
  useEffect(
    () => () => {
      if (current.current) URL.revokeObjectURL(current.current.url);
      current.current = null;
    },
    [assetId],
  );
  useEffect(() => {
    if (!body || !enabled || (current.current?.assetId === assetId && current.current.key === body))
      return;
    const controller = new AbortController();
    const key = body;
    const region: MediaPrecisionWindow | undefined = JSON.parse(body).region;
    const { signal } = controller;
    setFailed(null);
    let retry: number | undefined;
    async function render(attempt: number) {
      try {
        const response = await fetch(`/v1/assets/${assetId}/media/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal,
          body: key,
        });
        if (response.status === 429 && attempt === 0) {
          await response.body?.cancel();
          if (!signal.aborted) retry = window.setTimeout(() => void render(1), 350);
          return;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('Media preview failed');
        }
        const blob = await response.blob();
        if (signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.src = url;
        try {
          await image.decode();
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }
        if (signal.aborted) {
          URL.revokeObjectURL(url);
          return;
        }
        if (current.current) URL.revokeObjectURL(current.current.url);
        current.current = { assetId, url, key, region };
        setFrame(current.current);
      } catch {
        if (!signal.aborted) setFailed(key);
      }
    }
    const timer = window.setTimeout(() => void render(0), 160);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(retry);
    };
  }, [assetId, body, enabled]);
  return {
    frame: body && frame?.assetId === assetId ? frame : null,
    pending:
      !!body && enabled && (frame?.key !== body || frame.assetId !== assetId) && failed !== body,
    failed: !!body && failed === body,
  };
}
