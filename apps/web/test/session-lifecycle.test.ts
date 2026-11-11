import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionFence } from '../src/account/session-lifecycle';

test('a delayed boot or membership response cannot replace an explicitly accepted account', () => {
  const fence = new SessionFence();
  const boot = fence.read()!;
  fence.replace('alice');
  assert.equal(fence.acceptRead(boot, null), false);
  const membership = fence.read()!;
  fence.replace('bob');
  assert.equal(fence.acceptRead(membership, 'alice'), false);
  assert.equal(fence.snapshot().actor, 'bob');
});

test('only the newest session observation commits; same-actor membership preserves auth intent', () => {
  const fence = new SessionFence();
  fence.replace('alice');
  const authIntent = fence.snapshot();
  const older = fence.read()!;
  const current = fence.read()!;
  assert.equal(fence.acceptRead(older, null), false);
  assert.equal(fence.acceptRead(current, 'alice'), true);
  assert.equal(fence.isCurrent(authIntent), true);
  assert.equal(fence.acceptRead(current, 'alice'), false);
});

test('logout has a single owner and prevents background reads from restoring a stale session', () => {
  const fence = new SessionFence();
  fence.replace('alice');
  const background = fence.read()!;
  const logout = fence.beginLogout()!;
  assert.equal(fence.beginLogout(), null);
  assert.equal(fence.read(), null);
  assert.equal(fence.acceptRead(background, 'alice'), false);
  assert.equal(fence.finishLogout(logout, null), true);
  assert.equal(fence.releaseLogout(logout), false);
  assert.equal(fence.snapshot().actor, null);
});

test('unknown logout may retain the confirmed account; old completion never clears a newer one', () => {
  const fence = new SessionFence();
  fence.replace('alice');
  const unknown = fence.beginLogout()!;
  assert.equal(fence.releaseLogout(unknown), true);
  assert.equal(fence.snapshot().actor, 'alice');
  const retry = fence.beginLogout()!;
  fence.replace('bob');
  assert.equal(fence.finishLogout(retry, null), false);
  assert.equal(fence.releaseLogout(retry), false);
  assert.equal(fence.snapshot().actor, 'bob');
});

test('opening auth supersedes an old observation without inventing a new identity', () => {
  const fence = new SessionFence();
  const boot = fence.read()!;
  fence.invalidateReads();
  assert.equal(fence.acceptRead(boot, 'alice'), false);
  assert.equal(fence.snapshot().actor, null);
});

test('a confirmed reset session observation renews the same form owner before returning to login', () => {
  const fence = new SessionFence();
  fence.replace('alice');
  let formOwner = fence.snapshot();
  fence.invalidateReads();
  const resetObservation = fence.read()!;
  assert.equal(fence.acceptRead(resetObservation, null), true);
  assert.equal(fence.isCurrent(formOwner), false, 'the old form snapshot is no longer valid');
  // App must do this synchronously with acceptance, before another login callback.
  formOwner = fence.snapshot();
  assert.equal(fence.isCurrent(formOwner), true);
  fence.replace('alice');
  assert.equal(fence.acceptRead(resetObservation, null), false);
  assert.equal(fence.snapshot().actor, 'alice', 'an old reset read cannot undo the new login');
});
