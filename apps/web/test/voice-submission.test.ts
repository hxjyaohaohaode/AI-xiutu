import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecipeV4 } from '@ai-xiutu/editor';
import { ApiError } from '../src/lib/api.ts';
import {
  acceptVoiceSubmission,
  clearVoiceSubmission,
  freezeVoiceSubmission,
  isVoiceAdmissionRejected,
  readVoiceSubmission,
  saveVoiceSubmission,
  voiceSubmissionEvent,
  voiceSubmissionRequest,
} from '../src/ai/voiceSubmission.ts';

const requestId = '10000000-0000-4000-8000-000000000001';
const nextRequestId = '10000000-0000-4000-8000-000000000002';
const sessionId = '20000000-0000-4000-8000-000000000001';
const projectId = '30000000-0000-4000-8000-000000000001';
const artworkId = '40000000-0000-4000-8000-000000000001';
const assetId = '50000000-0000-4000-8000-000000000001';
const grantId = '60000000-0000-4000-8000-000000000001';

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
    projectTitle: '语音测试项目',
    editorKey: 'original-canvas',
    body: {
      idempotencyKey,
      modelId: 'gpt-live-1',
      backendModelId: 'configured-backend',
      voice: 'marin',
      context: {
        artworkId,
        assetId,
        expectedVersion: 9,
        recipe: createRecipeV4(),
        imageDataUrl: 'data:image/png;base64,AAAA',
      },
      scope: { spaceIds: [], referenceAssetIds: [assetId], executionGrantId: grantId },
    },
  };
}

const receipt = () => ({
  id: sessionId,
  ticket: 'private-one-time-ticket',
  websocketPath: `/v1/voice-sessions/${sessionId}/stream`,
});

test('voice recovery freezes its own schema, context, grant and key before preparation', () => {
  const mutable = input();
  const frozen = freezeVoiceSubmission(mutable);
  const request = voiceSubmissionRequest(frozen);
  mutable.body.context.expectedVersion = 10;
  mutable.body.context.recipe.adjustments.exposure = 2;
  mutable.body.scope.executionGrantId = nextRequestId;
  mutable.body.context.imageDataUrl = 'data:image/png;base64,BBBB';
  mutable.body.backendModelId = 'another-model';
  assert.deepEqual(voiceSubmissionRequest(frozen), request);
  assert.equal(request.path, `/projects/${projectId}/voice-sessions`);
  const body = JSON.parse(request.init.body as string);
  assert.equal(body.idempotencyKey, requestId);
  assert.equal(body.context.expectedVersion, 9);
  assert.equal(body.context.recipe.adjustments.exposure, 0);
  assert.equal(body.scope.executionGrantId, grantId);
  assert.throws(() =>
    freezeVoiceSubmission({ ...input(), body: { ...input().body, prompt: 'not a voice field' } }),
  );
});

test('new voice preparation retains web permission but never carries a stale text-search query', () => {
  const original = input();
  const prepared = freezeVoiceSubmission({
    ...original,
    body: {
      ...original.body,
      scope: {
        ...original.body.scope,
        allowWebSearch: true,
        publicSearch: { query: '文字模式留下的检索词', kind: 'images' },
      },
    },
  });
  const request = voiceSubmissionRequest(prepared);
  const posted = JSON.parse(request.init.body as string);
  assert.equal(posted.scope.allowWebSearch, true);
  assert.equal(posted.scope.publicSearch, undefined);
  assert.equal(posted.scope.executionGrantId, grantId);
  const checkpoint = storage();
  saveVoiceSubmission(checkpoint, prepared);
  assert.deepEqual(voiceSubmissionRequest(readVoiceSubmission(checkpoint, 'actor-a')!), request);
});

test('a lost preparation receipt keeps the same key; existing preparations return 409 without a new ticket', async () => {
  const checkpoint = storage();
  const original = freezeVoiceSubmission(input());
  const accepted = new Set<string>();
  let reservations = 0;
  const calls: string[] = [];
  async function server(request: ReturnType<typeof voiceSubmissionRequest>) {
    const body = JSON.parse(request.init.body as string);
    calls.push(body.idempotencyKey);
    if (accepted.has(body.idempotencyKey))
      throw new ApiError('VOICE_ALREADY_PREPARED', '通话已准备过', 409);
    accepted.add(body.idempotencyKey);
    reservations++;
    throw new ApiError('NETWORK_UNAVAILABLE', 'Lost preparation response', 0);
  }
  saveVoiceSubmission(checkpoint, original);
  await assert.rejects(server(voiceSubmissionRequest(original)), /Lost preparation response/);
  const restored = readVoiceSubmission(checkpoint, 'actor-a')!;
  assert.equal(calls.length, 1, 'reading local identity must never dispatch a request');
  let refusal: unknown;
  try {
    await server(voiceSubmissionRequest(restored));
  } catch (error) {
    refusal = error;
  }
  assert.equal(isVoiceAdmissionRejected(refusal, true), false);
  assert.equal(isVoiceAdmissionRejected(refusal, false), false);
  const blocked = { ...restored, state: 'already-prepared' as const };
  saveVoiceSubmission(checkpoint, blocked);
  assert.throws(
    () => voiceSubmissionRequest(readVoiceSubmission(checkpoint, 'actor-a')!),
    /旧|票据/,
  );
  assert.throws(
    () => saveVoiceSubmission(checkpoint, freezeVoiceSubmission(input(nextRequestId))),
    /最终状态尚未确认/,
  );
  assert.equal(reservations, 1);
  assert.deepEqual(calls, [requestId, requestId]);
});

test('unknown close survives reopening and blocks another project, while a definitive close releases only that request', () => {
  const checkpoint = storage();
  const prepared = acceptVoiceSubmission(freezeVoiceSubmission(input()), receipt());
  const unknown = voiceSubmissionEvent(prepared, {
    type: 'closed',
    state: 'unknown',
    reason: 'SETTLEMENT_UNCONFIRMED',
  })!;
  saveVoiceSubmission(checkpoint, unknown);
  assert.equal(readVoiceSubmission(checkpoint, 'actor-a', new Map())?.state, 'unknown');
  assert.equal(readVoiceSubmission(checkpoint, 'actor-b'), null);
  assert.throws(
    () =>
      saveVoiceSubmission(
        checkpoint,
        freezeVoiceSubmission({ ...input(nextRequestId), projectId: 'another-project' }),
      ),
    /最终状态尚未确认/,
  );
  for (const state of ['closed', 'failed'] as const)
    assert.equal(
      voiceSubmissionEvent(unknown, { type: 'closed', state, reason: 'confirmed' }),
      null,
    );
  clearVoiceSubmission(checkpoint, unknown);
  const next = freezeVoiceSubmission(input(nextRequestId));
  saveVoiceSubmission(checkpoint, next);
  clearVoiceSubmission(checkpoint, unknown);
  assert.equal(readVoiceSubmission(checkpoint, 'actor-a')?.idempotencyKey, nextRequestId);
});

test('a late preparation acknowledgement is retained without a ticket or media and never invents a GET endpoint', () => {
  const checkpoint = storage();
  const payloads = new Map<string, string>();
  const pending = freezeVoiceSubmission(input());
  saveVoiceSubmission(checkpoint, pending, payloads);
  // Equivalent to a response arriving after the original panel has unmounted.
  const admitted = acceptVoiceSubmission(
    readVoiceSubmission(checkpoint, 'actor-a', payloads)!,
    receipt(),
  );
  saveVoiceSubmission(checkpoint, admitted, payloads);
  const serialized = [...checkpoint.entries.values()][0]!;
  assert.equal(serialized.includes('private-one-time-ticket'), false);
  assert.equal(serialized.includes('ticket'), false);
  assert.equal(serialized.includes('imageDataUrl'), false);
  assert.equal(serialized.includes('data:image'), false);
  const refreshed = readVoiceSubmission(checkpoint, 'actor-a', new Map())!;
  assert.equal(refreshed.sessionId, sessionId);
  assert.equal(refreshed.requestBody, null);
  assert.throws(() => voiceSubmissionRequest(refreshed), /不会重新发放连接票据/);
});

test('transport failures, timeout, unknown receipts and retry refusals cannot release the reservation', () => {
  for (const failure of [
    new ApiError('NETWORK_UNAVAILABLE', 'Offline', 0),
    new ApiError('HTTP_408', 'Timed out', 408),
    new ApiError('HTTP_503', 'Service unavailable', 503),
    new ApiError('VOICE_ALREADY_PREPARED', 'Already prepared', 409),
    new ApiError('IDEMPOTENCY_CONFLICT', 'Conflict', 409),
    new DOMException('Panel closed', 'AbortError'),
    new SyntaxError('Bad response JSON'),
  ]) {
    assert.equal(isVoiceAdmissionRejected(failure, false), false);
    assert.equal(isVoiceAdmissionRejected(failure, true), false);
  }
  for (const failure of [
    new ApiError('VOICE_NOT_CONFIGURED', 'Voice unavailable', 503),
    new ApiError('ASSISTANT_MODEL_UNAVAILABLE', 'Model disabled', 503),
    new ApiError('FREE_QUOTA_EXHAUSTED', 'Quota', 409),
    new ApiError('VOICE_ALREADY_ACTIVE', 'Another active session', 409),
  ]) {
    assert.equal(isVoiceAdmissionRejected(failure, false), true);
    assert.equal(isVoiceAdmissionRejected(failure, true), false);
  }
});

test('an accepted session only trusts its bound ready receipt and recognized final states', () => {
  const pending = freezeVoiceSubmission(input());
  assert.throws(
    () => acceptVoiceSubmission(pending, { ...receipt(), websocketPath: '/v1/other/stream' }),
    /回执/,
  );
  const prepared = acceptVoiceSubmission(pending, receipt());
  assert.throws(
    () =>
      voiceSubmissionEvent(prepared, {
        type: 'ready',
        sessionId: nextRequestId,
        modelId: 'x',
        maxSeconds: 60,
      }),
    /标识与原回执不一致/,
  );
  const active = voiceSubmissionEvent(prepared, {
    type: 'ready',
    sessionId,
    modelId: 'x',
    maxSeconds: 60,
  })!;
  assert.equal(active.state, 'active');
  assert.throws(() => voiceSubmissionRequest(active), /票据/);
  assert.throws(
    () =>
      voiceSubmissionEvent(active, {
        type: 'closed',
        state: 'timeout' as 'unknown',
        reason: 'local timeout',
      }),
    /无法识别/,
  );
});

test('missing private payload and corrupted storage preserve the identity instead of silently replacing it', () => {
  const checkpoint = storage();
  const payloads = new Map<string, string>();
  const pending = freezeVoiceSubmission(input());
  saveVoiceSubmission(checkpoint, pending, payloads);
  assert.equal(
    readVoiceSubmission(checkpoint, 'actor-a', payloads)?.requestBody,
    pending.requestBody,
  );
  const refreshed = readVoiceSubmission(checkpoint, 'actor-a', new Map())!;
  assert.equal(refreshed.requestBody, null);
  assert.throws(() => voiceSubmissionRequest(refreshed), /页面内存/);
  const key = [...checkpoint.entries.keys()][0]!;
  checkpoint.setItem(key, '{damaged');
  assert.throws(() => readVoiceSubmission(checkpoint, 'actor-a'), /恢复记录无法读取/);
  assert.throws(
    () => saveVoiceSubmission(checkpoint, freezeVoiceSubmission(input(nextRequestId))),
    /恢复记录无法读取/,
  );
  assert.equal(checkpoint.getItem(key), '{damaged');
});
