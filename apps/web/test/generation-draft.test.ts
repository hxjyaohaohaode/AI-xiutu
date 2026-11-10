import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { AssetCopyRecord } from '@ai-xiutu/contracts';
import type { Asset } from '../src/lib/types.ts';
import { ConfirmationRequests } from '../src/components/ConfirmationDialog.tsx';
import {
  prepareGenerationDraft,
  type PreparedGenerationDraft,
  type ReferenceCopyJournal,
} from '../src/components/generationDraft.ts';

const target = randomUUID();
const foreign = randomUUID();
const asset = (id: string, projectId = target): Asset => ({
  id,
  projectId,
  name: id,
  mime: 'image/png',
  width: 40,
  height: 30,
  bytes: 120,
  url: `/v1/assets/${id}/file`,
});
const receipt = (sourceId: string, destination: Asset) => ({
  asset: destination,
  copy: {
    id: randomUUID(),
    sourceAssetId: sourceId,
    sourceProjectId: foreign,
    targetProjectId: target,
    copiedAssetId: destination.id,
    createdAt: '2026-11-10T00:00:00.000Z',
  } satisfies AssetCopyRecord,
});
const input = (references: string[]) => ({
  candidateId: randomUUID(),
  prompt: '保留两张参考图的构图与光线',
  referenceAssetIds: references,
});
function harness(projectAssets: Asset[] = []) {
  const journal: ReferenceCopyJournal = new Map();
  const ready: Asset[] = [];
  const committed: PreparedGenerationDraft[] = [];
  return {
    ready,
    committed,
    journal,
    options: {
      actorScope: 'test-actor',
      projectId: target,
      journal,
      loadProjectAssets: async () => projectAssets,
      copyAsset: async (_sourceId: string, _key: string): Promise<ReturnType<typeof receipt>> => {
        throw new Error('Unexpected copy');
      },
      makeId: (_sourceId: string) => randomUUID(),
      confirmCopy: (_count: number): boolean | Promise<boolean> => {
        throw new Error('Unexpected confirmation');
      },
      assertCurrent: () => {},
      onAssetReady: (value: Asset) => ready.push(value),
      commit: (value: PreparedGenerationDraft) => committed.push(value),
    },
  };
}

test('generation handoff reads authoritative project assets, preserves order and duplicates, and commits only on demand', async () => {
  const first = asset(randomUUID());
  const second = asset(randomUUID());
  const h = harness([first, second]);
  const draft = input([second.id, first.id, second.id]);
  const commit = await prepareGenerationDraft(draft, h.options);
  assert.equal(h.committed.length, 0);
  assert.equal(h.journal.size, 0);
  assert.deepEqual(
    h.ready.map((value) => value.id),
    [second.id, first.id],
  );
  draft.prompt = 'changed after preparation';
  draft.referenceAssetIds.length = 0;
  commit!();
  commit!();
  assert.equal(h.committed.length, 1);
  assert.deepEqual(h.committed[0]!.referenceAssetIds, [second.id, first.id, second.id]);
  assert.equal(h.committed[0]!.prompt, '保留两张参考图的构图与光线');
});

test('cross-project references are explicitly confirmed, copied with distinct keys, and fully mapped to actual receipts', async () => {
  const direct = asset(randomUUID());
  const a = randomUUID(),
    b = randomUUID();
  const copies = new Map([
    [a, asset(randomUUID())],
    [b, asset(randomUUID())],
  ]);
  const h = harness([direct]);
  const requests: { id: string; key: string }[] = [];
  const confirmations: number[] = [];
  h.options.confirmCopy = (count) => {
    confirmations.push(count);
    return true;
  };
  h.options.copyAsset = async (id, key) => {
    requests.push({ id, key });
    return receipt(id, copies.get(id)!);
  };
  const commit = await prepareGenerationDraft(input([a, direct.id, b, a]), h.options);
  assert.deepEqual(confirmations, [2]);
  assert.deepEqual(
    requests.map((value) => value.id),
    [a, b],
  );
  assert.equal(new Set(requests.map((value) => value.key)).size, 2);
  assert.equal(h.ready.length, 3);
  assert.equal(h.committed.length, 0);
  commit!();
  assert.deepEqual(h.committed[0]!.referenceAssetIds, [
    copies.get(a)!.id,
    direct.id,
    copies.get(b)!.id,
    copies.get(a)!.id,
  ]);
  assert.equal(h.committed[0]!.referenceAssets.length, 4);
});

test('canceling cross-project preparation sends no copy and leaves the composer untouched', async () => {
  const h = harness();
  let confirmations = 0;
  h.options.confirmCopy = () => {
    confirmations++;
    return false;
  };
  const commit = await prepareGenerationDraft(input([randomUUID()]), h.options);
  assert.equal(commit, null);
  assert.equal(confirmations, 1);
  assert.equal(h.journal.size, 0);
  assert.equal(h.ready.length, 0);
  assert.equal(h.committed.length, 0);
});

test('consent after the editing scope changes cannot start a reference copy', async () => {
  const h = harness();
  const confirmations = new ConfirmationRequests<number>();
  let active = true;
  let show!: () => void;
  const shown = new Promise<void>((resolve) => {
    show = resolve;
  });
  let copies = 0;
  h.options.assertCurrent = () => {
    if (!active) throw new Error('作品、来源或草稿已变化');
  };
  h.options.confirmCopy = (count) => {
    const question = confirmations.request(count)!;
    show();
    return question.result;
  };
  h.options.copyAsset = async (sourceId) => {
    copies++;
    return receipt(sourceId, asset(randomUUID()));
  };
  const pending = prepareGenerationDraft(input([randomUUID()]), h.options);
  await shown;
  active = false;
  confirmations.settle(confirmations.current!.id, true);
  await assert.rejects(pending, /作品、来源或草稿已变化/);
  assert.equal(copies, 0);
  assert.equal(h.journal.size, 0);
  assert.equal(h.ready.length, 0);
  assert.equal(h.committed.length, 0);
});

test('partial failure keeps completed copies and reuses the exact key for an unknown request instead of dropping a reference', async () => {
  const a = randomUUID(),
    b = randomUUID();
  const copiedA = asset(randomUUID()),
    copiedB = asset(randomUUID());
  const serverAssets: Asset[] = [];
  const h = harness(serverAssets);
  const requests: { id: string; key: string }[] = [];
  let fail = true;
  h.options.confirmCopy = () => true;
  h.options.copyAsset = async (id, key) => {
    requests.push({ id, key });
    if (id === a) {
      serverAssets.push(copiedA);
      return receipt(a, copiedA);
    }
    if (fail) {
      fail = false;
      throw new Error('The response was lost');
    }
    serverAssets.push(copiedB);
    return receipt(b, copiedB);
  };
  const draft = input([a, b]);
  await assert.rejects(
    prepareGenerationDraft(draft, h.options),
    /本次已确认的 1 张副本.*The response was lost/,
  );
  assert.equal(h.committed.length, 0);
  assert.deepEqual(
    h.ready.map((value) => value.id),
    [copiedA.id],
  );
  const commit = await prepareGenerationDraft(draft, h.options);
  assert.deepEqual(
    requests.map((value) => value.id),
    [a, b, b],
  );
  assert.equal(requests[1]!.key, requests[2]!.key);
  commit!();
  assert.deepEqual(h.committed[0]!.referenceAssetIds, [copiedA.id, copiedB.id]);
});

test('a permission or storage error stops preparation without fallback upload, partial commit, or omission', async () => {
  const h = harness();
  let requests = 0;
  h.options.confirmCopy = () => true;
  h.options.copyAsset = async () => {
    requests++;
    throw new Error('来源空间不允许复制');
  };
  await assert.rejects(
    prepareGenerationDraft(input([randomUUID(), randomUUID()]), h.options),
    /来源空间不允许复制/,
  );
  assert.equal(requests, 1);
  assert.equal(h.committed.length, 0);
  assert.equal(h.ready.length, 0);
  assert.equal(h.journal.size, 1);
  assert.equal([...h.journal.values()][0]!.copiedAssetId, undefined);
});

test('a late acknowledged copy is journaled but cannot switch a different project or panel', async () => {
  const sourceId = randomUUID(),
    destination = asset(randomUUID());
  const h = harness();
  let active = true;
  h.options.assertCurrent = () => {
    if (!active) throw new Error('项目已变化');
  };
  h.options.confirmCopy = () => true;
  h.options.copyAsset = async () => {
    active = false;
    return receipt(sourceId, destination);
  };
  await assert.rejects(prepareGenerationDraft(input([sourceId]), h.options), /项目已变化/);
  assert.equal([...h.journal.values()][0]!.copiedAssetId, destination.id);
  assert.equal(h.ready.length, 0);
  assert.equal(h.committed.length, 0);
});

test('mismatched copy receipts are rejected before becoming visible or selected', async () => {
  const sourceId = randomUUID();
  for (const mutation of ['source', 'target', 'asset'] as const) {
    const h = harness();
    h.options.confirmCopy = () => true;
    h.options.copyAsset = async () => {
      const value = receipt(sourceId, asset(randomUUID()));
      if (mutation === 'source') value.copy.sourceAssetId = randomUUID();
      if (mutation === 'target') value.copy.targetProjectId = foreign;
      if (mutation === 'asset') value.asset.projectId = foreign;
      return value;
    };
    await assert.rejects(
      prepareGenerationDraft(input([sourceId]), h.options),
      /复制回执与来源或目标项目不一致/,
    );
    assert.equal(h.ready.length, 0);
    assert.equal(h.committed.length, 0);
    assert.equal([...h.journal.values()][0]!.copiedAssetId, undefined);
  }
});

test('failed candidate decision leaves a prepared draft unapplied; retry reuses the confirmed copy and guards final context', async () => {
  const sourceId = randomUUID(),
    copied = asset(randomUUID());
  const serverAssets: Asset[] = [];
  const h = harness(serverAssets);
  let copyCalls = 0,
    active = true;
  h.options.assertCurrent = () => {
    if (!active) throw new Error('面板已切换');
  };
  h.options.confirmCopy = () => true;
  h.options.copyAsset = async () => {
    copyCalls++;
    serverAssets.push(copied);
    return receipt(sourceId, copied);
  };
  const draft = input([sourceId]);
  await prepareGenerationDraft(draft, h.options); // Candidate POST fails; commit is deliberately not called.
  assert.equal(h.committed.length, 0);
  const commit = await prepareGenerationDraft(draft, h.options);
  assert.equal(copyCalls, 1);
  active = false;
  assert.throws(() => commit!(), /面板已切换/);
  assert.equal(h.committed.length, 0);
});

test('a draft without references needs neither project file listing nor copy consent', async () => {
  const h = harness();
  h.options.loadProjectAssets = async () => {
    throw new Error('Should not load unrelated assets');
  };
  const commit = await prepareGenerationDraft(input([]), h.options);
  assert.equal(h.committed.length, 0);
  commit!();
  assert.deepEqual(h.committed[0]!.referenceAssetIds, []);
  assert.deepEqual(h.committed[0]!.referenceAssets, []);
});
