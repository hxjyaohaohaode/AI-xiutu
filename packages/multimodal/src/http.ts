import { ProviderError } from '@ai-xiutu/providers';

export class MultimodalProviderError extends ProviderError {
  constructor(
    code: string,
    outcome: 'rejected' | 'unknown',
    public readonly requestId = '',
  ) {
    super(
      code,
      outcome,
      outcome === 'unknown'
        ? '外部请求结果尚不确定，请核对后处理，勿自动重试'
        : '外部请求未通过输入、配置或供应商检查',
    );
    this.name = 'MultimodalProviderError';
  }
}

export function reject(code: string): never {
  throw new MultimodalProviderError(code, 'rejected');
}
export function unknown(code: string, requestId = ''): never {
  throw new MultimodalProviderError(code, 'unknown', requestId);
}
export const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const cleanId = (value: unknown): string =>
  typeof value === 'string' && /^[A-Za-z0-9._:/-]{1,256}$/.test(value) ? value : '';
export const responseId = (response: Response, data?: Record<string, unknown>): string =>
  cleanId(response.headers.get('x-request-id')) ||
  cleanId(response.headers.get('x-tt-logid')) ||
  cleanId(data?.request_id) ||
  cleanId(data?.id);

export function token(value: string | undefined): string {
  if (!value) return '';
  if (value.length > 4096 || /[\r\n\u0000]/.test(value))
    reject('INVALID_PROVIDER_CREDENTIAL_CONFIG');
  return value;
}

async function readBoundedJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const bytes = await readBounded(response, maxBytes, signal);
  const id = responseId(response);
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!record(parsed)) unknown('PROVIDER_INVALID_JSON_OBJECT', id);
    return parsed;
  } catch (error) {
    if (error instanceof MultimodalProviderError) throw error;
    return unknown('PROVIDER_INVALID_JSON', id);
  }
}

async function readBounded(
  response: Response, maxBytes: number, signal: AbortSignal,
  consume?: (chunk: Uint8Array) => void,
) {
  const id = responseId(response);
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    void response.body?.cancel().catch(() => undefined);
    unknown('PROVIDER_RESPONSE_TOO_LARGE', id);
  }
  if (!response.body) unknown('PROVIDER_EMPTY_RESPONSE', id);
  const reader = response.body.getReader();
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_, rejectPromise) => {
    abort = () =>
      rejectPromise(new MultimodalProviderError('PROVIDER_RESPONSE_TIMEOUT', 'unknown', id));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) unknown('PROVIDER_RESPONSE_TOO_LARGE', id);
      if (consume) consume(value);
      else chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof MultimodalProviderError) throw error;
    unknown('PROVIDER_RESPONSE_INTERRUPTED', id);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  return consume ? Buffer.alloc(0) : Buffer.concat(chunks, total);
}

/** The caller owns the fixed provider URL and authorization. */
export async function getJson(
  url: string,
  apiKey: string,
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
) {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      signal,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return unknown('PROVIDER_NETWORK_UNKNOWN');
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    unknown('PROVIDER_HTTP_UNKNOWN', responseId(response));
  }
  return readBoundedJson(response, maxBytes, signal);
}

/** One request only. No redirect following, URL fetching from a response, or automatic retry. */
export async function postJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown> | string | FormData,
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<{ data: Record<string, unknown>; requestId: string }> {
  const { response, signal } = await postResponse(url, apiKey, body, timeoutMs, fetcher);
  const data = await readBoundedJson(response, maxBytes, signal);
  const requestId = responseId(response, data);
  assertHttpSuccess(response, data, requestId);
  return { data, requestId };
}

export async function postBinary(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
) {
  const { response, signal } = await postResponse(url, apiKey, body, timeoutMs, fetcher);
  const requestId = responseId(response);
  if (!response.ok)
    assertHttpSuccess(response, await readBoundedJson(response, 32_768, signal), requestId);
  const mime = response.headers.get('content-type')?.split(';')[0]?.toLowerCase();
  if (!mime?.startsWith('audio/') && mime !== 'application/octet-stream') {
    void response.body?.cancel().catch(() => undefined);
    unknown('PROVIDER_INVALID_AUDIO_TYPE', requestId);
  }
  const bytes = await readBounded(response, maxBytes, signal);
  if (!bytes.length) unknown('PROVIDER_EMPTY_RESPONSE', requestId);
  return { bytes, requestId };
}

export async function postEventStream(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
  onEvent?: (event: Record<string, unknown>, requestId: string) => void,
) {
  const { response, signal } = await postResponse(url, apiKey, body, timeoutMs, fetcher);
  const requestId = responseId(response);
  if (!response.ok)
    assertHttpSuccess(response, await readBoundedJson(response, 32_768, signal), requestId);
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    void response.body?.cancel().catch(() => undefined);
    unknown('PROVIDER_INVALID_EVENT_STREAM', requestId);
  }
  const events: Record<string, unknown>[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffered = '';
  let count = 0;
  function parse(block: string) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data || data === '[DONE]') return;
    const event: unknown = JSON.parse(data);
    if (!record(event) || ++count > 24) unknown('PROVIDER_INVALID_EVENT_STREAM', requestId);
    if (onEvent) onEvent(event, requestId);
    else events.push(event);
  }
  try {
    let scanned = 0;
    await readBounded(response, maxBytes, signal, (chunk) => {
      buffered += decoder.decode(chunk, { stream: true });
      const boundary = /\r?\n\r?\n/g;
      boundary.lastIndex = Math.max(0, scanned - 3);
      let start = 0;
      for (let match = boundary.exec(buffered); match; match = boundary.exec(buffered)) {
        parse(buffered.slice(start, match.index));
        start = boundary.lastIndex;
      }
      buffered = buffered.slice(start);
      scanned = buffered.length;
    });
    parse(buffered + decoder.decode());
  } catch (error) {
    if (error instanceof MultimodalProviderError) throw error;
    unknown('PROVIDER_INVALID_EVENT_STREAM', requestId);
  }
  return { events, requestId };
}

async function postResponse(
  url: string,
  apiKey: string,
  body: Record<string, unknown> | string | FormData,
  timeoutMs: number,
  fetcher: typeof fetch,
) {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: {
        ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${apiKey}`,
      },
      body: typeof body === 'string' || body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    return unknown('PROVIDER_NETWORK_UNKNOWN');
  }
  return { response, signal };
}

function assertHttpSuccess(response: Response, data: Record<string, unknown>, requestId: string) {
  if (!response.ok) {
    // A definite client-error envelope is a rejected request. 408/429/5xx and
    // malformed/unexplained replies remain unknown; caller must reconcile.
    if (
      [400, 401, 403, 404, 422].includes(response.status) &&
      record(data.error) &&
      typeof data.error.code === 'string'
    ) {
      throw new MultimodalProviderError('PROVIDER_REQUEST_REJECTED', 'rejected', requestId);
    }
    unknown('PROVIDER_HTTP_UNKNOWN', requestId);
  }
}
