import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Raw shared frames and recorded audio live only in this page's memory. */
export type RequestPayloadCache = Map<string, string>;
export const requestPayloads: RequestPayloadCache = new Map();

export function requestBodyHash(body: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(body)));
}

function containsRawMedia(value: unknown): boolean {
  if (typeof value === 'string') return /^data:(?:image|audio)\//i.test(value);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      ['imageDataUrl', 'imageBase64', 'audioBase64'].includes(key) || containsRawMedia(nested),
  );
}

export function persistableRequestBody(
  body: string | null,
  cacheKey: string,
  cache: RequestPayloadCache = requestPayloads,
): string | null {
  if (body === null) return null;
  if (!containsRawMedia(JSON.parse(body))) return body;
  cache.set(cacheKey, body);
  // Retain only a bounded number of unresolved private payloads in page memory.
  while (cache.size > 12) cache.delete(cache.keys().next().value!);
  return null;
}

export function restoreRequestBody(
  body: string | null,
  hash: string,
  cacheKey: string,
  cache: RequestPayloadCache = requestPayloads,
): string | null {
  const restored = body ?? cache.get(cacheKey) ?? null;
  if (restored !== null && requestBodyHash(restored) !== hash)
    throw new Error('原请求恢复记录的内容不完整，请先核对已保存的任务结果。');
  return restored;
}
