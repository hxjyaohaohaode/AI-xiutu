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
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    if (error instanceof MultimodalProviderError) throw error;
    unknown('PROVIDER_RESPONSE_INTERRUPTED', id);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
    if (!record(parsed)) unknown('PROVIDER_INVALID_JSON_OBJECT', id);
    return parsed;
  } catch (error) {
    if (error instanceof MultimodalProviderError) throw error;
    return unknown('PROVIDER_INVALID_JSON', id);
  }
}

/** One request only. No redirect following, URL fetching from a response, or automatic retry. */
export async function postJson(
  url: string,
  apiKey: string,
  body: Record<string, unknown> | string,
  maxBytes: number,
  timeoutMs: number,
  fetcher: typeof fetch,
): Promise<{ data: Record<string, unknown>; requestId: string }> {
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  } catch {
    return unknown('PROVIDER_NETWORK_UNKNOWN');
  }
  const data = await readBoundedJson(response, maxBytes, signal);
  const requestId = responseId(response, data);
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
  return { data, requestId };
}
