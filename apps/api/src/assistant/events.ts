import type { FastifyInstance } from 'fastify';
import type { Database, Queryable } from '@ai-xiutu/db';
import { transaction } from '@ai-xiutu/db';
import { z } from 'zod';
import { assistantAccess, lockedAssistantAccess, validateScope } from './context.js';
import { hash, HttpError, id, requireUser } from '../core.js';

export async function appendRunEvent(
  tx: Queryable,
  turnId: string,
  type: string,
  payload: unknown,
) {
  await tx.query('INSERT INTO assistant_run_events(turn_id,type,payload) VALUES($1,$2,$3)', [
    turnId,
    type,
    JSON.stringify(payload),
  ]);
}
export async function publishRunEvent(
  db: Database,
  turnId: string,
  type: string,
  payload: unknown,
) {
  await transaction(db, async (tx) => {
    const row = (
      await tx.query('SELECT state,stop_requested_at FROM assistant_turns WHERE id=$1 FOR UPDATE', [
        turnId,
      ])
    ).rows[0];
    if (row?.state !== 'running' || row.stop_requested_at)
      throw new HttpError(409, 'ASSISTANT_STATE_CHANGED', '任务已停止');
    await appendRunEvent(tx, turnId, type, payload);
  });
}
export function registerAssistantEvents(app: FastifyInstance, db: Database) {
  const streams = new Set<() => void>(),
    byActor = new Map<string, number>();
  app.addHook('preClose', async () => {
    for (const close of streams) close();
  });
  async function access(actorId: string, turnId: string) {
    const row = (
      await db.query(
        'SELECT project_id,state,error_code,scope,config FROM assistant_turns WHERE id=$1 AND actor_id=$2',
        [turnId, actorId],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'TURN_NOT_FOUND', '协作记录不存在');
    await assistantAccess(db, actorId, row.project_id);
    await validateScope(db, actorId, row.config?.historyScope ?? row.scope);
    return row;
  }
  app.get('/v1/assistant-turns/:turnId/context', async (req) => {
    const actorId = requireUser(req).id,
      turnId = id.parse((req.params as any).turnId);
    await access(actorId, turnId);
    return {
      manifest:
        (
          await db.query('SELECT manifest FROM assistant_context_snapshots WHERE turn_id=$1', [
            turnId,
          ])
        ).rows[0]?.manifest ?? null,
    };
  });
  app.get('/v1/assistant-turns/:turnId/events', async (req, reply) => {
    const actorId = requireUser(req).id,
      turnId = id.parse((req.params as any).turnId);
    const query = z
      .object({
        after: z
          .string()
          .regex(/^\d{1,18}$/)
          .default('0'),
      })
      .strict()
      .parse(req.query);
    let cursor = z
      .string()
      .regex(/^\d{1,18}$/)
      .parse(req.headers['last-event-id'] ?? query.after);
    await access(actorId, turnId);
    if (streams.size >= 128 || (byActor.get(actorId) ?? 0) >= 3)
      throw new HttpError(429, 'STREAM_LIMIT', '活动进度连接过多');
    const authHash = hash(req.cookies.xiutu_session ?? '');
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    });
    let closed = false;
    const close = () => {
      closed = true;
      reply.raw.end();
    };
    streams.add(close);
    byActor.set(actorId, (byActor.get(actorId) ?? 0) + 1);
    reply.raw.on('close', close);
    const deadline = Date.now() + 25_000;
    try {
      while (!closed && Date.now() < deadline) {
        const batch = await transaction(db, async (tx) => {
          const initial = (
            await tx.query(
              "SELECT project_id,COALESCE(config->'historyScope',scope) AS scope FROM assistant_turns WHERE id=$1 AND actor_id=$2",
              [turnId, actorId],
            )
          ).rows[0];
          if (!initial) return null;
          await lockedAssistantAccess(tx, actorId, initial.project_id, initial.scope, authHash);
          const state = (
            await tx.query(
              "SELECT state,error_code,COALESCE(config->'historyScope',scope)=$2::jsonb AS same_scope FROM assistant_turns WHERE id=$1 FOR SHARE",
              [turnId, JSON.stringify(initial.scope)],
            )
          ).rows[0];
          if (!state?.same_scope) return { retry: true as const };
          const events = (
            await tx.query(
              'SELECT seq::text AS id,type,payload,created_at AS "createdAt" FROM assistant_run_events WHERE turn_id=$1 AND seq>$2 ORDER BY seq LIMIT 100',
              [turnId, cursor],
            )
          ).rows;
          return { retry: false as const, state, events };
        });
        if (!batch) break;
        if (batch.retry) continue;
        const { state, events } = batch;
        for (const event of events) {
          if (closed) break;
          const accepted = reply.raw.write(
            `id: ${event.id}\nevent: update\ndata: ${JSON.stringify({ ...event, runId: turnId })}\n\n`,
          );
          cursor = event.id;
          if (!accepted) {
            close();
            break;
          } // Durable replay handles a slow client.
        }
        if (closed) break;
        if (state.state !== 'running' && events.length < 100) {
          reply.raw.write(
            `event: state\ndata: ${JSON.stringify({ state: state.state, errorCode: state.error_code })}\n\n`,
          );
          break;
        }
        reply.raw.write(': keepalive\n\n');
        if (events.length < 100) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch {
      // Access loss or database failure closes the stream. It never restarts a task.
    } finally {
      reply.raw.off('close', close);
      close();
      streams.delete(close);
      const count = (byActor.get(actorId) ?? 1) - 1;
      if (count) byActor.set(actorId, count);
      else byActor.delete(actorId);
    }
  });
}
