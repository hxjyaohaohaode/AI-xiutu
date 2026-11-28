import { readSheets } from './sheet-preview';

self.onmessage = (event: MessageEvent<{ name: string; buffer: ArrayBuffer }>) => {
  try {
    const sheets = readSheets(event.data.name, new Uint8Array(event.data.buffer));
    self.postMessage({ ok: true, sheets });
  } catch (error) {
    self.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
};
