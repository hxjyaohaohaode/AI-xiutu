import { randomUUID } from 'node:crypto';
import type { Queryable } from './index.js';

export class QuotaError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'QuotaError';
  }
}
async function walletLock(tx: Queryable, spaceId: string): Promise<void> {
  await tx.query('INSERT INTO quota_wallets(space_id) VALUES($1) ON CONFLICT DO NOTHING', [
    spaceId,
  ]);
  await tx.query('SELECT space_id FROM quota_wallets WHERE space_id=$1 FOR UPDATE', [spaceId]);
}
async function expireAvailable(tx: Queryable, spaceId: string): Promise<void> {
  const rows = await tx.query(
    `WITH due AS (SELECT id,available AS amount FROM quota_lots
      WHERE space_id=$1 AND expires_at<=clock_timestamp() AND available>0 FOR UPDATE)
     UPDATE quota_lots l SET expired=l.expired+l.available,available=0 FROM due
     WHERE l.id=due.id RETURNING l.id,due.amount`,
    [spaceId],
  );
  for (const lot of rows.rows)
    await tx.query(
      `INSERT INTO ledger_entries(space_id,lot_id,kind,units,event_key,reason,movement)
       VALUES($1,$2,'expire',0,$3,'周期或权益到期',jsonb_build_object('expired',$4::integer)) ON CONFLICT DO NOTHING`,
      [spaceId, lot.id, `expire:${lot.id}`, lot.amount],
    );
}
export async function ensureMonthlyGrant(tx: Queryable, userId: string): Promise<string> {
  const { rows } = await tx.query("SELECT id FROM spaces WHERE owner_id=$1 AND kind='personal'", [
    userId,
  ]);
  const spaceId = rows[0]?.id as string | undefined;
  if (!spaceId) throw new QuotaError('PERSONAL_SPACE_MISSING', '个人空间尚未建立');
  await walletLock(tx, spaceId);
  const q = await tx.query(`WITH t AS (SELECT clock_timestamp() AS at)
    SELECT to_char(date_trunc('month',at AT TIME ZONE 'Asia/Shanghai'),'YYYY-MM-DD') AS start,
    (date_trunc('month',at AT TIME ZONE 'Asia/Shanghai')+interval '1 month') AT TIME ZONE 'Asia/Shanghai' AS ends,
    c.free_units,c.quota_policy_version FROM t CROSS JOIN app_config c WHERE c.id=true`);
  const p = q.rows[0]!;
  const grant = await tx.query(
    `INSERT INTO quota_grants(subject_id,period_start,policy_version,units)
    VALUES($1,$2,$3,$4) ON CONFLICT(subject_id,period_start) DO NOTHING RETURNING id`,
    [userId, p.start, p.quota_policy_version, p.free_units],
  );
  if (grant.rows[0]) {
    const lot = await tx.query(
      `INSERT INTO quota_lots(space_id,kind,source_key,total_units,available,expires_at)
      VALUES($1,'free',$2,$3,$3,$4) RETURNING id`,
      [spaceId, `month:${userId}:${p.start}`, p.free_units, p.ends],
    );
    await tx.query(
      `INSERT INTO ledger_entries(space_id,lot_id,kind,units,event_key,actor_id,reason)
      VALUES($1,$2,'grant',$3,$4,$5,'本期免费额度')`,
      [spaceId, lot.rows[0]!.id, p.free_units, `grant:${grant.rows[0].id}`, userId],
    );
  }
  await expireAvailable(tx, spaceId);
  return spaceId;
}
export async function getEntitlements(tx: Queryable, spaceId: string) {
  await walletLock(tx, spaceId);
  await expireAvailable(tx, spaceId);
  const { rows: lots } = await tx.query(
    `SELECT id,kind,total_units AS "totalUnits",available,held,spent,expired,revoked,expires_at AS "expiresAt",created_at AS "createdAt"
    FROM quota_lots WHERE space_id=$1 ORDER BY expires_at NULLS LAST,created_at,id`,
    [spaceId],
  );
  const periods =
    await tx.query(`SELECT date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' AS start,
    (date_trunc('month',clock_timestamp() AT TIME ZONE 'Asia/Shanghai')+interval '1 month') AT TIME ZONE 'Asia/Shanghai' AS ends`);
  const sum = (field: string, filter: (l: (typeof lots)[number]) => boolean = () => true) =>
    lots.filter(filter).reduce((n, l) => n + Number(l[field]), 0);
  return {
    spaceId,
    periodStart: periods.rows[0]!.start,
    periodEnd: periods.rows[0]!.ends,
    available: sum('available'),
    held: sum('held'),
    freeAvailable: sum('available', (l) => l.kind !== 'purchased'),
    purchasedAvailable: sum('available', (l) => l.kind === 'purchased'),
    lots,
    usage: { spent: sum('spent'), expired: sum('expired'), revoked: sum('revoked') },
  };
}
export interface ReserveInput {
  spaceId: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  units: number;
}
export async function reserveUnits(
  tx: Queryable,
  input: ReserveInput,
): Promise<{ id: string; state: string; units: number }> {
  const { spaceId, userId, idempotencyKey, requestHash, units } = input;
  if (!Number.isSafeInteger(units) || units < 1 || units > 100000)
    throw new QuotaError('INVALID_UNITS', '额度参数无效');
  await walletLock(tx, spaceId);
  const existing = await tx.query(
    'SELECT * FROM quota_holds WHERE space_id=$1 AND idempotency_key=$2',
    [spaceId, idempotencyKey],
  );
  if (existing.rows[0]) {
    const old = existing.rows[0];
    if (old.request_hash !== requestHash || old.units !== units || old.user_id !== userId)
      throw new QuotaError('IDEMPOTENCY_CONFLICT', '幂等键已用于其他请求');
    return { id: old.id, state: old.state, units: old.units };
  }
  await expireAvailable(tx, spaceId);
  const { rows: lots } = await tx.query(
    `SELECT * FROM quota_lots WHERE space_id=$1 AND available>0
    ORDER BY expires_at NULLS LAST,CASE WHEN kind='purchased' THEN 1 ELSE 0 END,created_at,id FOR UPDATE`,
    [spaceId],
  );
  if (lots.reduce((n, l) => n + Number(l.available), 0) < units)
    throw new QuotaError(
      'FREE_QUOTA_EXHAUSTED',
      '可用额度不足，请等待下次发放或查看已获准的购买方式',
    );
  const id = randomUUID();
  await tx.query(
    `INSERT INTO quota_holds(id,space_id,user_id,idempotency_key,request_hash,units,state) VALUES($1,$2,$3,$4,$5,$6,'held')`,
    [id, spaceId, userId, idempotencyKey, requestHash, units],
  );
  let remaining = units;
  for (const lot of lots) {
    if (!remaining) break;
    const count = Math.min(remaining, Number(lot.available));
    await tx.query('UPDATE quota_lots SET available=available-$2,held=held+$2 WHERE id=$1', [
      lot.id,
      count,
    ]);
    await tx.query('INSERT INTO hold_allocations(hold_id,lot_id,units) VALUES($1,$2,$3)', [
      id,
      lot.id,
      count,
    ]);
    await tx.query(
      `INSERT INTO ledger_entries(space_id,lot_id,kind,units,event_key,actor_id,reason) VALUES($1,$2,'hold',$3,$4,$5,'任务预占')`,
      [spaceId, lot.id, -count, `hold:${id}:${lot.id}`, userId],
    );
    remaining -= count;
  }
  return { id, state: 'held', units };
}
async function finishHold(
  tx: Queryable,
  holdId: string,
  target: 'settled' | 'released',
): Promise<void> {
  const found = await tx.query('SELECT space_id FROM quota_holds WHERE id=$1', [holdId]);
  if (!found.rows[0]) throw new QuotaError('HOLD_NOT_FOUND', '预占记录不存在');
  await walletLock(tx, found.rows[0].space_id);
  const { rows } = await tx.query('SELECT * FROM quota_holds WHERE id=$1 FOR UPDATE', [holdId]);
  const hold = rows[0]!;
  if (hold.state === target) return;
  if (!['held', 'unknown'].includes(hold.state))
    throw new QuotaError('HOLD_TERMINAL', '预占已按另一结果结束');
  const allocations = await tx.query(
    'SELECT a.*,l.expires_at FROM hold_allocations a JOIN quota_lots l ON l.id=a.lot_id WHERE hold_id=$1 ORDER BY l.id FOR UPDATE OF l',
    [holdId],
  );
  // Keep PostgreSQL's full timestamp precision and one instant for every lot and
  // both complementary branches. Two clock_timestamp() calls can straddle expiry.
  const releasedAt =
    target === 'released'
      ? (await tx.query('SELECT clock_timestamp()::text AS value')).rows[0]!.value
      : null;
  for (const a of allocations.rows) {
    if (target === 'settled')
      await tx.query('UPDATE quota_lots SET held=held-$2,spent=spent+$2 WHERE id=$1', [
        a.lot_id,
        a.units,
      ]);
    else
      await tx.query(
        `UPDATE quota_lots SET held=held-$2,
      available=available+CASE WHEN expires_at IS NULL OR expires_at>$3::timestamptz THEN $2 ELSE 0 END,
      expired=expired+CASE WHEN expires_at IS NULL OR expires_at>$3::timestamptz THEN 0 ELSE $2 END WHERE id=$1`,
        [a.lot_id, a.units, releasedAt],
      );
    await tx.query(
      `INSERT INTO ledger_entries(space_id,lot_id,kind,units,event_key,actor_id,reason,movement)
       SELECT $1,$2,$3,$4,$5,$6,$7,
         CASE WHEN $3='settled' THEN jsonb_build_object('consumed',$8::integer)
         ELSE jsonb_build_object('released',$8::integer,'expired',
           CASE WHEN expires_at<=$9::timestamptz THEN $8::integer ELSE 0 END) END
       FROM quota_lots WHERE id=$2`,
      [
        hold.space_id,
        a.lot_id,
        target,
        target === 'released' ? a.units : 0,
        `${target}:${holdId}:${a.lot_id}`,
        hold.user_id,
        target === 'settled' ? '任务权益结算' : '未交付任务释放到原批次',
        a.units,
        releasedAt,
      ],
    );
  }
  await tx.query('UPDATE quota_holds SET state=$2 WHERE id=$1', [holdId, target]);
}
export const settleHold = (tx: Queryable, id: string) => finishHold(tx, id, 'settled');
export const releaseHold = (tx: Queryable, id: string) => finishHold(tx, id, 'released');
export async function markUnknownHold(tx: Queryable, id: string): Promise<void> {
  const found = await tx.query('SELECT space_id FROM quota_holds WHERE id=$1', [id]);
  if (!found.rows[0]) throw new QuotaError('HOLD_NOT_FOUND', '预占记录不存在');
  await walletLock(tx, found.rows[0].space_id);
  await tx.query("UPDATE quota_holds SET state='unknown' WHERE id=$1 AND state='held'", [id]);
}
export async function adjustUnits(
  tx: Queryable,
  p: {
    spaceId: string;
    actorId: string;
    units: number;
    reason: string;
    idempotencyKey: string;
    requestHash: string;
  },
) {
  await walletLock(tx, p.spaceId);
  const prior = await tx.query('SELECT * FROM quota_adjustments WHERE idempotency_key=$1', [
    p.idempotencyKey,
  ]);
  if (prior.rows[0]) {
    if (prior.rows[0].request_hash !== p.requestHash || prior.rows[0].actor_id !== p.actorId)
      throw new QuotaError('IDEMPOTENCY_CONFLICT', '幂等键冲突');
    return prior.rows[0];
  }
  await expireAvailable(tx, p.spaceId);
  const adjustment = await tx.query(
    'INSERT INTO quota_adjustments(space_id,actor_id,units,reason,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
    [p.spaceId, p.actorId, p.units, p.reason, p.idempotencyKey, p.requestHash],
  );
  const id = adjustment.rows[0]!.id;
  if (p.units > 0) {
    const lot = await tx.query(
      "INSERT INTO quota_lots(space_id,kind,source_key,total_units,available) VALUES($1,'gift',$2,$3,$3) RETURNING id",
      [p.spaceId, `adjust:${id}`, p.units],
    );
    await tx.query(
      "INSERT INTO ledger_entries(space_id,lot_id,kind,units,event_key,actor_id,reason) VALUES($1,$2,'gift',$3,$4,$5,$6)",
      [p.spaceId, lot.rows[0]!.id, p.units, `adjust:${id}`, p.actorId, p.reason],
    );
  } else {
    const { rows: lots } = await tx.query(
      "SELECT * FROM quota_lots WHERE space_id=$1 AND available>0 ORDER BY CASE WHEN kind='purchased' THEN 1 ELSE 0 END,expires_at NULLS LAST,id FOR UPDATE",
      [p.spaceId],
    );
    let remaining = -p.units;
    if (lots.reduce((n, l) => n + Number(l.available), 0) < remaining)
      throw new QuotaError('INSUFFICIENT_AVAILABLE', '可用额度不足，不能扣除占用额度');
    for (const lot of lots) {
      if (!remaining) break;
      const n = Math.min(remaining, Number(lot.available));
      await tx.query(
        'UPDATE quota_lots SET available=available-$2,revoked=revoked+$2 WHERE id=$1',
        [lot.id, n],
      );
      await tx.query(
        "INSERT INTO ledger_entries(space_id,lot_id,kind,units,event_key,actor_id,reason) VALUES($1,$2,'correction',$3,$4,$5,$6)",
        [p.spaceId, lot.id, -n, `adjust:${id}:${lot.id}`, p.actorId, p.reason],
      );
      remaining -= n;
    }
  }
  return adjustment.rows[0];
}
