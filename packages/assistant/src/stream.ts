import { MultimodalProviderError } from '@ai-xiutu/multimodal';

/** One billable request, bounded SSE parsing, no retry. A partial stream is never
 * interpreted as a successful result. Only response.completed/incomplete seals it. */
export async function streamResponse(
  url: string,
  key: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
  onText: (text: string) => Promise<void>,
): Promise<{ data: Record<string, any>; requestId: string }> {
  const signal = AbortSignal.timeout(60_000);
  let requestId = '';
  const fail = (code: string): never => {
    throw new MultimodalProviderError(code, 'unknown', requestId);
  };
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const response = await fetcher(url, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const id = response.headers.get('x-request-id') ?? '';
    requestId = /^[A-Za-z0-9._:/-]{1,256}$/.test(id) ? id : '';
    if (!response.body) fail('ASSISTANT_EMPTY_STREAM');
    reader = response.body!.getReader();
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () =>
        reject(new MultimodalProviderError('ASSISTANT_STREAM_TIMEOUT', 'unknown', requestId));
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const isStream = response.headers.get('content-type')?.includes('text/event-stream');
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let total = 0,
      buffer = '',
      pendingText = '';
    let terminal: Record<string, any> | undefined;
    const flush = async () => {
      if (pendingText) {
        const text = pendingText;
        pendingText = '';
        await onText(text);
      }
    };
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      total += value.byteLength;
      if (total > 2_000_000) fail('ASSISTANT_STREAM_BUDGET');
      buffer += decoder.decode(value, { stream: true });
      if (!isStream) continue;
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          if (terminal) fail('ASSISTANT_STREAM_ORDER');
          pendingText += event.delta;
          if (pendingText.length >= 512 || /[。！？\n]$/.test(pendingText)) await flush();
        } else if (['response.completed', 'response.incomplete'].includes(event.type)) {
          if (terminal || !event.response || typeof event.response !== 'object')
            fail('ASSISTANT_STREAM_ORDER');
          terminal = event.response;
        } else if (['error', 'response.failed'].includes(event.type))
          fail('ASSISTANT_STREAM_FAILED');
      }
    }
    buffer += decoder.decode();
    if (!isStream) {
      const data = JSON.parse(buffer);
      if (!response.ok) {
        if (
          [400, 401, 403, 404, 422, 429].includes(response.status) &&
          typeof data?.error?.code === 'string'
        )
          throw new MultimodalProviderError('PROVIDER_REQUEST_REJECTED', 'rejected', requestId);
        fail('PROVIDER_HTTP_UNKNOWN');
      }
      if (!data || typeof data !== 'object' || Array.isArray(data))
        fail('ASSISTANT_INVALID_RESPONSE');
      return { data, requestId };
    }
    if (!response.ok || !terminal || buffer.trim()) fail('ASSISTANT_STREAM_INTERRUPTED');
    await flush();
    return { data: terminal!, requestId };
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    if (error instanceof MultimodalProviderError) throw error;
    return fail('ASSISTANT_STREAM_INTERRUPTED');
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    reader?.releaseLock();
  }
}
