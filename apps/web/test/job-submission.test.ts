import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRecipeV4 } from '@ai-xiutu/editor';
import { ApiError } from '../src/lib/api.ts';
import type { AIJob } from '../src/ai/types.ts';
import {
  acceptJobSubmission,
  clearJobSubmission,
  freezeJobSubmission,
  isJobAdmissionRejected,
  jobSubmissionRequest,
  jobSubmissionResolved,
  readJobSubmission,
  saveJobSubmission,
} from '../src/ai/jobSubmission.ts';

const key = '10000000-0000-4000-8000-000000000001';
const nextKey = '10000000-0000-4000-8000-000000000002';
const projectId = '20000000-0000-4000-8000-000000000001';
const assetId = '30000000-0000-4000-8000-000000000001';
const jobId = '40000000-0000-4000-8000-000000000001';
const grantId = '50000000-0000-4000-8000-000000000001';
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
const base = () => ({
  actorId: 'actor-a',
  projectId,
  projectTitle: 'Project',
  recipeSnapshot: JSON.stringify(createRecipeV4()),
});
const body = (idempotencyKey = key) => ({
  operation: 'generate-image',
  modelId: 'configured-image-model',
  idempotencyKey,
  prompt: 'Create a natural product photograph',
  width: 1024,
  height: 1536,
  referenceAssetIds: [assetId],
  imageOptions: { quality: 'high', n: 2 },
  executionGrantId: grantId,
});
const job = (state: AIJob['state'] = 'queued'): AIJob => ({
  id: jobId,
  projectId,
  operation: 'generate-image',
  modelId: 'configured-image-model',
  state,
  output: null,
  errorCode: null,
  reservedUnits: 20,
  createdAt: '2026-11-10T00:00:00Z',
  updatedAt: '2026-11-10T00:00:00Z',
});

test('the legacy job request freezes references, generation options, grant, model and key across panel lifetimes', () => {
  const checkpoint = storage();
  const original = body();
  const frozen = freezeJobSubmission({ ...base(), body: original });
  saveJobSubmission(checkpoint, frozen);
  original.prompt = 'different request';
  original.referenceAssetIds.length = 0;
  original.imageOptions.n = 1;
  original.width = 2048;
  original.executionGrantId = nextKey;
  const restored = readJobSubmission(checkpoint, 'actor-a')!;
  assert.deepEqual(jobSubmissionRequest(restored), jobSubmissionRequest(frozen));
  const posted = JSON.parse(restored.requestBody!);
  assert.equal(posted.idempotencyKey, key);
  assert.deepEqual(posted.referenceAssetIds, [assetId]);
  assert.equal(posted.imageOptions.n, 2);
  assert.equal(posted.width, 1024);
  assert.equal(posted.executionGrantId, grantId);
  assert.equal(readJobSubmission(checkpoint, 'actor-b'), null);
  assert.throws(
    () => saveJobSubmission(checkpoint, freezeJobSubmission({ ...base(), body: body(nextKey) })),
    /上一轮创作结果仍待确认/,
  );
});

test('job recovery uses the existing project list after admission and never invents a per-job GET', () => {
  const frozen = freezeJobSubmission({ ...base(), body: body() });
  const queued = acceptJobSubmission(frozen, job());
  const uncertain = acceptJobSubmission(queued, job('unknown'));
  for (const saved of [queued, uncertain]) {
    assert.deepEqual(jobSubmissionRequest(saved), {
      path: `/projects/${projectId}/ai-jobs`,
      init: { method: 'GET' },
    });
    assert.equal(jobSubmissionResolved(saved.state), false);
  }
  for (const state of ['completed', 'failed', 'cancelled'])
    assert.equal(jobSubmissionResolved(state), true);
  assert.throws(() => acceptJobSubmission(queued, { ...job(), id: nextKey }), /回执与原请求不一致/);
  assert.throws(
    () => acceptJobSubmission(queued, { ...job(), modelId: 'another-model' }),
    /回执与原请求不一致/,
  );
});

test('closing after admission but before receipt preserves the key; an explicit retry has one paid admission', async () => {
  const checkpoint = storage();
  const frozen = freezeJobSubmission({ ...base(), body: body() });
  const admitted = new Map<string, AIJob>();
  let charges = 0;
  let drop = true;
  const methods: string[] = [];
  async function server(request: ReturnType<typeof jobSubmissionRequest>) {
    methods.push(request.init.method!);
    if (request.init.method === 'GET') return { jobs: [...admitted.values()] };
    const input = JSON.parse(request.init.body as string);
    if (!admitted.has(input.idempotencyKey)) {
      charges++;
      admitted.set(input.idempotencyKey, job());
    }
    if (drop) {
      drop = false;
      throw new ApiError('NETWORK_UNAVAILABLE', 'receipt lost', 0);
    }
    return { job: admitted.get(input.idempotencyKey)! };
  }
  saveJobSubmission(checkpoint, frozen);
  await assert.rejects(server(jobSubmissionRequest(frozen)), /receipt lost/);
  const reopened = readJobSubmission(checkpoint, 'actor-a')!;
  assert.equal(methods.length, 1, 'a mount/read does not send a paid request');
  const receipt = await server(jobSubmissionRequest(reopened));
  const accepted = acceptJobSubmission(reopened, receipt.job!);
  saveJobSubmission(checkpoint, accepted);
  await server(jobSubmissionRequest(readJobSubmission(checkpoint, 'actor-a')!));
  assert.equal(charges, 1);
  assert.deepEqual(methods, ['POST', 'POST', 'GET']);
});

test('audio stays in page memory; after refresh its identity stays locked without fabricating a replacement payload', () => {
  const checkpoint = storage();
  const payloads = new Map<string, string>();
  const audioBase64 = 'A'.repeat(64);
  const frozen = freezeJobSubmission({
    ...base(),
    body: {
      operation: 'transcribe',
      modelId: 'configured-speech-model',
      idempotencyKey: key,
      audioBase64,
    },
  });
  saveJobSubmission(checkpoint, frozen, payloads);
  const persisted = [...checkpoint.entries.values()][0]!;
  assert.equal(persisted.includes(audioBase64), false);
  assert.equal(persisted.includes('audioBase64'), false);
  assert.equal(readJobSubmission(checkpoint, 'actor-a', payloads)?.requestBody, frozen.requestBody);
  const afterRefresh = readJobSubmission(checkpoint, 'actor-a', new Map())!;
  assert.equal(afterRefresh.idempotencyKey, key);
  assert.equal(afterRefresh.requestBody, null);
  assert.throws(() => jobSubmissionRequest(afterRefresh), /原始录音只保留在页面内存/);
  assert.throws(
    () =>
      saveJobSubmission(
        checkpoint,
        freezeJobSubmission({ ...base(), body: body(nextKey) }),
        new Map(),
      ),
    /上一轮创作结果仍待确认/,
  );
});

test('job and assistant schemas cannot be mixed, and every legacy operation keeps its actual prompt limit', () => {
  assert.throws(
    () =>
      freezeJobSubmission({
        ...base(),
        body: { modelId: 'model', idempotencyKey: key, prompt: 'test', context: {}, scope: {} },
      }),
    /类型、模型或请求标识/,
  );
  assert.throws(
    () =>
      freezeJobSubmission({
        ...base(),
        body: { ...body(), imageDataUrl: 'data:image/png;base64,AAAA' },
      }),
    /不支持的字段/,
  );
  assert.throws(
    () =>
      freezeJobSubmission({
        ...base(),
        body: {
          operation: 'generate-text',
          modelId: 'model',
          idempotencyKey: key,
          prompt: 'a'.repeat(1501),
        },
      }),
    /字数限制/,
  );
  assert.doesNotThrow(() =>
    freezeJobSubmission({ ...base(), body: { ...body(), prompt: 'a'.repeat(4000) } }),
  );
  assert.doesNotThrow(() =>
    freezeJobSubmission({
      ...base(),
      body: {
        operation: 'edit-plan',
        modelId: 'model',
        idempotencyKey: key,
        prompt: 'Adjust light',
        artworkId: assetId,
        expectedVersion: 3,
        recipe: createRecipeV4(),
      },
    }),
  );
});

test('only an explicit first-attempt rejection releases the guard; retries and ambiguous responses remain locked', () => {
  const denied = new ApiError('VERSION_CONFLICT', 'changed version', 409);
  assert.equal(isJobAdmissionRejected(denied, false), true);
  assert.equal(isJobAdmissionRejected(denied, true), false);
  for (const error of [
    new ApiError('NETWORK_UNAVAILABLE', 'offline', 0),
    new ApiError('HTTP_503', 'unknown', 503),
    new ApiError('HTTP_408', 'timeout', 408),
    new ApiError('IDEMPOTENCY_CONFLICT', 'conflict', 409),
    new SyntaxError('bad JSON'),
  ]) {
    assert.equal(isJobAdmissionRejected(error, false), false);
    assert.equal(isJobAdmissionRejected(error, true), false);
  }
});

test('a late old receipt cannot clear a newer checkpoint, and corrupted checkpoints fail closed', () => {
  const checkpoint = storage();
  const original = freezeJobSubmission({ ...base(), body: body() });
  saveJobSubmission(checkpoint, original);
  clearJobSubmission(checkpoint, original);
  const next = freezeJobSubmission({ ...base(), body: body(nextKey) });
  saveJobSubmission(checkpoint, next);
  clearJobSubmission(checkpoint, original);
  assert.equal(readJobSubmission(checkpoint, 'actor-a')?.idempotencyKey, nextKey);
  const slot = [...checkpoint.entries.keys()][0]!;
  checkpoint.setItem(slot, '{broken');
  assert.throws(() => readJobSubmission(checkpoint, 'actor-a'), /恢复记录无法读取/);
  assert.throws(() => saveJobSubmission(checkpoint, original), /恢复记录无法读取/);
});
