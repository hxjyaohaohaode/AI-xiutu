import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { z, ZodError } from 'zod';
import { listUnknownAiJobs } from './ai-reconciliation.js';
import { createDatabase, migrate, QuotaError, type Database } from '@ai-xiutu/db';
import {
  createTencentSms,
  createTencentTextModerator,
  ProviderError,
  type SmsAdapter,
} from '@ai-xiutu/providers';
import { RecipeValidationError } from '@ai-xiutu/editor';
import { assistantModelConfigSchema, VOICE_MODELS } from '@ai-xiutu/assistant';
import { loadConfig, type AppConfig } from './config.js';
import {
  HttpError,
  hash,
  id,
  requireUser,
  requireOperator,
  projectAccess,
  rateLimit,
  type User,
} from './core.js';
import { registerAuth } from './auth.js';
import { registerSpaces } from './spaces.js';
import { registerProjects } from './projects.js';
import { registerRevisionRender } from './revision-render.js';
import { registerAssetAnnotations } from './asset-annotations.js';
import { registerAiDecisions } from './ai-decisions.js';
import { registerAssetCopy } from './asset-copy.js';
import { registerEditorContract } from './editor-contract.js';
import { createBuiltinRegistry, type RuntimeGate } from '@ai-xiutu/contracts';
import { registerCollaboration } from './collaboration.js';
import { registerRealtimeCollaboration } from './realtime-collaboration.js';
import { registerResources } from './resources.js';
import { registerUsage } from './usage.js';
import { registerMediaImport } from './media-import.js';
import { registerAssistant, type AssistantDependencies } from './assistant/index.js';
import { registerSharing } from './sharing.js';
import { registerOperations, publicSettings, modelDto } from './operations.js';
import { LocalPrivateStorage, StorageError } from './storage.js';

export interface AiService {
  configured: boolean;
  reason: string | null;
  availableOperations?: string[];
  operationStatus?: Record<string, { available: boolean; reason: string | null }>;
  providerModelCatalog?: readonly unknown[];
  describeModel?(
    id: string,
    config: {
      provider?: string;
      operations?: string[];
      maxOutputs?: number;
      allowedQualities?: string[];
      unitCost?: number;
      imageUnitCosts?: Partial<
        Record<'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max', number>
      >;
    },
  ): {
    runtimeAvailable: boolean;
    runtimeReason?: string | null;
    minPixels?: number;
    maxPixels?: number;
    maxDimension?: number;
  };
  submit(args: {
    actorId: string;
    projectId: string;
    spaceId: string;
    body: unknown;
    sessionHash?: string;
  }): Promise<unknown>;
  list(args: { actorId: string; projectId: string }): Promise<unknown>;
  cancel?(args: {
    actorId: string;
    jobId: string;
    body: unknown;
    sessionHash?: string;
  }): Promise<unknown>;
  resolve?(args: { actorId: string; jobId: string; body: unknown }): Promise<unknown>;
}
export interface BuildOptions {
  db?: Database;
  config?: AppConfig;
  sms?: SmsAdapter;
  aiService?: AiService;
  assistant?: AssistantDependencies;
}
export async function buildApp(options: BuildOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const db = options.db ?? createDatabase(config.databaseUrl);
  const sms = options.sms ?? createTencentSms();
  const ai = options.aiService;
  await migrate(db);
  const storage = new LocalPrivateStorage(config);
  await storage.initialize();
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: config.trustProxyHops === 1 ? (_address: string, hop: number) => hop < 1 : false,
    requestTimeout: 60_000,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { files: 1, fields: 2, fileSize: config.maxUploadBytes, fieldSize: 1024, parts: 3 },
  });
  app.decorateRequest('currentUser', null);
  app.addHook('onRequest', async (req, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (typeof origin !== 'string' || !config.origins.includes(origin))
        throw new HttpError(403, 'ORIGIN_FORBIDDEN', '请求来源未获准');
      const transient =
        /^\/v1\/artworks\/[a-f0-9-]+\/collaboration\/(sessions|leases|previews)(?:\/|\?|$)/i.test(
          req.url,
        );
      await rateLimit(
        db,
        `${transient ? 'collaboration-ip' : 'write-ip'}:${hash(req.ip)}`,
        transient ? 3600 : 180,
        60,
      );
    }
    const token = req.cookies.xiutu_session;
    if (token && /^[A-Za-z0-9_-]{40,64}$/.test(token)) {
      const { rows } = await db.query(
        `SELECT u.id,u.phone,u.display_name,u.status,EXISTS(SELECT 1 FROM operator_users o WHERE o.user_id=u.id) AS is_operator
        FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp() AND u.status='active'`,
        [hash(token)],
      );
      req.currentUser = (rows[0] as User | undefined) ?? null;
      if (
        req.currentUser &&
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        req.url.includes('/collaboration/')
      )
        await rateLimit(db, `collaboration-user:${req.currentUser.id}`, 600, 60);
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: '输入字段不符合要求',
          details: {
            fields: error.issues.map((i) => ({
              path: i.path.map(String).join('.'),
              message: i.message,
            })),
          },
        },
      });
    if (error instanceof RecipeValidationError)
      return reply.code(400).send({
        error: {
          code: 'RECIPE_INVALID',
          message: '编辑参数不符合要求',
          details: { fields: error.errors },
        },
      });
    if (error instanceof ProviderError)
      return reply.code(error.outcome === 'unknown' ? 503 : 400).send({
        error: {
          code: error.code,
          message:
            error.outcome === 'unknown'
              ? '外部请求结果尚待核实，请查看任务状态，勿重复提交'
              : '输入或供应商配置不符合当前操作要求',
        },
      });
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
    if (error instanceof StorageError)
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    if (error instanceof QuotaError)
      return reply
        .code(error.code === 'HOLD_NOT_FOUND' ? 404 : 409)
        .send({ error: { code: error.code, message: error.message } });
    const e = error as { code?: string; statusCode?: number; name?: string; message?: string };
    if (
      e.code === 'P0001' &&
      ['COLLABORATION_LOCKED', 'COLLABORATION_LEASE_EXPIRED'].includes(e.message ?? '')
    )
      return reply.code(409).send({
        error: {
          code: e.message,
          message:
            e.message === 'COLLABORATION_LOCKED'
              ? '作品有正在编辑的租约，请先完成或取消该操作；保存、AI采纳和历史恢复均不能覆盖协作中的内容'
              : '编辑租约已失效，请刷新后重新取得编辑权',
        },
      });
    if (e.code === 'P0001' && e.message === 'SPACE_STORAGE_LIMIT')
      return reply.code(409).send({
        error: {
          code: 'SPACE_STORAGE_LIMIT',
          message: '目标空间的保留素材容量已满，请联系运营调整限额；软删除尚不会释放保留容量',
        },
      });
    if (e.name === 'AiError' && e.statusCode && e.code)
      return reply.code(e.statusCode).send({ error: { code: e.code, message: e.message } });
    if (e.code === '23505')
      return reply
        .code(409)
        .send({ error: { code: 'CONFLICT', message: '记录已存在，请刷新后重试' } });
    if (e.code === '23503')
      return reply
        .code(409)
        .send({ error: { code: 'REFERENCE_CONFLICT', message: '相关记录已改变，请刷新' } });
    if (e.code === '40001' || e.code === '40P01')
      return reply.code(409).send({
        error: { code: 'CONCURRENT_CHANGE', message: '并发操作发生冲突，请刷新后重试原操作' },
      });
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.statusCode === 413)
      return reply
        .code(413)
        .send({ error: { code: 'UPLOAD_TOO_LARGE', message: '请求超过大小限制' } });
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500)
      return reply
        .code(e.statusCode)
        .send({ error: { code: 'INVALID_REQUEST', message: '无法处理此请求' } });
    // Error names/codes only: never serialize request bodies, keys, SQL parameters or OTPs.
    process.stderr.write(
      JSON.stringify({
        event: 'api_error',
        requestId: req.id,
        errorType: e.name ?? 'Error',
        code: e.code ?? 'INTERNAL',
      }) + '\n',
    );
    return reply
      .code(500)
      .send({ error: { code: 'INTERNAL_ERROR', message: '服务暂时未能完成操作，请稍后重试' } });
  });
  const capabilities = () => ({
    smsConfigured: sms.configured,
    providerConfigured: Boolean(
      process.env.DASHSCOPE_API_KEY || process.env.ARK_API_KEY || process.env.OPENAI_API_KEY,
    ),
    moderationConfigured: createTencentTextModerator().configured,
    aiConfigured: ai?.configured ?? false,
    aiUnavailableReason: ai?.reason ?? 'AI服务尚未配置；未进行任何模型调用',
    paymentConfigured: false,
    imageGenerationConfigured: ai?.availableOperations?.includes('generate-image') ?? false,
    availableOperations: ai?.availableOperations ?? [],
    operationStatus: ai?.operationStatus ?? {},
    providerModelCatalog: ai?.providerModelCatalog ?? [],
  });
  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });
  app.get('/v1/public-config', async () => ({
    ...(await publicSettings(db)),
    capabilities: capabilities(),
    media: storage.capabilities(),
    limits: { maxUploadBytes: config.maxUploadBytes, maxPixels: config.maxPixels },
  }));
  const moduleRegistry = createBuiltinRegistry();
  app.get('/v1/modules', async () => {
    const configuredModels = (await db.query('SELECT id,config FROM model_configs')).rows;
    const assistantRows = (await db.query('SELECT id,config FROM assistant_model_configs')).rows;
    const assistantModels = assistantRows.flatMap((model) => {
      const parsed = assistantModelConfigSchema.safeParse(model.config);
      return parsed.success && parsed.data.enabled
        ? [{ id: String(model.id), config: parsed.data }]
        : [];
    });
    const assistantAvailable = assistantModels.some((model) =>
      model.config.operations.includes('assistant-turn'),
    );
    const voiceAvailable = assistantModels.some(
      (model) =>
        model.config.operations.includes('realtime-voice') &&
        VOICE_MODELS.some((profile) => profile.id === model.id),
    );
    const mediaCapabilities = await mediaRuntime.capabilities;
    const gates: Record<string, RuntimeGate> = {
      sms: { available: sms.configured, reason: sms.configured ? null : '短信供应商未配置' },
      moderation: { available: capabilities().moderationConfigured, reason: '审核供应商未配置' },
      'portrait.analysis': {
        available: false,
        reason: '由浏览器检查同源模型资产和分析适配器，服务器不宣称客户端模型可用',
      },
      'media.retained-import': {
        available: mediaRuntime.enabled && mediaCapabilities.available,
        reason: mediaRuntime.enabled
          ? '隔离解码环境不可用，请检查媒体能力报告'
          : '高精度媒体导入开关未启用',
      },
      'assistant.turns': {
        available: assistantRuntime.ready && assistantAvailable,
        reason: assistantRuntime.ready ? '没有启用的智能体模型档案' : assistantRuntime.reason,
      },
      'assistant.voice': {
        available: assistantRuntime.voiceReady && assistantAvailable && voiceAvailable,
        reason: assistantRuntime.voiceReady
          ? '需要启用的语音协议档案与后端智能体模型'
          : (assistantRuntime.reason ?? '实时语音开关未启用'),
      },
    };
    for (const operation of ['generate-image', 'edit-plan', 'generate-text', 'transcribe']) {
      const status = ai?.operationStatus?.[operation];
      const executorStatus = status ?? {
        available: ai?.availableOperations?.includes(operation) ?? false,
        reason: ai?.reason ?? '执行适配器未配置',
      };
      const configured = configuredModels.some(
        (model) =>
          model.config?.enabled === true &&
          Array.isArray(model.config.operations) &&
          model.config.operations.includes(operation),
      );
      gates[operation] = {
        available: executorStatus.available && configured,
        reason: executorStatus.available
          ? configured
            ? null
            : '没有启用的对应操作模型档案'
          : executorStatus.reason,
      };
    }
    return { protocolVersion: 1, modules: moduleRegistry.discover(gates) };
  });
  app.get('/v1/public-logo', async (_req, reply) => {
    const asset = (
      await db.query(
        `SELECT a.* FROM app_config c JOIN assets a ON a.id=(c.brand->>'logoAssetId')::uuid JOIN projects p ON p.id=a.project_id WHERE c.id=true AND a.deleted_at IS NULL AND p.deleted_at IS NULL`,
      )
    ).rows[0];
    if (!asset) throw new HttpError(404, 'LOGO_NOT_FOUND', '未设置公开Logo');
    return reply
      .type(asset.mime)
      .header('Cache-Control', 'no-store')
      .send(storage.stream(asset.storage_key));
  });
  app.get('/v1/models', async () => ({
    models: (
      await db.query("SELECT * FROM model_configs WHERE (config->>'enabled')::boolean ORDER BY id")
    ).rows.map((row) => {
      const model = modelDto(row);
      return {
        ...model,
        ...(ai?.describeModel?.(model.id, model) ?? {
          runtimeAvailable: false,
          runtimeReason: '执行适配器尚未配置',
        }),
      };
    }),
    executionEnabled: ai?.configured ?? false,
    reason: ai?.reason ?? 'AI服务未启用',
    availableOperations: ai?.availableOperations ?? [],
    operationStatus: ai?.operationStatus ?? {},
    providerModelCatalog: ai?.providerModelCatalog ?? [],
  }));
  app.post('/v1/projects/:id/ai-jobs', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const project = await projectAccess(db, p.id, user.id, 'edit');
    if (!ai) throw new HttpError(503, 'AI_EXECUTION_DISABLED', 'AI执行尚未配置，未产生费用');
    return reply.code(202).send(
      await ai.submit({
        actorId: user.id,
        projectId: p.id,
        spaceId: project.space_id,
        body: req.body,
        sessionHash: hash(req.cookies.xiutu_session ?? ''),
      }),
    );
  });
  app.get('/v1/projects/:id/ai-jobs', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await projectAccess(db, p.id, user.id);
    return ai ? ai.list({ actorId: user.id, projectId: p.id }) : { jobs: [] };
  });
  app.post('/v1/ai-jobs/:id/cancel', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    if (!ai?.cancel) throw new HttpError(503, 'AI_LIFECYCLE_UNAVAILABLE', '任务维护服务未配置');
    return ai.cancel({
      actorId: user.id,
      jobId: p.id,
      body: req.body,
      sessionHash: hash(req.cookies.xiutu_session ?? ''),
    });
  });
  app.get('/v1/ops/ai-jobs/unknown', async (req) => {
    return {
      ...(await listUnknownAiJobs(db, requireOperator(req).id, req.query)),
      resolutionAvailable: Boolean(ai?.resolve),
    };
  });
  app.post('/v1/ops/ai-jobs/:id/resolve', async (req) => {
    const user = requireOperator(req);
    const p = z.object({ id }).parse(req.params);
    if (!ai?.resolve) throw new HttpError(503, 'AI_EXECUTION_DISABLED', '此服务未配置核验流程');
    return ai.resolve({ actorId: user.id, jobId: p.id, body: req.body });
  });
  registerAuth(app, db, config, sms);
  registerSpaces(app, db);
  registerProjects(app, db, storage);
  registerRevisionRender(app, db, storage);
  registerCollaboration(app, db);
  registerRealtimeCollaboration(app, db);
  registerResources(app, db);
  registerUsage(app, db, config.sessionSecret);
  const mediaRuntime = registerMediaImport(app, db, config);
  const assistantRuntime = registerAssistant(app, db, config, options.assistant);
  registerSharing(app, db);
  registerOperations(
    app,
    db,
    capabilities,
    (model) => ({
      ...model,
      ...(ai?.describeModel?.(model.id, model) ?? {
        runtimeAvailable: false,
        runtimeReason: '执行适配器尚未配置',
      }),
    }),
    ai?.providerModelCatalog ?? [],
  );
  registerAssetAnnotations(app, db);
  registerAiDecisions(app, db);
  registerAssetCopy(app, db);
  registerEditorContract(app);
  app.addHook('onClose', async () => {
    if (!options.db) await db.end();
  });
  return app;
}
