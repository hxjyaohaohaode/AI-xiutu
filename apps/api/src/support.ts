import { open } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { MAX_HEADER_BYTES, readImageHeader } from '@ai-xiutu/editor';
import { adjustUnits, audit, getEntitlements, transaction, type Database } from '@ai-xiutu/db';
import { z } from 'zod';
import { hash, HttpError, id, requireOperator, requireUser } from './core.js';

const supportRates = {
  asOf: '2026-11-13',
  cnyPerUsd: 6.7152,
  model: 'gpt-5.4-mini',
  inputUsdPerMillion: 0.75,
  outputUsdPerMillion: 4.5,
  inputShare: 0.75,
};
const supportTiers = [199, 999, 1999, 4999, 9999, 14999].map((cents) => {
  const usd = cents / 100 / supportRates.cnyPerUsd;
  const rate =
    supportRates.inputShare * supportRates.inputUsdPerMillion +
    (1 - supportRates.inputShare) * supportRates.outputUsdPerMillion;
  return {
    cents,
    points: Math.round(cents / 10),
    usd,
    textTokens: Math.floor((usd * 1_000_000) / rate),
  };
});

export async function loadSupportQr(file: string | undefined): Promise<Buffer | null> {
  if (!file) return null;
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 32 || info.size > 2 * 1024 * 1024)
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

export function registerSupport(app: FastifyInstance, db: Database, qr: Buffer | null) {
  app.get('/v1/support', async (req, reply) => {
    const user = requireUser(req);
    reply.header('Cache-Control', 'private, no-store');
    const account = (await db.query('SELECT phone_verified_at FROM users WHERE id=$1', [user.id]))
      .rows[0];
    return {
      qrUrl: qr ? '/v1/support/wechat-qr' : null,
      phoneVerified: Boolean(account?.phone_verified_at),
      rates: supportRates,
      tiers: supportTiers,
    };
  });
  app.get('/v1/support/wechat-qr', async (req, reply) => {
    requireUser(req);
    if (!qr) throw new HttpError(404, 'SUPPORT_QR_UNAVAILABLE', '微信赞赏暂未开放');
    return reply.header('Cache-Control', 'private, no-store').type('image/png').send(qr);
  });
  app.post('/v1/ops/support-grants', async (req) => {
    const operator = requireOperator(req);
    if (!qr) throw new HttpError(503, 'SUPPORT_QR_UNAVAILABLE', '微信赞赏暂未开放');
    const input = z
      .object({
        userId: id,
        cents: z.number().int().positive(),
        expectedPoints: z.number().int().positive(),
        reference: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{6,96}$/),
      })
      .strict()
      .parse(req.body);
    const tier = supportTiers.find((item) => item.cents === input.cents);
    if (!tier || tier.points !== input.expectedPoints)
      throw new HttpError(409, 'SUPPORT_TIER_CHANGED', '参考点数已变更，请重新读取后再发放');
    // Only the fingerprint is retained. Operators use a unique WeChat record number
    // or the stable reference assigned to that record during reconciliation.
    const reference = `support:wechat:${hash(input.reference.toLowerCase())}`;
    return transaction(db, async (tx) => {
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
        JSON.stringify({ userId: input.userId, cents: tier.cents, points: tier.points }),
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
          points: tier.points,
          replayed: true,
          entitlements: await getEntitlements(tx, target.id),
        };
      }
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
