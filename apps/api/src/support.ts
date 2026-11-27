import { open } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { MAX_HEADER_BYTES, readImageHeader } from '@ai-xiutu/editor';
import { adjustUnits, audit, getEntitlements, transaction, type Database, type Queryable } from '@ai-xiutu/db';
import { z } from 'zod';
import { hash, HttpError, id, lockOperatorSession, requireOperator, requireUser } from './core.js';

const MAX_QR_BYTES = 2 * 1024 * 1024;
const MAX_QR_PIXELS = 4096 * 4096;
const tierSchema = z.object({
  cents: z.number().int().min(1).max(10_000_000),
  points: z.number().int().min(1).max(100_000),
}).strict();
const settingsSchema = z.object({
  expectedVersion: z.number().int().positive(),
  enabled: z.boolean(),
  tiers: z.array(tierSchema).min(1).max(24)
    .refine((rows) => new Set(rows.map((row) => row.cents)).size === rows.length, 'Amounts must be unique'),
}).strict();
const defaultTiers = [199, 999, 1999, 4999, 9999, 14999].map((cents) => ({
  cents,
  points: Math.round(cents / 10),
}));
const versionQuery = z.object({ expectedVersion: z.coerce.number().int().positive() }).strict();
const qrPath = '/v1/support/wechat-qr';
type SupportConfigRow = {
  version: number;
  enabled: boolean;
  tiers: z.infer<typeof tierSchema>[] | null;
  has_upload: boolean;
};
const configFields = 'version,enabled,tiers,qr_png IS NOT NULL AS has_upload';
const tiersFor = (row: SupportConfigRow) => row.tiers ?? defaultTiers;
const hasQr = (row: SupportConfigRow, fallback: Buffer | null) => row.has_upload || Boolean(fallback);

async function readConfig(db: Queryable, lock = false) {
  const result = await db.query<SupportConfigRow>(
    'SELECT ' + configFields + ' FROM site_support_config WHERE id=true' + (lock ? ' FOR SHARE' : ''),
  );
  return result.rows[0]!;
}


function settingsDto(row: SupportConfigRow, fallback: Buffer | null) {
  return {
    version: row.version,
    enabled: row.enabled,
    tiers: tiersFor(row),
    qrSource: row.has_upload ? 'upload' : fallback ? 'deployment' : null,
    previewUrl: hasQr(row, fallback) ? '/v1/ops/support/qr?v=' + row.version : null,
  };
}

function configChanged() {
  return new HttpError(409, 'SUPPORT_CONFIG_CHANGED', '赞赏设置已被更新，请读取当前版本后重试');
}

async function normalizeSupportQr(bytes: Buffer) {
  try {
    const header = readImageHeader(bytes.subarray(0, MAX_HEADER_BYTES));
    if (!['png', 'jpeg', 'webp'].includes(header.format) || header.animated ||
        header.width < 64 || header.height < 64 || header.width > 4096 || header.height > 4096)
      throw new Error('INVALID_QR_SOURCE');
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: MAX_QR_PIXELS });
    const metadata = await image.metadata();
    if ((metadata.pages ?? 1) !== 1) throw new Error('INVALID_QR_SOURCE');
    const png = await image.autoOrient().flatten({ background: '#fff' }).png().toBuffer();
    if (png.length > MAX_QR_BYTES) throw new Error('INVALID_QR_OUTPUT');
    return png;
  } catch {
    throw new HttpError(400, 'SUPPORT_QR_INVALID', '请使用清晰的静态 PNG、JPEG 或 WebP 赞赏码（最大 2 MB）');
  }
}

export async function loadSupportQr(file: string | undefined): Promise<Buffer | null> {
  if (!file) return null;
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 32 || info.size > MAX_QR_BYTES)
      throw new Error('SUPPORT_QR_INVALID');
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new Error('SUPPORT_QR_INVALID');
    const original = bytes.subarray(0, offset);
    const image = readImageHeader(original.subarray(0, MAX_HEADER_BYTES));
    if (image.format !== 'png' || image.animated || image.width > 4096 || image.height > 4096)
      throw new Error('SUPPORT_QR_INVALID');
    return original;
  } finally {
    await handle.close();
  }
}

export function registerSupport(app: FastifyInstance, db: Database, fallback: Buffer | null) {
  app.get('/v1/support', async (req, reply) => {
    const user = requireUser(req);
    reply.header('Cache-Control', 'private, no-store');
    const [config, account] = await Promise.all([
      readConfig(db),
      db.query('SELECT phone_verified_at FROM users WHERE id=$1', [user.id]),
    ]);
    return {
      version: config.version,
      qrUrl: config.enabled && hasQr(config, fallback) ? qrPath : null,
      phoneVerified: Boolean(account.rows[0]?.phone_verified_at),
      tiers: tiersFor(config),
    };
  });

  async function readQr(preview: boolean) {
    const row = (await db.query('SELECT enabled,qr_png FROM site_support_config WHERE id=true')).rows[0];
    if (!preview && !row?.enabled) return null;
    return (row?.qr_png as Buffer | null) ?? fallback;
  }
  app.get(qrPath, async (req, reply) => {
    requireUser(req);
    const qr = await readQr(false);
    if (!qr) throw new HttpError(404, 'SUPPORT_QR_UNAVAILABLE', '微信赞赏暂未开放');
    return reply.header('Cache-Control', 'private, no-store').type('image/png').send(qr);
  });
  app.get('/v1/ops/support', async (req) => {
    requireOperator(req);
    return settingsDto(await readConfig(db), fallback);
  });
  app.get('/v1/ops/support/qr', async (req, reply) => {
    requireOperator(req);
    const qr = await readQr(true);
    if (!qr) throw new HttpError(404, 'SUPPORT_QR_UNAVAILABLE', '尚未设置赞赏码');
    return reply.header('Cache-Control', 'private, no-store').type('image/png').send(qr);
  });
  app.patch('/v1/ops/support', async (req) => {
    const operator = requireOperator(req);
    const { expectedVersion, enabled, tiers } = settingsSchema.parse(req.body);
    return transaction(db, async (tx) => {
      await lockOperatorSession(tx, operator.id, req.cookies.xiutu_session ?? '');
      const row = (await tx.query<SupportConfigRow>(
        'UPDATE site_support_config SET enabled=$2,tiers=$3,version=version+1,updated_at=clock_timestamp() WHERE id=true AND version=$1 RETURNING ' + configFields,
        [expectedVersion, enabled, JSON.stringify(tiers.sort((a, b) => a.cents - b.cents))],
      )).rows[0];
      if (!row) throw configChanged();
      await audit(tx, operator.id, 'operator.support_config', 'support_config', null, {
        version: row.version, enabled, tiers,
      });
      return settingsDto(row, fallback);
    });
  });
  app.put('/v1/ops/support/qr', async (req) => {
    const operator = requireOperator(req);
    const { expectedVersion } = versionQuery.parse(req.query);
    if ((await readConfig(db)).version !== expectedVersion) throw configChanged();
    const files = req.parts({ limits: { files: 1, fields: 0, fileSize: MAX_QR_BYTES, parts: 2 } });
    let png: Buffer | undefined;
    for await (const part of files) {
      if (part.type !== 'file' || part.fieldname !== 'file' || png)
        throw new HttpError(400, 'SUPPORT_QR_INVALID', '请上传一张赞赏码图片');
      png = await normalizeSupportQr(await part.toBuffer());
    }
    if (!png) throw new HttpError(400, 'SUPPORT_QR_INVALID', '请上传一张赞赏码图片');
    return transaction(db, async (tx) => {
      await lockOperatorSession(tx, operator.id, req.cookies.xiutu_session ?? '');
      const row = (await tx.query<SupportConfigRow>(
        'UPDATE site_support_config SET qr_png=$2,version=version+1,updated_at=clock_timestamp() WHERE id=true AND version=$1 RETURNING ' + configFields,
        [expectedVersion, png],
      )).rows[0];
      if (!row) throw configChanged();
      await audit(tx, operator.id, 'operator.support_qr_updated', 'support_config', null, {
        version: row.version,
      });
      return settingsDto(row, fallback);
    });
  });
  app.post('/v1/ops/support-grants', async (req) => {
    const operator = requireOperator(req);
    const input = z
      .object({
        userId: id,
        cents: tierSchema.shape.cents,
        expectedPoints: tierSchema.shape.points,
        expectedVersion: z.number().int().positive().optional(),
        reference: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{6,96}$/),
      })
      .strict()
      .parse(req.body);
    // Only the fingerprint is retained. Operators use a unique WeChat record number
    // or the stable reference assigned to that record during reconciliation.
    const reference = `support:wechat:${hash(input.reference.toLowerCase())}`;
    return transaction(db, async (tx) => {
      await lockOperatorSession(tx, operator.id, req.cookies.xiutu_session ?? '');
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [reference]);
      const target = (
        await tx.query(
          `SELECT s.id FROM users u JOIN spaces s ON s.owner_id=u.id AND s.kind='personal'
         JOIN memberships m ON m.space_id=s.id AND m.user_id=u.id AND m.role='owner'
         WHERE u.id=$1 AND u.status='active' AND u.phone_verified_at IS NOT NULL FOR SHARE OF u,s,m`,
          [input.userId],
        )
      ).rows[0];
      if (!target)
        throw new HttpError(409, 'SUPPORT_ACCOUNT_UNAVAILABLE', '仅可向已验证且正常使用的账号发放');
      const requestHash = hash(
        JSON.stringify({ userId: input.userId, cents: input.cents, points: input.expectedPoints }),
      );
      const existing = (
        await tx.query(
          'SELECT id,space_id,request_hash FROM quota_adjustments WHERE idempotency_key=$1',
          [reference],
        )
      ).rows[0];
      if (existing) {
        if (existing.space_id !== target.id || existing.request_hash !== requestHash)
          throw new HttpError(409, 'SUPPORT_RECORD_ALREADY_USED', '该核对编号已用于其他权益发放');
        return {
          adjustmentId: existing.id,
          points: input.expectedPoints,
          replayed: true,
          entitlements: await getEntitlements(tx, target.id),
        };
      }
      const config = await readConfig(tx, true);
      // An operator may reconcile money already received even after hiding the public QR.
      if (!hasQr(config, fallback))
        throw new HttpError(503, 'SUPPORT_QR_UNAVAILABLE', '尚未设置赞赏码');
      const tier = tiersFor(config).find((item) => item.cents === input.cents);
      if (!tier || tier.points !== input.expectedPoints ||
          (input.expectedVersion !== undefined && input.expectedVersion !== config.version))
        throw new HttpError(409, 'SUPPORT_TIER_CHANGED', '参考点数已变更，请重新读取后再发放');
      const adjustment = await adjustUnits(tx, {
        spaceId: target.id,
        actorId: operator.id,
        units: tier.points,
        reason: '微信赞赏核对后赠额',
        idempotencyKey: reference,
        requestHash,
      });
      await audit(tx, operator.id, 'operator.support_grant', 'adjustment', adjustment!.id, {
        userId: input.userId,
        spaceId: target.id,
        cents: tier.cents,
        units: tier.points,
      });
      return {
        adjustmentId: adjustment!.id,
        points: tier.points,
        replayed: false,
        entitlements: await getEntitlements(tx, target.id),
      };
    });
  });
}
