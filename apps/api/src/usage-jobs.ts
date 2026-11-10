import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@ai-xiutu/db';
import { publishedModelPrices, type ProviderStage, type UsageJobDetail } from '@ai-xiutu/contracts';
import { HttpError, id, requireOperator, requireUser, spaceRole } from './core.js';
import { meterStage, recordedPricing } from './provider-metering.js';

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;
const jobQuery = `WITH job AS (
  SELECT id,actor_id,hold_id,model_id,operation,state,'image-job' AS kind,provider_pricing,
    COALESCE(provider_usage,output->'providerUsage') AS usage,provider_dispatched_at AS dispatched_at,provider_received_at AS received_at,
    NULL::text AS backend_model_id,created_at,updated_at FROM ai_jobs WHERE id=$1
  UNION ALL SELECT id,actor_id,hold_id,model_id,'assistant-turn',state,'turn',NULL,NULL,NULL,NULL,NULL,created_at,updated_at
    FROM assistant_turns WHERE id=$1
  UNION ALL SELECT id,actor_id,hold_id,model_id,'realtime-voice',state,'voice',provider_pricing,usage,NULL,NULL,backend_model_id,created_at,updated_at
    FROM voice_sessions WHERE id=$1
) SELECT j.*,h.space_id,h.units,h.state AS hold_state FROM job j JOIN quota_holds h ON h.id=j.hold_id`;

export function registerUsageJobs(app: FastifyInstance, db: Database) {
  app.get('/v1/usage/model-prices', async (req) => {
    requireUser(req);
    return { currency: 'USD', basis: 'published-estimate', prices: publishedModelPrices() };
  });
  for (const operator of [false, true])
    app.get(operator ? '/v1/ops/usage/jobs/:id' : '/v1/usage/jobs/:id', async (req, reply) => {
      const user = operator ? requireOperator(req) : requireUser(req);
      const { id: jobId } = z.object({ id }).parse(req.params);
      const row = (await db.query(jobQuery, [jobId])).rows[0];
      if (!row) throw new HttpError(404, 'USAGE_JOB_NOT_FOUND', '用量任务不存在');
      const check = async () => {
        if (operator) return;
        const role = await spaceRole(db, row.space_id, user.id);
        if (row.actor_id !== user.id && !['owner', 'admin'].includes(role))
          throw new HttpError(
            403,
            'MEMBER_FILTER_FORBIDDEN',
            '只能查看自己的调用明细，或由团队管理员查看成员明细',
          );
      };
      await check();
      const [dispatches, movements] = await Promise.all([
        row.kind === 'image-job'
          ? Promise.resolve([])
          : db
              .query(
                `SELECT id,branch_key,purpose,pricing,usage,tool_calls,service_tier,created_at,completed_at FROM assistant_dispatches
         WHERE ${row.kind === 'voice' ? 'voice_id' : 'turn_id'}=$1 ORDER BY sequence LIMIT 101`,
                [jobId],
              )
              .then((result) => result.rows),
        db.query(
          `SELECT e.id::text,e.lot_id,e.kind,e.created_at,
        CASE WHEN e.kind='settled' THEN COALESCE((e.movement->>'consumed')::integer,a.units)
             ELSE abs(e.units) END AS units
        FROM hold_allocations a JOIN ledger_entries e ON e.lot_id=a.lot_id AND e.space_id=$1
        AND e.event_key IN ('hold:'||a.hold_id||':'||a.lot_id,'settled:'||a.hold_id||':'||a.lot_id,'released:'||a.hold_id||':'||a.lot_id)
        WHERE a.hold_id=$2 ORDER BY e.id`,
          [row.space_id, row.hold_id],
        ),
      ]);
      const pending = ['queued', 'running', 'prepared', 'connecting', 'active'].includes(row.state);
      const status = (usage: unknown) =>
        usage
          ? ('received' as const)
          : pending
            ? ('pending' as const)
            : row.state === 'unknown' || row.hold_state === 'unknown'
              ? ('unknown' as const)
              : ('no-receipt' as const);
      const stages: ProviderStage[] = dispatches.map((dispatch) => {
        const modelId = (row.kind === 'voice' ? row.backend_model_id : row.model_id) as string;
        return meterStage(
          {
            stageId: dispatch.id,
            branchId: dispatch.branch_key,
            purpose:
              dispatch.purpose ?? (row.kind === 'voice' ? 'voice-delegation' : 'conversation'),
            modelId,
            dispatchedAt: iso(dispatch.created_at),
            receivedAt: iso(dispatch.completed_at),
            status: status(dispatch.usage),
            pricing:
              dispatch.service_tier === 'default' &&
              (!modelId.startsWith('gpt-6') ||
                (dispatch.usage?.input_tokens ?? Infinity) <= 128_000)
                ? recordedPricing(dispatch.pricing, modelId)
                : null,
          },
          dispatch.usage,
          'responses',
          dispatch.tool_calls,
        );
      });
      if (row.kind === 'image-job')
        stages.push(
          meterStage(
            {
              stageId: jobId,
              branchId: null,
              purpose: row.operation,
              modelId: row.model_id,
              dispatchedAt: iso(row.dispatched_at),
              receivedAt: iso(row.received_at),
              status: status(row.usage),
              pricing: recordedPricing(row.provider_pricing, row.model_id),
            },
            row.usage,
            row.operation === 'generate-image' ? 'image' : 'responses',
          ),
        );
      if (row.kind === 'voice') {
        const duration = row.model_id === 'gpt-live-1';
        const usage = Array.isArray(row.usage?.events) ? row.usage.events : [];
        const receipts = duration
          ? row.usage?.vendorFinalUsageConfirmed
            ? [{ value: usage.at(-1), index: usage.length - 1 }]
            : []
          : usage.map((value: unknown, index: number) => ({ value, index }));
        if (!receipts.length || (!duration && row.usage?.responseReceiptsComplete === false))
          receipts.push({ value: null, index: usage.length });
        for (const { value, index } of receipts)
          stages.push(
            meterStage(
              {
                stageId: `${jobId}-${index}`,
                branchId: null,
                purpose: duration ? 'live-duration' : 'realtime-response',
                modelId: row.model_id,
                dispatchedAt: null,
                receivedAt: value ? iso(row.usage?.eventTimes?.[index]) : null,
                status: status(value),
                pricing: recordedPricing(row.provider_pricing, row.model_id),
              },
              value,
              duration ? 'duration' : 'realtime',
            ),
          );
      }
      await check();
      const detail: UsageJobDetail = {
        jobId,
        actorId: row.actor_id,
        spaceId: row.space_id,
        holdId: row.hold_id,
        modelId: row.model_id,
        operation: row.operation,
        state: row.state,
        holdState: row.hold_state,
        units: row.units,
        stages,
        movements: movements.rows.map((entry) => ({
          id: entry.id,
          lotId: entry.lot_id,
          kind: entry.kind,
          units: entry.units,
          createdAt: iso(entry.created_at)!,
        })),
      };
      return reply.header('Cache-Control', 'private, no-store').send(detail);
    });
}
