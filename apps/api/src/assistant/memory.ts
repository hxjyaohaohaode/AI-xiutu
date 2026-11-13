import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, audit, type Database, type Queryable } from '@ai-xiutu/db';
import { assistantMemorySchema, type AssistantMemory } from '@ai-xiutu/contracts';
import { assistantAccess, lockedAssistantAccess } from './context.js';
import { id, requireUser, HttpError, assertVersion, rateLimit } from '../core.js';
import { mandatoryMemory } from './memory-context.js';

function dto(row: Record<string, any>, actorId: string, role: string): AssistantMemory {
  return {
    id: row.id,
    scope: row.scope,
    category: row.category,
    title: row.title,
    content: row.content,
    version: row.version,
    ownerId: row.owner_id,
    projectId: row.project_id,
    artworkId: row.artwork_id,
    sourceTurnId: row.source_turn_id,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    canEdit:
      row.scope === 'user'
        ? row.owner_id === actorId
        : row.scope === 'team'
          ? ['owner', 'admin'].includes(role)
          : true,
  };
}
export async function assistantMemories(
  db: Queryable,
  actorId: string,
  projectId: string,
  artworkId?: string,
  management?: { includeExpired: boolean; offset: number },
  lock = false,
) {
  const access = await assistantAccess(db, actorId, projectId);
  if (
    artworkId &&
    !(
      await db.query('SELECT 1 FROM artworks WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL', [artworkId, projectId])
    ).rowCount
  )
    throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不属于当前项目');
  const rows = (
    await db.query(
      `SELECT * FROM assistant_memories WHERE deleted_at IS NULL
    AND ($5::boolean OR expires_at IS NULL OR expires_at>clock_timestamp())
    AND ((scope='user' AND owner_id=$1) OR (scope='team' AND space_id=$2)
      OR (scope='project' AND project_id=$3) OR (scope='artwork' AND project_id=$3 AND artwork_id=$4))
    ORDER BY CASE category WHEN 'constraint' THEN 0 WHEN 'correction' THEN 1 ELSE 2 END,updated_at DESC,id LIMIT 101 OFFSET $6${lock ? ' FOR SHARE' : ''}`,
      [
        actorId,
        access.space_id,
        projectId,
        artworkId ?? null,
        management?.includeExpired ?? false,
        management?.offset ?? 0,
      ],
    )
  ).rows;
  const items = rows.map((row) => dto(row, actorId, access.role));
  if (!management && items.length > 100 && mandatoryMemory(items[100]!))
    throw new HttpError(
      409,
      'MEMORY_CONTEXT_LIMIT',
      '有效约束与更正超过本次范围，请整理或设置有效期',
    );
  return management ? items : items.slice(0, 100);
}
export function registerAssistantMemory(app: FastifyInstance, db: Database) {
  app.get('/v1/projects/:projectId/assistant-memory', async (req) => {
    const query = z
      .object({
        artworkId: id.optional(),
        includeExpired: z.enum(['true', 'false']).default('false'),
        page: z.coerce.number().int().min(0).max(10000).default(0),
      })
      .strict()
      .parse(req.query);
    const rows = await assistantMemories(
      db,
      requireUser(req).id,
      id.parse((req.params as any).projectId),
      query.artworkId,
      { includeExpired: query.includeExpired === 'true', offset: query.page * 100 },
    );
    return { memories: rows.slice(0, 100), hasMore: rows.length > 100, page: query.page };
  });
  app.get('/v1/projects/:projectId/assistant-memory/:memoryId/history', async (req) => {
    const query = z
      .object({ beforeVersion: z.coerce.number().int().positive().optional() })
      .strict()
      .parse(req.query);
    const actorId = requireUser(req).id,
      projectId = id.parse((req.params as any).projectId),
      memoryId = id.parse((req.params as any).memoryId);
    const access = await assistantAccess(db, actorId, projectId);
    const row = (await db.query('SELECT * FROM assistant_memories WHERE id=$1', [memoryId]))
      .rows[0];
    if (
      !row ||
      (row.scope === 'user'
        ? row.owner_id !== actorId
        : row.scope === 'team'
          ? row.space_id !== access.space_id
          : row.project_id !== projectId)
    )
      throw new HttpError(404, 'MEMORY_NOT_FOUND', '记忆不存在或不属于当前范围');
    const versions = (
      await db.query(
        'SELECT version,actor_id,created_at,snapshot FROM assistant_memory_versions WHERE memory_id=$1 AND ($2::integer IS NULL OR version<$2) ORDER BY version DESC LIMIT 101',
        [memoryId, query.beforeVersion ?? null],
      )
    ).rows;
    return {
      hasMore: versions.length > 100,
      versions: versions.slice(0, 100).map((item) => ({
        version: item.version,
        actorId: item.actor_id,
        createdAt: item.created_at,
        ...item.snapshot,
      })),
    };
  });
  app.post('/v1/projects/:projectId/assistant-memory', async (req) => {
    const actorId = requireUser(req).id,
      projectId = id.parse((req.params as any).projectId);
    const body = assistantMemorySchema.parse(req.body);
    await rateLimit(db, `assistant-memory:${actorId}`, 120, 3600);
    return transaction(db, async (tx) => {
      const access = await lockedAssistantAccess(tx, actorId, projectId);
      if (body.scope === 'team' && !['owner', 'admin'].includes(access.role))
        throw new HttpError(403, 'MEMORY_FORBIDDEN', '团队要求由团队管理员维护');
      if (body.scope === 'artwork') {
        if (
          !body.artworkId ||
          !(
            await tx.query('SELECT 1 FROM artworks WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR SHARE', [
              body.artworkId,
              projectId,
            ])
          ).rowCount
        )
          throw new HttpError(404, 'ARTWORK_NOT_FOUND', '请指定当前项目中的作品');
      } else if (body.artworkId)
        throw new HttpError(400, 'MEMORY_SCOPE_INVALID', '只有作品记忆可以指定作品');
      if (
        body.sourceTurnId &&
        !(
          await tx.query(
            'SELECT 1 FROM assistant_turns WHERE id=$1 AND actor_id=$2 AND project_id=$3',
            [body.sourceTurnId, actorId, projectId],
          )
        ).rowCount
      )
        throw new HttpError(404, 'MEMORY_SOURCE_NOT_FOUND', '来源必须是当前项目中自己的对话');
      const row = (
        await tx.query(
          `INSERT INTO assistant_memories(scope,owner_id,space_id,project_id,artwork_id,category,title,content,source_turn_id,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [
            body.scope,
            actorId,
            body.scope === 'team' ? access.space_id : null,
            ['project', 'artwork'].includes(body.scope) ? projectId : null,
            body.artworkId ?? null,
            body.category,
            body.title,
            body.content,
            body.sourceTurnId ?? null,
            body.expiresAt,
          ],
        )
      ).rows[0]!;
      await record(tx, row, actorId);
      return { memory: dto(row, actorId, access.role) };
    });
  });
  for (const method of ['PUT', 'DELETE'] as const)
    app.route({
      method,
      url: '/v1/projects/:projectId/assistant-memory/:memoryId',
      handler: async (req) => {
        const actorId = requireUser(req).id,
          projectId = id.parse((req.params as any).projectId),
          memoryId = id.parse((req.params as any).memoryId);
        const update =
          method === 'PUT'
            ? z
                .object({
                  expectedVersion: z.number().int().positive(),
                  title: assistantMemorySchema.shape.title,
                  content: assistantMemorySchema.shape.content,
                  category: assistantMemorySchema.shape.category,
                  expiresAt: assistantMemorySchema.shape.expiresAt,
                })
                .strict()
                .parse(req.body)
            : undefined;
        const envelope =
          update ??
          z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
        return transaction(db, async (tx) => {
          const access = await lockedAssistantAccess(tx, actorId, projectId);
          const row = (
            await tx.query(
              'SELECT * FROM assistant_memories WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',
              [memoryId],
            )
          ).rows[0];
          if (
            !row ||
            (row.scope === 'user'
              ? row.owner_id !== actorId
              : row.scope === 'team'
                ? row.space_id !== access.space_id
                : row.project_id !== projectId)
          )
            throw new HttpError(404, 'MEMORY_NOT_FOUND', '记忆不存在或不属于当前范围');
          if (row.scope === 'team' && !['owner', 'admin'].includes(access.role))
            throw new HttpError(403, 'MEMORY_FORBIDDEN', '团队要求由管理员维护');
          assertVersion(row.version, envelope.expectedVersion);
          const updated = update
            ? (
                await tx.query(
                  `UPDATE assistant_memories SET title=$2,content=$3,category=$4,expires_at=$5,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
                  [memoryId, update.title, update.content, update.category, update.expiresAt],
                )
              ).rows[0]!
            : (
                await tx.query(
                  'UPDATE assistant_memories SET deleted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
                  [memoryId],
                )
              ).rows[0]!;
          await record(tx, updated, actorId);
          return { memory: updated.deleted_at ? null : dto(updated, actorId, access.role) };
        });
      },
    });
}
async function record(tx: Queryable, row: Record<string, any>, actorId: string) {
  await tx.query(
    'INSERT INTO assistant_memory_versions(memory_id,version,actor_id,snapshot) VALUES($1,$2,$3,$4)',
    [
      row.id,
      row.version,
      actorId,
      JSON.stringify({
        title: row.title,
        content: row.content,
        category: row.category,
        deleted: !!row.deleted_at,
        expiresAt: row.expires_at,
      }),
    ],
  );
  await audit(
    tx,
    actorId,
    row.deleted_at ? 'assistant.memory.deleted' : 'assistant.memory.confirmed',
    'assistant-memory',
    row.id,
    { scope: row.scope, version: row.version, sourceTurnId: row.source_turn_id },
  );
}
