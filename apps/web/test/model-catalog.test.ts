import assert from 'node:assert/strict';
import test from 'node:test';
import { preferredNarrationModel } from '../src/ai/model-guidance';
import type { AIModel } from '../src/ai/types';
import { readModelCatalog, withRequestDeadline } from '../src/lib/api';

test('reply narration uses a preferred speech model while the server reports it available', () => {
  const preferred: AIModel = {
    id: 'gpt-4o-mini-tts',
    label: 'GPT-4o mini TTS',
    provider: 'openai',
    enabled: true,
    shutdownDate: '2027-01-06',
    runtimeAvailable: true,
    runtimeOperations: ['speak'],
  };
  const fallback = { ...preferred, id: 'tts-1-hd' };
  assert.equal(preferredNarrationModel([fallback, preferred]), preferred);
  assert.equal(preferredNarrationModel([{ ...preferred, runtimeAvailable: false }, fallback]), fallback);
});

test('model discovery retries transient empty responses without retrying authentication failures', async (t) => {
  let attempt = 0;
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    ++attempt === 1
      ? new Response(null, { status: 503 })
      : Response.json({ models: ['example'] }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await readModelCatalog('/assistant/models', signal), { models: ['example'] });
  assert.equal(fetch.mock.callCount(), 2);

  fetch.mock.mockImplementation(async () => new Response(null, { status: 401 }));
  await assert.rejects(readModelCatalog('/assistant/models', signal), { status: 401 });
  assert.equal(fetch.mock.callCount(), 3);
});

test('model discovery works without newer AbortSignal helpers and cancels when leaving', async (t) => {
  t.mock.method(AbortSignal, 'any', () => { throw new Error('Unavailable on this browser'); });
  t.mock.method(AbortSignal, 'timeout', () => { throw new Error('Unavailable on this browser'); });
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ models: [] }));
  const controller = new AbortController();
  assert.deepEqual(await readModelCatalog('/models', controller.signal), { models: [] });
  controller.abort();
  await assert.rejects(readModelCatalog('/models', controller.signal), { name: 'AbortError' });
  assert.equal(fetch.mock.callCount(), 1);
});

test('request deadline distinguishes timeouts from navigation cancellation', async () => {
  const interrupted = (signal: AbortSignal) => new Promise<never>((_, reject) =>
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))),
  );
  await assert.rejects(withRequestDeadline(undefined, 5, interrupted), { code: 'REQUEST_TIMEOUT' });
  const controller = new AbortController();
  const request = withRequestDeadline(controller.signal, 10_000, interrupted);
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});
