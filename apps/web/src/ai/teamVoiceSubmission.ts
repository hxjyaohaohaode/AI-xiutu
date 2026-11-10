import { teamVoiceInviteSchema, type TeamVoiceAgentStatus } from '@ai-xiutu/contracts';
import { ApiError } from '../lib/api';
import {
  persistableRequestBody,
  requestBodyHash,
  requestPayloads,
  restoreRequestBody,
  type RequestPayloadCache,
} from './requestPayload';
import {
  assertNoOtherVoiceSubmission,
  notifyVoiceSubmissionChanged,
  voiceSubmissionStorageKey,
} from './voiceSubmissionStorage';

type CheckpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface TeamVoiceSubmission {
  readonly schema: 'team-voice-invitation-v1';
  readonly actorId: string;
  readonly artworkId: string;
  readonly idempotencyKey: string;
  readonly modelId: string;
  readonly requestBody: string | null;
  readonly requestHash: string;
  readonly createdAt: number;
  /** A room lease identifier, never a voice_session ID or a billing receipt. */
  readonly invitationId?: string;
  readonly state: 'unconfirmed' | 'accepted' | 'connecting' | 'active' | 'closing' | 'unknown';
}

const storageKey = (actorId: string) => voiceSubmissionStorageKey(actorId, 'team');
const payloadKey = (value: Pick<TeamVoiceSubmission, 'actorId' | 'idempotencyKey'>) =>
  `${storageKey(value.actorId)}:${value.idempotencyKey}`;
const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function freezeTeamVoiceSubmission(input: {
  actorId: string;
  artworkId: string;
  body: unknown;
  createdAt?: number;
}): TeamVoiceSubmission {
  const body = teamVoiceInviteSchema.parse(input.body);
  const requestBody = JSON.stringify(body);
  return Object.freeze({
    schema: 'team-voice-invitation-v1',
    actorId: input.actorId,
    artworkId: input.artworkId,
    idempotencyKey: body.idempotencyKey,
    modelId: body.modelId,
    requestBody,
    requestHash: requestBodyHash(requestBody),
    createdAt: input.createdAt ?? Date.now(),
    state: 'unconfirmed',
  });
}

export function readTeamVoiceSubmission(
  storage: CheckpointStorage,
  actorId: string,
  payloads: RequestPayloadCache = requestPayloads,
): TeamVoiceSubmission | null {
  const raw = storage.getItem(storageKey(actorId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as TeamVoiceSubmission;
    if (
      value.schema !== 'team-voice-invitation-v1' ||
      value.actorId !== actorId ||
      !validId(value.artworkId) ||
      !validId(value.idempotencyKey) ||
      typeof value.modelId !== 'string' ||
      !value.modelId ||
      !Number.isFinite(value.createdAt) ||
      typeof value.requestHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.requestHash) ||
      (value.requestBody !== null && typeof value.requestBody !== 'string') ||
      !['unconfirmed', 'accepted', 'connecting', 'active', 'closing', 'unknown'].includes(
        value.state,
      ) ||
      (value.invitationId !== undefined && !validId(value.invitationId))
    )
      throw new Error('Invalid checkpoint');
    const requestBody = restoreRequestBody(
      value.requestBody,
      value.requestHash,
      payloadKey(value),
      payloads,
    );
    if (requestBody !== null) {
      const body = teamVoiceInviteSchema.parse(JSON.parse(requestBody));
      if (body.idempotencyKey !== value.idempotencyKey || body.modelId !== value.modelId)
        throw new Error('Invalid checkpoint');
    }
    return Object.freeze({ ...value, requestBody });
  } catch {
    throw new Error('上次团队 AI 邀请的恢复记录无法读取，请先核对用量并联系平台运营。');
  }
}

export function saveTeamVoiceSubmission(
  storage: CheckpointStorage,
  value: TeamVoiceSubmission,
  payloads: RequestPayloadCache = requestPayloads,
) {
  const previous = readTeamVoiceSubmission(storage, value.actorId, payloads);
  if (!previous) assertNoOtherVoiceSubmission(storage, value.actorId, 'team');
  if (previous && previous.idempotencyKey !== value.idempotencyKey)
    throw new Error('上次团队 AI 邀请结果仍待确认，不能创建新的付费邀请。');
  if (previous && previous.requestHash !== value.requestHash)
    throw new Error('原团队 AI 邀请已冻结，不能修改后复用请求标识。');
  storage.setItem(
    storageKey(value.actorId),
    JSON.stringify({
      ...value,
      requestBody: persistableRequestBody(value.requestBody, payloadKey(value), payloads),
    }),
  );
  notifyVoiceSubmissionChanged();
}

export function clearTeamVoiceSubmission(
  storage: CheckpointStorage,
  value: TeamVoiceSubmission,
  payloads: RequestPayloadCache = requestPayloads,
) {
  const previous = readTeamVoiceSubmission(storage, value.actorId, payloads);
  if (previous?.idempotencyKey === value.idempotencyKey) {
    storage.removeItem(storageKey(value.actorId));
    payloads.delete(payloadKey(value));
    notifyVoiceSubmissionChanged();
  }
}

type Observation =
  | { kind: 'ignore' }
  | { kind: 'unknown' }
  | { kind: 'resolved' }
  | { kind: 'bound'; invitationId: string; state: 'connecting' | 'active' | 'closing' };

/**
 * Ephemeral proof for one first admission on one continuously connected socket.
 * Never hydrate this proof from storage, reuse it after a retry, or attach it to
 * a new transport: off/lastOutcome contains no request or invitation identifier.
 */
export class TeamVoiceAdmissionObserver {
  private invitationId?: string;
  private active = false;
  private invalid = false;

  constructor(
    private readonly speakerId: number,
    private readonly modelId: string,
  ) {}

  get observedActive() {
    return this.active;
  }

  invalidate() {
    this.invalid = true;
  }

  observe(agent: TeamVoiceAgentStatus): Observation {
    if (this.invalid) return { kind: 'ignore' };
    if (agent.state !== 'off') {
      if (
        agent.hostSpeakerId !== this.speakerId ||
        agent.modelId !== this.modelId ||
        !validId(agent.invitationId) ||
        (this.invitationId && agent.invitationId !== this.invitationId)
      ) {
        this.invalid = true;
        return { kind: 'unknown' };
      }
      this.invitationId = agent.invitationId;
      if (agent.state === 'active') this.active = true;
      return { kind: 'bound', invitationId: agent.invitationId, state: agent.state };
    }
    if (!this.invitationId) return { kind: 'ignore' };
    this.invalid = true;
    // connecting -> failed can be a rejected replay or an unconfirmed paid
    // connection. Only an observed active invitation has terminal authority.
    return this.active && (agent.lastOutcome === 'closed' || agent.lastOutcome === 'failed')
      ? { kind: 'resolved' }
      : { kind: 'unknown' };
  }
}

const preAdmissionCodes = new Set([
  'AUTH_REQUIRED',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'VOICE_NOT_CONFIGURED',
  'TEAM_VOICE_UNAVAILABLE',
  'TEAM_VOICE_JOIN_REQUIRED',
  'TEAM_VOICE_AGENT_FORBIDDEN',
  'TEAM_VOICE_CONTEXT_CHANGED',
  'TEAM_VOICE_AGENT_BUSY',
  'VOICE_PROFILE_UNKNOWN',
  'VOICE_NOT_ALLOWED',
  'VOICE_ALREADY_ACTIVE',
  'FREE_QUOTA_EXHAUSTED',
]);

export function isTeamVoiceAdmissionRejected(error: unknown, wasUnconfirmed = false): boolean {
  // ASSISTANT_MODEL_UNAVAILABLE may occur in beforeVoiceConnection after the
  // hold/dispatch evidence exists. Do not reuse the individual preparation rule.
  return !wasUnconfirmed && error instanceof ApiError && preAdmissionCodes.has(error.code);
}
