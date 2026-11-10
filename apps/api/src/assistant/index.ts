import { z } from 'zod';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { transaction, audit, type Database } from '@ai-xiutu/db';
import {
  assistantModelConfigSchema,
  VOICE_MODELS,
  VOICE_DOCS,
  VOICE_VERIFIED_AT,
  recipeHash,
} from '@ai-xiutu/assistant';
import type { AppConfig } from '../config.js';
import { HttpError, requireUser, requireOperator, id, hash, rateLimit } from '../core.js';
import { LocalPrivateStorage } from '../storage.js';
import { assistantAccess, lockedAssistantAccess } from './context.js';
import { createAssistantService, type AssistantDependencies } from './service.js';
import { attachVoiceBridge } from './voice.js';
export type { AssistantDependencies } from './service.js';

export function registerAssistant(
  app: FastifyInstance,
  db: Database,
  config: AppConfig,
  dependencies: AssistantDependencies = {},
) {
  const storage = new LocalPrivateStorage(config);
  const service = createAssistantService(
    db,
    storage,
    dependencies,
    join((dependencies.env ?? process.env).AI_JOURNAL_DIR ?? config.storageDir, 'assistant'),
  );
  const bridge = attachVoiceBridge(app, db, config, service);
  app.addHook('onClose', async () => {
    await service.waitForIdle();
  });
  app.get('/v1/assistant/models', async (req) => {
    requireUser(req);
    const rows = (await db.query('SELECT id,config FROM assistant_model_configs ORDER BY id')).rows;
    return {
      ready: service.ready,
      voiceReady: service.voiceReady,
      reason: service.reason,
      models: rows.flatMap((row) => {
        const parsed = assistantModelConfigSchema.safeParse(row.config);
        if (!parsed.success || !parsed.data.enabled) return [];
        const model = parsed.data;
        const operations = model.operations.filter((op) =>
          ['assistant-turn', 'realtime-voice'].includes(op),
        );
        if (!operations.length) return [];
        return [
          {
            id: row.id,
            label: model.label ?? row.id,
            operations,
            unitCost: model.unitCost,
            maxSeconds: model.maxSeconds,
            maxDelegations: model.maxDelegations,
            imageInput: model.imageInput,
            webSearch: model.webSearch,
            voice: VOICE_MODELS.find((voice) => voice.id === row.id) ?? null,
          },
        ];
      }),
      voiceProfiles: VOICE_MODELS,
      verifiedAt: VOICE_VERIFIED_AT,
      sources: VOICE_DOCS,
    };
  });
  app.get('/v1/projects/:projectId/assistant-turns', async (req) => {
    const user = requireUser(req),
      projectId = id.parse((req.params as any).projectId);
    await assistantAccess(db, user.id, projectId);
    const rows = (
      await db.query(
        'SELECT id,model_id,state,prompt,output,error_code,created_at FROM assistant_turns WHERE project_id=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 30',
        [projectId, user.id],
      )
    ).rows;
    const decisions = (
      await db.query(
        'SELECT id,decision FROM assistant_candidates WHERE project_id=$1 AND actor_id=$2 AND turn_id=ANY($3::uuid[])',
        [projectId, user.id, rows.map((row) => row.id)],
      )
    ).rows;
    const current = new Map(decisions.map((candidate) => [candidate.id, candidate.decision]));
    return {
      turns: rows.map((row) => ({
        id: row.id,
        modelId: row.model_id,
        state: row.state,
        prompt: row.prompt,
        output: row.output
          ? {
              ...row.output,
              candidates: (row.output.candidates ?? []).map((candidate: any) => ({
                ...candidate,
                decision: current.get(candidate.id) ?? 'rejected',
              })),
            }
          : null,
        errorCode: row.error_code,
        createdAt: row.created_at,
      })),
    };
  });
  app.post(
    '/v1/projects/:projectId/assistant-turns',
    { bodyLimit: 4_000_000 },
    async (req, reply) => {
      const user = requireUser(req),
        projectId = id.parse((req.params as any).projectId);
      await rateLimit(db, `assistant:${user.id}`, 30, 3600);
      const turn = await service.turn(user.id, projectId, req.body);
      return reply.code(turn.state === 'running' ? 202 : 200).send(turn);
    },
  );
  app.get('/v1/assistant-turns/:turnId', async (req) =>
    service.getTurn(requireUser(req).id, id.parse((req.params as any).turnId)),
  );
  app.get('/v1/projects/:projectId/assistant-candidates', async (req) => {
    const user = requireUser(req),
      projectId = id.parse((req.params as any).projectId);
    await assistantAccess(db, user.id, projectId);
    const rows = (
      await db.query(
        `SELECT * FROM assistant_candidates WHERE project_id=$1 AND actor_id=$2 AND expires_at>clock_timestamp() ORDER BY created_at DESC,id DESC LIMIT 50`,
        [projectId, user.id],
      )
    ).rows;
    return {
      candidates: rows.map((row) => ({
        ...row.payload,
        id: row.id,
        kind: row.kind,
        artworkId: row.artwork_id,
        baseVersion: row.base_version,
        baseRecipeHash: row.base_recipe_hash,
        decision: row.decision,
      })),
    };
  });
  app.post('/v1/projects/:projectId/voice-sessions', { bodyLimit: 4_000_000 }, async (req) => {
    const user = requireUser(req),
      projectId = id.parse((req.params as any).projectId);
    await rateLimit(db, `voice:${user.id}`, 12, 3600);
    await service.recoverStale();
    const result = await service.prepareVoice(user.id, projectId, req.body);
    bridge.retain(result.row.id, result.context);
    return {
      id: result.row.id,
      ticket: result.ticket,
      websocketPath: `/v1/voice-sessions/${result.row.id}/stream`,
      maxSeconds: result.row.config.voiceModel.maxSeconds,
      reservedUnits: result.row.config.voiceModel.unitCost,
      billing:
        '一次有时限的实时会话服务点；供应商费用另行记账。准备过期且无派发证据时释放，连接或计费结果不明确时保留预占待运营核验。',
    };
  });
  app.post('/v1/assistant-candidates/:candidateId/decision', async (req) => {
    const user = requireUser(req),
      candidateId = id.parse((req.params as any).candidateId);
    const body = z
      .object({
        decision: z.enum(['previewed', 'rejected']),
        recipe: z.unknown().optional(),
        expectedVersion: z.number().int().positive().optional(),
      })
      .strict()
      .parse(req.body);
    const hint = (
      await db.query('SELECT project_id FROM assistant_candidates WHERE id=$1 AND actor_id=$2', [
        candidateId,
        user.id,
      ])
    ).rows[0];
    if (!hint) throw new HttpError(404, 'CANDIDATE_NOT_FOUND', '候选不存在或无权访问');
    return transaction(db, async (tx) => {
      await lockedAssistantAccess(tx, user.id, hint.project_id);
      const row = (
        await tx.query(
          'SELECT * FROM assistant_candidates WHERE id=$1 AND actor_id=$2 AND expires_at>clock_timestamp() FOR UPDATE',
          [candidateId, user.id],
        )
      ).rows[0];
      if (!row) throw new HttpError(404, 'CANDIDATE_NOT_FOUND', '候选不存在、已过期或无权访问');
      if (row.decision === 'rejected' && body.decision !== 'rejected')
        throw new HttpError(409, 'CANDIDATE_REJECTED', '候选已退回');
      if (body.decision === 'previewed' && row.kind === 'edit') {
        const artwork = (
          await tx.query('SELECT head_version FROM artworks WHERE id=$1', [row.artwork_id])
        ).rows[0];
        if (
          artwork?.head_version !== row.base_version ||
          body.expectedVersion !== row.base_version ||
          !body.recipe ||
          recipeHash(body.recipe) !== row.base_recipe_hash
        )
          throw new HttpError(409, 'CANDIDATE_STALE', '图片或本地参数已变化，请重新生成建议');
      }
      await tx.query('UPDATE assistant_candidates SET decision=$2 WHERE id=$1', [
        candidateId,
        body.decision,
      ]);
      // Preview is deliberately distinct from an applied/saved revision. The editor
      // must still acquire its collaboration lease and use normal versioned save.
      return { ok: true, decision: body.decision, payload: row.payload, applied: false };
    });
  });
  app.get('/v1/ops/assistant-models', async (req) => {
    requireOperator(req);
    return {
      models: (
        await db.query(
          "SELECT id,config FROM assistant_model_configs WHERE config->'operations' ?| ARRAY['assistant-turn','realtime-voice'] ORDER BY id",
        )
      ).rows.map((row) => ({ ...row, hash: hash(JSON.stringify(row.config)) })),
      profiles: VOICE_MODELS,
      ready: service.ready,
      voiceReady: service.voiceReady,
      sources: VOICE_DOCS,
    };
  });
  app.put('/v1/ops/assistant-models/:modelId', async (req) => {
    const operator = requireOperator(req);
    const modelId = z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
      .parse((req.params as any).modelId);
    const envelope = z
      .object({
        config: assistantModelConfigSchema,
        expectedHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
      })
      .strict()
      .parse(req.body);
    const settings = envelope.config;
    if (
      !settings.operations.length ||
      settings.operations.some(
        (operation) => !['assistant-turn', 'realtime-voice'].includes(operation),
      )
    )
      throw new HttpError(400, 'MODEL_OPERATION_INVALID', '此配置入口只接收智能体/实时语音能力');
    if (
      settings.operations.includes('realtime-voice') &&
      !VOICE_MODELS.some((voice) => voice.id === modelId)
    )
      throw new HttpError(400, 'VOICE_PROFILE_UNKNOWN', '语音模型尚无经过核验的协议适配器');
    await transaction(db, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `assistant-model:${modelId}`,
      ]);
      const existing = (
        await tx.query('SELECT config FROM assistant_model_configs WHERE id=$1 FOR UPDATE', [
          modelId,
        ])
      ).rows[0];
      if ((existing ? hash(JSON.stringify(existing.config)) : null) !== envelope.expectedHash)
        throw new HttpError(409, 'MODEL_CONFIG_CHANGED', '模型配置已更新，请重新读取后再保存');
      const otherOps = (existing?.config?.operations ?? []).filter(
        (op: string) => !['assistant-turn', 'realtime-voice'].includes(op),
      );
      if (otherOps.length)
        throw new HttpError(
          409,
          'MODEL_CONFIGURATION_SHARED',
          '此模型已有其他任务配置，请通过统一配置迁移，避免覆盖现有能力',
        );
      await tx.query(
        'INSERT INTO assistant_model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config,updated_at=clock_timestamp()',
        [modelId, JSON.stringify(settings)],
      );
      await audit(tx, operator.id, 'assistant.model_configured', 'model', modelId, {
        operations: settings.operations,
        unitCost: settings.unitCost,
        enabled: settings.enabled,
      });
    });
    return { ok: true };
  });
  app.get('/v1/ops/assistant-reconciliation', async (req) => {
    requireOperator(req);
    const turns = (
      await db.query(
        "SELECT id,project_id,actor_id,model_id,state,error_code,created_at FROM assistant_turns WHERE state='unknown' ORDER BY created_at LIMIT 100",
      )
    ).rows;
    const voices = (
      await db.query(
        "SELECT id,project_id,actor_id,model_id,state,error_code,elapsed_seconds,created_at FROM voice_sessions WHERE state='unknown' ORDER BY created_at LIMIT 100",
      )
    ).rows;
    return { turns, voices };
  });
  app.post('/v1/ops/assistant-reconciliation/:kind/:recordId', async (req) => {
    const user = requireOperator(req),
      params = z.object({ kind: z.enum(['voice', 'turn']), recordId: id }).parse(req.params);
    return service.resolve(user.id, params.kind, params.recordId, req.body);
  });
  return service;
}
