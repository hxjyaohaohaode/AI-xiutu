import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, audit, type Database, type Queryable } from '@ai-xiutu/db';
import { resourceMemorySchema } from '@ai-xiutu/contracts';
import {
  id,
  hash,
  requireUser,
  projectAccess,
  assetDto,
  HttpError,
  assertVersion,
} from './core.js';

const timestamp = z.string().max(40).datetime({ offset: true });
export const resourceFiltersSchema = z
  .object({
    scope: z.enum(['all', 'personal', 'team']).default('all'),
    spaceId: id.optional(),
    projectId: id.optional(),
    query: z
      .string()
      .trim()
      .max(120)
      .regex(/^[^\u0000-\u001f\u007f]*$/)
      .default(''),
    remembered: z.enum(['true', 'false']).optional(),
    source: z.enum(['upload', 'generated', 'sketch', 'unknown']).optional(),
    createdFrom: timestamp.optional(),
    createdTo: timestamp.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(1024).optional(),
  })
  .strict()
  .refine(
    (p) => !p.createdFrom || !p.createdTo || Date.parse(p.createdFrom) < Date.parse(p.createdTo),
    '时间范围不正确',
  );
const cursorSchema = z
  .object({ at: timestamp, id, scope: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const memoryDto = (row: Record<string, any> | undefined) =>
  row
    ? {
        remembered: row.remembered,
        title: row.title,
        tags: row.tags,
        note: row.note,
        version: row.version,
        updatedAt: row.updated_at,
      }
    : null;
const sourceSql =
  "CASE WHEN a.provenance->>'kind'='ai-generated' THEN 'generated' WHEN a.provenance->>'kind'='uploaded' AND a.provenance->>'declaredSource'='sketch' THEN 'sketch' WHEN a.provenance->>'kind'='uploaded' THEN 'upload' ELSE 'unknown' END";

/** Shared by the HTTP API and explicitly authorized assistant search. No operator bypass. */
export async function searchResources(db: Queryable, actorId: string, input: unknown) {
  const query = resourceFiltersSchema.parse(input);
  const scope = hash(JSON.stringify({ actorId, ...query, cursor: undefined, limit: undefined }));
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (query.cursor) {
    try {
      cursor = cursorSchema.parse(
        JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
      );
    } catch {
      throw new HttpError(400, 'INVALID_CURSOR', '分页游标无效');
    }
    if (cursor.scope !== scope)
      throw new HttpError(400, 'CURSOR_SCOPE_MISMATCH', '筛选条件已改变，请重新查询');
  }
  const rows = (
    await db.query(
      `SELECT a.*,s.id AS space_id,s.name AS space_name,s.kind AS space_kind,p.title AS project_title,
    CASE WHEN rm.asset_id IS NULL THEN NULL ELSE jsonb_build_object('remembered',rm.remembered,'title',rm.title,'tags',rm.tags,'note',rm.note,'version',rm.version,'updatedAt',rm.updated_at) END AS memory,
    to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
    FROM assets a JOIN projects p ON p.id=a.project_id JOIN spaces s ON s.id=p.space_id
    LEFT JOIN memberships m ON m.space_id=s.id AND m.user_id=$1
    LEFT JOIN resource_memories rm ON rm.user_id=$1 AND rm.asset_id=a.id
    WHERE a.deleted_at IS NULL AND p.deleted_at IS NULL
    AND (m.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM share_grants g WHERE g.project_id=p.id AND g.target_user_id=$1
      AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND
      ((g.mode='reference' AND (s.sharing_policy->>'allowReference')::boolean) OR (g.mode='copy' AND (s.sharing_policy->>'allowCopy')::boolean))))
    AND ($2='all' OR s.kind=$2) AND ($3::uuid IS NULL OR s.id=$3) AND ($4::uuid IS NULL OR p.id=$4)
    AND ($5::text='' OR strpos(lower(a.name||' '||COALESCE(a.annotations->>'title','')||' '||COALESCE(a.annotations->'tags','[]'::jsonb)::text||' '||COALESCE(rm.title,'')||' '||COALESCE(rm.tags,'[]'::jsonb)::text||' '||COALESCE(rm.note,'')),lower($5))>0)
    AND ($6::boolean IS NULL OR COALESCE(rm.remembered,false)=$6) AND ($7::text IS NULL OR (${sourceSql})=$7)
    AND ($8::timestamptz IS NULL OR a.created_at>=$8) AND ($9::timestamptz IS NULL OR a.created_at<$9)
    AND ($10::timestamptz IS NULL OR (a.created_at,a.id)<($10::timestamptz,$11::uuid))
    ORDER BY a.created_at DESC,a.id DESC LIMIT $12`,
      [
        actorId,
        query.scope,
        query.spaceId ?? null,
        query.projectId ?? null,
        query.query,
        query.remembered ?? null,
        query.source ?? null,
        query.createdFrom ?? null,
        query.createdTo ?? null,
        cursor?.at ?? null,
        cursor?.id ?? null,
        query.limit + 1,
      ],
    )
  ).rows;
  const page = rows.slice(0, query.limit),
    last = page.at(-1);
  return {
    resources: page.map((row) => ({
      asset: assetDto(row),
      space: { id: row.space_id, name: row.space_name, kind: row.space_kind },
      project: { id: row.project_id, title: row.project_title },
      memory: row.memory,
    })),
    nextCursor:
      rows.length > query.limit && last
        ? Buffer.from(JSON.stringify({ at: last.cursor_at, id: last.id, scope })).toString(
            'base64url',
          )
        : null,
  };
}
async function readableAsset(db: Queryable, assetId: string, actorId: string) {
  const row = (
    await db.query('SELECT project_id FROM assets WHERE id=$1 AND deleted_at IS NULL', [assetId])
  ).rows[0];
  if (!row) throw new HttpError(404, 'ASSET_NOT_FOUND', '素材不存在或已移除');
  await projectAccess(db, row.project_id, actorId);
}
export function registerResources(app: FastifyInstance, db: Database): void {
  app.get('/v1/resources', async (req) => searchResources(db, requireUser(req).id, req.query));
  app.get('/v1/assets/:id/memory', async (req) => {
    const actor = requireUser(req),
      assetId = z.object({ id }).parse(req.params).id;
    await readableAsset(db, assetId, actor.id);
    return {
      memory: memoryDto(
        (
          await db.query('SELECT * FROM resource_memories WHERE user_id=$1 AND asset_id=$2', [
            actor.id,
            assetId,
          ])
        ).rows[0],
      ),
    };
  });
  app.put('/v1/assets/:id/memory', async (req) => {
    const actor = requireUser(req),
      assetId = z.object({ id }).parse(req.params).id,
      body = resourceMemorySchema.parse(req.body);
    const memory = await transaction(db, async (tx) => {
      await readableAsset(tx, assetId, actor.id);
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `resource-memory:${actor.id}:${assetId}`,
      ]);
      const prior = (
        await tx.query(
          'SELECT * FROM resource_memories WHERE user_id=$1 AND asset_id=$2 FOR UPDATE',
          [actor.id, assetId],
        )
      ).rows[0];
      assertVersion(prior?.version ?? 0, body.expectedVersion);
      const row = (
        await tx.query(
          `INSERT INTO resource_memories(user_id,asset_id,remembered,title,tags,note) VALUES($1,$2,$3,$4,$5::jsonb,$6)
        ON CONFLICT(user_id,asset_id) DO UPDATE SET remembered=$3,title=$4,tags=$5::jsonb,note=$6,version=resource_memories.version+1,updated_at=clock_timestamp()
        RETURNING *`,
          [actor.id, assetId, body.remembered, body.title, JSON.stringify(body.tags), body.note],
        )
      ).rows[0]!;
      // Audit includes no private preference text, tags, labels or inference about a person.
      await audit(tx, actor.id, 'resource.memory.update', 'asset', assetId, {
        version: row.version,
        remembered: body.remembered,
      });
      return memoryDto(row);
    });
    return { memory };
  });
  app.delete('/v1/assets/:id/memory', async (req) => {
    const actor = requireUser(req),
      assetId = z.object({ id }).parse(req.params).id;
    const body = z
      .object({ expectedVersion: z.number().int().positive() })
      .strict()
      .parse(req.body);
    await transaction(db, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `resource-memory:${actor.id}:${assetId}`,
      ]);
      const prior = (
        await tx.query(
          'SELECT version FROM resource_memories WHERE user_id=$1 AND asset_id=$2 FOR UPDATE',
          [actor.id, assetId],
        )
      ).rows[0];
      if (prior) {
        assertVersion(prior.version, body.expectedVersion);
        await tx.query('DELETE FROM resource_memories WHERE user_id=$1 AND asset_id=$2', [
          actor.id,
          assetId,
        ]);
        await audit(tx, actor.id, 'resource.memory.delete', 'asset', assetId);
      }
    });
    return { ok: true };
  });
}
