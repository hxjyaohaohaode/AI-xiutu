import { reject } from './http.js';
import type { WavInfo } from './types.js';

/** 30 seconds × 16,000 mono samples × 2 bytes, plus a small bounded container. */
export const MAX_WAV_BYTES = 960_096;
export const MAX_WAV_SECONDS = 30;
const fourcc = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);

/** Strict RIFF WAV: PCM signed 16-bit, mono, 16kHz; no compressed/extensible/RF64. */
export function validateWav(bytes: Uint8Array): WavInfo {
  return { durationSeconds: wavPcm16(bytes).length / 32000, sampleRate: 16000, channels: 1 };
}

export function wavPcm16(bytes: Uint8Array) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 46 || bytes.byteLength > MAX_WAV_BYTES)
    reject('WAV_SIZE_LIMIT');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    fourcc(bytes, 0) !== 'RIFF' ||
    fourcc(bytes, 8) !== 'WAVE' ||
    view.getUint32(4, true) + 8 !== bytes.byteLength
  )
    reject('WAV_INVALID_RIFF');
  let offset = 12;
  let seenFormat = false;
  let data: Uint8Array | undefined;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) reject('WAV_TRUNCATED_CHUNK');
    const type = fourcc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + size + (size & 1);
    if (end > bytes.length) reject('WAV_TRUNCATED_CHUNK');
    if ((size & 1) !== 0 && bytes[end - 1] !== 0) reject('WAV_INVALID_PADDING');
    if (type === 'fmt ') {
      if (seenFormat || data || size !== 16) reject('WAV_UNSUPPORTED_FORMAT');
      if (
        view.getUint16(start, true) !== 1 ||
        view.getUint16(start + 2, true) !== 1 ||
        view.getUint32(start + 4, true) !== 16000 ||
        view.getUint32(start + 8, true) !== 32000 ||
        view.getUint16(start + 12, true) !== 2 ||
        view.getUint16(start + 14, true) !== 16
      )
        reject('WAV_REQUIRES_MONO_16KHZ_PCM16');
      seenFormat = true;
    } else if (type === 'data') {
      if (!seenFormat || data || size < 2 || size % 2 !== 0 || size > 960_000)
        reject('WAV_INVALID_DATA');
      data = bytes.subarray(start, start + size);
    } else if (type !== 'JUNK' && type !== 'LIST') reject('WAV_UNSUPPORTED_CHUNK');
    offset = end;
  }
  if (!seenFormat || !data || offset !== bytes.length) reject('WAV_MISSING_DATA');
  return data;
}
