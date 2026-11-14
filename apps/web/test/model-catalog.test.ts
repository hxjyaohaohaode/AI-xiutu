import assert from 'node:assert/strict';
import test from 'node:test';
import { readModelCatalog } from '../src/lib/api';

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
