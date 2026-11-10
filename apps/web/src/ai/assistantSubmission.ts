import { assistantTurnSchema } from '@ai-xiutu/contracts';
import { ApiError } from '../lib/api';
import {
  persistableRequestBody,
  requestBodyHash,
  requestPayloads,
  restoreRequestBody,
  type RequestPayloadCache,
} from './requestPayload';

type CheckpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AssistantSubmission {
  readonly schemaVersion: 1;
  readonly actorId: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly editorKey: string;
  readonly automatic: boolean;
  readonly requestBody: string | null;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly createdAt: number;
  readonly turnId?: string;
  readonly conversationId?: string;
  readonly state: 'unconfirmed' | 'running' | 'unknown';
}

const storageKey = (actorId: string) => `xiutu:assistant-submission:${actorId}`;
const payloadKey = (value: Pick<AssistantSubmission, 'actorId' | 'idempotencyKey'>) =>
  `${storageKey(value.actorId)}:${value.idempotencyKey}`;
const validTurnId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** Keep the original serialized body: a retry must not recapture a canvas or renew a grant. */
export function freezeAssistantSubmission(
  input: Pick<
    AssistantSubmission,
    'actorId' | 'projectId' | 'projectTitle' | 'editorKey' | 'automatic'
  > & { body: unknown; createdAt?: number },
): AssistantSubmission {
  const body = assistantTurnSchema.parse(input.body);
  const requestBody = JSON.stringify(body);
  return Object.freeze({
    schemaVersion: 1,
    actorId: input.actorId,
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    editorKey: input.editorKey,
    automatic: input.automatic,
    requestBody,
    requestHash: requestBodyHash(requestBody),
    idempotencyKey: body.idempotencyKey,
    prompt: body.prompt,
    createdAt: input.createdAt ?? Date.now(),
    state: 'unconfirmed',
  });
}

export function readAssistantSubmission(
  storage: CheckpointStorage,
  actorId: string,
  payloads: RequestPayloadCache = requestPayloads,
): AssistantSubmission | null {
  const raw = storage.getItem(storageKey(actorId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as AssistantSubmission;
    if (
      value.schemaVersion !== 1 ||
      value.actorId !== actorId ||
      typeof value.projectId !== 'string' ||
      !value.projectId ||
      typeof value.projectTitle !== 'string' ||
      typeof value.editorKey !== 'string' ||
      typeof value.automatic !== 'boolean' ||
      !Number.isFinite(value.createdAt) ||
      !validTurnId(value.idempotencyKey) ||
      typeof value.prompt !== 'string' ||
      !value.prompt ||
      value.prompt.length > 4000 ||
      typeof value.requestHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.requestHash) ||
      (value.requestBody !== null && typeof value.requestBody !== 'string') ||
      !['unconfirmed', 'running', 'unknown'].includes(value.state) ||
      (value.turnId !== undefined && !validTurnId(value.turnId)) ||
      (value.conversationId !== undefined && !validTurnId(value.conversationId)) ||
      (value.state !== 'unconfirmed' && !value.turnId)
    )
      throw new Error('Invalid checkpoint');
    const requestBody = restoreRequestBody(
      value.requestBody,
      value.requestHash,
      payloadKey(value),
      payloads,
    );
    if (requestBody !== null) {
      const body = assistantTurnSchema.parse(JSON.parse(requestBody));
      if (value.idempotencyKey !== body.idempotencyKey || value.prompt !== body.prompt)
        throw new Error('Invalid checkpoint');
    }
    return Object.freeze({ ...value, requestBody });
  } catch {
    // A damaged checkpoint is not evidence that an earlier paid request was rejected.
    throw new Error(
      '上次协作请求的恢复记录无法读取。请先在会话和用量记录中核对结果，再联系平台处理。',
    );
  }
}

/** Persist before POST. Refuse to replace a different unresolved paid request. */
export function saveAssistantSubmission(
  storage: CheckpointStorage,
  value: AssistantSubmission,
  payloads: RequestPayloadCache = requestPayloads,
): void {
  const existing = readAssistantSubmission(storage, value.actorId, payloads);
  if (existing && existing.idempotencyKey !== value.idempotencyKey)
    throw new Error('上一轮协作结果仍待确认，请先恢复原请求。');
  if (existing && existing.requestHash !== value.requestHash)
    throw new Error('原协作请求的内容已冻结，不能修改后复用请求标识。');
  storage.setItem(
    storageKey(value.actorId),
    JSON.stringify({
      ...value,
      requestBody: persistableRequestBody(value.requestBody, payloadKey(value), payloads),
    }),
  );
}

export function assistantSubmissionRequest(value: AssistantSubmission): {
  path: string;
  init: RequestInit;
} {
  if (!value.turnId && value.requestBody === null)
    throw new Error(
      '本轮原始画面只保留在页面内存中，刷新后无法重放。请先查看会话与用量记录并联系平台核对，不能直接创建重复请求。',
    );
  return value.turnId
    ? { path: `/assistant-turns/${encodeURIComponent(value.turnId)}`, init: { method: 'GET' } }
    : {
        path: `/projects/${encodeURIComponent(value.projectId)}/assistant-turns`,
        init: { method: 'POST', body: value.requestBody },
      };
}

/** A late response can clear only the request it acknowledged. */
export function clearAssistantSubmission(
  storage: CheckpointStorage,
  value: AssistantSubmission,
  payloads: RequestPayloadCache = requestPayloads,
): void {
  const existing = readAssistantSubmission(storage, value.actorId, payloads);
  if (existing?.idempotencyKey === value.idempotencyKey) {
    storage.removeItem(storageKey(value.actorId));
    payloads.delete(payloadKey(value));
  }
}

export function acceptAssistantSubmission(
  value: AssistantSubmission,
  turn: { id: string; state: string; conversationId?: string },
): AssistantSubmission {
  if (
    !validTurnId(turn.id) ||
    !['running', 'completed', 'failed', 'unknown', 'stopped'].includes(turn.state) ||
    (turn.conversationId !== undefined && !validTurnId(turn.conversationId))
  )
    throw new Error('未收到有效的协作回执，请按原请求核对结果。');
  if (value.turnId && value.turnId !== turn.id)
    throw new Error('协作回执与原请求不一致，已保留恢复记录。');
  return Object.freeze({
    ...value,
    turnId: turn.id,
    conversationId: turn.conversationId ?? value.conversationId,
    state: turn.state === 'unknown' ? 'unknown' : 'running',
  });
}

export function assistantSubmissionResolved(state: string): boolean {
  return ['completed', 'failed', 'stopped'].includes(state);
}

// These codes are emitted before admission. Permission/read failures may also happen
// when the server is returning an already admitted turn, so they are not included.
const admissionRejections = new Set([
  'AUTH_REQUIRED',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'RECIPE_INVALID',
  'UPLOAD_TOO_LARGE',
  'CONTEXT_NOT_FOUND',
  'CONTEXT_VERSION_CONFLICT',
  'LOCAL_LAYERS_NOT_SAVED',
  'LAYER_SCOPE_FORBIDDEN',
  'SNAPSHOT_SIZE',
  'SNAPSHOT_FORMAT',
  'IMAGE_REVIEW_REQUIRED',
  'ASSISTANT_BUSY',
  'PARENT_TURN_NOT_FOUND',
  'CONTEXT_HISTORY_LIMIT',
  'CONTEXT_SCOPE_REVOKED',
  'PUBLIC_SEARCH_UNAVAILABLE',
  'ASSISTANT_GRANT_EXPIRED',
  'ASSISTANT_ACTION_FORBIDDEN',
  'ASSISTANT_BUDGET_INVALID',
  'ASSISTANT_BUDGET_EXHAUSTED',
  'FREE_QUOTA_EXHAUSTED',
]);

export function isAssistantAdmissionRejected(error: unknown, wasUnconfirmed: boolean): boolean {
  // A retry's refusal cannot resolve a previous transport failure: the first request
  // might still be in flight or its result might no longer be readable.
  if (wasUnconfirmed || !(error instanceof ApiError)) return false;
  // These precise configuration failures occur before admission. A general 503
  // still leaves the original request unresolved.
  if (['ASSISTANT_NOT_CONFIGURED', 'ASSISTANT_MODEL_UNAVAILABLE'].includes(error.code)) return true;
  return error.status >= 400 && error.status < 500 && admissionRejections.has(error.code);
}
