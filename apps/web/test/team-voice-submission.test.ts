import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecipeV4 } from '@ai-xiutu/editor';
import type { TeamVoiceAgentStatus } from '@ai-xiutu/contracts';
import { ApiError } from '../src/lib/api.ts';
import {
  clearTeamVoiceSubmission,
  freezeTeamVoiceSubmission,
  isTeamVoiceAdmissionRejected,
  readTeamVoiceSubmission,
  saveTeamVoiceSubmission,
  TeamVoiceAdmissionObserver,
} from '../src/ai/teamVoiceSubmission.ts';
import {
  clearVoiceSubmission,
  freezeVoiceSubmission,
  saveVoiceSubmission,
} from '../src/ai/voiceSubmission.ts';

const requestId = '10000000-0000-4000-8000-000000000001';
const nextId = '10000000-0000-4000-8000-000000000002';
const artworkId = '20000000-0000-4000-8000-000000000001';
const assetId = '30000000-0000-4000-8000-000000000001';
const invitationId = '40000000-0000-4000-8000-000000000001';

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
    artworkId,
    body: {
      idempotencyKey,
      confirmed: true,
      modelId: 'gpt-live-1',
      backendModelId: 'configured-model',
      voice: 'marin',
      context: {
        artworkId,
        assetId,
        expectedVersion: 3,
        recipe: createRecipeV4(),
        imageDataUrl: 'data:image/png;base64,AAAA',
      },
    },
  };
}

function agent(
  state: 'connecting' | 'active' | 'closing',
  id = invitationId,
): TeamVoiceAgentStatus {
  return { state, invitationId: id, hostSpeakerId: 7, modelId: 'gpt-live-1', contextReady: true };
}

test('team admission freezes the confirmed team schema without an individual scope or session ticket', () => {
  const mutable = input();
  const frozen = freezeTeamVoiceSubmission(mutable);
  mutable.body.context.expectedVersion = 4;
  mutable.body.context.recipe.adjustments.exposure = 2;
  mutable.body.modelId = 'another-model';
  const body = JSON.parse(frozen.requestBody!);
  assert.equal(body.confirmed, true);
  assert.equal(body.context.expectedVersion, 3);
  assert.equal(body.context.recipe.adjustments.exposure, 0);
  assert.equal(body.modelId, 'gpt-live-1');
  assert.throws(() =>
    freezeTeamVoiceSubmission({ ...input(), body: { ...input().body, confirmed: false } }),
  );
  assert.throws(() =>
    freezeTeamVoiceSubmission({
      ...input(),
      body: { ...input().body, scope: { allowWebSearch: true } },
    }),
  );
});

test('individual and team paid voice checkpoints block each other for the same actor but keep accounts isolated', () => {
  const checkpoint = storage();
  const team = freezeTeamVoiceSubmission(input());
  const personal = freezeVoiceSubmission({
    actorId: 'actor-a',
    projectId: artworkId,
    projectTitle: 'project',
    editorKey: '',
    body: {
      idempotencyKey: nextId,
      modelId: 'gpt-live-1',
      backendModelId: 'configured-model',
      voice: 'marin',
    },
  });
  saveTeamVoiceSubmission(checkpoint, team);
  assert.throws(() => saveVoiceSubmission(checkpoint, personal), /团队 AI 邀请仍待确认/);
  assert.equal(readTeamVoiceSubmission(checkpoint, 'actor-b'), null);
  saveVoiceSubmission(checkpoint, { ...personal, actorId: 'actor-b' });
  clearTeamVoiceSubmission(checkpoint, team);
  saveVoiceSubmission(checkpoint, personal);
  assert.throws(() => saveTeamVoiceSubmission(checkpoint, team), /个人 AI 通话仍待确认/);
  clearVoiceSubmission(checkpoint, personal);
  saveTeamVoiceSubmission(checkpoint, team);
  assert.throws(
    () =>
      saveTeamVoiceSubmission(
        checkpoint,
        freezeTeamVoiceSubmission({ ...input(nextId), artworkId: nextId }),
      ),
    /不能创建新的付费邀请/,
  );
});

test('only a bound invitation observed active on the original connection can acknowledge its terminal roster', () => {
  for (const lastOutcome of ['closed', 'failed'] as const) {
    const observer = new TeamVoiceAdmissionObserver(7, 'gpt-live-1');
    assert.equal(observer.observe(agent('connecting')).kind, 'bound');
    assert.equal(observer.observe(agent('active')).kind, 'bound');
    assert.equal(observer.observe(agent('closing')).kind, 'bound');
    assert.equal(observer.observe({ state: 'off', lastOutcome }).kind, 'resolved');
    assert.equal(observer.observe({ state: 'off', lastOutcome }).kind, 'ignore');
  }
});

test('a rejected same-key replay creates connecting then failed but cannot resolve an earlier reservation', () => {
  const observer = new TeamVoiceAdmissionObserver(7, 'gpt-live-1');
  observer.observe(agent('connecting', nextId));
  // The real route creates a new lease before prepareVoice rejects the original key.
  const failure = new ApiError('VOICE_ALREADY_PREPARED', 'Already prepared', 409);
  assert.equal(isTeamVoiceAdmissionRejected(failure), false);
  assert.equal(observer.observe({ state: 'off', lastOutcome: 'failed' }).kind, 'unknown');
  assert.equal(observer.observe(agent('active')).kind, 'ignore');
  assert.equal(observer.observe({ state: 'off', lastOutcome: 'closed' }).kind, 'ignore');
});

test('unknown outcomes and changed invitations permanently invalidate this connection proof', () => {
  const unknown = new TeamVoiceAdmissionObserver(7, 'gpt-live-1');
  unknown.observe(agent('active'));
  assert.equal(unknown.observe({ state: 'off', lastOutcome: 'unknown' }).kind, 'unknown');
  assert.equal(unknown.observe(agent('active', nextId)).kind, 'ignore');
  assert.equal(unknown.observe({ state: 'off', lastOutcome: 'failed' }).kind, 'ignore');
  const changed = new TeamVoiceAdmissionObserver(7, 'gpt-live-1');
  changed.observe(agent('active'));
  assert.equal(changed.observe(agent('connecting', nextId)).kind, 'unknown');
  assert.equal(changed.observe({ state: 'off', lastOutcome: 'closed' }).kind, 'ignore');
  const wrongHost = new TeamVoiceAdmissionObserver(8, 'gpt-live-1');
  assert.equal(wrongHost.observe(agent('active')).kind, 'unknown');
});

test('disconnect, a new connection and persisted active metadata cannot manufacture terminal proof', () => {
  const observer = new TeamVoiceAdmissionObserver(7, 'gpt-live-1');
  observer.observe(agent('active'));
  observer.invalidate();
  assert.equal(observer.observe({ state: 'off', lastOutcome: 'closed' }).kind, 'ignore');
  const reopened = new TeamVoiceAdmissionObserver(7, 'gpt-live-1');
  assert.equal(reopened.observe({ state: 'off', lastOutcome: 'closed' }).kind, 'ignore');
  const checkpoint = storage();
  const saved = { ...freezeTeamVoiceSubmission(input()), invitationId, state: 'active' as const };
  saveTeamVoiceSubmission(checkpoint, saved);
  assert.equal(readTeamVoiceSubmission(checkpoint, 'actor-a')?.state, 'active');
  assert.throws(
    () => saveTeamVoiceSubmission(checkpoint, freezeTeamVoiceSubmission(input(nextId))),
    /结果仍待确认/,
  );
});

test('only precise first admission refusals release a team request; post-reservation model and connection errors do not', () => {
  for (const failure of [
    new ApiError('VOICE_NOT_CONFIGURED', 'Disabled before preparation', 503),
    new ApiError('TEAM_VOICE_AGENT_FORBIDDEN', 'Viewer', 403),
    new ApiError('TEAM_VOICE_AGENT_BUSY', 'Busy room', 409),
    new ApiError('FREE_QUOTA_EXHAUSTED', 'Quota', 409),
  ]) {
    assert.equal(isTeamVoiceAdmissionRejected(failure), true);
    assert.equal(isTeamVoiceAdmissionRejected(failure, true), false);
  }
  for (const failure of [
    new ApiError('ASSISTANT_MODEL_UNAVAILABLE', 'Disabled after reservation', 503),
    new ApiError('VOICE_STATE_CHANGED', 'Connection changed', 409),
    new ApiError('ASSISTANT_RECOVERY_REQUIRED', 'Journal unknown', 503),
    new ApiError('NETWORK_UNAVAILABLE', 'Lost response', 0),
    new ApiError('HTTP_503', 'Unknown', 503),
    new ApiError('IDEMPOTENCY_CONFLICT', 'Original hash differs', 409),
  ])
    assert.equal(isTeamVoiceAdmissionRejected(failure), false);
});

test('media stays in memory while identity survives refresh, corruption and late acknowledgements', () => {
  const checkpoint = storage();
  const payloads = new Map<string, string>();
  const original = freezeTeamVoiceSubmission(input());
  saveTeamVoiceSubmission(checkpoint, original, payloads);
  assert.equal([...checkpoint.entries.values()][0]!.includes('data:image'), false);
  assert.equal([...checkpoint.entries.values()][0]!.includes('imageDataUrl'), false);
  assert.equal(
    readTeamVoiceSubmission(checkpoint, 'actor-a', payloads)?.requestBody,
    original.requestBody,
  );
  assert.equal(readTeamVoiceSubmission(checkpoint, 'actor-a', new Map())?.requestBody, null);
  clearTeamVoiceSubmission(checkpoint, original, payloads);
  const next = freezeTeamVoiceSubmission(input(nextId));
  saveTeamVoiceSubmission(checkpoint, next, payloads);
  clearTeamVoiceSubmission(checkpoint, original, payloads);
  assert.equal(readTeamVoiceSubmission(checkpoint, 'actor-a', payloads)?.idempotencyKey, nextId);
  const key = [...checkpoint.entries.keys()][0]!;
  checkpoint.setItem(key, '{damaged');
  assert.throws(() => readTeamVoiceSubmission(checkpoint, 'actor-a'), /恢复记录无法读取/);
  assert.throws(() => saveTeamVoiceSubmission(checkpoint, original), /恢复记录无法读取/);
});
