import { z } from 'zod';
import { join } from 'node:path';
import {
  listOpenAIProjectModels,
  OPENAI_FILE_TRANSCRIPTION_MODELS,
  OPENAI_IMAGE_MODEL_PROFILES,
} from '@ai-xiutu/multimodal';
import type { FastifyInstance } from 'fastify';
import {
  transaction,
  audit,
  claimAssistantGrant,
  assertAssistantGrant,
  type Database,
} from '@ai-xiutu/db';
import { applyAuthorizedCandidate, assertVoiceCandidateContext } from './apply.js';
import {
  assistantModelConfigSchema,
  VOICE_MODELS,
  RESPONSES_MODELS,
  RESPONSES_SOURCES,
  RESPONSES_VERIFIED_AT,
  modelProfileError,
  responsesModel,
  VOICE_DOCS,
  VOICE_VERIFIED_AT,
  CALL_TRANSCRIPTION_MODELS,
  recipeHash,
} from '@ai-xiutu/assistant';
import type { AppConfig } from '../config.js';
import { HttpError, requireUser, requireOperator, id, hash, rateLimit } from '../core.js';
import { LocalPrivateStorage } from '../storage.js';
import {
  assistantAccess,
  lockedAssistantAccess,
  searchAssistantResources,
  validateScope,
} from './context.js';
import { createAssistantService, type AssistantDependencies } from './service.js';
import { attachVoiceBridge } from './voice.js';
import {
  assistantCandidateCommitSchema,
  assistantGrantSchema,
  OPENAI_SPECIALIST_OPERATIONS,
  OPENAI_SPECIALIST_MODELS,
} from '@ai-xiutu/contracts';
import { registerAssistantEvents } from './events.js';
import { registerAssistantMemory } from './memory.js';
import {
  assistantReconciliationFilters,
  listUnknownAssistantRecords,
} from '../ai-reconciliation.js';
export type { AssistantDependencies } from './service.js';

export function registerAssistant(
  app: FastifyInstance,
  db: Database,
  config: AppConfig,
  dependencies: AssistantDependencies = {},
) {
  registerAssistantEvents(app, db);
  registerAssistantMemory(app, db);
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
  const grantDto = (row: Record<string, any>) => ({
    id: row.id,
    mode: row.mode,
    unitLimit: row.unit_limit,
    usedUnits: row.used_units,
    stepLimit: row.step_limit,
    usedSteps: row.used_steps,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  });
  app.post('/v1/projects/:projectId/assistant-grants', async (req) => {
    const user = requireUser(req),
      projectId = id.parse((req.params as any).projectId);
    const body = assistantGrantSchema.parse(req.body);
    return transaction(db, async (tx) => {
      await lockedAssistantAccess(
        tx,
        user.id,
        projectId,
        undefined,
        hash(req.cookies.xiutu_session ?? ''),
      );
      const known = (
        await tx.query(
          `SELECT id FROM assistant_model_configs WHERE id=ANY($1::text[]) AND config->>'enabled'='true'
         UNION SELECT id FROM model_configs WHERE id=ANY($1::text[]) AND COALESCE(config->>'enabled','true')='true'`,
          [body.modelIds],
        )
      ).rows;
      if (new Set(known.map((item) => item.id)).size !== new Set(body.modelIds).size)
        throw new HttpError(400, 'GRANT_MODEL_UNAVAILABLE', '请为本次授权选择已启用的模型');
      const row = (
        await tx.query(
          `INSERT INTO assistant_grants(actor_id,project_id,mode,unit_limit,step_limit,allowed_actions,model_ids,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+($8::integer*interval '1 minute')) RETURNING *`,
          [
            user.id,
            projectId,
            body.mode,
            body.unitLimit,
            body.stepLimit,
            JSON.stringify([...new Set(body.allowedActions)]),
            JSON.stringify([...new Set(body.modelIds)]),
            body.minutes,
          ],
        )
      ).rows[0];
      await audit(tx, user.id, 'assistant.grant.created', 'project', projectId, {
        grantId: row.id,
        mode: body.mode,
        unitLimit: body.unitLimit,
        stepLimit: body.stepLimit,
      });
      return { grant: grantDto(row) };
    });
  });
  app.get('/v1/assistant-grants/:grantId', async (req) => {
    const user = requireUser(req);
    const row = (
      await db.query('SELECT * FROM assistant_grants WHERE id=$1 AND actor_id=$2', [
        id.parse((req.params as any).grantId),
        user.id,
      ])
    ).rows[0];
    if (!row) throw new HttpError(404, 'GRANT_NOT_FOUND', '授权不存在');
    await assistantAccess(db, user.id, row.project_id);
    return { grant: grantDto(row) };
  });
  app.delete('/v1/assistant-grants/:grantId', async (req) => {
    const user = requireUser(req);
    const result = await db.query(
      'UPDATE assistant_grants SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1 AND actor_id=$2 RETURNING id',
      [id.parse((req.params as any).grantId), user.id],
    );
    if (!result.rowCount) throw new HttpError(404, 'GRANT_NOT_FOUND', '授权不存在');
    return { ok: true };
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
        if (
          !parsed.success ||
          !parsed.data.enabled ||
          modelProfileError(row.id, parsed.data, service.allowTestModel)
        )
          return [];
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
            maxOutputTokens: model.maxOutputTokens,
            imageInput: model.imageInput,
            webSearch: model.webSearch,
            webImageSearch: model.webSearch && model.webImageSearch === true,
            voice: VOICE_MODELS.find((voice) => voice.id === row.id) ?? null,
            responses: responsesModel(row.id) ?? null,
            responseDefaults: {
              effort: model.reasoningEffort,
              verbosity: model.responses?.verbosity,
              effortFixedForSampling:
                model.responses?.temperature !== undefined || model.responses?.topP !== undefined,
            },
          },
        ];
      }),
      voiceProfiles: VOICE_MODELS,
      responsesProfiles: RESPONSES_MODELS,
      verifiedAt: VOICE_VERIFIED_AT,
      responsesVerifiedAt: RESPONSES_VERIFIED_AT,
      sources: [...VOICE_DOCS, ...RESPONSES_SOURCES],
      transcriptionModels: CALL_TRANSCRIPTION_MODELS,
    };
  });
  app.get('/v1/projects/:projectId/assistant-conversations', async (req) => {
    const user = requireUser(req),
      projectId = id.parse((req.params as any).projectId);
    await assistantAccess(db, user.id, projectId);
    const rows = (
      await db.query(
        `SELECT t.conversation_id AS id, max(t.created_at) AS updated_at, count(*)::int AS turn_count,
      root.prompt AS title, COALESCE(root.config->'historyScope',root.scope) AS access_scope
      FROM assistant_turns t JOIN assistant_turns root ON root.id=t.conversation_id
      WHERE t.project_id=$1 AND t.actor_id=$2 GROUP BY t.conversation_id,root.id
      ORDER BY max(t.created_at) DESC,t.conversation_id LIMIT 100`,
        [projectId, user.id],
      )
    ).rows;
    for (const row of rows) {
      try {
        await validateScope(db, user.id, row.access_scope);
      } catch (error) {
        if (!(error instanceof HttpError) || ![403, 404].includes(error.statusCode)) throw error;
        row.title = '素材权限已变化';
      }
    }
    return {
      conversations: rows.map((row) => ({
        id: row.id,
        title: String(row.title).slice(0, 100),
        turnCount: row.turn_count,
        updatedAt: row.updated_at,
      })),
    };
  });
  app.get('/v1/projects/:projectId/assistant-turns', async (req) => {
    const user = requireUser(req),
      projectId = id.parse((req.params as any).projectId);
    await assistantAccess(db, user.id, projectId);
    const query = z.object({ conversationId: id.optional() }).strict().parse(req.query);
    const rows = (
      await db.query(
        'SELECT id,conversation_id,model_id,state,prompt,output,error_code,created_at,scope,config,stop_requested_at FROM assistant_turns WHERE project_id=$1 AND actor_id=$2 AND ($3::uuid IS NULL OR conversation_id=$3) ORDER BY created_at DESC LIMIT 30',
        [projectId, user.id, query.conversationId ?? null],
      )
    ).rows;
    const decisions = (
      await db.query(
        'SELECT id,decision,applied_revision_id FROM assistant_candidates WHERE project_id=$1 AND actor_id=$2 AND turn_id=ANY($3::uuid[])',
        [projectId, user.id, rows.map((row) => row.id)],
      )
    ).rows;
    const current = new Map(decisions.map((candidate) => [candidate.id, candidate]));
    // Repeated scopes are checked once per response, never cached across requests.
    const checked = new Map<string, boolean>();
    for (const row of rows) {
      const scope = row.config?.historyScope ?? row.scope,
        key = JSON.stringify(scope);
      if (!checked.has(key)) {
        try {
          await validateScope(db, user.id, scope);
          checked.set(key, true);
        } catch (error) {
          if (!(error instanceof HttpError) || ![403, 404].includes(error.statusCode)) throw error;
          checked.set(key, false);
        }
      }
      if (!checked.get(key)) {
        row.prompt = '此会话引用的素材权限已变化。';
        row.output = null;
        row.state = 'unavailable';
        row.error_code = 'CONTEXT_SCOPE_REVOKED';
      }
    }
    return {
      turns: rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        modelId: row.model_id,
        state: row.state,
        prompt: row.prompt,
        output: row.output
          ? {
              ...row.output,
              candidates: (row.output.candidates ?? []).map((candidate: any) => ({
                ...candidate,
                decision: current.get(candidate.id)?.decision ?? 'rejected',
                appliedRevisionId: current.get(candidate.id)?.applied_revision_id ?? null,
              })),
            }
          : null,
        errorCode: row.error_code,
        stopRequested: Boolean(row.stop_requested_at),
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
      const turn = await service.turn(
        user.id,
        projectId,
        req.body,
        hash(req.cookies.xiutu_session ?? ''),
      );
      return reply.code(turn.state === 'running' ? 202 : 200).send(turn);
    },
  );
  app.get('/v1/assistant-turns/:turnId', async (req) =>
    service.getTurn(requireUser(req).id, id.parse((req.params as any).turnId)),
  );
  app.post('/v1/assistant-turns/:turnId/stop', async (req) =>
    service.stopTurn(requireUser(req).id, id.parse((req.params as any).turnId)),
  );
  app.post('/v1/projects/:projectId/assistant-resources/search', async (req) => {
    const actorId = requireUser(req).id;
    const projectId = id.parse((req.params as any).projectId);
    const body = z
      .object({
        spaceIds: z.array(id).min(1).max(12),
        query: z.string().trim().max(200),
        limit: z.number().int().min(1).max(20).default(12),
      })
      .strict()
      .parse(req.body);
    await rateLimit(db, `assistant-resources:${actorId}`, 180, 60);
    await assistantAccess(db, actorId, projectId);
    return searchAssistantResources(
      db,
      actorId,
      {
        spaceIds: body.spaceIds,
        referenceAssetIds: [],
        allowWebSearch: false,
        usePersonalMemory: false,
      },
      body.query,
      body.limit,
    );
  });
  app.get('/v1/projects/:projectId/assistant-candidates', async (req) => {
    const user = requireUser(req),
      projectId = id.parse((req.params as any).projectId);
    await assistantAccess(db, user.id, projectId);
    const query = z.object({ conversationId: id.optional() }).strict().parse(req.query);
    const rows = (
      await db.query(
        `SELECT c.*,COALESCE(t.config->'historyScope',t.scope,v.config->'historyScope',v.scope) AS access_scope FROM assistant_candidates c
        LEFT JOIN assistant_turns t ON t.id=c.turn_id LEFT JOIN voice_sessions v ON v.id=c.voice_id
        WHERE c.project_id=$1 AND c.actor_id=$2 AND c.expires_at>clock_timestamp() AND ($3::uuid IS NULL OR t.conversation_id=$3) ORDER BY c.created_at DESC,c.id DESC LIMIT 50`,
        [projectId, user.id, query.conversationId ?? null],
      )
    ).rows;
    const visible = [];
    const checked = new Map<string, boolean>();
    for (const row of rows) {
      const key = JSON.stringify(row.access_scope);
      if (!checked.has(key)) {
        try {
          await validateScope(db, user.id, row.access_scope);
          checked.set(key, true);
        } catch (error) {
          if (!(error instanceof HttpError) || ![403, 404].includes(error.statusCode)) throw error;
          checked.set(key, false);
        }
      }
      if (checked.get(key)) visible.push(row);
    }
    return {
      candidates: visible.map((row) => ({
        ...row.payload,
        id: row.id,
        kind: row.kind,
        artworkId: row.artwork_id,
        baseVersion: row.base_version,
        baseRecipeHash: row.base_recipe_hash,
        decision: row.decision,
        appliedRevisionId: row.applied_revision_id,
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
  app.post(
    '/v1/assistant-candidates/:candidateId/decision',
    { bodyLimit: 4_000_000 },
    async (req) => {
      const user = requireUser(req),
        candidateId = id.parse((req.params as any).candidateId);
      const body = z
        .object({
          decision: z.enum(['previewed', 'rejected']),
          recipe: z.unknown().optional(),
          expectedVersion: z.number().int().positive().optional(),
          automatic: z.boolean().default(false),
        })
        .strict()
        .parse(req.body);
      const hint = (
        await db.query(
          `SELECT c.project_id,
          COALESCE(t.config->'historyScope',t.scope,v.config->'historyScope',v.scope) AS access_scope,
          COALESCE(t.scope,v.scope) AS execution_scope,
          COALESCE(t.model_id,v.backend_model_id) AS model_id
        FROM assistant_candidates c LEFT JOIN assistant_turns t ON t.id=c.turn_id
        LEFT JOIN voice_sessions v ON v.id=c.voice_id WHERE c.id=$1 AND c.actor_id=$2`,
          [candidateId, user.id],
        )
      ).rows[0];
      if (!hint) throw new HttpError(404, 'CANDIDATE_NOT_FOUND', '候选不存在或无权访问');
      return transaction(db, async (tx) => {
        await lockedAssistantAccess(
          tx,
          user.id,
          hint.project_id,
          hint.access_scope,
          hash(req.cookies.xiutu_session ?? ''),
        );
        const row = (
          await tx.query(
            'SELECT * FROM assistant_candidates WHERE id=$1 AND actor_id=$2 AND expires_at>clock_timestamp() FOR UPDATE',
            [candidateId, user.id],
          )
        ).rows[0];
        if (!row) throw new HttpError(404, 'CANDIDATE_NOT_FOUND', '候选不存在、已过期或无权访问');
        if (row.applied_revision_id) {
          if (body.decision === 'rejected')
            throw new HttpError(409, 'CANDIDATE_ALREADY_APPLIED', '候选已应用，请通过版本历史恢复');
          return {
            ok: true,
            decision: row.decision,
            payload: row.payload,
            applied: true,
            revisionId: row.applied_revision_id,
          };
        }
        if (row.decision === 'rejected' && body.decision !== 'rejected')
          throw new HttpError(409, 'CANDIDATE_REJECTED', '候选已退回');
        if (body.decision === 'previewed') {
          if (body.automatic && row.payload.autoEligible === false)
            throw new HttpError(409, 'CANDIDATE_UNAVAILABLE', '此候选需要人工确认');
          const grantId = hint.execution_scope?.executionGrantId;
          if (body.automatic && !grantId)
            throw new HttpError(
              403,
              'AUTOMATIC_GRANT_REQUIRED',
              '自动执行需要有效的范围与预算授权',
            );
          if (grantId) {
            const mode = await assertAssistantGrant(
              tx,
              grantId,
              user.id,
              row.project_id,
              true,
              hint.model_id,
            );
            if (mode === 'suggest' || (body.automatic && mode !== 'auto'))
              throw new HttpError(
                403,
                'ASSISTANT_ACTION_FORBIDDEN',
                '当前授权只允许建议或需要逐次确认',
              );
            if (row.kind === 'edit')
              await claimAssistantGrant(tx, {
                grantId,
                actorId: user.id,
                projectId: row.project_id,
                key: `candidate:${candidateId}`,
                action: 'edit',
                modelId: hint.model_id,
                units: 0,
                automatic: body.automatic,
              });
          }
          await assertVoiceCandidateContext(tx, row);
        }
        if (body.decision === 'previewed' && row.kind === 'edit') {
          const artwork = (
            await tx.query(
              'SELECT head_version FROM artworks WHERE id=$1 AND project_id=$2 FOR SHARE',
              [row.artwork_id, row.project_id],
            )
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
    },
  );
  app.post('/v1/assistant-candidates/:candidateId/apply', { bodyLimit: 4_000_000 }, async (req) => {
    const actorId = requireUser(req).id,
      candidateId = id.parse((req.params as any).candidateId);
    const body = z
      .object({ expectedVersion: z.number().int().positive(), recipe: z.unknown() })
      .strict()
      .parse(req.body);
    return transaction(db, (tx) =>
      applyAuthorizedCandidate(tx, {
        candidateId,
        actorId,
        ...body,
        requireSavedBase: true,
        authHash: hash(req.cookies.xiutu_session ?? ''),
      }),
    );
  });
  app.post(
    '/v1/assistant-candidates/:candidateId/commit',
    { bodyLimit: 4_000_000 },
    async (req) => {
      const actorId = requireUser(req).id;
      const candidateId = id.parse((req.params as any).candidateId);
      const { expectedVersion, recipe, includeUnsavedBase } = assistantCandidateCommitSchema.parse(
        req.body,
      );
      return transaction(db, (tx) =>
        applyAuthorizedCandidate(tx, {
          candidateId,
          actorId,
          expectedVersion,
          recipe,
          confirmed: true,
          requireSavedBase: !includeUnsavedBase,
          authHash: hash(req.cookies.xiutu_session ?? ''),
        }),
      );
    },
  );
  app.get('/v1/ops/assistant-models', async (req) => {
    requireOperator(req);
    return {
      models: (
        await db.query(
          "SELECT id,config FROM assistant_model_configs WHERE config->'operations' ?| ARRAY['assistant-turn','realtime-voice'] ORDER BY id",
        )
      ).rows.map((row) => ({ ...row, hash: hash(JSON.stringify(row.config)) })),
      profiles: VOICE_MODELS,
      responsesProfiles: RESPONSES_MODELS,
      ready: service.ready,
      voiceReady: service.voiceReady,
      responsesVerifiedAt: RESPONSES_VERIFIED_AT,
      sources: [...VOICE_DOCS, ...RESPONSES_SOURCES],
      transcriptionModels: CALL_TRANSCRIPTION_MODELS,
    };
  });
  let inventory: { ids: string[]; checkedAt: number } | undefined;
  let discovery: Promise<{ ids: string[]; checkedAt: number }> | undefined;
  app.get('/v1/ops/openai-model-inventory', async (req, reply) => {
    requireOperator(req);
    reply.header('cache-control', 'no-store');
    if (!service.key) return { state: 'unconfigured', models: [] };
    if (!inventory || Date.now() - inventory.checkedAt > 5 * 60_000) {
      discovery ??= listOpenAIProjectModels(service.key, service.dependencies.fetcher)
        .then((ids) => ({ ids, checkedAt: Date.now() }))
        .finally(() => {
          discovery = undefined;
        });
      try {
        inventory = await discovery;
      } catch {
        return { state: 'unavailable', models: [] };
      }
    }
    return {
      state: 'visible',
      checkedAt: new Date(inventory.checkedAt).toISOString(),
      models: inventory.ids.map((id) => {
        const specialist = OPENAI_SPECIALIST_OPERATIONS.find((operation) =>
          (OPENAI_SPECIALIST_MODELS[operation] as readonly string[]).includes(id),
        );
        const adapter = responsesModel(id)
          ? 'responses'
          : (VOICE_MODELS.find((model) => model.id === id)?.protocol ??
            (Object.hasOwn(OPENAI_IMAGE_MODEL_PROFILES, id)
              ? 'images'
              : (OPENAI_FILE_TRANSCRIPTION_MODELS as readonly string[]).includes(id)
                ? 'file-transcription'
                : (CALL_TRANSCRIPTION_MODELS as readonly string[]).includes(id)
                  ? 'call-transcription'
                  : ['omni-moderation-latest', 'omni-moderation-2024-09-26'].includes(id)
                    ? 'moderation'
                    : (specialist ?? null)));
        return { id, adapter };
      }),
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
      settings.enabled &&
      settings.operations.includes('realtime-voice') &&
      !VOICE_MODELS.some((voice) => voice.id === modelId)
    )
      throw new HttpError(400, 'VOICE_PROFILE_UNKNOWN', '语音模型尚无经过核验的协议适配器');
    const incompatible = modelProfileError(modelId, settings, service.allowTestModel);
    if (incompatible && settings.enabled) {
      if (incompatible === 'RESPONSES_PROFILE_UNKNOWN')
        throw new HttpError(400, incompatible, '请选择已核验的 OpenAI 文本模型');
      throw new HttpError(400, incompatible, '模型用途、推理档位或 Token 上限与协议档案不符');
    }
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
    const user = requireOperator(req),
      query = assistantReconciliationFilters.parse(req.query);
    const empty = { records: [], nextCursor: null };
    const turns =
      query.kind === 'voice'
        ? empty
        : await listUnknownAssistantRecords(db, user.id, 'turn', query);
    const voices =
      query.kind === 'turn'
        ? empty
        : await listUnknownAssistantRecords(db, user.id, 'voice', query);
    return {
      turns: turns.records,
      voices: voices.records,
      nextCursor: query.kind === 'voice' ? voices.nextCursor : turns.nextCursor,
      nextCursors: { turn: turns.nextCursor, voice: voices.nextCursor },
    };
  });
  app.post('/v1/ops/assistant-reconciliation/:kind/:recordId', async (req) => {
    const user = requireOperator(req),
      params = z.object({ kind: z.enum(['voice', 'turn']), recordId: id }).parse(req.params);
    return service.resolve(user.id, params.kind, params.recordId, req.body);
  });
  return service;
}
