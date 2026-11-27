import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorVoiceClient } from '../src/ai/voiceClient.ts';

test('stalled handshakes, late messages and sustained upload congestion close the original voice connection once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  class Socket {
    static OPEN = 1;
    static last: Socket;
    readyState = Socket.OPEN;
    bufferedAmount = 0;
    onerror?: () => void;
    onclose?: () => void;
    onmessage?: (value: { data: string }) => void;
    sent: string[] = [];
    closed = 0;
    constructor() { Socket.last = this; }
    send(text: string) { this.sent.push(text); }
    close() { this.closed++; }
  }
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const oldSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href: 'https://example.test/' } } });
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: Socket });
  t.after(() => {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (oldSocket) Object.defineProperty(globalThis, 'WebSocket', oldSocket);
    else Reflect.deleteProperty(globalThis, 'WebSocket');
  });
  const open = () => {
    const failures: string[] = [], events: string[] = [];
    const client = new EditorVoiceClient((e) => events.push(e.type), (m) => failures.push(m));
    Object.assign(client, { audio: { close: async () => {} } });
    client.connect('/v1/voice-sessions/12345678-1234-4321-a321-123456789abc/stream', 'test-ticket');
    return { client, failures, events, socket: Socket.last };
  };

  const stalled = open();
  t.mock.timers.tick(30_000);
  stalled.socket.onerror?.();
  stalled.socket.onclose?.();
  stalled.socket.onmessage?.({ data: '{"type":"ready"}' });
  assert.deepEqual([stalled.failures.length, stalled.socket.closed, stalled.events.length], [1, 1, 0]);

  const live = open();
  live.socket.onmessage?.({ data: '{"type":"ready"}' });
  t.mock.timers.tick(30_000);
  assert.deepEqual([live.failures.length, live.socket.closed, ...live.events], [0, 0, 'ready']);
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const frame = { type: 'audio', pcm: 'AAAA' } as const;
  live.socket.bufferedAmount = 200_000;
  live.client.send(frame);
  now = 2_900;
  live.socket.bufferedAmount = 0;
  live.client.send(frame);
  assert.ok(live.socket.sent.some((s) => JSON.parse(s).type === 'audio'));
  live.socket.bufferedAmount = 200_000;
  live.client.send(frame);
  now += 3001;
  live.client.send(frame);
  live.socket.onclose?.();
  assert.deepEqual([live.failures.length, live.socket.closed], [1, 1]);
});
