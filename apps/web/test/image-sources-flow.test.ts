import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecipeV3 } from '@ai-xiutu/editor';
import { assertRevisionSourceBinding, createSourceLoadGuard } from '../src/editor/source-flow.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('late image download cannot overwrite edits made while its network request was pending', async () => {
  let state = { context: 1, source: 4, recipe: createRecipeV3() };
  const guard = createSourceLoadGuard(() => state);
  const network = deferred();
  let committed = false;
  const load = (async () => {
    await network.promise;
    if (!guard.isCurrent()) return;
    committed = true;
  })();
  state = { ...state, recipe: createRecipeV3({ adjustments: { exposure: -0.3 } }) };
  network.resolve();
  await load;
  assert.equal(guard.status(), 'edited');
  assert.equal(committed, false);
  assert.equal(state.recipe.adjustments.exposure, -0.3);
});

test('late referenced-layer decoding stops after project switch even if the same recipe is selected', async () => {
  let state = { context: 5, source: 7, recipe: createRecipeV3() };
  const guard = createSourceLoadGuard(() => state);
  const firstLayer = deferred();
  const decoded: string[] = [];
  let committed = false;
  const load = (async () => {
    for (const id of ['first', 'second']) {
      if (!guard.isCurrent()) return;
      if (id === 'first') await firstLayer.promise;
      decoded.push(id);
    }
    if (guard.isCurrent()) committed = true;
  })();
  state = { ...state, context: 6 };
  firstLayer.resolve();
  await load;
  assert.equal(guard.status(), 'superseded');
  assert.deepEqual(decoded, ['first']);
  assert.equal(committed, false);
});

test('unchanged request may commit while changed source identity cancels an otherwise identical recipe', () => {
  let state = { context: 2, source: 2, recipe: createRecipeV3() };
  const guard = createSourceLoadGuard(() => state);
  assert.equal(guard.isCurrent(), true);
  state = { ...state, source: 3 };
  assert.equal(guard.isCurrent(), false);
  assert.equal(guard.status(), 'edited');
});

test('history binding resolves the old immutable source and rejects the current source or foreign project', () => {
  const old = {
    artworkId: 'artwork',
    projectId: 'project',
    revision: { artworkId: 'artwork', assetId: 'old-source' },
    asset: { id: 'old-source', projectId: 'project' },
  };
  assert.doesNotThrow(() => assertRevisionSourceBinding(old));
  assert.throws(
    () =>
      assertRevisionSourceBinding({
        ...old,
        asset: { id: 'new-head-source', projectId: 'project' },
      }),
    /不匹配/,
  );
  assert.throws(
    () =>
      assertRevisionSourceBinding({
        ...old,
        asset: { id: 'old-source', projectId: 'other-project' },
      }),
    /不匹配/,
  );
  assert.throws(
    () =>
      assertRevisionSourceBinding({
        ...old,
        revision: { artworkId: 'other-artwork', assetId: 'old-source' },
      }),
    /不匹配/,
  );
});
