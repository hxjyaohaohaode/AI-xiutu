import { useEffect, useRef, useState } from 'react';
import type { PrecisionEdit } from '@ai-xiutu/editor';
import LinearFitWorker from './linear-fit.worker?worker';
import type { FitRequest, FitResponse } from './linear-fit.worker';
import type { FitMasterEncoding, LinearMaster } from './linear-master-stream';
import type { LinearFitArea } from './linear-fit-parameters';

type PendingFrame = {
  edit: PrecisionEdit;
  area: LinearFitArea;
  viewKey: string;
  loadSource: boolean;
};

export function useLinearFitPreview(
  assetId: string,
  source: LinearMaster | undefined,
  encoding: FitMasterEncoding | undefined,
  area: LinearFitArea,
  edit: PrecisionEdit | null,
  loadSource: boolean,
) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const offer = useRef<(frame: PendingFrame | null) => void>(() => {});
  const [state, setState] = useState<{ key: string; viewKey: string | null } | null>(null);
  const key = source && encoding ? `${assetId}:${source.sha256}:${encoding}` : '';
  const { region, maxEdge } = area;
  const viewKey = [maxEdge, region?.left, region?.top, region?.width, region?.height].join(':');

  useEffect(() => {
    setState(null);
    if (!source || !encoding || !navigator.gpu || typeof OffscreenCanvas === 'undefined') return;
    const worker = new LinearFitWorker();
    let started = false;
    let ready = false;
    let closed = false;
    let desired: PendingFrame | null = null;
    let inFlight: PendingFrame | null = null;
    let lastSent: PendingFrame | null = null;
    const send = (request: FitRequest) => worker.postMessage(request);
    function pump() {
      if (closed || !ready || inFlight || !desired || desired === lastSent) return;
      inFlight = lastSent = desired;
      send({ type: 'frame', edit: desired.edit, area: desired.area });
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
      if (value?.loadSource && !started && !closed) {
        started = true;
        setState({ key, viewKey: null });
        send({ type: 'open', assetId, source, encoding });
      }
      pump();
    };
    worker.onerror = fail;
    worker.onmessageerror = fail;
    worker.onmessage = ({ data }: MessageEvent<FitResponse>) => {
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
      const finished = inFlight;
      inFlight = null;
      const element = canvas.current;
      const bitmap = data.bitmap;
      if (!element || !finished || finished.viewKey !== desired?.viewKey) {
        lastSent = null;
        bitmap.close();
      } else {
        try {
          if (element.width !== bitmap.width || element.height !== bitmap.height) {
            element.width = bitmap.width;
            element.height = bitmap.height;
          }
          const output = element.getContext('bitmaprenderer');
          if (!output) throw new Error('Linear preview canvas could not receive the frame');
          output.transferFromImageBitmap(bitmap);
          setState((current) =>
            current?.key === key && current.viewKey === finished.viewKey
              ? current
              : { key, viewKey: finished.viewKey },
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
  }, [assetId, source, encoding, key]);

  useEffect(() => {
    offer.current(edit ? { edit, area, viewKey, loadSource } : null);
  }, [edit, key, viewKey, loadSource]);

  const warm = !!edit && !!key && state?.key === key && state.viewKey !== null;
  return {
    canvas,
    loading: !!edit && !!key && state?.key === key && state.viewKey !== viewKey,
    painted: warm && state.viewKey === viewKey,
    warm,
  };
}
