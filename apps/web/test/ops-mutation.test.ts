import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpsMutationOwner } from '../src/components/ops-mutation.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('an operations write locks immediately and submits an isolated model/config/hash snapshot', async () => {
  const owner = new OpsMutationOwner();
  owner.mount();
  const pending = deferred<void>();
  const draft = {
    modelId: 'model-a',
    settings: { label: 'A', operations: ['assistant-turn'] },
    hash: 'hash-a',
  };
  let submitted: typeof draft | undefined;
  const values: string[] = [];
  let started = 0,
    settled = 0;
  const handlers = {
    current: () => true,
    started: () => {
      started++;
    },
    value: (value: string) => values.push(value),
    error: () => assert.fail('the successful write must not fail'),
    settled: () => {
      settled++;
    },
  };
  const saving = owner.run(
    draft,
    async (snapshot, current) => {
      submitted = snapshot;
      await pending.promise;
      if (current()) return snapshot.modelId;
    },
    handlers,
  );
  assert.equal(owner.busy, true, 'selection and configuration are locked before React rerenders');
  let selected = draft.modelId;
  if (!owner.busy) selected = 'model-b';
  assert.equal(selected, 'model-a', 'a pending save cannot change the selected model owner');
  const duplicate = await owner.run(draft, async () => assert.fail('no second write'), handlers);
  assert.equal(duplicate, false);
  draft.modelId = 'model-b';
  draft.settings.label = 'B';
  draft.settings.operations.push('realtime-voice');
  draft.hash = 'hash-b';
  assert.deepEqual(submitted, {
    modelId: 'model-a',
    settings: { label: 'A', operations: ['assistant-turn'] },
    hash: 'hash-a',
  });
  pending.resolve();
  assert.equal(await saving, true);
  assert.deepEqual(values, ['model-a']);
  assert.equal(started, 1);
  assert.equal(settled, 1);
  assert.equal(owner.busy, false);
});

test('a changed form owner prevents post-save reads and cannot receive another model hash', async () => {
  const owner = new OpsMutationOwner();
  owner.mount();
  const pending = deferred<void>();
  let selected = 'model-a';
  let reads = 0,
    settled = 0;
  const form = { modelId: 'model-b', settings: 'B', hash: 'hash-b' };
  const saving = owner.run(
    { modelId: selected },
    async (snapshot, current) => {
      await pending.promise;
      if (!current()) return;
      reads++;
      return { modelId: snapshot.modelId, settings: 'A', hash: 'hash-a-new' };
    },
    {
      current: () => selected === 'model-a',
      started() {},
      value: (value) => Object.assign(form, value),
      error: () => assert.fail('a superseded owner cannot show an error'),
      settled: () => {
        settled++;
      },
    },
  );
  selected = 'model-b'; // A separate lifecycle change, even if normal UI controls are disabled.
  pending.resolve();
  await saving;
  assert.equal(reads, 0);
  assert.deepEqual(form, { modelId: 'model-b', settings: 'B', hash: 'hash-b' });
  assert.equal(settled, 1);
});

test('a draft changed during the post-save read rejects its old result without mixing config and hash', async () => {
  const owner = new OpsMutationOwner();
  owner.mount();
  const reading = deferred<{ modelId: string; settings: string; hash: string }>();
  let draftVersion = 1;
  const form = { modelId: 'model-a', settings: 'new local edit', hash: 'hash-a' };
  const saving = owner.run({ modelId: 'model-a' }, async () => reading.promise, {
    current: () => draftVersion === 1,
    started() {},
    value: (value) => Object.assign(form, value),
    error: () => assert.fail('no current failure'),
    settled() {},
  });
  draftVersion++;
  reading.resolve({ modelId: 'model-a', settings: 'old saved edit', hash: 'hash-a-new' });
  await saving;
  assert.deepEqual(form, { modelId: 'model-a', settings: 'new local edit', hash: 'hash-a' });
});

test('unmount and remount invalidate an old write without releasing or updating a new account owner', async () => {
  const owner = new OpsMutationOwner();
  owner.mount();
  const first = deferred<void>(),
    second = deferred<void>();
  const events: string[] = [];
  const handlers = (name: string) => ({
    current: () => true,
    started: () => events.push(`${name}:start`),
    value: () => events.push(`${name}:value`),
    error: () => events.push(`${name}:error`),
    settled: () => events.push(`${name}:settled`),
  });
  const old = owner.run(
    'account-a',
    async (_, current) => {
      await first.promise;
      if (!current()) return;
      events.push('account-a:reread');
      return true;
    },
    handlers('account-a'),
  );
  owner.unmount();
  owner.mount();
  const next = owner.run(
    'account-b',
    async () => {
      await second.promise;
      return true;
    },
    handlers('account-b'),
  );
  first.resolve();
  await old;
  assert.equal(owner.busy, true, 'old finally must not unlock the new write');
  assert.deepEqual(events, ['account-a:start', 'account-b:start']);
  second.resolve();
  await next;
  assert.deepEqual(events, [
    'account-a:start',
    'account-b:start',
    'account-b:value',
    'account-b:settled',
  ]);
  assert.equal(owner.busy, false);
});

test('a current write failure stays visible, while an unmounted late failure does not publish or retry', async () => {
  const owner = new OpsMutationOwner();
  owner.mount();
  const failure = new Error('configuration changed');
  const errors: unknown[] = [];
  let settled = 0,
    writes = 0;
  const handlers = {
    current: () => true,
    started() {},
    value: () => assert.fail('failed writes cannot publish success'),
    error: (error: unknown) => errors.push(error),
    settled: () => {
      settled++;
    },
  };
  await owner.run(
    null,
    async () => {
      writes++;
      throw failure;
    },
    handlers,
  );
  assert.deepEqual(errors, [failure]);
  assert.equal(owner.busy, false);
  assert.equal(settled, 1);
  const pending = deferred<void>();
  const saving = owner.run(
    null,
    async () => {
      writes++;
      await pending.promise;
    },
    handlers,
  );
  owner.unmount();
  pending.reject(new Error('late response'));
  await saving;
  assert.deepEqual(errors, [failure]);
  assert.equal(settled, 1);
  assert.equal(writes, 2, 'ownership cancellation must never automatically repeat a write');
});
