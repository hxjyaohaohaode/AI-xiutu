import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { z, ZodError } from 'zod';
import { createDatabase, migrate, QuotaError, type Database } from '@ai-xiutu/db';
import {
  createTencentSms,
  createTencentTextModerator,
  ProviderError,
  type SmsAdapter,
} from '@ai-xiutu/providers';
import { RecipeValidationError } from '@ai-xiutu/editor';
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
import { registerCollaboration } from './collaboration.js';
import { registerSharing } from './sharing.js';
import { registerOperations, publicSettings, modelDto } from './operations.js';
import { LocalPrivateStorage, StorageError } from './storage.js';

export interface AiService {
  configured: boolean;
  reason: string | null;
  availableOperations?: string[];
  operationStatus?: Record<string, { available: boolean; reason: string | null }>;
  describeModel?(
    id: string,
    config: { provider?: string; operations?: string[] },
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
  }): Promise<unknown>;
  list(args: { actorId: string; projectId: string }): Promise<unknown>;
  resolve?(args: { actorId: string; jobId: string; body: unknown }): Promise<unknown>;
}
export interface BuildOptions {
  db?: Database;
  config?: AppConfig;
  sms?: SmsAdapter;
  aiService?: AiService;
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
      await rateLimit(db, `write-ip:${hash(req.ip)}`, 180, 60);
    }
    const token = req.cookies.xiutu_session;
    if (token && /^[A-Za-z0-9_-]{40,64}$/.test(token)) {
      const { rows } = await db.query(
        `SELECT u.id,u.phone,u.display_name,u.status,EXISTS(SELECT 1 FROM operator_users o WHERE o.user_id=u.id) AS is_operator
        FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp() AND u.status='active'`,
        [hash(token)],
      );
      req.currentUser = (rows[0] as User | undefined) ?? null;
    }
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply
        .code(400)
        .send({
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
      return reply
        .code(400)
        .send({
          error: {
            code: 'RECIPE_INVALID',
            message: '编辑参数不符合要求',
            details: { fields: error.errors },
          },
        });
    if (error instanceof ProviderError)
      return reply
        .code(error.outcome === 'unknown' ? 503 : 400)
        .send({
          error: {
            code: error.code,
            message:
              error.outcome === 'unknown'
                ? '外部请求结果尚待核实，请查看任务状态，勿重复提交'
                : '输入或供应商配置不符合当前操作要求',
          },
        });
    if (error instanceof HttpError)
      return reply
        .code(error.statusCode)
        .send({
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
      return reply
        .code(409)
        .send({
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
    providerConfigured: Boolean(process.env.DASHSCOPE_API_KEY || process.env.ARK_API_KEY),
    moderationConfigured: createTencentTextModerator().configured,
    aiConfigured: ai?.configured ?? false,
    aiUnavailableReason: ai?.reason ?? 'AI服务尚未配置；未进行任何模型调用',
    paymentConfigured: false,
    imageGenerationConfigured: ai?.availableOperations?.includes('generate-image') ?? false,
    availableOperations: ai?.availableOperations ?? [],
    operationStatus: ai?.operationStatus ?? {},
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
  }));
  app.post('/v1/projects/:id/ai-jobs', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const project = await projectAccess(db, p.id, user.id, 'edit');
    if (!ai) throw new HttpError(503, 'AI_EXECUTION_DISABLED', 'AI执行尚未配置，未产生费用');
    return reply
      .code(202)
      .send(
        await ai.submit({
          actorId: user.id,
          projectId: p.id,
          spaceId: project.space_id,
          body: req.body,
        }),
      );
  });
  app.get('/v1/projects/:id/ai-jobs', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await projectAccess(db, p.id, user.id);
    return ai ? ai.list({ actorId: user.id, projectId: p.id }) : { jobs: [] };
  });
  app.get('/v1/ops/ai-jobs/unknown', async (req) => {
    requireOperator(req);
    return {
      jobs: (
        await db.query(
          `SELECT j.id,j.project_id AS "projectId",j.actor_id AS "actorId",j.model_id AS "modelId",j.operation,j.provider_request_id AS "providerRequestId",j.error_code AS "errorCode",h.units AS "heldUnits",j.created_at AS "createdAt" FROM ai_jobs j LEFT JOIN quota_holds h ON h.id=j.hold_id WHERE j.state='unknown' ORDER BY j.created_at LIMIT 100`,
        )
      ).rows,
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
  registerCollaboration(app, db);
  registerSharing(app, db);
  registerOperations(app, db, capabilities);
  app.addHook('onClose', async () => {
    if (!options.db) await db.end();
  });
  return app;
}
