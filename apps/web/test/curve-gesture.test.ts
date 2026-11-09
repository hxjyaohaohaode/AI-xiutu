import assert from 'node:assert/strict';
import test from 'node:test';
import { createRecipeV2, type EditorRecipe } from '@ai-xiutu/editor';
import { createCurveGestureController } from '../src/editor/CurveEditor.js';

function fixture() {
  let identity = 1;
  let channel: 'rgb' | 'red' = 'rgb';
  let recipe: EditorRecipe = createRecipeV2();
  let commits = 0;
  const restores: EditorRecipe[] = [];
  const captures = new Set<number>();
  const released: number[] = [];
  let onRelease = (_id: number) => {};
  const capture = {
    setPointerCapture(id: number) {
      captures.add(id);
    },
    hasPointerCapture(id: number) {
      return captures.has(id);
    },
    releasePointerCapture(id: number) {
      captures.delete(id);
      released.push(id);
      onRelease(id);
    },
  };
  const controller = createCurveGestureController(() => ({
    sourceIdentity: identity,
    channel,
    recipe,
    preview: (value) => {
      restores.push(value);
      recipe = value;
    },
    commit: () => {
      commits += 1;
    },
  }));
  return {
    controller,
    capture,
    captures,
    released,
    restores,
    get recipe() {
      return recipe;
    },
    get commits() {
      return commits;
    },
    setRecipe: (value: EditorRecipe) => {
      recipe = value;
    },
    setSource: (value: number) => {
      identity = value;
    },
    setChannel: (value: 'rgb' | 'red') => {
      channel = value;
    },
    onRelease: (callback: (id: number) => void) => {
      onRelease = callback;
    },
  };
}

test('curve drag has one pointer owner; another finger cannot move, finish, cancel or replace it', () => {
  const f = fixture();
  assert.equal(f.controller.begin(4, 1, f.capture), true);
  assert.equal(f.controller.begin(5, 0, f.capture), false);
  assert.equal(f.controller.current(5), null);
  assert.equal(f.controller.commit(5), false);
  assert.equal(f.controller.cancel(5), false);
  assert.equal(f.controller.current(4)?.index, 1);
  assert.equal(f.controller.commit(4), true);
  assert.equal(f.commits, 1);
  assert.deepEqual(f.released, [4]);
  assert.equal(f.controller.current(4), null);
  assert.equal(f.controller.commit(4), false);
  assert.equal(f.commits, 1);
});

test('cancellation restores the starting recipe once and a late lost-capture event cannot repeat it', () => {
  const f = fixture(),
    initial = f.recipe;
  f.controller.begin(11, 1, f.capture);
  const changed = createRecipeV2({
    curves: {
      rgb: [
        [0, 0.1],
        [1, 0.9],
      ],
    },
  });
  assert.equal(f.controller.preview(11, changed), true);
  assert.equal(f.controller.cancel(11), true);
  assert.equal(f.recipe, initial);
  assert.deepEqual(f.restores, [changed, initial]);
  assert.equal(f.controller.cancel(11), false);
  assert.equal(f.controller.current(11), null);
  assert.equal(f.commits, 0);
});

test('window-level cancellation without a pointer id uses the same ownership and rollback rule', () => {
  const f = fixture(),
    initial = f.recipe;
  f.controller.begin(7, 1, f.capture);
  f.controller.preview(7, createRecipeV2({ adjustments: { exposure: 0.5 } }));
  assert.equal(f.controller.cancel(), true);
  assert.equal(f.recipe, initial);
  assert.equal(f.captures.size, 0);
  assert.equal(f.controller.cancel(), false);
});

test('source changes invalidate late move, up, cancel and lost-capture paths without writing old data', () => {
  for (const event of ['move', 'up', 'cancel'] as const) {
    const f = fixture();
    f.controller.begin(8, 1, f.capture);
    const newRecipe = createRecipeV2({ adjustments: { exposure: -1 }, effects: { fade: 8 } });
    f.setSource(2);
    f.setRecipe(newRecipe);
    if (event === 'move') assert.equal(f.controller.current(8), null);
    else if (event === 'up') f.controller.commit(8);
    else f.controller.cancel(8);
    assert.equal(f.recipe, newRecipe, event);
    assert.equal(f.commits, 0, event);
    assert.deepEqual(f.restores, [], event);
    assert.equal(f.captures.size, 0, event);
    assert.equal(f.controller.current(8), null);
    assert.equal(f.controller.begin(9, 0, f.capture), true);
  }
});

test('a changed channel cannot receive a former channel gesture or its rollback', () => {
  const f = fixture();
  f.controller.begin(10, 1, f.capture);
  f.setChannel('red');
  assert.equal(f.controller.current(10), null);
  assert.equal(f.controller.cancel(10), false);
  assert.deepEqual(f.restores, []);
  assert.equal(f.commits, 0);
  assert.equal(f.controller.begin(12, 0, f.capture), true);
  assert.equal(f.controller.current(12)?.channel, 'red');
});

test('releasePointerCapture reentrancy cannot turn a committed drag into a rollback', () => {
  const f = fixture();
  f.controller.begin(3, 1, f.capture);
  const changed = createRecipeV2({
    curves: {
      rgb: [
        [0, 0.1],
        [1, 1],
      ],
    },
  });
  f.controller.preview(3, changed);
  f.onRelease((id) => {
    assert.equal(f.controller.cancel(id), false);
  });
  assert.equal(f.controller.commit(3), true);
  assert.equal(f.recipe, changed);
  assert.equal(f.commits, 1);
  assert.deepEqual(f.restores, [changed]);
});

test('an external commit interrupts the drag so late move, commit and cancel preserve the new edit', () => {
  for (const event of ['move', 'preview', 'up', 'cancel'] as const) {
    const f = fixture();
    f.controller.begin(8, 1, f.capture);
    const owned = createRecipeV2({
      curves: {
        rgb: [
          [0, 0.1],
          [1, 0.9],
        ],
      },
    });
    f.controller.preview(8, owned);
    // Models a synchronous editor.commit/preview occurring before React has
    // re-rendered the curve component; source and selected channel are unchanged.
    const external = createRecipeV2({ ...owned, effects: { ...owned.effects, fade: 27 } });
    f.setRecipe(external);
    if (event === 'move') assert.equal(f.controller.current(8), null);
    else if (event === 'preview') assert.equal(f.controller.preview(8, owned), false);
    else if (event === 'up') f.controller.commit(8);
    else f.controller.cancel(8);
    assert.equal(f.recipe, external, event);
    assert.equal(f.commits, 0, event);
    assert.deepEqual(f.restores, [owned], event);
    assert.equal(f.captures.size, 0, event);
  }
});

test('several synchronous owned previews remain cancellable without requiring a React render', () => {
  const f = fixture(),
    base = f.recipe;
  f.controller.begin(6, 1, f.capture);
  const one = createRecipeV2({
    curves: {
      rgb: [
        [0, 0],
        [1, 0.9],
      ],
    },
  });
  const two = createRecipeV2({
    curves: {
      rgb: [
        [0, 0],
        [1, 0.8],
      ],
    },
  });
  assert.equal(f.controller.preview(6, one), true);
  assert.equal(f.controller.current(6)?.lastPreview, one);
  assert.equal(f.controller.preview(19, two), false);
  assert.equal(f.recipe, one);
  assert.equal(f.controller.preview(6, two), true);
  assert.equal(f.controller.current(6)?.lastPreview, two);
  assert.equal(f.controller.cancel(), true);
  assert.equal(f.recipe, base);
  assert.deepEqual(f.restores, [one, two, base]);
});

test('unavailable capture and explicit discard leave no dangling transaction', () => {
  const f = fixture();
  assert.equal(f.controller.begin(2, -1, f.capture), false);
  assert.equal(f.controller.begin(2, 99, f.capture), false);
  assert.equal(
    f.controller.begin(2, 1, {
      ...f.capture,
      setPointerCapture() {
        throw new Error('detached');
      },
    }),
    false,
  );
  assert.equal(f.controller.current(2), null);
  assert.equal(f.controller.begin(3, 1, f.capture), true);
  assert.equal(f.controller.discard(), true);
  assert.equal(f.controller.current(3), null);
  assert.equal(f.captures.size, 0);
  assert.equal(f.commits, 0);
  assert.deepEqual(f.restores, []);
});

test('a local curve transaction owns the whole recipe and cannot commit after its scope changes', () => {
  let scopeKey = 'region:first';
  let recipe: EditorRecipe = createRecipeV2();
  const localCurves = { ...recipe.curves, rgb: [[0, 0], [.3, .6], [1, 1]] as [number, number][] };
  let commits = 0;
  const pointers = new Set<number>();
  const capture = { setPointerCapture: (id: number) => { pointers.add(id); }, hasPointerCapture: (id: number) => pointers.has(id), releasePointerCapture: (id: number) => { pointers.delete(id); } };
  const controller = createCurveGestureController(() => ({ sourceIdentity: 1, channel: 'rgb', recipe, scopeKey, getCurves: () => localCurves, preview: (next) => { recipe = next; }, commit: () => { commits += 1; } }));
  // Point 2 exists in the local curve even though the global curve has two points.
  assert.equal(controller.begin(33, 2, capture), true);
  scopeKey = 'region:second';
  assert.equal(controller.current(33), null);
  assert.equal(controller.commit(33), false);
  assert.equal(commits, 0);
  assert.equal(pointers.size, 0);
});
