import { parseEditorRecipe } from '@ai-xiutu/editor';
import { ApiError } from '../lib/api';
import type { AIJob, AIOperation } from './types';
import {
  persistableRequestBody,
  requestBodyHash,
  requestPayloads,
  restoreRequestBody,
  type RequestPayloadCache,
} from './requestPayload';

type CheckpointStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const operations: AIOperation[] = [
  'edit-plan',
  'generate-image',
  'generate-text',
  'transcribe',
  ...OPENAI_SPECIALIST_OPERATIONS,
];
const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export interface JobSubmission {
  readonly schema: 'ai-job-v1';
  readonly actorId: string;
  readonly projectId: string;
  readonly projectTitle: string;
  readonly operation: AIOperation;
  readonly modelId: string;
  readonly idempotencyKey: string;
  readonly prompt: string;
  readonly requestBody: string | null;
  readonly requestHash: string;
  readonly recipeSnapshot: string;
  readonly createdAt: number;
  readonly jobId?: string;
  readonly state: 'unconfirmed' | AIJob['state'];
}

const storageKey = (actorId: string) => `xiutu:ai-job-submission:${actorId}`;
const payloadKey = (value: Pick<JobSubmission, 'actorId' | 'idempotencyKey'>) =>
  `${storageKey(value.actorId)}:${value.idempotencyKey}`;

/** This is the /ai-jobs wire shape, deliberately separate from assistantTurnSchema. */
function validateJobRequest(raw: unknown): Record<string, unknown> & {
  operation: AIOperation;
  idempotencyKey: string;
  modelId: string;
  prompt?: string;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('创作请求不完整。');
  const body = raw as Record<string, unknown>;
  if (
    !operations.includes(body.operation as AIOperation) ||
    !validId(body.idempotencyKey) ||
    typeof body.modelId !== 'string' ||
    !body.modelId ||
    body.modelId.length > 128
  )
    throw new Error('创作请求的类型、模型或请求标识不完整。');
  const allowed = {
    'edit-plan': ['prompt', 'artworkId', 'expectedVersion', 'recipe', 'parentJobId'],
    'generate-image': [
      'prompt',
      'width',
      'height',
      'imageOptions',
      'referenceAssetId',
      'referenceAssetIds',
      'maskAssetId',
      'markupAssetId',
      'parentJobId',
      'executionGrantId',
    ],
    'generate-text': ['prompt', 'contextDocumentId', 'expectedDocumentVersion', 'parentJobId'],
    transcribe: ['audioBase64', 'transcriptionOptions'],
    speak: ['prompt', 'options'],
    'audio-chat': ['prompt', 'options', 'audioBase64'],
    'web-search': ['prompt', 'options'],
    embed: ['prompt', 'options'],
    'translate-audio': ['audioBase64', 'options'],
  }[body.operation as AIOperation];
  if (
    Object.keys(body).some(
      (key) => !['operation', 'modelId', 'idempotencyKey', ...allowed].includes(key),
    )
  )
    throw new Error('创作请求包含当前任务不支持的字段。');
  if (
    body.operation === 'transcribe' ||
    body.operation === 'translate-audio' ||
    (body.operation === 'audio-chat' && body.audioBase64 !== undefined)
  ) {
    if (
      typeof body.audioBase64 !== 'string' ||
      body.audioBase64.length < 60 ||
      body.audioBase64.length > 1_280_128 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body.audioBase64)
    )
      throw new Error('请先准备有效的录音。');
  }
  if (
    body.operation !== 'transcribe' &&
    body.operation !== 'translate-audio' &&
    (typeof body.prompt !== 'string' ||
      !body.prompt.trim() ||
      body.prompt.trim().length >
        (body.operation === 'generate-image'
          ? 4000
          : body.operation === 'speak' || body.operation === 'embed'
            ? 4096
            : 1500))
  )
    throw new Error('创作要求为空或超过当前任务的字数限制。');
  if (body.operation === 'edit-plan') {
    if (
      !validId(body.artworkId) ||
      !Number.isSafeInteger(body.expectedVersion) ||
      Number(body.expectedVersion) < 1
    )
      throw new Error('请先保存当前作品版本。');
    parseEditorRecipe(body.recipe);
  }
  if (
    body.operation === 'generate-image' &&
    ['width', 'height'].some(
      (key) =>
        !Number.isSafeInteger(body[key]) || Number(body[key]) < 64 || Number(body[key]) > 8192,
    )
  )
    throw new Error('图片尺寸超出当前任务的范围。');
  return body as ReturnType<typeof validateJobRequest>;
}

export function freezeJobSubmission(input: {
  actorId: string;
  projectId: string;
  projectTitle: string;
  body: unknown;
  recipeSnapshot: string;
}): JobSubmission {
  const body = validateJobRequest(input.body);
  const requestBody = JSON.stringify(body);
  return Object.freeze({
    schema: 'ai-job-v1',
    actorId: input.actorId,
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    operation: body.operation,
    modelId: body.modelId,
    idempotencyKey: body.idempotencyKey,
    prompt: body.prompt?.trim() ?? '',
    requestBody,
    requestHash: requestBodyHash(requestBody),
    recipeSnapshot: input.recipeSnapshot,
    createdAt: Date.now(),
    state: 'unconfirmed',
  });
}

export function readJobSubmission(
  storage: CheckpointStorage,
  actorId: string,
  payloads: RequestPayloadCache = requestPayloads,
): JobSubmission | null {
  const raw = storage.getItem(storageKey(actorId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as JobSubmission;
    if (
      value.schema !== 'ai-job-v1' ||
      value.actorId !== actorId ||
      !validId(value.projectId) ||
      !validId(value.idempotencyKey) ||
      typeof value.projectTitle !== 'string' ||
      typeof value.modelId !== 'string' ||
      !operations.includes(value.operation) ||
      typeof value.prompt !== 'string' ||
      typeof value.recipeSnapshot !== 'string' ||
      !Number.isFinite(value.createdAt) ||
      typeof value.requestHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.requestHash) ||
      (value.requestBody !== null && typeof value.requestBody !== 'string') ||
      !['unconfirmed', 'queued', 'running', 'unknown', 'completed', 'failed', 'cancelled'].includes(
        value.state,
      ) ||
      (value.jobId !== undefined && !validId(value.jobId)) ||
      (value.state !== 'unconfirmed' && !value.jobId)
    )
      throw new Error('Invalid checkpoint');
    const requestBody = restoreRequestBody(
      value.requestBody,
      value.requestHash,
      payloadKey(value),
      payloads,
    );
    if (requestBody !== null) {
      const body = validateJobRequest(JSON.parse(requestBody));
      if (
        body.operation !== value.operation ||
        body.idempotencyKey !== value.idempotencyKey ||
        body.modelId !== value.modelId ||
        (body.prompt?.trim() ?? '') !== value.prompt
      )
        throw new Error('Invalid checkpoint');
    }
    return Object.freeze({ ...value, requestBody });
  } catch {
    throw new Error(
      '上次创作请求的恢复记录无法读取。请先核对项目任务和用量记录，不能直接创建重复请求。',
    );
  }
}

export function saveJobSubmission(
  storage: CheckpointStorage,
  value: JobSubmission,
  payloads: RequestPayloadCache = requestPayloads,
): void {
  const existing = readJobSubmission(storage, value.actorId, payloads);
  if (existing && existing.idempotencyKey !== value.idempotencyKey)
    throw new Error('上一轮创作结果仍待确认，请先恢复原请求。');
  if (existing && existing.requestHash !== value.requestHash)
    throw new Error('原创作请求已冻结，不能更换参数后复用请求标识。');
  storage.setItem(
    storageKey(value.actorId),
    JSON.stringify({
      ...value,
      requestBody: persistableRequestBody(value.requestBody, payloadKey(value), payloads),
    }),
  );
}

export function clearJobSubmission(
  storage: CheckpointStorage,
  value: JobSubmission,
  payloads: RequestPayloadCache = requestPayloads,
): void {
  if (readJobSubmission(storage, value.actorId, payloads)?.idempotencyKey !== value.idempotencyKey)
    return;
  storage.removeItem(storageKey(value.actorId));
  payloads.delete(payloadKey(value));
}

export function acceptJobSubmission(value: JobSubmission, job: AIJob): JobSubmission {
  if (
    !validId(job.id) ||
    !['queued', 'running', 'unknown', 'completed', 'failed', 'cancelled'].includes(job.state) ||
    (job.projectId !== undefined && job.projectId !== value.projectId) ||
    (job.operation !== undefined && job.operation !== value.operation) ||
    job.modelId !== value.modelId ||
    (value.jobId !== undefined && value.jobId !== job.id)
  )
    throw new Error('任务回执与原请求不一致，已保留恢复记录。');
  return Object.freeze({ ...value, jobId: job.id, state: job.state });
}

export const jobSubmissionResolved = (state: string) =>
  ['completed', 'failed', 'cancelled'].includes(state);

export function jobSubmissionRequest(value: JobSubmission): { path: string; init: RequestInit } {
  const path = `/projects/${encodeURIComponent(value.projectId)}/ai-jobs`;
  // The existing API has a project list, not a GET /ai-jobs/:id route.
  if (value.jobId) return { path, init: { method: 'GET' } };
  if (value.requestBody === null)
    throw new Error('原始录音只保留在页面内存中，刷新后无法重放。请先核对项目任务和用量记录。');
  return { path, init: { method: 'POST', body: value.requestBody } };
}

export function isJobAdmissionRejected(error: unknown, retry: boolean): boolean {
  if (retry || !(error instanceof ApiError)) return false;
  if (
    [
      'AI_EXECUTION_DISABLED',
      'AI_NOT_CONFIGURED',
      'MODEL_NOT_CONFIGURED',
      'MODEL_NOT_ALLOWED',
    ].includes(error.code)
  )
    return true;
  return (
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.code !== 'IDEMPOTENCY_CONFLICT'
  );
}
import { OPENAI_SPECIALIST_OPERATIONS } from '@ai-xiutu/contracts';
