import { z } from 'zod';
import { OPENAI_SPECIALIST_OPERATIONS } from '@ai-xiutu/contracts';
import type { Queryable } from '@ai-xiutu/db';
import { id, hash, HttpError } from './core.js';

const filters = z
  .object({
    jobId: id.optional(),
    actorId: id.optional(),
    operation: z
      .enum([
        'edit-plan',
        'generate-image',
        'generate-text',
        'transcribe',
        ...OPENAI_SPECIALIST_OPERATIONS,
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(1024).optional(),
  })
  .strict();
const position = z
  .object({ at: z.iso.datetime({ offset: true }), id, scope: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

/** Operator-only metadata. No prompts, images, recipe, phone or provider keys. */
export async function listUnknownAiJobs(db: Queryable, operatorId: string, input: unknown) {
  const query = filters.parse(input);
  const scope = hash(
    JSON.stringify({
      operatorId,
      jobId: query.jobId,
      actorId: query.actorId,
      operation: query.operation,
    }),
  );
  let after: z.infer<typeof position> | undefined;
  if (query.cursor) {
    try {
      after = position.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
    } catch {
      throw new HttpError(400, 'INVALID_CURSOR', '分页游标无效');
    }
    if (after.scope !== scope)
      throw new HttpError(400, 'CURSOR_SCOPE_MISMATCH', '筛选条件已改变，请重新查询');
  }
  const rows = (
    await db.query(
      `SELECT j.id,j.project_id AS "projectId",j.actor_id AS "actorId",j.model_id AS "modelId",
    j.operation,j.provider_request_id AS "providerRequestId",j.error_code AS "errorCode",h.units AS "heldUnits",j.created_at AS "createdAt",
    to_char(j.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM ai_jobs j LEFT JOIN quota_holds h ON h.id=j.hold_id
    WHERE j.state='unknown' AND ($1::uuid IS NULL OR j.id=$1) AND ($2::uuid IS NULL OR j.actor_id=$2)
    AND ($3::text IS NULL OR j.operation=$3) AND ($4::timestamptz IS NULL OR (j.created_at,j.id)>($4::timestamptz,$5::uuid))
    ORDER BY j.created_at,j.id LIMIT $6`,
      [
        query.jobId ?? null,
        query.actorId ?? null,
        query.operation ?? null,
        after?.at ?? null,
        after?.id ?? null,
        query.limit + 1,
      ],
    )
  ).rows;
  const page = rows.slice(0, query.limit),
    last = page.at(-1);
  return {
    jobs: page.map(({ cursor_at, ...row }) => row),
    nextCursor:
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id, scope })).toString(
            'base64url',
          )
        : null,
  };
}

export const assistantReconciliationFilters = z
  .object({
    kind: z.enum(['turn', 'voice']).optional(),
    recordId: id.optional(),
    actorId: id.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(1024).optional(),
  })
  .strict()
  .refine((query) => !query.cursor || !!query.kind, '请选择分页的会话类型');
export async function listUnknownAssistantRecords(
  db: Queryable,
  operatorId: string,
  kind: 'turn' | 'voice',
  query: z.infer<typeof assistantReconciliationFilters>,
) {
  const scope = hash(
    JSON.stringify({ operatorId, kind, recordId: query.recordId, actorId: query.actorId }),
  );
  let after: z.infer<typeof position> | undefined;
  if (query.cursor) {
    try {
      after = position.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
    } catch {
      throw new HttpError(400, 'INVALID_CURSOR', '分页游标无效');
    }
    if (after.scope !== scope)
      throw new HttpError(400, 'CURSOR_SCOPE_MISMATCH', '筛选条件已改变，请重新查询');
  }
  const rows = (
    await db.query(
      `SELECT id,project_id,actor_id,model_id,state,error_code,created_at${kind === 'voice' ? ',elapsed_seconds' : ''},
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM ${kind === 'voice' ? 'voice_sessions' : 'assistant_turns'} WHERE state='unknown'
    AND ($1::uuid IS NULL OR id=$1) AND ($2::uuid IS NULL OR actor_id=$2)
    AND ($3::timestamptz IS NULL OR (created_at,id)>($3::timestamptz,$4::uuid)) ORDER BY created_at,id LIMIT $5`,
      [
        query.recordId ?? null,
        query.actorId ?? null,
        after?.at ?? null,
        after?.id ?? null,
        query.limit + 1,
      ],
    )
  ).rows;
  const page = rows.slice(0, query.limit),
    last = page.at(-1);
  return {
    records: page.map(({ cursor_at, ...row }) => row),
    nextCursor:
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id, scope })).toString(
            'base64url',
          )
        : null,
  };
}
