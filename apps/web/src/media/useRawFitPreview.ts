import { useEffect, useRef, useState } from 'react';
import type { PrecisionEdit } from '@ai-xiutu/editor';
import RawFitWorker from './raw-fit.worker?worker';
import type { RawFitRequest, RawFitResponse } from './raw-fit.worker';
import type { RawMaster } from './raw-master-stream';

export function useRawFitPreview(
  assetId: string,
  source: RawMaster | undefined,
  maxEdge: number,
  edit: PrecisionEdit | null,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const offer = useRef<(edit: PrecisionEdit | null) => void>(() => {});
  const [state, setState] = useState<{ key: string; painted: boolean } | null>(null);
  const key = source ? `${assetId}:${source.sha256}:${maxEdge}` : '';

  useEffect(() => {
    if (!source || !navigator.gpu || typeof OffscreenCanvas === 'undefined') return;
    const worker = new RawFitWorker();
    let started = false;
    let ready = false;
    let rendering = false;
    let closed = false;
    let desired: PrecisionEdit | null = null;
    let lastSent: PrecisionEdit | null = null;
    const send = (request: RawFitRequest) => worker.postMessage(request);
    function pump() {
      if (closed || !ready || rendering || !desired || desired === lastSent) return;
      rendering = true;
      lastSent = desired;
      send({ type: 'frame', edit: desired });
    }
    function close() {
      if (closed) return;
      closed = true;
      offer.current = () => {};
      worker.terminate();
    }
    function fail() {
      if (closed) return;
      setState(null);
      close();
    }
    offer.current = (value) => {
      desired = value;
      if (value && !started && !closed) {
        started = true;
        setState({ key, painted: false });
        send({ type: 'open', assetId, source, maxEdge });
      }
      pump();
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = ({ data }: MessageEvent<RawFitResponse>) => {
      if (closed) {
        if (data.type === 'frame') data.bitmap.close();
        return;
      }
      if (data.type === 'unavailable') {
        fail();
        return;
      }
      if (data.type === 'ready') {
        ready = true;
        pump();
        return;
      }
      rendering = false;
      const element = canvas.current;
      const bitmap = data.bitmap;
      if (!element || !desired) {
        lastSent = null;
        bitmap.close();
      } else {
        try {
          if (element.width !== bitmap.width || element.height !== bitmap.height) {
            element.width = bitmap.width;
            element.height = bitmap.height;
          }
          const output = element.getContext('bitmaprenderer');
          if (!output) throw new Error('RAW preview canvas could not receive the frame');
          output.transferFromImageBitmap(bitmap);
          setState((current) =>
            current?.key === key && current.painted ? current : { key, painted: true },
          );
        } catch {
          bitmap.close();
          fail();
        }
      }
      // Keep completed frames visible while the next one uses the newest edit.
      pump();
    };
    return close;
  }, [assetId, source, maxEdge, key]);

  useEffect(() => {
    offer.current(edit);
  }, [edit, key]);

  return {
    canvas,
    loading: !!edit && !!key && state?.key === key && !state.painted,
    painted: !!edit && !!key && state?.key === key && state.painted,
  };
}
