import { api } from '../lib/api';

export interface RunEvent {
  id: string;
  runId: string;
  type: string;
  payload: Record<string, any>;
  createdAt: string;
}
/** Reconnect replays events only. This transport has no task-creation method. */
export function observeAssistantTurn<T extends { state: string }>(
  id: string,
  signal: AbortSignal,
  onEvent: (event: RunEvent) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const stream = new EventSource(`/v1/assistant-turns/${encodeURIComponent(id)}/events`);
    let closed = false,
      cursor = 0n,
      checking = false;
    const cleanup = () => {
      closed = true;
      stream.close();
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => {
      cleanup();
      reject(new DOMException('Stopped observing this run', 'AbortError'));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('任务仍可能在执行，请刷新会话记录恢复进度；不要重复发送相同生成请求。'));
    }, 280_000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    const readState = async () => {
      if (checking || closed) return;
      checking = true;
      try {
        const result = await api<T>(`/assistant-turns/${encodeURIComponent(id)}`, { signal });
        if (!closed && result.state !== 'running') {
          cleanup();
          resolve(result);
        }
      } catch (error) {
        if (!closed) {
          cleanup();
          reject(error);
        }
      } finally {
        checking = false;
      }
    };
    stream.addEventListener('update', (message) => {
      try {
        const event = JSON.parse((message as MessageEvent).data) as RunEvent;
        if (!/^\d{1,18}$/.test(event.id) || event.runId !== id || BigInt(event.id) <= cursor)
          return;
        cursor = BigInt(event.id);
        onEvent(event);
        if (['run.completed', 'run.failed', 'run.unknown', 'run.stopped'].includes(event.type))
          void readState();
      } catch {
        cleanup();
        reject(new Error('进度事件格式不正确，请重新读取会话'));
      }
    });
    stream.addEventListener('state', () => {
      void readState();
    });
    stream.onerror = () => {
      void readState();
    }; // EventSource reconnects with Last-Event-ID.
  });
}
