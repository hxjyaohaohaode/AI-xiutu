import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { parseEditorRecipe, type EditorRecipe } from '@ai-xiutu/editor';
import {
  transaction,
  ensureMonthlyGrant,
  reserveUnits,
  settleHold,
  releaseHold,
  markUnknownHold,
  emit,
  audit,
  type Database,
  type Queryable,
} from '@ai-xiutu/db';
import { createTencentTextModerator, ProviderError, type TextModerator } from '@ai-xiutu/providers';
import {
  canonical,
  digest,
  validateQwenEndpoint,
  preparePlan,
  parseProposal,
  createQwenProvider,
  type PlanProvider,
  type PreparedPlan,
} from './provider.js';
import { DispatchJournal } from './journal.js';
import {
  createMultimodalService,
  type MultimodalDependencies,
  type ImageCatalogConfig,
} from './multimodal.js';
export * from './provider.js';
export { DispatchJournal } from './journal.js';

export class AiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
const requestSchema = z
  .object({
    operation: z.literal('edit-plan').default('edit-plan'),
    prompt: z.string().trim().min(1).max(1500),
    modelId: z.string().min(1).max(128),
    idempotencyKey: z.string().uuid(),
    artworkId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    recipe: z.unknown(),
    parentJobId: z.string().uuid().optional(),
  })
  .strict();
interface StoredInput {
  prompt: string;
  artworkId: string;
  expectedVersion: number;
  recipe: EditorRecipe;
  prepared: PreparedPlan;
  requestHash: string;
  proposalVersion?: 2;
  parentJobId?: string;
  threadId?: string;
  threadDepth?: number;
}
interface JobRow {
  id: string;
  project_id: string;
  actor_id: string;
  model_id: string;
  operation: string;
  state: string;
  input_hash: string;
  input: StoredInput;
  output: unknown;
  error_code: string | null;
  hold_id: string;
  units?: number;
  created_at: Date;
  updated_at: Date;
}
function frozenPlanHash(
  input: StoredInput,
  context: { projectId: string; actorId: string; modelId: string },
) {
  return digest(
    canonical({
      operation: 'edit-plan',
      ...context,
      artworkId: input.artworkId,
      expectedVersion: input.expectedVersion,
      recipe: input.recipe,
      endpoint: input.prepared.endpoint,
      body: input.prepared.body,
      ...(input.proposalVersion !== undefined ? { proposalVersion: input.proposalVersion } : {}),
      ...(input.parentJobId
        ? {
            parentJobId: input.parentJobId,
            threadId: input.threadId,
            threadDepth: input.threadDepth,
          }
        : {}),
    }),
  );
}
function jobDto(job: JobRow) {
  const frozen = job.input as unknown as Record<string, any>;
  const source = frozen.input && typeof frozen.input === 'object' ? frozen.input : frozen;
  const request: Record<string, unknown> = { operation: job.operation ?? 'edit-plan' };
  for (const key of [
    'prompt',
    'width',
    'height',
    'imageOptions',
    'referenceAssetId',
    'referenceAssetIds',
    'maskAssetId',
    'markupAssetId',
    'parentJobId',
    'artworkId',
    'expectedVersion',
    'contextDocumentId',
    'expectedDocumentVersion',
    'proposalVersion',
  ]) {
    if (source[key] !== undefined) request[key] = source[key];
  }
  return {
    id: job.id,
    operation: job.operation ?? 'edit-plan',
    prompt: job.input.prompt,
    request,
    parentJobId: frozen.parentJobId ?? null,
    threadId: frozen.threadId ?? job.id,
    contextSummary: {
      parentResultIncluded: Boolean(frozen.manifest?.parentContext),
      contextDocumentId: frozen.manifest?.documentId ?? null,
      documentVersion: frozen.manifest?.documentVersion ?? null,
    },
    projectId: job.project_id,
    artworkId: job.input.artworkId,
    modelId: job.model_id,
    state: job.state,
    inputHash: job.input_hash,
    output: job.output,
    errorCode: job.error_code,
    reservedUnits: Number(job.units ?? 0),
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

async function member(tx: Queryable, actorId: string, projectId: string, edit: boolean) {
  const result = await tx.query(
    `SELECT p.space_id, m.role, s.kind FROM projects p JOIN spaces s ON s.id=p.space_id
    JOIN memberships m ON m.space_id=p.space_id AND m.user_id=$1 JOIN users u ON u.id=m.user_id
    WHERE p.id=$2 AND p.deleted_at IS NULL AND u.status='active' AND u.phone_verified_at IS NOT NULL`,
    [actorId, projectId],
  );
  const row = result.rows[0];
  if (!row || (edit && !['owner', 'admin', 'editor'].includes(row.role)))
    throw new AiError('FORBIDDEN', '当前账号没有使用此项目 AI 的权限', 403);
  return row as { space_id: string; role: string; kind: string };
}

export interface AiDependencies extends MultimodalDependencies {
  provider?: PlanProvider;
  moderator?: TextModerator;
  journal?: DispatchJournal;
}
/** Dependencies are injected by tests only; the application constructs real adapters. */
function createEditPlanService(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: AiDependencies = {},
) {
  const provider = dependencies.provider ?? createQwenProvider(env.DASHSCOPE_API_KEY ?? '');
  const moderator = dependencies.moderator ?? createTencentTextModerator(env);
  const journal =
    dependencies.journal ?? new DispatchJournal(env.AI_JOURNAL_DIR ?? '.data/ai-dispatch-journal');
  let endpoint = '';
  try {
    endpoint = validateQwenEndpoint(
      env.QWEN_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    );
  } catch {
    /* fail closed in readiness */
  }
  const configured =
    env.AI_PLAN_ENABLED === 'true' &&
    provider.configured &&
    moderator.configured &&
    Boolean(endpoint);
  const reason = configured ? null : 'AI 调整建议尚未启用：需配置百炼模型、文本审核及执行开关。';
  const dailyLimit = Math.min(1000, Math.max(1, Number(env.AI_DAILY_JOB_LIMIT ?? 100) || 100));
  const service = {
    configured,
    reason,
    async submit(args: { actorId: string; projectId: string; spaceId: string; body: unknown }) {
      if (!configured) throw new AiError('AI_NOT_CONFIGURED', reason!, 503);
      const body = requestSchema.parse(args.body);
      const recipe = parseEditorRecipe(body.recipe);
      const requestHash = digest(canonical({ ...body, recipe }));
      const proposalVersion = recipe.schemaVersion === 2 ? 2 : 1;
      const prepared = preparePlan(endpoint, body.modelId, body.prompt, recipe, proposalVersion);
      if (Array.from(prepared.moderationText).length > 10_000)
        throw new AiError('INPUT_TOO_LARGE', '完整输入超过审核上限');
      await journal.assertDatabaseMatches(db);
      return transaction(db, async (tx) => {
        const permission = await member(tx, args.actorId, args.projectId, true);
        if (permission.space_id !== args.spaceId)
          throw new AiError('SCOPE_MISMATCH', '付费空间不匹配', 403);
        // One admission lock serializes the daily cap and idempotency checks, never an HTTP call.
        await tx.query("SELECT pg_advisory_xact_lock(hashtext('ai-xiutu-ai-admission'))");
        const prior = await tx.query(
          `SELECT j.*,h.units FROM ai_jobs j LEFT JOIN quota_holds h ON h.id=j.hold_id
          WHERE j.project_id=$1 AND j.actor_id=$2 AND j.idempotency_key=$3`,
          [args.projectId, args.actorId, body.idempotencyKey],
        );
        if (prior.rows[0]) {
          const old = prior.rows[0] as JobRow;
          if (old.input.requestHash !== requestHash)
            throw new AiError('IDEMPOTENCY_CONFLICT', '此请求标识已经用于其他内容', 409);
          return { job: jobDto(old) };
        }
        const artwork = await tx.query(
          'SELECT head_version FROM artworks WHERE id=$1 AND project_id=$2',
          [body.artworkId, args.projectId],
        );
        if (!artwork.rows[0]) throw new AiError('ARTWORK_NOT_FOUND', '请先保存作品', 404);
        if (artwork.rows[0].head_version !== body.expectedVersion)
          throw new AiError('VERSION_CONFLICT', '作品版本已变化，请先同步', 409);
        const settings = await tx.query('SELECT config FROM model_configs WHERE id=$1', [
          body.modelId,
        ]);
        const settingsSchema = z.object({
          enabled: z.literal(true),
          unitCost: z.number().int().min(1).max(100000),
          provider: z.literal('qwen').default('qwen'),
          operations: z.array(z.string()).default(['edit-plan']),
        });
        const validated = settingsSchema.safeParse(settings.rows[0]?.config);
        if (!validated.success || !validated.data.operations.includes('edit-plan'))
          throw new AiError('MODEL_NOT_CONFIGURED', '运营端尚未配置此模型的服务点价格', 503);
        const count = await tx.query(
          `SELECT count(*)::int AS n FROM ai_jobs WHERE created_at>=date_trunc('day',clock_timestamp())`,
        );
        const active = await tx.query(
          "SELECT count(*)::int AS n FROM ai_jobs WHERE actor_id=$1 AND state IN ('queued','running','unknown')",
          [args.actorId],
        );
        if (count.rows[0]!.n >= dailyLimit || active.rows[0]!.n >= 5)
          throw new AiError('AI_CAPACITY_LIMIT', '今日请求上限或待处理任务数已达上限', 429);
        // Team wallets do not silently borrow the actor's personal quota.
        if (permission.kind === 'personal') await ensureMonthlyGrant(tx, args.actorId);
        const hold = await reserveUnits(tx, {
          spaceId: args.spaceId,
          userId: args.actorId,
          idempotencyKey: `ai:${args.projectId}:${args.actorId}:${body.idempotencyKey}`,
          requestHash,
          units: validated.data.unitCost,
        });
        const id = randomUUID();
        const input: StoredInput = {
          prompt: body.prompt,
          artworkId: body.artworkId,
          expectedVersion: body.expectedVersion,
          recipe,
          prepared,
          requestHash,
          ...(proposalVersion === 2 ? { proposalVersion: 2 as const } : {}),
        };
        if (body.parentJobId) {
          const parent = (
            await tx.query(
              'SELECT id,state,operation,input FROM ai_jobs WHERE id=$1 AND project_id=$2',
              [body.parentJobId, args.projectId],
            )
          ).rows[0];
          if (
            !parent ||
            parent.state !== 'completed' ||
            parent.operation !== 'edit-plan' ||
            parent.input?.artworkId !== body.artworkId
          )
            throw new AiError('PARENT_JOB_NOT_USABLE', '只能继续当前作品已完成的调整建议');
          const depth = Number(parent.input?.threadDepth ?? 0) + 1;
          if (!Number.isSafeInteger(depth) || depth > 50)
            throw new AiError('THREAD_DEPTH_LIMIT', '此创作分支已达到50轮');
          input.parentJobId = parent.id;
          input.threadId = parent.input?.threadId ?? parent.id;
          input.threadDepth = depth;
        }
        const frozenHash = frozenPlanHash(input, {
          projectId: args.projectId,
          actorId: args.actorId,
          modelId: body.modelId,
        });
        const inserted = await tx.query(
          `INSERT INTO ai_jobs(id,project_id,actor_id,model_id,input_hash,state,hold_id,operation,idempotency_key,input)
          VALUES($1,$2,$3,$4,$5,'queued',$6,'edit-plan',$7,$8) RETURNING *`,
          [
            id,
            args.projectId,
            args.actorId,
            body.modelId,
            frozenHash,
            hold.id,
            body.idempotencyKey,
            JSON.stringify(input),
          ],
        );
        await emit(tx, args.spaceId, args.projectId, 'ai.queued', id);
        return { job: jobDto({ ...inserted.rows[0], units: hold.units } as JobRow) };
      });
    },
    async list(args: { actorId: string; projectId: string }) {
      await member(db, args.actorId, args.projectId, false);
      const rows = await db.query(
        `SELECT j.*,h.units FROM ai_jobs j LEFT JOIN quota_holds h ON h.id=j.hold_id
        WHERE j.project_id=$1 ORDER BY j.created_at DESC LIMIT 100`,
        [args.projectId],
      );
      return { jobs: rows.rows.map((row) => jobDto(row as JobRow)) };
    },
    async resolve(args: { actorId: string; jobId: string; body: unknown }) {
      const body = z
        .object({
          resolution: z.enum(['release', 'settle']),
          reason: z.string().trim().min(10).max(1000),
          evidenceRef: z.string().trim().min(3).max(200),
        })
        .strict()
        .parse(args.body);
      return transaction(db, async (tx) => {
        const operator = await tx.query(
          "SELECT 1 FROM operator_users o JOIN users u ON u.id=o.user_id WHERE o.user_id=$1 AND u.status='active'",
          [args.actorId],
        );
        if (!operator.rowCount) throw new AiError('FORBIDDEN', '仅运营人员可核验未知请求', 403);
        const rows = await tx.query('SELECT * FROM ai_jobs WHERE id=$1 FOR UPDATE', [args.jobId]);
        const row = rows.rows[0] as JobRow | undefined;
        if (!row) throw new AiError('JOB_NOT_FOUND', '任务不存在', 404);
        const terminalCode = body.resolution === 'release' ? 'MANUAL_RELEASED' : 'MANUAL_SETTLED';
        if (row.state === 'failed' && row.error_code === terminalCode)
          return { ok: true, state: 'failed', resolution: body.resolution };
        if (row.state !== 'unknown')
          throw new AiError('JOB_NOT_UNKNOWN', '只能对待核验任务做人工处理', 409);
        if (body.resolution === 'release') await releaseHold(tx, row.hold_id);
        else await settleHold(tx, row.hold_id);
        await tx.query(
          "UPDATE ai_jobs SET state='failed',error_code=$2,updated_at=clock_timestamp() WHERE id=$1",
          [args.jobId, terminalCode],
        );
        await audit(tx, args.actorId, 'ai.unknown_resolved', 'ai_job', args.jobId, {
          resolution: body.resolution,
          reason: body.reason,
          evidenceRef: body.evidenceRef,
        });
        return { ok: true, state: 'failed', resolution: body.resolution };
      });
    },
    async runOnce(): Promise<boolean> {
      if (!configured) return false;
      await journal.assertDatabaseMatches(db);
      // Lost workers are never automatically resubmitted to a billable vendor.
      await transaction(db, async (tx) => {
        const stale = await tx.query(
          "SELECT * FROM ai_jobs WHERE state='running' AND operation='edit-plan' AND lease_started_at<clock_timestamp()-interval '5 minutes' FOR UPDATE SKIP LOCKED",
        );
        for (const row of stale.rows) {
          await markUnknownHold(tx, row.hold_id);
          await tx.query(
            "UPDATE ai_jobs SET state='unknown',error_code='WORKER_LOST',updated_at=clock_timestamp() WHERE id=$1",
            [row.id],
          );
        }
      });
      const claimed = await transaction(db, async (tx) => {
        const selected = await tx.query(
          "SELECT * FROM ai_jobs WHERE state='queued' AND operation='edit-plan' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED",
        );
        if (!selected.rows[0]) return null;
        const job = selected.rows[0] as JobRow;
        try {
          await member(tx, job.actor_id, job.project_id, true);
        } catch {
          await releaseHold(tx, job.hold_id);
          await tx.query(
            "UPDATE ai_jobs SET state='cancelled',error_code='ACCESS_REVOKED',updated_at=clock_timestamp() WHERE id=$1",
            [job.id],
          );
          return null;
        }
        await tx.query(
          "UPDATE ai_jobs SET state='running',lease_started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",
          [job.id],
        );
        return job;
      });
      if (!claimed) return false;
      const job = claimed;
      let vendorAttempted = false;
      let vendorCompleted = false;
      let providerRequestId = '';
      try {
        const firstDispatch = await journal.start(job.id, job.input_hash);
        if (!firstDispatch) throw new ProviderError('DISPATCH_ALREADY_RECORDED', 'unknown');
        if (
          job.input.prepared.hash !==
            digest(
              canonical({ endpoint: job.input.prepared.endpoint, body: job.input.prepared.body }),
            ) ||
          frozenPlanHash(job.input, {
            projectId: job.project_id,
            actorId: job.actor_id,
            modelId: job.model_id,
          }) !== job.input_hash
        ) {
          throw new AiError('INPUT_INTEGRITY_FAILED', '冻结输入不匹配');
        }
        if (JSON.parse(job.input.prepared.body).model !== job.model_id)
          throw new AiError('INPUT_INTEGRITY_FAILED', '模型与冻结请求不匹配');
        if (job.input.prepared.endpoint !== endpoint)
          throw new AiError('PROVIDER_CONFIG_CHANGED', '供应商配置已变化，请取消后重新提交');
        if (
          job.input.proposalVersion !== undefined &&
          (job.input.proposalVersion !== 2 || job.input.recipe.schemaVersion !== 2)
        )
          throw new AiError('INPUT_INTEGRITY_FAILED', '建议协议与配方版本不匹配');
        const before = await moderator.check(job.input.prepared.body, job.id);
        if (before.inputHash !== digest(job.input.prepared.body) || before.decision !== 'passed')
          throw new AiError('INPUT_REVIEW_REQUIRED', '请求未通过内容审核');
        await member(db, job.actor_id, job.project_id, true);
        const currentModel = (
          await db.query('SELECT config FROM model_configs WHERE id=$1', [job.model_id])
        ).rows[0]?.config;
        if (
          !currentModel?.enabled ||
          (currentModel.provider ?? 'qwen') !== 'qwen' ||
          !(currentModel.operations ?? ['edit-plan']).includes('edit-plan')
        )
          throw new AiError('MODEL_DISABLED', '模型已被运营人员关闭');
        vendorAttempted = true;
        const result = await provider.complete(job.input.prepared);
        providerRequestId = result.requestId;
        vendorCompleted = true;
        const proposal = parseProposal(
          result.value,
          parseEditorRecipe(job.input.recipe),
          job.input.proposalVersion ?? 1,
        );
        // The model never receives or changes existing region masks. Review the complete
        // newly-generated summary/numeric changes, not megabytes of preserved RLE data.
        const outputText = canonical(
          proposal.proposalVersion === 2
            ? {
                summary: proposal.summary,
                proposalVersion: 2,
                parameterChanges: proposal.parameterChanges,
              }
            : proposal,
        );
        const after = await moderator.check(outputText, job.id);
        if (after.inputHash !== digest(outputText) || after.decision !== 'passed')
          throw new AiError('OUTPUT_REVIEW_REQUIRED', '建议未通过内容审核');
        await transaction(db, async (tx) => {
          const current = await tx.query('SELECT state FROM ai_jobs WHERE id=$1 FOR UPDATE', [
            job.id,
          ]);
          if (current.rows[0]?.state !== 'running')
            throw new AiError('JOB_STATE_CHANGED', '任务状态已变化');
          const permission = await member(tx, job.actor_id, job.project_id, true);
          const output = {
            kind: 'edit-plan',
            ...proposal,
            artworkId: job.input.artworkId,
            baseVersion: job.input.expectedVersion,
            inputHash: job.input_hash,
          };
          await settleHold(tx, job.hold_id);
          await tx.query(
            "UPDATE ai_jobs SET state='completed',output=$2,provider_request_id=$3,updated_at=clock_timestamp() WHERE id=$1",
            [job.id, JSON.stringify(output), result.requestId],
          );
          await emit(tx, permission.space_id, job.project_id, 'ai.completed', job.id);
        });
      } catch (error) {
        const receipt = (error as { requestId?: unknown })?.requestId;
        if (
          !providerRequestId &&
          typeof receipt === 'string' &&
          /^[A-Za-z0-9._:/-]{1,256}$/.test(receipt)
        )
          providerRequestId = receipt;
        const uncertain =
          vendorCompleted ||
          (error instanceof ProviderError ? error.outcome === 'unknown' : vendorAttempted);
        const code =
          error instanceof AiError || error instanceof ProviderError
            ? error.code
            : 'AI_PROCESSING_FAILED';
        await transaction(db, async (tx) => {
          const current = await tx.query('SELECT state FROM ai_jobs WHERE id=$1 FOR UPDATE', [
            job.id,
          ]);
          if (current.rows[0]?.state !== 'running') return;
          if (uncertain) await markUnknownHold(tx, job.hold_id);
          else await releaseHold(tx, job.hold_id);
          await tx.query(
            "UPDATE ai_jobs SET state=$2,error_code=$3,provider_request_id=COALESCE(NULLIF($4,''),provider_request_id),updated_at=clock_timestamp() WHERE id=$1",
            [job.id, uncertain ? 'unknown' : 'failed', code, providerRequestId],
          );
          await audit(tx, job.actor_id, uncertain ? 'ai.unknown' : 'ai.failed', 'ai_job', job.id, {
            code,
          });
        });
      }
      return true;
    },
  };
  return service;
}

/** All operations share the same immutable jobs, wallet and reconciliation protocol. */
export function createAiService(
  db: Database,
  env: NodeJS.ProcessEnv = process.env,
  dependencies: AiDependencies = {},
) {
  const plan = createEditPlanService(db, env, dependencies);
  const multimodal = createMultimodalService(db, env, dependencies);
  const availableOperations = [
    ...(plan.configured ? ['edit-plan'] : []),
    ...multimodal.availableOperations,
  ];
  const operationStatus = {
    'edit-plan': { available: plan.configured, reason: plan.reason },
    ...multimodal.operationStatus,
  };
  let preferMultimodal = false;
  return {
    configured: availableOperations.length > 0,
    reason: availableOperations.length
      ? null
      : 'AI 服务尚未配置。请在运营端设置模型，并由服务器配置对应供应商、审核凭据和执行开关。',
    availableOperations,
    operationStatus,
    providerModelCatalog: multimodal.providerModelCatalog,
    describeModel(id: string, config: ImageCatalogConfig) {
      const description = multimodal.describeModel(id, config);
      if (
        (config.provider ?? 'qwen') === 'qwen' &&
        plan.configured &&
        (config.operations ?? ['edit-plan']).includes('edit-plan')
      )
        description.runtimeOperations.push('edit-plan');
      return {
        ...description,
        runtimeAvailable: description.runtimeOperations.length > 0,
        runtimeReason: description.runtimeOperations.length ? null : description.runtimeReason,
      };
    },
    submit(args: { actorId: string; projectId: string; spaceId: string; body: unknown }) {
      const operation = (args.body as { operation?: string } | null)?.operation ?? 'edit-plan';
      return operation === 'edit-plan' ? plan.submit(args) : multimodal.submit(args);
    },
    list: plan.list,
    resolve: plan.resolve,
    async runOnce() {
      preferMultimodal = !preferMultimodal;
      return preferMultimodal
        ? (await multimodal.runOnce()) || (await plan.runOnce())
        : (await plan.runOnce()) || (await multimodal.runOnce());
    },
  };
}
