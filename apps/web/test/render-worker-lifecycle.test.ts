import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureWorker, releaseWorker } from '../src/editor/workerLifecycle.ts';

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = 0;

  terminate() {
    this.terminated++;
  }

  reply(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data }));
  }
}

test('an existing worker is reused without replacing its active handlers or starting another instance', () => {
  const owner = { current: null as FakeWorker | null };
  const received: string[] = [];
  let created = 0;
  const create = () => {
    created++;
    return new FakeWorker();
  };
  const active = ensureWorker(owner, create, (data: string) => received.push(data), assert.fail);
  const reused = ensureWorker(owner, create, () => assert.fail('handler replaced'), assert.fail);
  assert.equal(active, reused);
  assert.equal(created, 1);
  active.reply('settled preview');
  assert.deepEqual(received, ['settled preview']);
});

for (const event of ['onerror', 'onmessageerror'] as const) {
  test(`${event} terminates the current owner, rejects pending requests once, and never restarts itself`, async () => {
    const owner = { current: null as FakeWorker | null };
    const fastOwner = { current: null as FakeWorker | null };
    const pending = new Map<
      number,
      { resolve: (value: string) => void; reject: (error: Error) => void }
    >();
    let created = 0;
    let failures = 0;
    const create = () => {
      created++;
      return new FakeWorker();
    };
    const receive = ({ id, value }: { id: number; value: string }) => {
      pending.get(id)?.resolve(value);
      pending.delete(id);
    };
    const fail = () => {
      failures++;
      releaseWorker(fastOwner);
      for (const request of pending.values()) request.reject(new Error('processing stopped'));
      pending.clear();
    };
    const main = ensureWorker(owner, create, receive, fail);
    const fast = ensureWorker(fastOwner, create, () => {}, assert.fail);
    const staleReply = main.onmessage!;
    const staleError = main.onerror!;
    const staleMessageError = main.onmessageerror!;
    const exported = new Promise<string>((resolve, reject) => pending.set(1, { resolve, reject }));
    const rejected = assert.rejects(exported, /processing stopped/);

    if (event === 'onerror') main.onerror!({} as ErrorEvent);
    else main.onmessageerror!(new MessageEvent('messageerror'));
    await rejected;
    assert.equal(owner.current, null);
    assert.equal(fastOwner.current, null);
    assert.equal(main.terminated, 1);
    assert.equal(fast.terminated, 1);
    assert.equal(pending.size, 0);
    assert.equal(failures, 1);
    assert.equal(created, 2, 'the failure callback did not retry either worker');

    // An explicit retry creates a new processing owner. Even a queued callback
    // with a reused request id cannot complete or terminate the new request.
    const next = ensureWorker(owner, create, receive, fail);
    let delivered = false;
    const current = new Promise<string>((resolve, reject) => pending.set(1, { resolve, reject }));
    void current.then(() => {
      delivered = true;
    });
    staleReply(new MessageEvent('message', { data: { id: 1, value: 'obsolete source' } }));
    staleError({} as ErrorEvent);
    staleMessageError(new MessageEvent('messageerror'));
    await Promise.resolve();
    assert.equal(delivered, false);
    assert.equal(owner.current, next);
    assert.equal(next.terminated, 0);
    assert.equal(failures, 1);
    assert.equal(pending.size, 1);
    next.reply({ id: 1, value: 'new source' });
    assert.equal(await current, 'new source');
    assert.equal(pending.size, 0);
  });
}

test('releasing an owner invalidates already queued callbacks without reporting a processing failure', () => {
  const owner = { current: null as FakeWorker | null };
  const active = ensureWorker(owner, () => new FakeWorker(), assert.fail, assert.fail);
  const staleReply = active.onmessage!;
  const staleError = active.onerror!;
  releaseWorker(owner);
  releaseWorker(owner);
  assert.equal(owner.current, null);
  assert.equal(active.terminated, 1);
  assert.equal(active.onmessage, null);
  assert.equal(active.onmessageerror, null);
  assert.equal(active.onerror, null);
  staleReply(new MessageEvent('message', { data: 'late result' }));
  staleError({} as ErrorEvent);
});

test('a synchronous construction failure leaves no phantom owner and a later explicit attempt can succeed', () => {
  const owner = { current: null as FakeWorker | null };
  assert.throws(
    () =>
      ensureWorker(
        owner,
        () => {
          throw new Error('module unavailable');
        },
        assert.fail,
        assert.fail,
      ),
    /module unavailable/,
  );
  assert.equal(owner.current, null);
  const next = ensureWorker(
    owner,
    () => new FakeWorker(),
    () => {},
    assert.fail,
  );
  assert.equal(owner.current, next);
  assert.equal(next.terminated, 0);
});

test('an optional interactive-worker failure does not terminate the settled channel', () => {
  const mainOwner = { current: null as FakeWorker | null };
  const fastOwner = { current: null as FakeWorker | null };
  const received: string[] = [];
  let degraded = 0;
  const main = ensureWorker(
    mainOwner,
    () => new FakeWorker(),
    (data: string) => received.push(data),
    assert.fail,
  );
  const fast = ensureWorker(
    fastOwner,
    () => new FakeWorker(),
    () => {},
    () => {
      degraded++;
    },
  );
  fast.onmessageerror!(new MessageEvent('messageerror'));
  assert.equal(fastOwner.current, null);
  assert.equal(mainOwner.current, main);
  assert.equal(main.terminated, 0);
  assert.equal(degraded, 1);
  main.reply('settled pixels remain available');
  assert.deepEqual(received, ['settled pixels remain available']);
});
