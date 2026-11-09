import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecipeV3 } from '@ai-xiutu/editor';
import { decisionAttempt, currentResultBlock, type DecisionDraft } from '../src/ai/decisions.ts';
import type { AIJob } from '../src/ai/types.ts';
import type { Artwork } from '../src/lib/types.ts';

test('uncertain decision retries retain a token without persisting generated or edited content', () => {
  const saved = new Map<string, string>();
  const storage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  let calls = 0;
  const uuid = () => {
    calls += 1;
    return `00000000-0000-4000-8000-${String(calls).padStart(12, '0')}`;
  };
  const draft: DecisionDraft = {
    action: 'save-text',
    title: '私有标题',
    body: '不可写入存储的用户文案',
  };
  const first = decisionAttempt('u1:p1', 'job-content', draft, storage, uuid);
  const retried = decisionAttempt(
    'u1:p1',
    'job-content',
    { body: draft.body, title: draft.title, action: 'save-text' },
    storage,
    uuid,
  );
  assert.equal(first.idempotencyKey, retried.idempotencyKey);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify([...saved]).includes(draft.body!));
  assert.ok(!JSON.stringify([...saved]).includes(draft.title!));
  assert.notEqual(
    decisionAttempt('u2:p1', 'job-content', draft, storage, uuid).idempotencyKey,
    first.idempotencyKey,
  );
  assert.notEqual(
    decisionAttempt('u1:p1', 'job-content', { ...draft, body: '新版' }, storage, uuid)
      .idempotencyKey,
    first.idempotencyKey,
  );
});

test('privacy-mode storage failure and malformed persisted tokens cannot corrupt decision requests', () => {
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  const key = '10000000-0000-4000-8000-000000000000';
  const draft: DecisionDraft = { action: 'fork', outputIndex: 0 };
  assert.equal(
    decisionAttempt('privacy', 'job-storage', draft, broken, () => key).idempotencyKey,
    key,
  );
  const bad = { getItem: () => 'not-a-token', setItem: () => {} };
  assert.equal(
    decisionAttempt('bad-storage', 'job-storage', draft, bad, () => key).idempotencyKey,
    key,
  );
});

test('current adoption is blocked for dirty, different-project, wrong-source and stale-revision results', () => {
  const artwork = {
    id: 'work',
    projectId: 'project',
    assetId: 'asset',
    title: '测试',
    headVersion: 7,
  } satisfies Artwork;
  const job = {
    id: 'job',
    projectId: 'project',
    modelId: 'model',
    state: 'completed',
    output: {
      kind: 'edit-plan',
      recipe: createRecipeV3(),
      summary: '',
      baseVersion: 7,
      inputHash: '',
      artworkId: 'work',
    },
    reservedUnits: 1,
    errorCode: null,
    createdAt: '',
    updatedAt: '',
  } satisfies AIJob;
  assert.equal(currentResultBlock(job, artwork, false), null);
  assert.match(currentResultBlock(job, artwork, true)!, /本地修改/);
  assert.match(currentResultBlock(job, { ...artwork, headVersion: 8 }, false)!, /旧版本/);
  assert.match(currentResultBlock(job, { ...artwork, id: 'other' }, false)!, /另一件作品/);
  assert.match(currentResultBlock(job, { ...artwork, projectId: 'private-other' }, false)!, /项目/);
  assert.match(currentResultBlock(job, null, false)!, /先打开/);
});
