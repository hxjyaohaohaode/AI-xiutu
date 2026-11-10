import assert from 'node:assert/strict';
import test from 'node:test';
import { ModalCloseRequests } from '../src/components/modal-close.ts';

function deferred() {
  let resolve!: (value: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('an ordinary synchronous close is not deferred into a later dialog owner', async () => {
  const guard = new ModalCloseRequests();
  let closed = false;
  const outcome = guard.request({
    isCurrent: () => true,
    close: () => {
      closed = true;
    },
  });
  assert.equal(closed, true, 'a default confirmation cancel is settled in its original event');
  assert.equal(await outcome, true);
});

test('repeated close, Escape and backdrop requests share one pending decision', async () => {
  const guard = new ModalCloseRequests(),
    decision = deferred();
  let questions = 0,
    closes = 0,
    open = true;
  const actions = {
    isCurrent: () => open,
    canClose: () => {
      questions++;
      return decision.promise;
    },
    close: () => {
      closes++;
      open = false;
    },
  };
  const first = guard.request(actions);
  assert.equal(await guard.request(actions), false);
  assert.equal(await guard.request(actions), false);
  assert.equal(questions, 1);
  assert.equal(closes, 0, 'a Promise is not a positive decision');
  decision.resolve(true);
  assert.equal(await first, true);
  assert.equal(closes, 1);
  assert.equal(await guard.request(actions), false);
  assert.equal(questions, 1, 'an already closing owner is not asked again');
});

test('cancelling or failing a close guard preserves the mounted draft and permits a later retry', async () => {
  const guard = new ModalCloseRequests();
  let closes = 0;
  for (const canClose of [
    () => false,
    () => {
      throw new Error('guard failed');
    },
    () => Promise.reject(new Error('request failed')),
  ]) {
    assert.equal(
      await guard.request({ isCurrent: () => true, canClose, close: () => closes++ }),
      false,
    );
  }
  assert.equal(closes, 0);
  assert.equal(await guard.request({ isCurrent: () => true, close: () => closes++ }), true);
  assert.equal(closes, 1);
});

test('a positive result after unmount or owner replacement cannot close a newer dialog', async () => {
  for (const change of ['unmount', 'replace'] as const) {
    const guard = new ModalCloseRequests(),
      decision = deferred();
    let mounted = true,
      generation = 1,
      closes = 0;
    const captured = generation;
    const pending = guard.request({
      isCurrent: () => mounted && generation === captured,
      canClose: () => decision.promise,
      close: () => closes++,
    });
    if (change === 'unmount') mounted = false;
    else generation++;
    decision.resolve(true);
    assert.equal(await pending, false);
    assert.equal(closes, 0);
  }
});

test('closing and reopening invalidates the previous question even when open becomes true again', async () => {
  const guard = new ModalCloseRequests(),
    old = deferred(),
    current = deferred();
  let closes = 0,
    questions = 0;
  const stale = guard.request({
    isCurrent: () => true,
    canClose: () => old.promise,
    close: () => closes++,
  });
  guard.invalidate();
  const actions = {
    isCurrent: () => true,
    canClose: () => {
      questions++;
      return current.promise;
    },
    close: () => closes++,
  };
  const next = guard.request(actions);
  old.resolve(true);
  assert.equal(await stale, false);
  assert.equal(
    await guard.request(actions),
    false,
    'the obsolete finally cannot unlock the new question',
  );
  assert.equal(questions, 1);
  assert.equal(closes, 0);
  current.resolve(true);
  assert.equal(await next, true);
  assert.equal(closes, 1);
});

test('the accepted request invokes the latest close callback instead of its render-time closure', async () => {
  const guard = new ModalCloseRequests(),
    decision = deferred();
  const called: string[] = [];
  const callback = { current: () => called.push('obsolete') };
  const pending = guard.request({
    isCurrent: () => true,
    canClose: () => decision.promise,
    close: () => callback.current(),
  });
  callback.current = () => called.push('current');
  decision.resolve(true);
  assert.equal(await pending, true);
  assert.deepEqual(called, ['current']);
});
