import type { PrecisionEdit } from '@ai-xiutu/editor';
import { openLinearFitGpu } from './linear-fit-gpu';
import type { FitMasterEncoding, LinearMaster } from './linear-master-stream';

export type FitRequest =
  | {
      type: 'open';
      assetId: string;
      source: LinearMaster;
      encoding: FitMasterEncoding;
      maxEdge: number;
    }
  | { type: 'frame'; edit: PrecisionEdit };

export type FitResponse =
  { type: 'ready' } | { type: 'unavailable' } | { type: 'frame'; bitmap: ImageBitmap };

let preview: Awaited<ReturnType<typeof openLinearFitGpu>> | null = null;
let unavailable = false;
const send = (response: FitResponse, transfer: Transferable[] = []) =>
  self.postMessage(response, { transfer });
const fail = () => {
  if (unavailable) return;
  unavailable = true;
  send({ type: 'unavailable' });
};

self.onmessage = async ({ data }: MessageEvent<FitRequest>) => {
  if (unavailable) return;
  try {
    if (data.type === 'open') {
      preview = await openLinearFitGpu(
        data.assetId,
        data.source,
        data.encoding,
        data.maxEdge,
        fail,
      );
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
