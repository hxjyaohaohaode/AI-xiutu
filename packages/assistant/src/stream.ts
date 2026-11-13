import { MultimodalProviderError } from '@ai-xiutu/multimodal';
import { HttpsProxyAgent } from 'https-proxy-agent';
import WebSocket from 'ws';
import { assistantEgressProxy } from './models.js';

const RESPONSES_SOCKET = 'wss://api.openai.com/v1/responses';

/** Convert one official socket response to the same bounded, moderated event path as HTTP SSE. */
export function responsesSocketFetch(key: string, proxy?: string): typeof fetch {
  const endpointProxy = assistantEgressProxy(proxy);
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    delete body.stream;
    const signal = init?.signal;
    signal?.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      const socket = new WebSocket(RESPONSES_SOCKET, {
        headers: { Authorization: `Bearer ${key}` },
        ...(endpointProxy ? { agent: new HttpsProxyAgent(endpointProxy) } : {}),
        handshakeTimeout: 12_000,
        maxPayload: 2_000_000,
        followRedirects: false,
        perMessageDeflate: false,
      });
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let finished = false;
      let receipt = '';
      let bytes = 0;
      const abort = () => finish(new Error('Responses socket aborted'));
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', abort);
        if (error) {
          if (controller) controller.error(error);
          else reject(error);
        } else controller?.close();
        socket.terminate();
      };
      signal?.addEventListener('abort', abort, { once: true });
      socket.on('upgrade', (response) => {
        const header = response.headers['x-request-id'];
        if (typeof header === 'string' && /^[A-Za-z0-9._:/-]{1,256}$/.test(header))
          receipt = header;
      });
      socket.on('open', () => {
        if (finished) return;
        const stream = new ReadableStream<Uint8Array>({
          start(value) {
            controller = value;
          },
          cancel() {
            controller = undefined;
            finish();
          },
        });
        resolve(
          new Response(stream, {
            headers: { 'content-type': 'text/event-stream', 'x-request-id': receipt },
          }),
        );
        socket.send(JSON.stringify({ ...body, type: 'response.create' }), (error) => {
          if (error) finish(error);
        });
      });
      socket.on('error', () => finish(new Error('Responses socket failed')));
      socket.on('close', () => finish(new Error('Responses socket closed before receipt')));
      socket.on('message', (message, binary) => {
        if (!controller || finished) return;
        try {
          if (binary) throw new Error('Unexpected binary Responses frame');
          const json = message.toString();
          const event = JSON.parse(json);
          const data = Buffer.from(`data: ${JSON.stringify(event)}\n\n`);
          bytes += data.length;
          if (bytes > 2_000_000) throw new Error('Responses socket budget exceeded');
          controller.enqueue(data);
          if (
            ['response.completed', 'response.incomplete', 'response.failed', 'error'].includes(
              event.type,
            )
          )
            finish();
        } catch {
          finish(new Error('Invalid Responses socket event'));
        }
      });
      if (signal?.aborted) abort();
    });
  };
}

/** One billable request, bounded SSE parsing, no retry. A partial stream is never
 * interpreted as a successful result. Only response.completed/incomplete seals it. */
export async function streamResponse(
  url: string,
  key: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
  onText: (delta: string, prefix: string) => Promise<void>,
  timeoutMs = 60_000,
): Promise<{ data: Record<string, any>; requestId: string }> {
  const signal = AbortSignal.timeout(timeoutMs);
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
      text = '',
      delivered = 0,
      deliveries = 0;
    let terminal: Record<string, any> | undefined;
    const flush = async () => {
      if (text.length > delivered) {
        await onText(text.slice(delivered), text);
        delivered = text.length;
        deliveries++;
      }
    };
    let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
    const flushDue = Symbol('flush-due');
    while (true) {
      // Keep the same in-flight read across a delivery deadline. Starting a
      // second read after a timer wins would lose/reorder upstream SSE chunks.
      pendingRead ??= reader.read();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let next: ReadableStreamReadResult<Uint8Array> | typeof flushDue;
      try {
        next = await Promise.race([
          pendingRead,
          aborted,
          ...(deliveries < 16 && text.length > delivered
            ? [
                new Promise<typeof flushDue>((done) => {
                  timer = setTimeout(() => done(flushDue), 250);
                }),
              ]
            : []),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (next === flushDue) {
        await flush();
        continue;
      }
      pendingRead = undefined;
      const { done, value } = next;
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
          text += event.delta;
          if (text.length > 20_000) fail('ASSISTANT_STREAM_TEXT_BUDGET');
          const pending = text.length - delivered;
          if (deliveries < 16 && (pending >= 384 || /[。！？\n]$/.test(text))) await flush();
        } else if (['response.completed', 'response.incomplete'].includes(event.type)) {
          if (terminal || !event.response || typeof event.response !== 'object')
            fail('ASSISTANT_STREAM_ORDER');
          terminal = event.response;
          if (
            terminal!.status !== (event.type === 'response.completed' ? 'completed' : 'incomplete')
          )
            fail('ASSISTANT_STREAM_ORDER');
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
    if (
      text &&
      (!Array.isArray(terminal!.output) ||
        terminal!.output
          .filter(
            (item: any) =>
              item?.type === 'message' &&
              (item.role === undefined || item.role === 'assistant') &&
              Array.isArray(item.content),
          )
          .flatMap((item: any) =>
            item.content
              .filter((part: any) => part?.type === 'output_text')
              .map((part: any) => part.text),
          )
          .join('') !== text)
    )
      fail('ASSISTANT_STREAM_TEXT_MISMATCH');
    await flush();
    const responseId = terminal!.id;
    return {
      data: terminal!,
      requestId:
        requestId ||
        (typeof responseId === 'string' && /^resp_[A-Za-z0-9_-]{1,200}$/.test(responseId)
          ? responseId
          : ''),
    };
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    if (error instanceof MultimodalProviderError) throw error;
    return fail('ASSISTANT_STREAM_INTERRUPTED');
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    reader?.releaseLock();
  }
}
