import { voiceSessionSchema, type VoiceServerEvent } from '@ai-xiutu/contracts';
import { ApiError } from '../lib/api';
import {
  persistableRequestBody,
  requestBodyHash,
  requestPayloads,
  restoreRequestBody,
  type RequestPayloadCache,
} from './requestPayload';

type CheckpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface VoiceSubmission {
  readonly schema: 'voice-session-v1';
  readonly actorId: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly editorKey: string;
  readonly requestBody: string | null;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly createdAt: number;
  readonly sessionId?: string;
  readonly state: 'unconfirmed' | 'prepared' | 'active' | 'unknown' | 'already-prepared';
}

const storageKey = (actorId: string) => `xiutu:voice-submission:${actorId}`;
const payloadKey = (value: Pick<VoiceSubmission, 'actorId' | 'idempotencyKey'>) =>
  `${storageKey(value.actorId)}:${value.idempotencyKey}`;
const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** A voice preparation has a different contract from an assistant turn. */
export function freezeVoiceSubmission(
  input: Pick<VoiceSubmission, 'actorId' | 'projectId' | 'projectTitle' | 'editorKey'> & {
    body: unknown;
    createdAt?: number;
  },
): VoiceSubmission {
  const body = voiceSessionSchema.parse(input.body);
  const requestBody = JSON.stringify(body);
  return Object.freeze({
    schema: 'voice-session-v1',
    actorId: input.actorId,
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    editorKey: input.editorKey,
    requestBody,
    requestHash: requestBodyHash(requestBody),
    idempotencyKey: body.idempotencyKey,
    createdAt: input.createdAt ?? Date.now(),
    state: 'unconfirmed',
  });
}

export function readVoiceSubmission(
  storage: CheckpointStorage,
  actorId: string,
  payloads: RequestPayloadCache = requestPayloads,
): VoiceSubmission | null {
  const raw = storage.getItem(storageKey(actorId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as VoiceSubmission;
    if (
      value.schema !== 'voice-session-v1' ||
      value.actorId !== actorId ||
      typeof value.projectId !== 'string' ||
      !value.projectId ||
      typeof value.projectTitle !== 'string' ||
      typeof value.editorKey !== 'string' ||
      !validId(value.idempotencyKey) ||
      !Number.isFinite(value.createdAt) ||
      typeof value.requestHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.requestHash) ||
      (value.requestBody !== null && typeof value.requestBody !== 'string') ||
      !['unconfirmed', 'prepared', 'active', 'unknown', 'already-prepared'].includes(value.state) ||
      (value.sessionId !== undefined && !validId(value.sessionId)) ||
      (['prepared', 'active'].includes(value.state) && !value.sessionId)
    )
      throw new Error('Invalid checkpoint');
    const requestBody = restoreRequestBody(
      value.requestBody,
      value.requestHash,
      payloadKey(value),
      payloads,
    );
    if (requestBody !== null) {
      const body = voiceSessionSchema.parse(JSON.parse(requestBody));
      if (body.idempotencyKey !== value.idempotencyKey) throw new Error('Invalid checkpoint');
    }
    return Object.freeze({ ...value, requestBody });
  } catch {
    throw new Error('上次通话的恢复记录无法读取。请先在用量记录中核对，并联系平台运营处理。');
  }
}

/** Persist before POST. Never store a ticket, microphone audio or raw shared image. */
export function saveVoiceSubmission(
  storage: CheckpointStorage,
  value: VoiceSubmission,
  payloads: RequestPayloadCache = requestPayloads,
): void {
  const previous = readVoiceSubmission(storage, value.actorId, payloads);
  if (previous && previous.idempotencyKey !== value.idempotencyKey)
    throw new Error('上次通话的最终状态尚未确认，请先核对原通话。');
  if (previous && previous.requestHash !== value.requestHash)
    throw new Error('原通话请求已冻结，不能修改后复用请求标识。');
  storage.setItem(
    storageKey(value.actorId),
    JSON.stringify({
      schema: value.schema,
      actorId: value.actorId,
      projectId: value.projectId,
      projectTitle: value.projectTitle,
      editorKey: value.editorKey,
      requestBody: persistableRequestBody(value.requestBody, payloadKey(value), payloads),
      requestHash: value.requestHash,
      idempotencyKey: value.idempotencyKey,
      createdAt: value.createdAt,
      sessionId: value.sessionId,
      state: value.state,
    }),
  );
}

export function voiceSubmissionRequest(value: VoiceSubmission): {
  path: string;
  init: RequestInit;
} {
  // The API returns VOICE_ALREADY_PREPARED for an existing key, not its old ticket.
  // There is no user-facing voice GET endpoint. Do not manufacture a recovery URL.
  if (value.sessionId || value.state === 'already-prepared')
    throw new Error('原通话已准备过，平台不会重新发放连接票据。请凭原标识联系平台核验。');
  if (value.requestBody === null)
    throw new Error('原始共享画面只保留在页面内存中，当前无法重放。请凭原请求标识联系平台核验。');
  return {
    path: `/projects/${encodeURIComponent(value.projectId)}/voice-sessions`,
    init: { method: 'POST', body: value.requestBody },
  };
}

export function acceptVoiceSubmission(
  value: VoiceSubmission,
  receipt: { id: string; ticket: string; websocketPath: string },
): VoiceSubmission {
  if (
    !validId(receipt.id) ||
    typeof receipt.ticket !== 'string' ||
    !receipt.ticket ||
    receipt.websocketPath !== `/v1/voice-sessions/${receipt.id}/stream` ||
    (value.sessionId && value.sessionId !== receipt.id)
  )
    throw new Error('未收到与原请求匹配的语音回执，请先核对原通话。');
  return Object.freeze({ ...value, sessionId: receipt.id, state: 'prepared' });
}

/** Only the bound socket's authoritative terminal event can release the local lock. */
export function voiceSubmissionEvent(
  value: VoiceSubmission,
  event: Extract<VoiceServerEvent, { type: 'ready' | 'closed' }>,
): VoiceSubmission | null {
  if (!value.sessionId) throw new Error('语音会话尚未获得有效回执。');
  if (event.type === 'ready') {
    if (event.sessionId !== value.sessionId) throw new Error('语音会话标识与原回执不一致。');
    return Object.freeze({ ...value, state: 'active' });
  }
  if (event.state === 'closed' || event.state === 'failed') return null;
  if (event.state !== 'unknown') throw new Error('无法识别通话的最终状态，请联系平台核验。');
  return Object.freeze({ ...value, state: 'unknown' });
}

export function clearVoiceSubmission(
  storage: CheckpointStorage,
  value: VoiceSubmission,
  payloads: RequestPayloadCache = requestPayloads,
): void {
  const previous = readVoiceSubmission(storage, value.actorId, payloads);
  if (previous?.idempotencyKey === value.idempotencyKey) {
    storage.removeItem(storageKey(value.actorId));
    payloads.delete(payloadKey(value));
  }
}

export function isVoiceAdmissionRejected(error: unknown, wasUnconfirmed: boolean): boolean {
  if (wasUnconfirmed || !(error instanceof ApiError)) return false;
  // These 503s are emitted before reservation; a general 503 is not proof of rejection.
  if (['VOICE_NOT_CONFIGURED', 'ASSISTANT_MODEL_UNAVAILABLE'].includes(error.code)) return true;
  return (
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    !['VOICE_ALREADY_PREPARED', 'IDEMPOTENCY_CONFLICT'].includes(error.code)
  );
}
