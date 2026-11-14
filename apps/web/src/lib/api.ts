import { formatDateTime } from '../i18n';
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path.startsWith('/v1') ? path : `/v1${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body && !(init.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'NETWORK_UNAVAILABLE',
      '暂时无法连接云端。你可以继续本地编辑，请稍后重试。',
      0,
    );
  }
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) {
    throw new ApiError(
      body?.error?.code ?? `HTTP_${response.status}`,
      body?.error?.message ??
        (response.status === 503 ? '云端暂不可用，请稍后重试。' : '请求未完成，请稍后重试。'),
      response.status,
      body?.error?.details,
    );
  }
  return body as T;
}

export async function withRequestDeadline<T>(
  signal: AbortSignal | undefined,
  timeout: number,
  read: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
  signal?.addEventListener('abort', cancel, { once: true });
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    cancel();
  }, timeout);
  try {
    return await read(controller.signal);
  } catch (error) {
    if (expired && !signal?.aborted)
      throw new ApiError('REQUEST_TIMEOUT', '云端响应超时，请重试。', 408);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Model discovery may retry; paid requests never use this path. */
export async function readModelCatalog<T>(path: string, signal: AbortSignal): Promise<T> {
  async function read(timeout: number) {
    const value = await withRequestDeadline(signal, timeout, (signal) =>
      api<T & { models?: unknown }>(path, { cache: 'no-store', signal }),
    );
    if (!Array.isArray(value?.models))
      throw new ApiError('MODEL_CATALOG_UNAVAILABLE', '暂时无法读取模型列表，请稍后重试。', 503);
    return value;
  }
  try {
    return await read(8_000);
  } catch (error) {
    if (signal.aborted) throw error;
    const transient = error instanceof SyntaxError ||
      (error instanceof ApiError && [0, 408, 502, 503, 504].includes(error.status));
    if (!transient) throw error;
    return read(10_000);
  }
}

export const jsonRequest = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作没有完成，请重试。';

export function settingsErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
    const { fields } = (error.details ?? {}) as { fields?: { path: string; message: string }[] };
    if (fields?.length) return fields.slice(0, 3).map(({ path, message }) =>
      path ? path.replace(/^config\\./, '') + ' · ' + message : message,
    ).join(' / ');
  }
  return errorMessage(error);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const formatDate = (value?: string) => (value ? formatDateTime(value) : '');
export const filenameBase = (name: string) =>
  name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || '作品';
