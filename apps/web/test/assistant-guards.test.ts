import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AssistantCandidate } from '@ai-xiutu/contracts';
import { createRecipeV4, type EditorRecipe } from '@ai-xiutu/editor';
import {
  acknowledgeEditCandidate,
  assistantEditorKey,
  assistantScopeKey,
  AssistantOperationGate,
  type AssistantEditorState,
} from '../src/ai/assistantGuards.ts';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const state = (): AssistantEditorState => ({
  loggedIn: true,
  projectId: 'project-a',
  spaceId: 'space-a',
  artworkId: 'artwork-a',
  assetId: 'asset-a',
  version: 3,
  recipe: createRecipeV4(),
});
const candidate = (value: AssistantEditorState): AssistantCandidate => ({
  id: 'candidate-a',
  kind: 'edit',
  summary: 'Adjust exposure',
  artworkId: value.artworkId,
  baseVersion: value.version,
  baseRecipeHash: 'server-owned-hash',
  baseRecipe: structuredClone(value.recipe),
  recipe: createRecipeV4({ adjustments: { exposure: -0.7 } }),
  decision: 'pending',
});

test('request ownership survives a late finally after scope switch, cancellation and a new operation', () => {
  const gate = new AssistantOperationGate();
  gate.setScope('account-a/project-a');
  const old = gate.begin()!;
  assert.equal(gate.begin(), null);
  gate.setScope('account-b/project-b');
  const fresh = gate.begin()!;
  assert.equal(gate.finish(old), false);
  assert.equal(gate.owns(fresh), true);
  gate.invalidate();
  const restarted = gate.begin()!;
  assert.equal(gate.finish(fresh), false);
  assert.equal(gate.owns(restarted), true);
  assert.equal(gate.finish(restarted), true);
  assert.equal(gate.busy, false);
});

test('a project A → B → A transition never revives an earlier operation', () => {
  const gate = new AssistantOperationGate();
  gate.setScope('a');
  const token = gate.begin()!;
  gate.setScope('b');
  gate.setScope('a');
  assert.equal(gate.owns(token), false);
  const replacement = gate.begin()!;
  assert.equal(gate.finish(token), false);
  assert.equal(gate.owns(replacement), true);
});

test('a late resource search cannot replace a newer result or release its ownership', async () => {
  const gate = new AssistantOperationGate();
  gate.setScope('project-a/spaces-a/query');
  const first = deferred<string[]>(),
    second = deferred<string[]>();
  let visible: string[] = [];
  async function search(result: Promise<string[]>) {
    const token = gate.beginLatest();
    try {
      const resources = await result;
      if (gate.owns(token)) visible = resources;
    } finally {
      gate.finish(token);
    }
  }
  const a = search(first.promise),
    b = search(second.promise);
  first.resolve(['old private result']);
  await a;
  assert.equal(gate.busy, true);
  assert.deepEqual(visible, []);
  second.resolve(['new result']);
  await b;
  assert.deepEqual(visible, ['new result']);
  assert.equal(gate.busy, false);
});

test('changing search project, authorization or selected space invalidates its pending result', async () => {
  for (const newScope of ['project-b/spaces-a/query', 'signed-out', 'project-a/spaces-b/query']) {
    const gate = new AssistantOperationGate();
    gate.setScope('project-a/spaces-a/query');
    const token = gate.beginLatest(),
      response = deferred<string[]>();
    let visible: string[] = [];
    const pending = response.promise.then((items) => {
      if (gate.owns(token)) visible = items;
    });
    gate.setScope(newScope);
    response.resolve(['stale']);
    await pending;
    assert.deepEqual(visible, []);
  }
});

test('late edit acknowledgement rejects every changed identity or recipe before invoking preview', async () => {
  const changes: [string, (value: AssistantEditorState) => void][] = [
    [
      'project',
      (value) => {
        value.projectId = 'project-b';
      },
    ],
    [
      'space',
      (value) => {
        value.spaceId = 'space-b';
      },
    ],
    [
      'authentication',
      (value) => {
        value.loggedIn = false;
      },
    ],
    [
      'artwork',
      (value) => {
        value.artworkId = 'artwork-b';
      },
    ],
    [
      'source asset',
      (value) => {
        value.assetId = 'asset-b';
      },
    ],
    [
      'server head',
      (value) => {
        value.version++;
      },
    ],
    [
      'local recipe',
      (value) => {
        value.recipe.adjustments.contrast = 14;
      },
    ],
  ];
  for (const [name, change] of changes) {
    const current = state(),
      receipt = deferred();
    let applied = 0;
    const pending = acknowledgeEditCandidate(candidate(current), {
      readCurrent: () => current,
      isActive: () => true,
      acknowledge: () => receipt.promise,
      apply: () => {
        applied++;
      },
    });
    change(current);
    receipt.resolve();
    await assert.rejects(pending, /等待期间发生变化/, name);
    assert.equal(applied, 0, name);
  }
});

test('scope cancellation suppresses an acknowledged edit and cannot release a newer request', async () => {
  const current = state(),
    receipt = deferred(),
    gate = new AssistantOperationGate();
  gate.setScope(assistantScopeKey(current));
  const token = gate.begin()!;
  let applied = 0;
  const pending = acknowledgeEditCandidate(candidate(current), {
    readCurrent: () => current,
    isActive: () => gate.owns(token),
    acknowledge: () => receipt.promise,
    apply: () => {
      applied++;
    },
  }).finally(() => {
    gate.finish(token);
  });
  gate.invalidate();
  const next = gate.begin()!;
  receipt.resolve();
  assert.equal(await pending, false);
  assert.equal(applied, 0);
  assert.equal(gate.owns(next), true);
});

test('equivalent normalized recipes can preview after acknowledgement despite object key order', async () => {
  const current = state(),
    proposal = candidate(current);
  const before = assistantEditorKey(current);
  current.recipe = Object.fromEntries(
    Object.entries(current.recipe).reverse(),
  ) as unknown as EditorRecipe;
  assert.equal(assistantEditorKey(current), before);
  const events: string[] = [];
  const applied = await acknowledgeEditCandidate(proposal, {
    readCurrent: () => current,
    isActive: () => true,
    acknowledge: async (body) => {
      events.push('acknowledged');
      assert.equal(body.expectedVersion, 3);
      assert.equal(body.recipe.schemaVersion, 4);
    },
    apply: (recipe) => {
      events.push('preview');
      assert.equal(recipe.adjustments.exposure, -0.7);
    },
  });
  assert.equal(applied, true);
  assert.deepEqual(events, ['acknowledged', 'preview']);
});

test('wrong base or rejected network acknowledgement never applies an edit', async () => {
  const current = state();
  let calls = 0,
    applied = 0;
  const wrong = candidate(current);
  wrong.baseVersion = 2;
  const options = {
    readCurrent: () => current,
    isActive: () => true,
    acknowledge: async () => {
      calls++;
      throw new Error('response unavailable');
    },
    apply: () => {
      applied++;
    },
  };
  await assert.rejects(acknowledgeEditCandidate(wrong, options), /图片或参数已经变化/);
  assert.equal(calls, 0);
  await assert.rejects(
    acknowledgeEditCandidate(candidate(current), options),
    /response unavailable/,
  );
  assert.equal(calls, 1);
  assert.equal(applied, 0);
});
