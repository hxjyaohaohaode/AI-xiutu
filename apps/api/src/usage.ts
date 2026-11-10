import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, ensureMonthlyGrant, getEntitlements, type Database } from '@ai-xiutu/db';
import { usageKinds, type UsageCounters } from '@ai-xiutu/contracts';
import { id, hash, HttpError, requireUser, requireOperator, spaceRole } from './core.js';

const timestamp = z.string().max(40).datetime({ offset: true });
const filters = z
  .object({
    scope: z.enum(['personal', 'space']).optional(),
    spaceId: id.optional(),
    actorId: id.optional(),
    from: timestamp.optional(),
    to: timestamp.optional(),
    bucket: z.enum(['day', 'month']).default('day'),
    limit: z.coerce.number().int().min(1).max(500).default(100),
    cursor: z.string().max(1024).optional(),
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();
const ledgerCursor = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((s) => BigInt(s) <= 9223372036854775807n);
const cursorSchema = z
  .object({ id: ledgerCursor, high: ledgerCursor, scope: z.string().length(64) })
  .strict();
const counters = (row: Record<string, any>): UsageCounters =>
  Object.fromEntries(usageKinds.map((kind) => [kind, Number(row[kind] ?? 0)])) as UsageCounters;
/** A CSV cell may be pasted into a spreadsheet; textual formulas must remain text. */
export function csvCell(input: unknown): string {
  const text = String(input ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
// One row per immutable ledger entry. Joins are bounded to one execution so a job
// cannot multiply a monetary-looking count. Credits are entitlements, not money.
const reportCte = `WITH raw AS (
  SELECT e.*,l.kind AS source_kind,l.expires_at,h.id AS hold_id,
    COALESCE(j.id,t.id,v.id) AS job_id,COALESCE(j.model_id,t.model_id,v.model_id) AS model_id,
    COALESCE(j.operation,CASE WHEN t.id IS NOT NULL THEN 'assistant-turn' WHEN v.id IS NOT NULL THEN 'realtime-voice' END) AS operation,
    CASE WHEN e.kind='grant' OR e.kind='purchase' THEN 'issued' WHEN e.kind='hold' THEN 'held' WHEN e.kind='settled' THEN 'consumed'
      WHEN e.kind='released' THEN 'released' WHEN e.kind='expire' THEN 'expired' ELSE 'adjusted' END AS usage_kind,
    CASE WHEN e.kind='settled' THEN COALESCE((e.movement->>'consumed')::integer,a.units)
      WHEN e.kind='expire' THEN (e.movement->>'expired')::integer
      WHEN e.kind IN ('hold','released') THEN abs(e.units) ELSE e.units END AS amount,
    CASE WHEN e.kind='expire' THEN e.movement ? 'expired'
      WHEN e.kind='released' AND l.expires_at IS NOT NULL THEN e.movement ? 'expired'
      WHEN e.kind='settled' THEN a.units IS NOT NULL OR e.movement ? 'consumed'
      ELSE e.kind IN ('grant','purchase','hold','gift','correction','released') END AS complete
  FROM ledger_entries e LEFT JOIN quota_lots l ON l.id=e.lot_id
  LEFT JOIN quota_holds h ON h.id=(CASE WHEN e.kind IN ('hold','settled','released') AND split_part(e.event_key,':',2) ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN split_part(e.event_key,':',2)::uuid ELSE NULL END)
    AND h.space_id=e.space_id
  LEFT JOIN hold_allocations a ON a.hold_id=h.id AND a.lot_id=e.lot_id
  LEFT JOIN LATERAL(SELECT id,model_id,operation FROM ai_jobs WHERE hold_id=h.id ORDER BY created_at,id LIMIT 1) j ON true
  LEFT JOIN LATERAL(SELECT id,model_id FROM assistant_turns WHERE hold_id=h.id ORDER BY created_at,id LIMIT 1) t ON true
  LEFT JOIN LATERAL(SELECT id,model_id FROM voice_sessions WHERE hold_id=h.id ORDER BY created_at,id LIMIT 1) v ON true
  WHERE ($1::uuid IS NULL OR e.space_id=$1) AND ($2::uuid IS NULL OR e.actor_id=$2)
    AND e.created_at>=$3::timestamptz AND e.created_at<$4::timestamptz AND e.id<=$5::bigint
    AND ($6::boolean OR EXISTS(SELECT 1 FROM memberships m WHERE m.space_id=e.space_id AND m.user_id=$7::uuid))
), normalized AS (
  SELECT raw.*,
    CASE WHEN usage_kind='issued' THEN COALESCE(amount,0) ELSE 0 END AS issued,
    CASE WHEN usage_kind='held' THEN COALESCE(amount,0) ELSE 0 END AS held,
    CASE WHEN usage_kind='consumed' THEN COALESCE(amount,0) ELSE 0 END AS consumed,
    CASE WHEN usage_kind='released' THEN COALESCE(amount,0) ELSE 0 END AS released,
    COALESCE((movement->>'expired')::integer,0) AS expired,
    CASE WHEN usage_kind='adjusted' AND complete THEN COALESCE(amount,0) ELSE 0 END AS adjusted
  FROM raw
)`;
const sums = usageKinds.map((kind) => `COALESCE(sum(${kind}),0)::text AS ${kind}`).join(',');

export function registerUsage(app: FastifyInstance, db: Database): void {
  for (const operator of [false, true])
    app.get(operator ? '/v1/ops/usage' : '/v1/usage', async (req, reply) => {
      const actor = operator ? requireOperator(req) : requireUser(req),
        query = filters.parse(req.query);
      if (!operator && query.actorId)
        throw new HttpError(400, 'ACTOR_FILTER_FORBIDDEN', '个人或团队报表不能指定其他账户');
      if (operator && query.scope)
        throw new HttpError(400, 'SCOPE_INVALID', '运营报表使用空间或执行者筛选');
      const scope = operator ? 'operator' : (query.scope ?? 'personal');
      let spaceId = query.spaceId ?? null;
      if (scope === 'personal') {
        const own = await transaction(db, (tx) => ensureMonthlyGrant(tx, actor.id));
        if (spaceId && spaceId !== own)
          throw new HttpError(403, 'SPACE_FORBIDDEN', '个人报表只能使用自己的个人空间');
        spaceId = own;
      } else if (scope === 'space') {
        if (!spaceId) throw new HttpError(400, 'SPACE_REQUIRED', '请选择团队或个人空间');
        await spaceRole(db, spaceId, actor.id);
      }
      if (spaceId) {
        const exists = (await db.query('SELECT id FROM spaces WHERE id=$1', [spaceId])).rowCount;
        if (!exists) throw new HttpError(404, 'SPACE_NOT_FOUND', '空间不存在');
        // Materialize due expiry once under the wallet lock; it doesn't issue another space's grant.
        await transaction(db, (tx) => getEntitlements(tx, spaceId!));
      }
      const to = query.to ?? new Date().toISOString();
      const from = query.from ?? new Date(Date.parse(to) - 30 * 86400_000).toISOString();
      const span = Date.parse(to) - Date.parse(from);
      if (span <= 0 || span > 732 * 86400_000)
        throw new HttpError(400, 'TIME_RANGE_INVALID', '报表时间范围应为正且不超过732天');
      // Defaults must be stable across pages: encode the resolved range in the cursor.
      const filterHash = hash(
        JSON.stringify({
          actorId: actor.id,
          operator,
          spaceId,
          filterActor: query.actorId ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
          bucket: query.bucket,
        }),
      );
      const extendedCursor = cursorSchema.extend({ from: timestamp, to: timestamp }).strict();
      let cursor: z.infer<typeof extendedCursor> | undefined;
      if (query.cursor) {
        try {
          cursor = extendedCursor.parse(
            JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
          );
        } catch {
          throw new HttpError(400, 'INVALID_CURSOR', '分页游标无效');
        }
        if (cursor.scope !== filterHash)
          throw new HttpError(400, 'CURSOR_SCOPE_MISMATCH', '报表筛选已改变，请重新查询');
      }
      const rangeFrom = cursor?.from ?? from,
        rangeTo = cursor?.to ?? to;
      if (
        Date.parse(rangeTo) - Date.parse(rangeFrom) <= 0 ||
        Date.parse(rangeTo) - Date.parse(rangeFrom) > 732 * 86400_000
      )
        throw new HttpError(400, 'INVALID_CURSOR', '分页游标的时间范围无效');
      const high =
        cursor?.high ??
        String(
          (await db.query('SELECT COALESCE(max(id),0)::text AS value FROM ledger_entries')).rows[0]!
            .value,
        );
      const args = [spaceId, query.actorId ?? null, rangeFrom, rangeTo, high, operator, actor.id];
      const totals = (
        await db.query(
          `${reportCte} SELECT ${sums},count(*) FILTER (WHERE NOT COALESCE(complete,false))::int AS unknown FROM normalized`,
          args,
        )
      ).rows[0]!;
      const series = (
        await db.query(
          `${reportCte} SELECT to_char(date_trunc($8,created_at AT TIME ZONE 'Asia/Shanghai'),'YYYY-MM-DD') AS bucket,
      ${sums},count(*) FILTER (WHERE NOT COALESCE(complete,false))::int AS unknown FROM normalized GROUP BY 1 ORDER BY 1`,
          [...args, query.bucket],
        )
      ).rows;
      const rows = (
        await db.query(
          `${reportCte} SELECT * FROM normalized WHERE ($8::bigint IS NULL OR id<$8) ORDER BY id DESC LIMIT $9`,
          [...args, cursor?.id ?? null, query.limit + 1],
        )
      ).rows;
      const page = rows.slice(0, query.limit);
      const entries = page.map((row) => ({
        id: String(row.id),
        kind: row.usage_kind,
        units: row.amount === null ? null : Number(row.amount),
        movement: counters(row),
        spaceId: row.space_id,
        actorId: row.actor_id,
        lotId: row.lot_id,
        holdId: row.hold_id,
        jobId: row.job_id,
        modelId: row.model_id,
        operation: row.operation,
        sourceKind: row.source_kind,
        createdAt: row.created_at,
        reason: row.reason,
        amountKnown: row.amount !== null,
        movementComplete: Boolean(row.complete),
      }));
      const balanceRow = (
        await db.query(
          `WITH moment AS(SELECT clock_timestamp() AS at)
      SELECT COALESCE(sum(CASE WHEN l.expires_at<=moment.at THEN 0 ELSE l.available END),0)::text AS available,COALESCE(sum(l.held),0)::text AS held,
      COALESCE(sum(l.spent),0)::text AS consumed,COALESCE(sum(l.expired+CASE WHEN l.expires_at<=moment.at THEN l.available ELSE 0 END),0)::text AS expired,COALESCE(sum(l.revoked),0)::text AS revoked
      FROM quota_lots l CROSS JOIN moment WHERE ($1::uuid IS NULL OR l.space_id=$1) AND
        ($2::boolean OR EXISTS(SELECT 1 FROM memberships m WHERE m.space_id=l.space_id AND m.user_id=$3))`,
          [spaceId, operator, actor.id],
        )
      ).rows[0]!;
      const nextCursor =
        rows.length > query.limit
          ? Buffer.from(
              JSON.stringify({
                id: String(page.at(-1)!.id),
                high,
                scope: filterHash,
                from: rangeFrom,
                to: rangeTo,
              }),
            ).toString('base64url')
          : null;
      if (!operator && spaceId) await spaceRole(db, spaceId, actor.id);
      if (query.format === 'csv') {
        const columns = [
          'id',
          'kind',
          'units',
          'amountKnown',
          'movementComplete',
          'spaceId',
          'actorId',
          'lotId',
          'holdId',
          'jobId',
          'modelId',
          'operation',
          'sourceKind',
          'createdAt',
          'reason',
        ] as const;
        const csv = [
          columns.map(csvCell).join(','),
          ...entries.map((entry) => columns.map((key) => csvCell(entry[key])).join(',')),
        ].join('\r\n');
        if (nextCursor) reply.header('X-Next-Cursor', nextCursor);
        return reply
          .type('text/csv; charset=utf-8')
          .header('Content-Disposition', 'attachment; filename="usage.csv"')
          .send(`\uFEFF${csv}\r\n`);
      }
      return {
        unit: 'credit',
        timezone: 'Asia/Shanghai',
        scope,
        range: { from: rangeFrom, to: rangeTo, bucket: query.bucket },
        totals: counters(totals),
        unknownAmountEntries: Number(totals.unknown),
        series: series.map((row) => ({
          bucket: row.bucket,
          ...counters(row),
          unknownAmountEntries: Number(row.unknown),
        })),
        entries,
        nextCursor,
        balance: Object.fromEntries(
          Object.entries(balanceRow).map(([key, value]) => [key, Number(value)]),
        ),
      };
    });
}
