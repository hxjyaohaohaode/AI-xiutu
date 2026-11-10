import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfirmationRequests } from '../src/components/ConfirmationDialog.tsx';

test('a duplicate confirmation cannot replace or answer the pending question', async () => {
  const requests = new ConfirmationRequests<string>();
  const first = requests.request('copy the selected reference');
  assert.ok(first);
  assert.equal(requests.request('different operation'), null);
  assert.equal(requests.current, first);
  assert.equal(requests.settle(first.id + 1, true), false);
  assert.equal(requests.settle(first.id, true), true);
  assert.equal(requests.settle(first.id, false), false);
  assert.equal(await first.result, true);
  assert.equal(requests.current, null);
});

test('a late click from the closing dialog cannot confirm its replacement', async () => {
  const requests = new ConfirmationRequests<string>();
  const first = requests.request('first source')!;
  requests.cancel();
  assert.equal(await first.result, false);
  const second = requests.request('second source')!;
  assert.ok(second.id > first.id);
  assert.equal(requests.settle(first.id, true), false);
  assert.equal(requests.current, second);
  requests.cancel();
  assert.equal(await second.result, false);
});

test('unmount cancels pending consent and rejects work from the removed owner', async () => {
  const requests = new ConfirmationRequests<string>();
  const first = requests.request('account A')!;
  requests.dispose();
  assert.equal(await first.result, false);
  assert.equal(requests.request('after unmount'), null);
  assert.equal(requests.settle(first.id, true), false);
  requests.activate();
  const remounted = requests.request('new effect lifetime')!;
  assert.ok(remounted.id > first.id);
  assert.equal(requests.settle(first.id, true), false);
  assert.equal(requests.settle(remounted.id, true), true);
  assert.equal(await remounted.result, true);
});
