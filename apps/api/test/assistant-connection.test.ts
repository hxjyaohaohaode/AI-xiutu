import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogConnection } from '../src/assistant/catalog-connection.js';

const visible = () => Response.json({ object: 'list', data: [{ id: 'catalog-test' }] });
test('one fixed read-only catalog check serves concurrent clients and recovers after a reset', async () => {
  let now = 500;
  let calls = 0;
  let up = false;
  const connection = createCatalogConnection({
    key: 'unit-test-only', live: true, now: () => now,
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/models');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'manual');
      assert.equal(init?.body, undefined);
      assert.deepEqual(init?.headers, { Authorization: 'Bearer unit-test-only' });
      if (!up) throw new Error('ECONNRESET');
      return visible();
    },
  });
  assert.equal(connection.snapshot().state, 'not_checked');
  const values = await Promise.all(Array.from({ length: 30 }, () => connection.check()));
  assert.equal(calls, 1);
  assert.ok(values.every(result => result.state === 'unreachable' && result.httpStatus === null));
  up = true;
  now += 14_999;
  assert.equal((await connection.check()).state, 'unreachable');
  now++;
  assert.equal((await connection.check()).state, 'reachable');
  assert.deepEqual((await connection.inventory())?.ids, ['catalog-test']);
  assert.equal(calls, 2);
  now += 300_000;
  assert.equal(connection.snapshot().stale, true);
  await connection.check();
  assert.equal(calls, 3);
});

test('catalog access, temporary vendor failures and invalid responses have separate outcomes', async () => {
  for (const [status, expected] of [[401, 'catalog_denied'], [403, 'catalog_denied'],
    [302, 'provider_error'], [429, 'provider_error'], [503, 'provider_error'], [200, 'provider_error']] as const) {
    const connection = createCatalogConnection({ key: 'test', live: true,
      fetcher: async () => new Response('private upstream text', { status }) });
    const result = await connection.check();
    assert.equal(result.state, expected);
    assert.equal(result.httpStatus, status);
    assert.ok(!JSON.stringify(result).includes('private'));
    assert.equal(await connection.inventory(), undefined);
  }
});

test('probes time out and nonproduction reads never dispatch to a provider', async () => {
  let calls = 0;
  const fake: typeof fetch = async (_url, init) => {
    calls++;
    return await new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(Error('deadline failed')), 1000);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Error('cancelled')); }, { once:true });
    });
  };
  const offline = createCatalogConnection({ key: 'test', live: false, fetcher: fake });
  assert.equal((await offline.check()).state, 'not_checked');
  const missing = createCatalogConnection({ key: '', live: true, fetcher: fake });
  assert.equal((await missing.check()).state, 'unconfigured');
  assert.equal(calls, 0);
  const probe = createCatalogConnection({ key: 'test', live: true, fetcher: fake, timeoutMs: 20 });
  assert.equal((await probe.check()).state, 'unreachable');
  assert.equal(calls, 1);
});
