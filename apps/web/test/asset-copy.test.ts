import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assetCopyAttempt, sourcePersistenceRoute } from '../src/lib/asset-copy';

test('cloud sources retain their copy policy across project changes and cannot become local uploads', () => {
  const cloudSource = randomUUID();
  const sourceProject = randomUUID();
  const targetProject = randomUUID();
  assert.equal(sourcePersistenceRoute(cloudSource, sourceProject, sourceProject), 'reuse');
  assert.equal(sourcePersistenceRoute(cloudSource, sourceProject, targetProject), 'copy');
  // Losing a device-side owner cache is not permission to upload downloaded cloud bytes.
  assert.equal(sourcePersistenceRoute(cloudSource, undefined, targetProject), 'copy');
  assert.equal(sourcePersistenceRoute(`local-${randomUUID()}`, undefined, targetProject), 'upload');
  for (const unknown of ['https://example.invalid/private.png', '../image', '', 'untracked']) {
    assert.throws(() => sourcePersistenceRoute(unknown, undefined, targetProject), /来源标识/);
  }
});

test('a lost copy response preserves one request identity while actor, source and destination are isolated', () => {
  const actor = randomUUID();
  const source = randomUUID();
  const target = randomUUID();
  const stored = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return stored.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      stored.set(key, value);
    },
  };
  let allocations = 0;
  const makeUuid = () => {
    allocations++;
    return randomUUID();
  };
  const first = assetCopyAttempt(actor, source, target, storage, makeUuid);
  const retry = assetCopyAttempt(actor, source, target, storage, makeUuid);
  assert.deepEqual(retry, first);
  assert.equal(allocations, 1);
  assert.equal(first.targetProjectId, target);
  assert.equal(stored.size, 1);
  const otherActor = assetCopyAttempt(randomUUID(), source, target, storage, makeUuid);
  const otherSource = assetCopyAttempt(actor, randomUUID(), target, storage, makeUuid);
  const otherTarget = assetCopyAttempt(actor, source, randomUUID(), storage, makeUuid);
  assert.equal(
    new Set([first, otherActor, otherSource, otherTarget].map((value) => value.idempotencyKey))
      .size,
    4,
  );
});

test('persisted valid identities recover after a reload; corrupt or unavailable session storage fails safely', () => {
  const saved = randomUUID();
  const restored = assetCopyAttempt(
    randomUUID(),
    randomUUID(),
    randomUUID(),
    {
      getItem() {
        return saved;
      },
      setItem() {},
    },
    () => {
      throw new Error('must reuse committed attempt');
    },
  );
  assert.equal(restored.idempotencyKey, saved);

  const fresh = randomUUID();
  const repaired = assetCopyAttempt(
    randomUUID(),
    randomUUID(),
    randomUUID(),
    {
      getItem() {
        return 'malformed-record';
      },
      setItem() {
        throw new Error('private mode');
      },
    },
    () => fresh,
  );
  assert.equal(repaired.idempotencyKey, fresh);

  const actor = randomUUID(),
    source = randomUUID(),
    target = randomUUID();
  const unavailable = {
    getItem(): string | null {
      throw new Error('private mode');
    },
    setItem() {
      throw new Error('private mode');
    },
  };
  const first = assetCopyAttempt(actor, source, target, unavailable);
  const second = assetCopyAttempt(actor, source, target, unavailable, () => {
    throw new Error('memory retry must not change identity');
  });
  assert.deepEqual(second, first);
});
