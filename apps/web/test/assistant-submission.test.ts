import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecipeV4 } from '@ai-xiutu/editor';
import { ApiError } from '../src/lib/api.ts';
import {
  acceptAssistantSubmission,
  assistantSubmissionRequest,
  assistantSubmissionResolved,
  clearAssistantSubmission,
  freezeAssistantSubmission,
  isAssistantAdmissionRejected,
  readAssistantSubmission,
  saveAssistantSubmission,
} from '../src/ai/assistantSubmission.ts';

const requestId = '10000000-0000-4000-8000-000000000001';
const secondRequestId = '10000000-0000-4000-8000-000000000002';
const artworkId = '20000000-0000-4000-8000-000000000001';
const assetId = '30000000-0000-4000-8000-000000000001';
const grantId = '40000000-0000-4000-8000-000000000001';
const spaceId = '50000000-0000-4000-8000-000000000001';
const turnId = '60000000-0000-4000-8000-000000000001';
const projectId = '70000000-0000-4000-8000-000000000001';

function storage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
  };
}

function input(idempotencyKey = requestId) {
  return {
    actorId: 'actor-a',
    projectId,
    projectTitle: '测试项目',
    editorKey: 'original-editor-state',
    automatic: true,
    body: {
      idempotencyKey,
      modelId: 'configured-model',
      prompt: ' 保留自然质感，轻微提亮 ',
      context: {
        artworkId,
        assetId,
        expectedVersion: 7,
        recipe: createRecipeV4(),
        imageDataUrl: 'data:image/png;base64,AAAA',
      },
      scope: {
        spaceIds: [spaceId],
        referenceAssetIds: [assetId],
        allowWebSearch: false,
        usePersonalMemory: false,
        executionGrantId: grantId,
      },
    },
  };
}

test('retry uses the original prompt, image, recipe, scope, grant and key after the editor changes', () => {
  const mutable = input();
  const frozen = freezeAssistantSubmission(mutable);
  const original = assistantSubmissionRequest(frozen);
  mutable.body.prompt = 'A new request';
  mutable.body.context.recipe.adjustments.exposure = 2;
  mutable.body.context.imageDataUrl = 'data:image/png;base64,BBBB';
  mutable.body.context.expectedVersion = 8;
  mutable.body.scope.referenceAssetIds.length = 0;
  mutable.body.scope.executionGrantId = secondRequestId;
  mutable.body.modelId = 'another-model';
  assert.deepEqual(assistantSubmissionRequest(frozen), original);
  const posted = JSON.parse(original.init.body as string);
  assert.equal(posted.idempotencyKey, requestId);
  assert.equal(posted.prompt, '保留自然质感，轻微提亮');
  assert.equal(posted.context.recipe.adjustments.exposure, 0);
  assert.equal(posted.context.expectedVersion, 7);
  assert.equal(posted.scope.executionGrantId, grantId);
});

test('an unresolved request survives panel reopening and blocks a fresh key across projects for that actor', () => {
  const checkpoint = storage();
  const pending = freezeAssistantSubmission(input());
  saveAssistantSubmission(checkpoint, pending);
  const reopened = readAssistantSubmission(checkpoint, 'actor-a')!;
  assert.equal(reopened.requestBody, pending.requestBody);
  assert.equal(reopened.prompt, pending.prompt);
  assert.equal(readAssistantSubmission(checkpoint, 'actor-b'), null);
  assert.throws(
    () =>
      saveAssistantSubmission(
        checkpoint,
        freezeAssistantSubmission({
          ...input(secondRequestId),
          projectId: 'different-project',
        }),
      ),
    /上一轮协作结果仍待确认/,
  );
  assert.equal(readAssistantSubmission(checkpoint, 'actor-a')?.idempotencyKey, requestId);
});

test('a frozen key cannot be reused with changed content, and a late receipt cannot delete a new request', () => {
  const checkpoint = storage();
  const original = freezeAssistantSubmission(input());
  saveAssistantSubmission(checkpoint, original);
  const changed = input();
  changed.body.prompt = 'Different body';
  assert.throws(
    () => saveAssistantSubmission(checkpoint, freezeAssistantSubmission(changed)),
    /内容已冻结/,
  );
  clearAssistantSubmission(checkpoint, original);
  const next = freezeAssistantSubmission(input(secondRequestId));
  saveAssistantSubmission(checkpoint, next);
  clearAssistantSubmission(checkpoint, original);
  assert.equal(readAssistantSubmission(checkpoint, 'actor-a')?.idempotencyKey, secondRequestId);
});

test('an admitted request with a lost POST response is recovered with one paid admission and then GET only', async () => {
  const checkpoint = storage();
  const pending = freezeAssistantSubmission(input());
  const admitted = new Map<string, { id: string; state: string; conversationId: string }>();
  let paidAdmissions = 0;
  let loseReceipt = true;
  const calls: string[] = [];
  async function server(request: ReturnType<typeof assistantSubmissionRequest>) {
    calls.push(request.init.method!);
    if (request.init.method === 'GET') return admitted.get(requestId)!;
    const body = JSON.parse(request.init.body as string);
    if (!admitted.has(body.idempotencyKey)) {
      paidAdmissions++;
      admitted.set(body.idempotencyKey, { id: turnId, state: 'running', conversationId: turnId });
    }
    if (loseReceipt) {
      loseReceipt = false;
      throw new ApiError('NETWORK_UNAVAILABLE', 'Lost response', 0);
    }
    return admitted.get(body.idempotencyKey)!;
  }
  saveAssistantSubmission(checkpoint, pending);
  await assert.rejects(server(assistantSubmissionRequest(pending)), /Lost response/);
  const restored = readAssistantSubmission(checkpoint, 'actor-a')!;
  assert.equal(calls.length, 1, 'restoring a checkpoint never dispatches automatically');
  const receipt = await server(assistantSubmissionRequest(restored));
  const accepted = acceptAssistantSubmission(restored, receipt);
  saveAssistantSubmission(checkpoint, accepted);
  await server(assistantSubmissionRequest(readAssistantSubmission(checkpoint, 'actor-a')!));
  assert.equal(paidAdmissions, 1);
  assert.deepEqual(calls, ['POST', 'POST', 'GET']);
});

test('known running and unknown turns always recover read-only; provider uncertainty needs reconciliation', () => {
  const pending = freezeAssistantSubmission(input());
  const running = acceptAssistantSubmission(pending, { id: turnId, state: 'running' });
  const unknown = acceptAssistantSubmission(running, { id: turnId, state: 'unknown' });
  for (const value of [running, unknown]) {
    const request = assistantSubmissionRequest(value);
    assert.equal(request.path, `/assistant-turns/${turnId}`);
    assert.equal(request.init.method, 'GET');
    assert.equal(request.init.body, undefined);
    assert.equal(assistantSubmissionResolved(value.state), false);
  }
  for (const state of ['completed', 'failed', 'stopped'])
    assert.equal(assistantSubmissionResolved(state), true);
  assert.equal(assistantSubmissionResolved('unavailable'), false);
  assert.throws(
    () => acceptAssistantSubmission(running, { id: secondRequestId, state: 'completed' }),
    /回执与原请求不一致/,
  );
});

test('only a first-attempt admission refusal clears a request; transport, access and retry failures do not', () => {
  const rejected = new ApiError('FREE_QUOTA_EXHAUSTED', 'Insufficient quota', 409);
  assert.equal(isAssistantAdmissionRejected(rejected, false), true);
  assert.equal(isAssistantAdmissionRejected(rejected, true), false);
  for (const failure of [
    new ApiError('NETWORK_UNAVAILABLE', 'Offline', 0),
    new ApiError('HTTP_503', 'Service unavailable', 503),
    new ApiError('HTTP_408', 'Timed out', 408),
    new ApiError('PROJECT_FORBIDDEN', 'Access revoked after admission', 403),
    new ApiError('REFERENCE_FORBIDDEN', 'Reference revoked after admission', 403),
    new ApiError('IDEMPOTENCY_CONFLICT', 'Conflicting receipt', 409),
    new DOMException('Closed the panel', 'AbortError'),
    new SyntaxError('Invalid response JSON'),
  ]) {
    assert.equal(isAssistantAdmissionRejected(failure, false), false);
    assert.equal(isAssistantAdmissionRejected(failure, true), false);
  }
});

test('damaged or unavailable checkpoint storage never silently discards a potentially paid request', () => {
  const checkpoint = storage();
  saveAssistantSubmission(checkpoint, freezeAssistantSubmission(input()));
  const key = [...checkpoint.entries.keys()][0]!;
  checkpoint.setItem(key, '{incomplete');
  assert.throws(() => readAssistantSubmission(checkpoint, 'actor-a'), /恢复记录无法读取/);
  assert.throws(
    () => saveAssistantSubmission(checkpoint, freezeAssistantSubmission(input(secondRequestId))),
    /恢复记录无法读取/,
  );
  assert.equal(checkpoint.getItem(key), '{incomplete');
  const unavailable = {
    ...storage(),
    setItem() {
      throw new Error('Storage quota exceeded');
    },
  };
  assert.throws(
    () => saveAssistantSubmission(unavailable, freezeAssistantSubmission(input())),
    /Storage quota/,
  );
});

test('a first configuration refusal releases the draft, but the same 503 on recovery cannot disprove prior admission', () => {
  for (const code of ['ASSISTANT_NOT_CONFIGURED', 'ASSISTANT_MODEL_UNAVAILABLE']) {
    const error = new ApiError(code, 'Configuration disabled before admission', 503);
    assert.equal(isAssistantAdmissionRejected(error, false), true);
    assert.equal(isAssistantAdmissionRejected(error, true), false);
  }
  assert.equal(
    isAssistantAdmissionRejected(new ApiError('HTTP_503', 'Unavailable', 503), false),
    false,
  );
  assert.equal(
    isAssistantAdmissionRejected(
      new ApiError('ASSISTANT_RECOVERY_REQUIRED', 'Journal unresolved', 503),
      false,
    ),
    false,
  );
});

test('a shared image survives a panel remount in memory but never enters session storage', () => {
  const checkpoint = storage();
  const payloads = new Map<string, string>();
  const original = freezeAssistantSubmission(input());
  saveAssistantSubmission(checkpoint, original, payloads);
  const serialized = [...checkpoint.entries.values()][0]!;
  assert.equal(serialized.includes('data:image'), false);
  assert.equal(serialized.includes('imageDataUrl'), false);
  assert.equal(
    readAssistantSubmission(checkpoint, 'actor-a', payloads)?.requestBody,
    original.requestBody,
  );
  const refreshed = readAssistantSubmission(checkpoint, 'actor-a', new Map())!;
  assert.equal(refreshed.requestBody, null);
  assert.equal(refreshed.idempotencyKey, original.idempotencyKey);
  assert.throws(() => assistantSubmissionRequest(refreshed), /原始画面只保留在页面内存/);
  const accepted = acceptAssistantSubmission(refreshed, { id: turnId, state: 'unknown' });
  assert.equal(assistantSubmissionRequest(accepted).init.method, 'GET');
});
