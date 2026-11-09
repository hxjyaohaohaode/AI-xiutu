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

export const jsonRequest = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作没有完成，请重试。';

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export const formatDate = (value?: string) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(value))
    : '';
export const filenameBase = (name: string) =>
  name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '_') || '作品';
