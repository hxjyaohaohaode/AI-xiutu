import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpsReadCoordinator, type OpsReadScope } from '../src/components/ops-read.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('explicit operations searches freeze their own query and only the newest result releases loading', async () => {
  const reader = new OpsReadCoordinator();
  const old = deferred<string[]>(),
    latest = deferred<string[]>();
  const submitted = { tab: 'users', query: 'first search' };
  const requests: { scope: OpsReadScope; signal: AbortSignal }[] = [];
  const values: string[][] = [],
    errors: unknown[] = [];
  let settled = 0;
  const handlers = {
    current: () => true,
    value: (value: string[]) => values.push(value),
    error: (error: unknown) => errors.push(error),
    settled: () => {
      settled++;
    },
  };
  const first = reader.run(
    submitted,
    (scope, signal) => {
      requests.push({ scope, signal });
      return old.promise;
    },
    handlers,
  );
  submitted.query = 'new name & +';
  assert.equal(requests.length, 1, 'editing a query alone starts no new request');
  assert.equal(requests[0]!.scope.query, 'first search');
  const second = reader.run(
    submitted,
    (scope, signal) => {
      requests.push({ scope, signal });
      return latest.promise;
    },
    handlers,
  );
  assert.equal(requests[1]!.scope.query, 'new name & +');
  assert.equal(requests[0]!.signal.aborted, true);
  old.resolve(['stale user']); // The transport deliberately ignores AbortSignal.
  await first;
  assert.deepEqual(values, []);
  assert.equal(settled, 0, 'old finally must not dismiss the current loading skeleton');
  latest.resolve(['current user']);
  await second;
  assert.deepEqual(values, [['current user']]);
  assert.deepEqual(errors, []);
  assert.equal(settled, 1);
});

test('a changed operations tab rejects old values even before effect cleanup begins', async () => {
  const reader = new OpsReadCoordinator();
  const pending = deferred<number>();
  let tab = 'users';
  const events: string[] = [];
  const task = reader.run({ tab, query: '' }, () => pending.promise, {
    current: (scope) => scope.tab === tab,
    value: () => events.push('value'),
    error: () => events.push('error'),
    settled: () => events.push('settled'),
  });
  tab = 'models';
  pending.resolve(1);
  await task;
  assert.deepEqual(events, []);
});

test('an aborted old read cannot publish errors or settle a remounted read of the same scope', async () => {
  const reader = new OpsReadCoordinator();
  const old = deferred<string>(),
    next = deferred<string>();
  const events: string[] = [];
  const handlers = {
    current: () => true,
    value: (value: string) => events.push(value),
    error: () => events.push('error'),
    settled: () => events.push('settled'),
  };
  const first = reader.run({ tab: 'overview', query: '' }, () => old.promise, handlers);
  reader.cancel();
  const second = reader.run({ tab: 'overview', query: '' }, () => next.promise, handlers);
  old.reject(new Error('late failure'));
  await first;
  assert.deepEqual(events, []);
  next.resolve('new overview');
  await second;
  assert.deepEqual(events, ['new overview', 'settled']);
});

test('a current read exposes its actual failure and cancellation after unmount exposes nothing', async () => {
  const reader = new OpsReadCoordinator();
  const errors: unknown[] = [];
  let settled = 0;
  const handlers = {
    current: () => true,
    value: () => assert.fail('a failed read has no value'),
    error: (error: unknown) => errors.push(error),
    settled: () => {
      settled++;
    },
  };
  const failure = new Error('permission unavailable');
  await reader.run(
    { tab: 'audit', query: '' },
    async () => {
      throw failure;
    },
    handlers,
  );
  assert.deepEqual(errors, [failure]);
  assert.equal(settled, 1);
  const pending = deferred<void>();
  const task = reader.run({ tab: 'audit', query: '' }, () => pending.promise, handlers);
  reader.cancel();
  pending.reject(new Error('after unmount'));
  await task;
  assert.deepEqual(errors, [failure]);
  assert.equal(settled, 1);
});
