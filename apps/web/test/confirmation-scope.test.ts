import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confirmStableScope } from '../src/lib/confirmation-scope.ts';

test('confirmation never authorizes a changed actor, source, revision, recipe or document draft', async () => {
  const original = {
    actor: 'a',
    project: 'p',
    source: 1,
    version: 2,
    recipe: {},
    title: '文档',
    body: '草稿',
    generation: 1,
  };
  for (const key of Object.keys(original)) {
    let current: Record<string, unknown> = { ...original };
    const result = await confirmStableScope(
      () => current,
      async () => {
        current = { ...current, [key]: {} };
        return true;
      },
    );
    assert.equal(result, 'changed', key);
  }
  assert.equal(
    await confirmStableScope(
      () => original,
      async () => false,
    ),
    'cancelled',
  );
  assert.equal(
    await confirmStableScope(
      () => original,
      async () => true,
    ),
    'confirmed',
  );
});

test('a confirmation snapshots mutable scope records before waiting and detects owner unmount', async () => {
  const scope: Record<string, unknown> = { actor: 'a', mounted: true };
  assert.equal(
    await confirmStableScope(
      () => scope,
      async () => {
        scope.mounted = false;
        return true;
      },
    ),
    'changed',
  );
});
