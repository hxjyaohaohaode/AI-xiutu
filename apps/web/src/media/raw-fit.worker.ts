import type { PrecisionEdit } from '@ai-xiutu/editor';
import { openRawFitGpu } from './raw-fit-gpu';
import type { RawMaster } from './raw-master-stream';

export type RawFitRequest =
  | { type: 'open'; assetId: string; source: RawMaster; maxEdge: number }
  | { type: 'frame'; edit: PrecisionEdit };

export type RawFitResponse =
  { type: 'ready' } | { type: 'unavailable' } | { type: 'frame'; bitmap: ImageBitmap };

let preview: Awaited<ReturnType<typeof openRawFitGpu>> | null = null;
let unavailable = false;
const send = (response: RawFitResponse, transfer: Transferable[] = []) =>
  self.postMessage(response, { transfer });
const fail = () => {
  if (unavailable) return;
  unavailable = true;
  send({ type: 'unavailable' });
};

self.onmessage = async ({ data }: MessageEvent<RawFitRequest>) => {
  if (unavailable) return;
  try {
    if (data.type === 'open') {
      preview = await openRawFitGpu(data.assetId, data.source, data.maxEdge, fail);
      if (!unavailable) send({ type: 'ready' });
    } else if (preview) {
      const bitmap = await preview.frame(data.edit);
      if (unavailable) bitmap.close();
      else send({ type: 'frame', bitmap }, [bitmap]);
    }
  } catch {
    fail();
  }
};
