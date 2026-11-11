import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DocumentDraftStore,
  isDocumentSaveReceipt,
  projectDocumentsFromResponse,
  serializeDocumentDraft,
  type DocumentDraftInput,
} from '../src/account/document-drafts';

const base = {
  id: 'document-a',
  title: '云端标题',
  body: '原始正文',
  version: 3,
  updatedAt: '2026-11-10T10:00:00Z',
};
const input = (overrides: Partial<DocumentDraftInput> = {}): DocumentDraftInput => ({
  actorId: 'actor-a',
  projectId: 'project-a',
  projectTitle: '项目',
  base,
  title: '  未保存标题  ',
  body: '第一行\r\n第二行\n\n表情 🧑🏽‍🎨 与空格  ',
  ...overrides,
});
function put(store: DocumentDraftStore, value: DocumentDraftInput = input()) {
  const result = store.put(value);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Draft capture failed');
  return result.draft;
}

test('page-memory capture keeps exact text and a frozen original version for explicit recovery', () => {
  const store = new DocumentDraftStore(24, () => 1000);
  const original = { ...base };
  const captured = put(store, input({ base: original }));
  original.version = 9;
  original.body = '外部对象已更新';
  assert.equal(
    store.get('actor-a', 'project-a'),
    captured,
    'Snapshots remain stable between writes',
  );
  assert.equal(captured.base?.version, 3);
  assert.equal(captured.base?.body, '原始正文');
  assert.equal(captured.title, input().title);
  assert.equal(captured.body, input().body);
  assert.equal(captured.capturedAt, 1000);
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(captured.base));
});

test('the same project cannot expose a retained draft to a signed-out or different actor', () => {
  const store = new DocumentDraftStore();
  put(store);
  assert.equal(store.get(null, 'project-a'), null);
  assert.equal(store.get('actor-b', 'project-a'), null);
  assert.equal(store.get('actor-a', 'project-b'), null);
  assert.equal(store.count(), 1);
  assert.equal(store.count(null), 0);
  assert.equal(store.count('actor-b'), 0);
  assert.equal(store.count('actor-a'), 1);
  assert.equal(
    store.list('actor-a'),
    store.list('actor-a'),
    'Actor list snapshots must be stable between writes',
  );
  assert.deepEqual(store.list('actor-b'), []);
  assert.deepEqual(store.list(null), []);
  assert.ok(Object.isFrozen(store.list('actor-a')));
});

test('explicit actor cleanup leaves every other actor intact and notifies presence subscribers', () => {
  const store = new DocumentDraftStore();
  let events = 0;
  const unsubscribe = store.subscribe(() => {
    events++;
  });
  put(store);
  put(store, input({ projectId: 'project-b' }));
  const other = put(store, input({ actorId: 'actor-b' }));
  store.clearActor('actor-a');
  assert.equal(store.count('actor-a'), 0);
  assert.equal(store.count(), 1);
  assert.equal(store.get('actor-b', 'project-a'), other);
  assert.equal(events, 4);
  store.clearActor('actor-a');
  assert.equal(events, 4, 'A no-op cleanup does not publish a phantom change');
  unsubscribe();
  store.clearActor('actor-b');
  assert.equal(events, 4);
});

test('a confirmation based on an old draft cannot discard a newer keystroke', () => {
  const store = new DocumentDraftStore();
  const before = put(store);
  const after = put(store, input({ body: '最后输入的字' }));
  assert.equal(store.remove('actor-a', 'project-a', before.revision), false);
  assert.equal(store.get('actor-a', 'project-a'), after);
  assert.equal(store.remove('actor-a', 'project-a', after.revision), true);
  assert.equal(store.count(), 0);
});

test('capacity refuses a new project without evicting existing work or blocking its further edits', () => {
  const store = new DocumentDraftStore(2);
  const first = put(store);
  put(store, input({ projectId: 'project-b' }));
  assert.deepEqual(store.put(input({ projectId: 'project-c' })), { ok: false, reason: 'capacity' });
  assert.equal(store.get('actor-a', 'project-a'), first);
  const updated = put(store, input({ body: '容量已满时继续编辑已有草稿' }));
  assert.equal(store.count(), 2);
  assert.equal(store.remove('actor-a', 'project-a', updated.revision), true);
  put(store, input({ projectId: 'project-c' }));
  assert.equal(store.count(), 2);
});

test('oversized or invalid drafts leave the previous complete recovery record untouched', () => {
  const store = new DocumentDraftStore();
  const original = put(store);
  for (const patch of [
    { title: 'a'.repeat(121) },
    { body: 'a'.repeat(100001) },
    { actorId: '' },
    { base: { ...base, version: 0 } },
  ])
    assert.deepEqual(store.put(input(patch)), { ok: false, reason: 'invalid' });
  assert.equal(store.get('actor-a', 'project-a'), original);
});

test('a real save acknowledges submitted text while preserving text typed in flight against its new base', () => {
  const store = new DocumentDraftStore();
  const submitted = put(store, input({ title: '已提交的标题', body: '已提交的正文' }));
  assert.equal(store.beginSave(submitted), true);
  put(store, input({ title: '已提交的标题', body: '发送期间继续输入' }));
  const saved = { ...base, title: '已提交的标题', body: '已提交的正文', version: 4 };
  assert.equal(store.acknowledgeSave(submitted, saved), 'retained');
  const current = store.get('actor-a', 'project-a')!;
  assert.equal(current.body, '发送期间继续输入');
  assert.equal(current.base?.version, 4);
  assert.equal(current.lineage, submitted.lineage);
  assert.equal(store.beginSave(current), true);
  assert.equal(
    store.acknowledgeSave(current, { ...saved, body: current.body, version: 5 }),
    'cleared',
  );
  assert.equal(store.count(), 0);
});

test('a late save cannot resurrect a draft cleared at logout or clear a newly created editing lineage', () => {
  const store = new DocumentDraftStore();
  const old = put(store);
  assert.equal(store.beginSave(old), true);
  const saved = { ...base, title: old.title.trim(), body: old.body, version: 4 };
  store.clearActor('actor-a');
  assert.equal(store.acknowledgeSave(old, saved), 'stale');
  assert.equal(store.count(), 0);
  const reopened = put(store);
  assert.notEqual(reopened.lineage, old.lineage);
  assert.equal(store.acknowledgeSave(old, saved), 'stale');
  assert.equal(store.get('actor-a', 'project-a'), reopened);
});

test('a save acknowledgement cannot adopt an unrelated document or silently upgrade a stale base twice', () => {
  const store = new DocumentDraftStore();
  const submitted = put(store);
  assert.equal(store.beginSave(submitted), true);
  put(store, input({ body: '新文字' }));
  const saved = { ...base, title: submitted.title.trim(), body: submitted.body, version: 4 };
  assert.equal(store.acknowledgeSave(submitted, { ...saved, id: 'other-document' }), 'stale');
  assert.equal(store.acknowledgeSave(submitted, saved), 'retained');
  const current = store.get('actor-a', 'project-a');
  assert.equal(store.acknowledgeSave(submitted, { ...saved, version: 5 }), 'stale');
  assert.equal(store.get('actor-a', 'project-a'), current);
});

test('export round-trips exact title, Unicode, whitespace, project and original expected version', () => {
  const store = new DocumentDraftStore(24, () => 1000);
  const draft = put(store);
  const exported = JSON.parse(serializeDocumentDraft(draft));
  assert.equal(exported.formatVersion, 1);
  assert.equal(exported.title, draft.title);
  assert.equal(exported.body, draft.body);
  assert.equal(exported.projectId, 'project-a');
  assert.equal(exported.documentId, base.id);
  assert.equal(exported.baseVersion, 3);
  assert.equal(Object.hasOwn(exported, 'actorId'), false);
  const fresh = put(store, input({ projectId: 'new-project', base: null }));
  const newExport = JSON.parse(serializeDocumentDraft(fresh));
  assert.equal(newExport.documentId, null);
  assert.equal(newExport.baseVersion, null);
});

test('reverting to the old base while saving retains that intention in the same lineage', () => {
  const store = new DocumentDraftStore();
  const submitted = put(store, input({ title: '提交中的标题', body: '提交中的正文' }));
  assert.equal(store.beginSave(submitted), true);
  const reverted = put(store, input({ title: base.title, body: base.body }));
  assert.equal(reverted.lineage, submitted.lineage);
  assert.equal(reverted.saveState, 'pending');
  assert.equal(
    store.acknowledgeSave(submitted, {
      ...base,
      title: submitted.title,
      body: submitted.body,
      version: 4,
    }),
    'retained',
  );
  const current = store.get('actor-a', 'project-a')!;
  assert.equal(current.title, base.title);
  assert.equal(current.body, base.body);
  assert.equal(
    current.base?.version,
    4,
    'The reversion must later use the acknowledged server version',
  );
});

test('new-document text cleared and retyped in flight stays attached to its real creation acknowledgement', () => {
  const store = new DocumentDraftStore();
  const submitted = put(store, input({ base: null, title: '新文档', body: '提交正文' }));
  assert.equal(store.beginSave(submitted), true);
  put(store, input({ base: null, title: '', body: '' }));
  const retyped = put(store, input({ base: null, title: '新文档', body: '后续输入' }));
  assert.equal(retyped.lineage, submitted.lineage);
  assert.equal(
    store.acknowledgeSave(submitted, {
      ...base,
      title: submitted.title,
      body: submitted.body,
      version: 1,
    }),
    'retained',
  );
  const current = store.get('actor-a', 'project-a')!;
  assert.equal(current.body, '后续输入');
  assert.equal(current.base?.id, base.id);
  assert.equal(current.base?.version, 1);
});

test('a remounted matching editor receives a known save base even when the retained text becomes clean', () => {
  const store = new DocumentDraftStore();
  const submitted = put(store, input({ base: null, title: '已创建', body: '已保存正文' }));
  assert.equal(store.beginSave(submitted), true);
  const notices: Array<{ lineage: number; document: { id: string; version: number } }> = [];
  const unsubscribe = store.subscribeSaves((notice) => notices.push(notice));
  assert.equal(
    store.acknowledgeSave(submitted, {
      ...base,
      title: submitted.title,
      body: submitted.body,
      version: 1,
    }),
    'cleared',
  );
  assert.equal(store.count(), 0);
  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.lineage, submitted.lineage);
  assert.equal(notices[0]!.document.id, base.id);
  unsubscribe();
});

test('unknown creation cannot be resubmitted and explicit rejection releases the attempt without dropping later text', () => {
  const store = new DocumentDraftStore();
  const submitted = put(store, input({ base: null }));
  assert.equal(store.beginSave(submitted), true);
  store.finishUnconfirmedSave(submitted, false);
  const unknown = store.get('actor-a', 'project-a')!;
  assert.equal(unknown.saveState, 'unknown');
  assert.equal(store.beginSave(unknown), false);
  const edited = put(store, input({ base: null, body: '继续保留的新文字' }));
  assert.equal(edited.saveState, 'unknown');
  store.finishUnconfirmedSave(submitted, true);
  const rejected = store.get('actor-a', 'project-a')!;
  assert.equal(rejected.body, edited.body);
  assert.equal(rejected.saveState, 'idle');
  assert.equal(store.beginSave(rejected), true);
  store.finishUnconfirmedSave(submitted, false);
  assert.equal(
    store.get('actor-a', 'project-a')?.saveState,
    'pending',
    'An old failed attempt cannot change a newer one',
  );
});

test('success receipts require the exact submitted text, identity and next version', () => {
  const store = new DocumentDraftStore();
  const submitted = put(store);
  assert.equal(store.beginSave(submitted), true);
  const valid = { ...base, title: submitted.title.trim(), body: submitted.body, version: 4 };
  for (const receipt of [
    null,
    {},
    { ...valid, title: '不属于本次提交' },
    { ...valid, body: '错误正文' },
    { ...valid, version: 3 },
    { ...valid, version: 5 },
    { ...valid, id: 'another' },
    { ...valid, updatedAt: 'invalid' },
  ]) {
    assert.equal(isDocumentSaveReceipt(submitted, receipt), false);
  }
  assert.equal(isDocumentSaveReceipt(submitted, valid), true);
  const fresh = put(store, input({ projectId: 'fresh-project', base: null }));
  assert.equal(isDocumentSaveReceipt(fresh, { ...valid, version: 2 }), false);
  assert.equal(isDocumentSaveReceipt(fresh, { ...valid, version: 1 }), true);
});

test('malformed cloud lists are rejected before they can replace text or consume a recovery record', () => {
  const store = new DocumentDraftStore();
  const retained = put(store);
  for (const value of [
    null,
    {},
    { documents: {} },
    { documents: [null] },
    { documents: [{ ...base, body: null }] },
    { documents: [base, base] },
  ]) {
    assert.throws(() => projectDocumentsFromResponse(value), /响应不完整/);
  }
  assert.equal(store.get('actor-a', 'project-a'), retained);
  assert.deepEqual(projectDocumentsFromResponse({ documents: [base] }), [base]);
});
