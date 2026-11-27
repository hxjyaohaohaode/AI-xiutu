import type { FastifyInstance } from 'fastify';
import { registerAccountLifecycle } from './ops-account-lifecycle.js';
import { z } from 'zod';
import { OPENAI_SPECIALIST_OPERATIONS } from '@ai-xiutu/contracts';
import {
  transaction,
  audit,
  ensureMonthlyGrant,
  getEntitlements,
  adjustUnits,
  type Database,
  type Queryable,
} from '@ai-xiutu/db';
import {
  HttpError,
  id,
  title,
  reason,
  phoneSchema,
  normalizePhone,
  requireUser,
  requireOperator,
  lockOperatorSession,
  lockUserSession,
  projectAccess,
  maskPhone,
  hash,
  opaqueToken,
} from './core.js';

const planSchema = z.object({
  name: title,
  units: z.number().int().min(1).max(1000000),
  priceCents: z.number().int().min(0).max(10000000),
  expiresAfterDays: z.number().int().min(1).max(3650).nullable().optional(),
  description: z.string().trim().max(400).optional(),
  benefits: z.array(z.string().trim().min(1).max(100)).max(12).optional(),
  kind: z.enum(['credits', 'subscription']).optional(),
  active: z.boolean(),
  reason,
});
const modelSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(2_147_483_646),
    label: title,
    provider: z.enum(['qwen', 'ark', 'openai']).default('qwen'),
    operations: z
      .array(
        z.enum([
          'edit-plan',
          'generate-image',
          'generate-text',
          'transcribe',
          ...OPENAI_SPECIALIST_OPERATIONS,
        ]),
      )
      .min(1)
      .max(4)
      .default(['edit-plan']),
    enabled: z.boolean(),
    minWidth: z.number().int().min(64).max(8192),
    maxWidth: z.number().int().min(64).max(8192),
    minHeight: z.number().int().min(64).max(8192),
    maxHeight: z.number().int().min(64).max(8192),
    maxOutputs: z.number().int().min(1).max(10),
    unitCost: z.number().int().min(1).max(100000),
    allowedQualities: z
      .array(z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'auto']))
      .min(1)
      .max(6),
    imageUnitCosts: z
      .object({
        auto: z.number().int().min(1).max(100000).optional(),
        low: z.number().int().min(1).max(100000).optional(),
        medium: z.number().int().min(1).max(100000).optional(),
        high: z.number().int().min(1).max(100000).optional(),
        xhigh: z.number().int().min(1).max(100000).optional(),
        max: z.number().int().min(1).max(100000).optional(),
      })
      .strict()
      .optional(),
    reason,
  })
  .strict()
  .refine((x) => x.minWidth <= x.maxWidth && x.minHeight <= x.maxHeight, '尺寸范围无效')
  .refine(
    (x) =>
      x.operations.every((op) =>
        x.provider === 'ark' || x.provider === 'openai'
          ? op === 'generate-image' ||
            (x.provider === 'openai' &&
              (op === 'transcribe' ||
                (OPENAI_SPECIALIST_OPERATIONS as readonly string[]).includes(op)))
          : ['edit-plan', 'generate-text', 'transcribe'].includes(op),
      ),
    '供应商与操作能力不匹配',
  );
const planDto = (p: Record<string, any>) => ({
  id: p.plan_id,
  version: p.version,
  name: p.name,
  units: p.units,
  priceCents: p.price_cents,
  expiresAfterDays: p.expires_after_days,
  description: p.description,
  benefits: p.benefits,
  kind: p.kind,
  active: p.active,
  createdAt: p.created_at,
});
export const modelDto = (p: Record<string, any>) => ({
  id: p.id,
  provider: 'qwen',
  operations: ['edit-plan'],
  ...p.config,
  version: p.version,
  pointsPerPlan: p.config.unitCost,
  ...(p.config.provider === 'openai' || p.config.provider === 'ark'
    ? {
        pricing: {
          unit: 'service-point',
          per: 'image',
          defaultPerImage: p.config.unitCost,
          qualityPerImage: p.config.imageUnitCosts ?? {},
        },
      }
    : {}),
});
export async function publicSettings(db: Database) {
  const row = (await db.query('SELECT * FROM app_config WHERE id=true')).rows[0]!;
  return settingsDto(row);
}

function settingsDto(row: Record<string, any>) {
  return {
    brand: { ...row.brand, logoUrl: row.brand.logoAssetId ? '/v1/public-logo' : null },
    registrationMode: row.registration_mode,
    quota: { period: 'month', freeUnits: row.free_units, policyVersion: row.quota_policy_version },
    sharingDefaults: {
      allowReference: true,
      allowCopy: false,
      maxActiveGrants: 20,
      maxCopyAssets: 20,
    },
  };
}
async function lockWalletAccess(tx: Queryable, spaceId: string, userId: string) {
  const membership = await tx.query(
    'SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2 FOR SHARE',
    [spaceId, userId],
  );
  if (!membership.rowCount) throw new HttpError(403, 'SPACE_FORBIDDEN', '没有此空间的操作权限');
}

export function registerOperations(
  app: FastifyInstance,
  db: Database,
  capabilities: () => Record<string, unknown>,
  describeModel: (model: ReturnType<typeof modelDto>) => Record<string, unknown> = (model) => model,
  providerModelCatalog: readonly unknown[] = [],
): void {
  app.get('/v1/me/entitlements', async (req) => {
    const user = requireUser(req);
    const { spaceId } = z.object({ spaceId: id.optional() }).parse(req.query);
    return transaction(db, async (tx) => {
      await lockUserSession(tx, user.id, req.cookies.xiutu_session ?? '');
      const personal = await ensureMonthlyGrant(tx, user.id);
      const target = spaceId ?? personal;
      await lockWalletAccess(tx, target, user.id);
      return getEntitlements(tx, target);
    });
  });
  app.get('/v1/me/usage', async (req) => {
    const user = requireUser(req);
    const { spaceId } = z.object({ spaceId: id.optional() }).parse(req.query);
    return transaction(db, async (tx) => {
      await lockUserSession(tx, user.id, req.cookies.xiutu_session ?? '');
      const target =
        spaceId ??
        (await tx.query("SELECT id FROM spaces WHERE owner_id=$1 AND kind='personal'", [user.id]))
          .rows[0]?.id;
      if (!target) throw new HttpError(404, 'SPACE_NOT_FOUND', '空间不存在');
      await lockWalletAccess(tx, target, user.id);
      return {
        entries: (
          await tx.query(
            'SELECT id,lot_id AS "lotId",kind,units,reason,created_at AS "createdAt" FROM ledger_entries WHERE space_id=$1 ORDER BY id DESC LIMIT 100',
            [target],
          )
        ).rows,
      };
    });
  });
  app.get('/v1/ops/overview', async (req) => {
    requireOperator(req);
    const { rows } = await db.query(`SELECT
    (SELECT count(*) FROM users)::integer AS users,(SELECT count(*) FROM spaces)::integer AS spaces,
    (SELECT count(*) FROM projects WHERE deleted_at IS NULL)::integer AS projects,(SELECT count(*) FROM assets WHERE deleted_at IS NULL)::integer AS assets,
    (SELECT count(*) FROM artworks)::integer AS artworks,(SELECT count(*) FROM ai_jobs)::integer AS jobs`);
    const totals = (
      await db.query(
        'SELECT COALESCE(sum(available),0)::bigint AS available,COALESCE(sum(held),0)::bigint AS held,COALESCE(sum(spent),0)::bigint AS spent FROM quota_lots',
      )
    ).rows[0]!;
    return {
      counts: rows[0],
      pointTotals: {
        available: Number(totals.available),
        held: Number(totals.held),
        spent: Number(totals.spent),
      },
      capabilities: capabilities(),
    };
  });
  registerAccountLifecycle(app, db);
  app.get('/v1/ops/users', async (req) => {
    const actor = requireOperator(req);
    const p = z.object({ query: z.string().max(120).default('') }).parse(req.query);
    const query = p.query.trim();
    const compact = query.replace(/[\s()-]/g, '');
    const exactPhone = /^(?:1[3-9]\d{9}|\+[1-9]\d{7,14})$/.test(compact)
      ? normalizePhone(compact)
      : null;
    const term = query.replace(/[\\%_]/g, '\\$&');
    const canManageAccounts = !!(
      await db.query('SELECT 1 FROM operator_users WHERE user_id=$1 AND manages_accounts', [
        actor.id,
      ])
    ).rowCount;
    const rows = (
      await db.query(
        "SELECT u.id,u.display_name,u.phone,u.status,u.created_at,o.user_id IS NOT NULL AS is_operator,COALESCE(o.manages_accounts,false) AS manages_accounts FROM users u LEFT JOIN operator_users o ON o.user_id=u.id WHERE CASE WHEN $2::text IS NOT NULL THEN u.phone=$2 ELSE u.display_name ILIKE $1 ESCAPE '\\' OR u.phone ILIKE $1 ESCAPE '\\' END ORDER BY u.created_at DESC LIMIT 100",
        [`%${term}%`, exactPhone],
      )
    ).rows;
    return {
      canManageAccounts,
      users: rows.map((u) => ({
        id: u.id,
        displayName: u.display_name,
        phoneMasked: u.status === 'closed' ? '' : maskPhone(u.phone),
        status: u.status,
        isOperator: u.is_operator,
        managesAccounts: u.manages_accounts,
        createdAt: u.created_at,
      })),
    };
  });
  app.get('/v1/ops/users/:id/entitlements', async (req) => {
    const actor = requireOperator(req);
    const p = z.object({ id }).parse(req.params);
    return transaction(db, async (tx) => {
      await lockOperatorSession(tx, actor.id, req.cookies.xiutu_session ?? '');
      const user = (
        await tx.query(
          'SELECT id,phone,display_name,status,phone_verified_at FROM users WHERE id=$1 FOR SHARE',
          [p.id],
        )
      ).rows[0];
      if (!user) throw new HttpError(404, 'USER_NOT_FOUND', '账号不存在');
      const owned = (
        await tx.query(
          "SELECT s.id,s.kind,s.name,m.role FROM spaces s JOIN memberships m ON m.space_id=s.id AND m.user_id=$1 WHERE s.owner_id=$1 ORDER BY CASE WHEN s.kind='personal' THEN 0 ELSE 1 END,s.id",
          [p.id],
        )
      ).rows;
      if (
        user.status === 'active' &&
        user.phone_verified_at &&
        owned.some((s) => s.kind === 'personal')
      )
        await ensureMonthlyGrant(tx, p.id);
      const spaces = [];
      for (const space of owned)
        spaces.push({ ...space, entitlements: await getEntitlements(tx, space.id) });
      await audit(tx, actor.id, 'operator.quota_view', 'user', p.id, {
        spaceIds: owned.map((s) => s.id),
      });
      return {
        user: {
          id: user.id,
          displayName: user.display_name,
          phoneMasked: user.status === 'closed' ? '' : maskPhone(user.phone),
          status: user.status,
          phoneVerified: Boolean(user.phone_verified_at),
        },
        spaces,
      };
    });
  });
  app.post('/v1/ops/users', async (req, reply) => {
    const actor = requireOperator(req);
    const p = z.object({ phone: phoneSchema, displayName: title, reason }).strict().parse(req.body);
    const user = await transaction(db, async (tx) => {
      await lockOperatorSession(tx, actor.id, req.cookies.xiutu_session ?? '');
      const row = (
        await tx.query(
          "INSERT INTO users(phone,display_name,status) VALUES($1,$2,'pending') RETURNING *",
          [p.phone, p.displayName],
        )
      ).rows[0]!;
      await audit(tx, actor.id, 'operator.user_invite', 'user', row.id, { reason: p.reason });
      return {
        id: row.id,
        displayName: row.display_name,
        phoneMasked: maskPhone(row.phone),
        status: row.status,
        isOperator: false,
        createdAt: row.created_at,
      };
    });
    return reply.code(201).send({ user });
  });
  app.patch('/v1/ops/users/:id', async (req) => {
    const actor = requireOperator(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({ status: z.enum(['active', 'banned']), reason })
      .strict()
      .parse(req.body);
    if (actor.id === p.id) throw new HttpError(400, 'SELF_STATUS_CHANGE', '不能在此停用自己的账号');
    const user = await transaction(db, async (tx) => {
      await lockOperatorSession(tx, actor.id, req.cookies.xiutu_session ?? '');
      const old = (await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [p.id])).rows[0];
      if (!old) throw new HttpError(404, 'USER_NOT_FOUND', '账号不存在');
      if (old.status === 'closed')
        throw new HttpError(409, 'ACCOUNT_CLOSED', '账号已注销，无法恢复');
      if (old.status === 'pending' && body.status === 'active')
        throw new HttpError(409, 'VERIFICATION_REQUIRED', '待验证账号必须自行完成短信注册');
      if ((await tx.query('SELECT user_id FROM operator_users WHERE user_id=$1', [p.id])).rowCount)
        throw new HttpError(403, 'OPERATOR_PROTECTED', '请先由账号管理员撤回运营权限');
      // Restoring an unverified invitation must restore the verification workflow,
      // not fabricate phone ownership or leave an active account without a space.
      const nextStatus =
        body.status === 'active' && !old.phone_verified_at ? 'pending' : body.status;
      const updated = (
        await tx.query(
          'UPDATE users SET status=$2,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [p.id, nextStatus],
        )
      ).rows[0]!;
      if (nextStatus !== 'active') {
        await tx.query('DELETE FROM sessions WHERE user_id=$1', [p.id]);
        await tx.query('UPDATE invitations SET revoked_at=clock_timestamp() WHERE created_by=$1 AND revoked_at IS NULL', [p.id]);
      }
      await audit(tx, actor.id, 'operator.user_status', 'user', p.id, {
        from: old.status,
        to: nextStatus,
        requested: body.status,
        reason: body.reason,
      });
      return {
        id: updated.id,
        displayName: updated.display_name,
        phoneMasked: maskPhone(updated.phone),
        status: updated.status,
        isOperator: false,
      };
    });
    return { user };
  });
  async function readOpsConfig() {
    const row = (
      await db.query('SELECT *,updated_at::text AS revision FROM app_config WHERE id=true')
    ).rows[0]!;
    return { ...settingsDto(row), revision: row.revision as string };
  }
  app.get('/v1/ops/config', async (req) => {
    requireOperator(req);
    return readOpsConfig();
  });
  app.patch('/v1/ops/config', async (req) => {
    const actor = requireOperator(req);
    const body = z
      .object({
        brand: z
          .object({ name: title, tagline: z.string().max(200), logoAssetId: id.nullable() })
          .strict()
          .optional(),
        registrationMode: z.enum(['open', 'invite']).optional(),
        expectedRevision: z.string().min(16).max(64).optional(),
        quota: z
          .object({ freeUnits: z.number().int().min(0).max(100000) })
          .strict()
          .optional(),
        reason,
      })
      .strict()
      .parse(req.body);
    return transaction(db, async (tx) => {
      await lockOperatorSession(tx, actor.id, req.cookies.xiutu_session ?? '');
      const current = (
        await tx.query(
          'SELECT *,updated_at::text AS revision FROM app_config WHERE id=true FOR UPDATE',
        )
      ).rows[0]!;
      if (body.expectedRevision !== undefined && body.expectedRevision !== current.revision)
        throw new HttpError(409, 'SITE_CONFIG_CHANGED', '站点设置已更新，请刷新后重新编辑');
      if (body.brand?.logoAssetId && body.brand.logoAssetId !== current.brand?.logoAssetId) {
        const asset = (
          await tx.query('SELECT project_id FROM assets WHERE id=$1 AND deleted_at IS NULL', [
            body.brand.logoAssetId,
          ])
        ).rows[0];
        if (!asset) throw new HttpError(400, 'LOGO_NOT_FOUND', 'Logo图片不存在');
        await projectAccess(tx, asset.project_id, actor.id, 'admin');
      }
      const saved = (
        await tx.query(
          'UPDATE app_config SET brand=$1,registration_mode=$2,free_units=$3,quota_policy_version=quota_policy_version+$4,updated_at=clock_timestamp() WHERE id=true RETURNING *,updated_at::text AS revision',
          [
            JSON.stringify(body.brand ?? current.brand),
            body.registrationMode ?? current.registration_mode,
            body.quota?.freeUnits ?? current.free_units,
            body.quota && body.quota.freeUnits !== current.free_units ? 1 : 0,
          ],
        )
      ).rows[0]!;
      await audit(tx, actor.id, 'operator.config', 'config', 'main', {
        changed: Object.keys(body).filter((k) => k !== 'reason' && k !== 'expectedRevision'),
        reason: body.reason,
        freeUnits: body.quota?.freeUnits,
      });
      return { ...settingsDto(saved), revision: saved.revision as string };
    });
  });
  app.get('/v1/plans', async (req) => {
    requireUser(req);
    const { rows } = await db.query(
      `SELECT v.* FROM plans p JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version
       WHERE v.active ORDER BY v.price_cents, p.created_at, p.id`,
    );
    return { plans: rows.map(planDto), checkoutAvailable: false };
  });
  app.get('/v1/ops/plans', async (req) => {
    requireOperator(req);
    return {
      plans: (
        await db.query(
          'SELECT v.* FROM plans p JOIN plan_versions v ON v.plan_id=p.id AND v.version=p.current_version ORDER BY p.created_at DESC',
        )
      ).rows.map(planDto),
    };
  });
  app.post('/v1/ops/plans', async (req, reply) => {
    const actor = requireOperator(req);
    const p = planSchema.strict().parse(req.body);
    const plan = await transaction(db, async (tx) => {
      await lockOperatorSession(tx, actor.id, req.cookies.xiutu_session ?? '');
      const row = (await tx.query('INSERT INTO plans DEFAULT VALUES RETURNING id')).rows[0]!;
      const version = (
        await tx.query(
          `INSERT INTO plan_versions(plan_id,version,name,units,price_cents,expires_after_days,active,created_by,description,benefits,kind)
           VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            row.id,
            p.name,
            p.units,
            p.priceCents,
            p.expiresAfterDays ?? null,
            p.active,
            actor.id,
            p.description ?? '',
            p.benefits ?? [],
            p.kind ?? 'credits',
          ],
        )
      ).rows[0]!;
      await audit(tx, actor.id, 'operator.plan_create', 'plan', row.id, {
        reason: p.reason,
        version: 1,
      });
      return planDto(version);
    });
    return reply.code(201).send({ plan });
  });
  app.patch('/v1/ops/plans/:id', async (req) => {
    const actor = requireOperator(req);
    const params = z.object({ id }).parse(req.params);
    const p = planSchema
      .extend({ expectedVersion: z.number().int().positive().optional() })
      .strict()
      .parse(req.body);
    const plan = await transaction(db, async (tx) => {
      await lockOperatorSession(tx, actor.id, req.cookies.xiutu_session ?? '');
      const current = (await tx.query('SELECT * FROM plans WHERE id=$1 FOR UPDATE', [params.id]))
        .rows[0];
      if (!current) throw new HttpError(404, 'PLAN_NOT_FOUND', '套餐不存在');
      if (p.expectedVersion !== undefined && current.current_version !== p.expectedVersion)
        throw new HttpError(409, 'PLAN_VERSION_CHANGED', '套餐已经更新，请重新读取');
      const previous = (
        await tx.query(
          'SELECT description,benefits,kind FROM plan_versions WHERE plan_id=$1 AND version=$2',
          [params.id, current.current_version],
        )
      ).rows[0]!;
      const next = current.current_version + 1;
      const row = (
        await tx.query(
          `INSERT INTO plan_versions(plan_id,version,name,units,price_cents,expires_after_days,active,created_by,description,benefits,kind)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            params.id,
            next,
            p.name,
            p.units,
            p.priceCents,
            p.expiresAfterDays ?? null,
            p.active,
            actor.id,
            p.description ?? previous.description,
            p.benefits ?? previous.benefits,
            p.kind ?? previous.kind,
          ],
        )
      ).rows[0]!;
      await tx.query('UPDATE plans SET current_version=$2 WHERE id=$1', [params.id, next]);
      await audit(tx, actor.id, 'operator.plan_version', 'plan', params.id, {
        version: next,
        reason: p.reason,
      });
      return planDto(row);
    });
    return { plan };
  });
  app.get('/v1/ops/models', async (req) => {
    requireOperator(req);
    return {
      models: (await db.query('SELECT * FROM model_configs ORDER BY id')).rows.map((row) =>
        describeModel(modelDto(row)),
      ),
      providerModelCatalog,
    };
  });
  app.put('/v1/ops/models/:id', async (req) => {
    const actor = requireOperator(req);
    const p = z
      .object({ id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/) })
      .parse(req.params);
    const body = modelSchema.parse(req.body);
    if (
      body.enabled &&
      body.provider === 'openai' &&
      body.operations.some(
        (operation) =>
          !providerModelCatalog.some((value) => {
            const item = value as { id: string; operation?: string };
            return item.id === p.id && item.operation === operation;
          }),
      )
    )
      throw new HttpError(400, 'MODEL_PROFILE_MISMATCH', '模型 ID 与 OpenAI 接口用途不匹配');
    const { reason: why, expectedVersion, ...config } = body;
    const model = await transaction(db, async (tx) => {
      await lockOperatorSession(tx, actor.id, req.cookies.xiutu_session ?? '');
      const encoded = JSON.stringify(config);
      const result =
        expectedVersion === 0
          ? await tx.query(
              'INSERT INTO model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO NOTHING RETURNING *',
              [p.id, encoded],
            )
          : await tx.query(
              'UPDATE model_configs SET config=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$3 RETURNING *',
              [p.id, encoded, expectedVersion],
            );
      const row = result.rows[0];
      if (!row)
        throw new HttpError(
          409,
          'MODEL_CONFIG_CHANGED',
          '模型配置已变化，请从目录重新打开后再保存。',
        );
      await audit(tx, actor.id, 'operator.model_config', 'model', p.id, {
        reason: why,
        version: row.version,
      });
      return describeModel(modelDto(row));
    });
    return { model };
  });
  app.post('/v1/ops/adjustments', async (req) => {
    const actor = requireOperator(req);
    const p = z
      .object({
        spaceId: id,
        units: z
          .number()
          .int()
          .min(-100000)
          .max(100000)
          .refine((n) => n !== 0),
        reason,
        idempotencyKey: z.string().min(8).max(128),
      })
      .strict()
      .parse(req.body);
    if (p.idempotencyKey.startsWith('support:wechat:'))
      throw new HttpError(400, 'ADJUSTMENT_KEY_RESERVED', '请使用微信赞赏发放入口');
    return transaction(db, async (tx) => {
      await lockOperatorSession(tx, actor.id, req.cookies.xiutu_session ?? '');
      if (!(await tx.query('SELECT id FROM spaces WHERE id=$1', [p.spaceId])).rowCount)
        throw new HttpError(404, 'SPACE_NOT_FOUND', '空间不存在');
      const adjustment = await adjustUnits(tx, {
        ...p,
        actorId: actor.id,
        requestHash: hash(JSON.stringify({ spaceId: p.spaceId, units: p.units, reason: p.reason })),
      });
      // An idempotent retry may add an audit of access, but cannot mint another lot.
      await audit(tx, actor.id, 'operator.quota_adjustment', 'adjustment', adjustment!.id, {
        spaceId: p.spaceId,
        units: p.units,
        reason: p.reason,
      });
      return { adjustment, entitlements: await getEntitlements(tx, p.spaceId) };
    });
  });
  app.get('/v1/ops/audit', async (req) => {
    requireOperator(req);
    const { before, limit } = z
      .object({
        before: z
          .string()
          .regex(/^[1-9][0-9]{0,18}$/)
          .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n)
          .optional(),
        limit: z.coerce.number().int().min(1).max(50).default(10),
      })
      .strict()
      .parse(req.query);
    const { rows } = await db.query(
      'SELECT id,actor_id AS "actorId",action,target_type AS "targetType",target_id AS "targetId",detail,created_at AS "createdAt" FROM audit_entries WHERE ($1::bigint IS NULL OR id<$1) ORDER BY id DESC LIMIT $2',
      [before ?? null, limit + 1],
    );
    const entries = rows.slice(0, limit);
    return { entries, nextCursor: rows.length > limit ? String(entries.at(-1)!.id) : null };
  });
  app.post('/v1/ops/registration-invites', async (req, reply) => {
    const actor = requireOperator(req);
    const p = z
      .object({
        maxUses: z.number().int().min(1).max(100).default(1),
        expiresInDays: z.number().int().min(1).max(30).default(7),
        reason,
      })
      .strict()
      .parse(req.body);
    const code = opaqueToken();
    const invitation = await transaction(db, async (tx) => {
      await lockOperatorSession(tx, actor.id, req.cookies.xiutu_session ?? '');
      const row = (
        await tx.query(
          'INSERT INTO invitations(code_hash,kind,max_uses,expires_at,created_by) VALUES($1,\'registration\',$2,clock_timestamp()+($3::text||\' days\')::interval,$4) RETURNING id,expires_at AS "expiresAt",max_uses AS "maxUses"',
          [hash(code), p.maxUses, p.expiresInDays, actor.id],
        )
      ).rows[0]!;
      await audit(tx, actor.id, 'operator.registration_invite', 'invitation', row.id, {
        reason: p.reason,
        maxUses: p.maxUses,
      });
      return { ...row, code };
    });
    return reply.code(201).send({ invitation });
  });
}
