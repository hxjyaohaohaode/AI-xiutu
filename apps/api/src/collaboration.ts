import type { FastifyInstance } from 'fastify';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { documentFormatSchema, formatMatchesBody, rebaseDocumentFormat } from '@ai-xiutu/contracts';
import { transaction, emit, type Database, type Queryable } from '@ai-xiutu/db';
import {
  HttpError,
  hash,
  id,
  title,
  lockProjectMutation,
  requireUser,
  projectAccess,
  assertVersion,
  spaceRole,
} from './core.js';

const commentDto = (c: Record<string, any>) => ({
  id: c.id,
  projectId: c.project_id,
  artworkId: c.artwork_id,
  revisionId: c.revision_id,
  body: c.body,
  anchor: c.anchor,
  authorId: c.author_id,
  authorName: c.author_name,
  resolved: c.resolved,
  bodyVersion: c.body_version,
  editedAt: c.edited_at,
  createdAt: c.created_at,
});
const taskDto = (t: Record<string, any>) => ({
  id: t.id,
  projectId: t.project_id,
  title: t.title,
  description: t.description,
  status: t.status,
  assigneeId: t.assignee_id,
  version: t.version,
  authorId: t.author_id,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
});
const documentDto = (d: Record<string, any>) => ({
  id: d.id,
  projectId: d.project_id,
  title: d.title,
  body: d.body,
  ...(d.formatting ? { formatting: d.formatting } : {}),
  version: d.version,
  authorId: d.author_id,
  createdAt: d.created_at,
  updatedAt: d.updated_at,
});
async function checkAssignee(
  tx: Queryable,
  spaceId: string,
  assigneeId: string | null | undefined,
) {
  if (
    assigneeId &&
    !(
      await tx.query('SELECT 1 FROM memberships WHERE space_id=$1 AND user_id=$2', [
        spaceId,
        assigneeId,
      ])
    ).rowCount
  )
    throw new HttpError(400, 'ASSIGNEE_NOT_MEMBER', '任务负责人必须是当前空间成员');
}
export function registerCollaboration(app: FastifyInstance, db: Database): void {
  app.get('/v1/projects/:id/comments', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await projectAccess(db, p.id, user.id);
    const filter = z.object({ artworkId: id.optional(), revisionId: id.optional() }).strict().parse(req.query);
    if (filter.revisionId && !filter.artworkId)
      throw new HttpError(400, 'COMMENT_ANCHOR_INVALID', '版本锚点需要对应作品');
    return {
      comments: (
        await db.query(
          `SELECT c.*,u.display_name AS author_name FROM comments c JOIN users u ON u.id=c.author_id
           WHERE project_id=$1 AND c.deleted_at IS NULL
           AND ($2::uuid IS NULL OR (c.artwork_id=$2 AND c.anchor IS NOT NULL))
           AND ($3::uuid IS NULL OR c.revision_id=$3)
           ORDER BY c.created_at, c.id LIMIT 500`,
          [p.id, filter.artworkId ?? null, filter.revisionId ?? null],
        )
      ).rows.map(commentDto),
    };
  });
  app.post('/v1/projects/:id/comments', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({
        body: z.string().trim().min(1).max(5000),
        artworkId: id.optional(),
        revisionId: id.optional(),
        anchor: z
          .object({
            x: z.number().min(0).max(1),
            y: z.number().min(0).max(1),
            shape: z.enum(['point', 'diamond', 'frame']).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(req.body);
    const comment = await transaction(db, async (tx) => {
      const project = await projectAccess(tx, p.id, user.id, 'comment');
      if ((body.revisionId || body.anchor) && !body.artworkId)
        throw new HttpError(400, 'COMMENT_ANCHOR_INVALID', '版本锚点需要对应作品');
      if (
        body.artworkId &&
        !(
          await tx.query('SELECT id FROM artworks WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR SHARE', [
            body.artworkId,
            p.id,
          ])
        ).rowCount
      )
        throw new HttpError(400, 'COMMENT_ANCHOR_INVALID', '作品不属于项目');
      if (
        body.revisionId &&
        !(
          await tx.query('SELECT id FROM revisions WHERE id=$1 AND artwork_id=$2', [
            body.revisionId,
            body.artworkId,
          ])
        ).rowCount
      )
        throw new HttpError(400, 'COMMENT_ANCHOR_INVALID', '版本不属于作品');
      const row = (
        await tx.query(
          'INSERT INTO comments(project_id,artwork_id,revision_id,body,anchor,author_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
          [
            p.id,
            body.artworkId ?? null,
            body.revisionId ?? null,
            body.body,
            body.anchor ? JSON.stringify(body.anchor) : null,
            user.id,
          ],
        )
      ).rows[0]!;
      await emit(tx, project.space_id, p.id, 'comment.created', row.id);
      return commentDto({ ...row, author_name: user.display_name });
    });
    return reply.code(201).send({ comment });
  });
  app.patch('/v1/comments/:id', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z.union([
      z.object({ resolved: z.boolean() }).strict(),
      z.object({ body: z.string().trim().min(1).max(5000), expectedVersion: z.number().int().positive() }).strict(),
    ]).parse(req.body);
    const comment = await transaction(db, async (tx) => {
      const row = (await tx.query('SELECT * FROM comments WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [p.id])).rows[0];
      if (!row) throw new HttpError(404, 'COMMENT_NOT_FOUND', '评论不存在');
      const project = await projectAccess(tx, row.project_id, user.id, 'comment');
      if (row.author_id !== user.id &&
          ('body' in body || !['owner', 'admin', 'editor'].includes(project.role)))
        throw new HttpError(403, 'COMMENT_FORBIDDEN', '仅作者或编辑者可以处理评论');
      if ('body' in body) assertVersion(row.body_version, body.expectedVersion);
      const updated = (
        await ('body' in body
          ? tx.query(`UPDATE comments SET body=$2,body_version=body_version+1,edited_at=clock_timestamp()
                      WHERE id=$1 RETURNING *, (SELECT display_name FROM users WHERE id=author_id) AS author_name`,
                    [p.id, body.body])
          : tx.query(`UPDATE comments SET resolved=$2 WHERE id=$1
                      RETURNING *, (SELECT display_name FROM users WHERE id=author_id) AS author_name`,
                    [p.id, body.resolved]))
      ).rows[0]!;
      await emit(tx, project.space_id, project.id, 'comment.updated', p.id);
      return commentDto(updated);
    });
    return { comment };
  });
  app.delete('/v1/comments/:id', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const { expectedVersion } = z.object({ expectedVersion: z.coerce.number().int().positive() }).strict().parse(req.query);
    await transaction(db, async (tx) => {
      const row = (await tx.query('SELECT * FROM comments WHERE id=$1 FOR UPDATE', [p.id])).rows[0];
      if (!row) throw new HttpError(404, 'COMMENT_NOT_FOUND', '评论不存在');
      const project = await projectAccess(tx, row.project_id, user.id, 'comment');
      if (row.author_id !== user.id)
        throw new HttpError(403, 'COMMENT_FORBIDDEN', '仅作者可以删除评论');
      if (row.deleted_at) return;
      assertVersion(row.body_version, expectedVersion);
      await tx.query('UPDATE comments SET deleted_at=clock_timestamp() WHERE id=$1', [p.id]);
      await emit(tx, project.space_id, project.id, 'comment.deleted', p.id);
    });
    return reply.code(204).send();
  });
  app.get('/v1/projects/:id/tasks', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await projectAccess(db, p.id, user.id);
    return {
      tasks: (
        await db.query('SELECT * FROM tasks WHERE project_id=$1 ORDER BY created_at', [p.id])
      ).rows.map(taskDto),
    };
  });
  app.post('/v1/projects/:id/tasks', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({
        title,
        description: z.string().max(10000).default(''),
        assigneeId: id.nullable().optional(),
      })
      .strict()
      .parse(req.body);
    const task = await transaction(db, async (tx) => {
      const project = await projectAccess(tx, p.id, user.id, 'edit');
      await checkAssignee(tx, project.space_id, body.assigneeId);
      const row = (
        await tx.query(
          'INSERT INTO tasks(project_id,title,description,assignee_id,author_id) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [p.id, body.title, body.description, body.assigneeId ?? null, user.id],
        )
      ).rows[0]!;
      await emit(tx, project.space_id, p.id, 'task.created', row.id);
      return taskDto(row);
    });
    return reply.code(201).send({ task });
  });
  app.patch('/v1/tasks/:id', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({
        expectedVersion: z.number().int().positive(),
        title: title.optional(),
        description: z.string().max(10000).optional(),
        status: z.enum(['todo', 'doing', 'done']).optional(),
        assigneeId: id.nullable().optional(),
      })
      .strict()
      .parse(req.body);
    const task = await transaction(db, async (tx) => {
      const old = (await tx.query('SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [p.id])).rows[0];
      if (!old) throw new HttpError(404, 'TASK_NOT_FOUND', '任务不存在');
      const project = await projectAccess(tx, old.project_id, user.id, 'edit');
      assertVersion(old.version, body.expectedVersion);
      await checkAssignee(tx, project.space_id, body.assigneeId);
      const row = (
        await tx.query(
          'UPDATE tasks SET title=$2,description=$3,status=$4,assignee_id=$5,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [
            p.id,
            body.title ?? old.title,
            body.description ?? old.description,
            body.status ?? old.status,
            body.assigneeId === undefined ? old.assignee_id : body.assigneeId,
          ],
        )
      ).rows[0]!;
      await emit(tx, project.space_id, project.id, 'task.updated', p.id);
      return taskDto(row);
    });
    return { task };
  });
  app.get('/v1/projects/:id/documents', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    return transaction(db, async tx => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await projectAccess(tx, p.id, user.id);
      const result = await tx.query('SELECT * FROM documents WHERE project_id=$1 ORDER BY updated_at DESC', [p.id]);
      return { documents: result.rows.map(documentDto) };
    });
  });
  app.get('/v1/documents/:id/versions', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const query = z.object({
      beforeVersion: z.coerce.number().int().positive().max(2147483647).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }).strict().parse(req.query);
    reply.header('Cache-Control', 'private, no-store');
    return transaction(db, async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const doc = (await tx.query('SELECT project_id FROM documents WHERE id=$1', [p.id])).rows[0];
      if (!doc) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
      await projectAccess(tx, doc.project_id, user.id, 'edit');
      const { rows } = await tx.query(
        `SELECT v.version,v.title,v.created_at AS "createdAt",u.display_name AS "authorName"
         FROM document_versions v JOIN users u ON u.id=v.author_id
         WHERE v.document_id=$1 AND ($2::integer IS NULL OR v.version<$2)
         ORDER BY v.version DESC LIMIT $3`,
        [p.id, query.beforeVersion ?? null, query.limit + 1],
      );
      const versions = rows.slice(0, query.limit);
      return { versions, nextBeforeVersion: rows.length > query.limit ? versions.at(-1)!.version : null };
    });
  });
  app.get('/v1/documents/:id/versions/:version', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id, version: z.coerce.number().int().positive().max(2147483647) }).parse(req.params);
    reply.header('Cache-Control', 'private, no-store');
    return transaction(db, async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const doc = (await tx.query('SELECT project_id FROM documents WHERE id=$1', [p.id])).rows[0];
      if (!doc) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
      await projectAccess(tx, doc.project_id, user.id, 'edit');
      const version = (await tx.query(
        'SELECT version,title,body,formatting,author_id,created_at FROM document_versions WHERE document_id=$1 AND version=$2',
        [p.id, p.version],
      )).rows[0];
      if (!version) throw new HttpError(404, 'DOCUMENT_VERSION_NOT_FOUND', '文档版本不存在');
      return { document: documentDto({
        ...version, id: p.id, project_id: doc.project_id, updated_at: version.created_at,
      }) };
    });
  });
  app.post('/v1/projects/:id/documents', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({ title, body: z.string().max(100000).default(''), formatting: documentFormatSchema.nullable().optional() })
      .strict()
      .parse(req.body);
    const document = await transaction(db, async (tx) => {
      const project = await lockProjectMutation(tx, p.id, user.id, hash(req.cookies.xiutu_session ?? ''));
      if (body.formatting && !formatMatchesBody(body.body, body.formatting))
        throw new HttpError(400, 'DOCUMENT_FORMAT_MISMATCH', '文字排版与正文不匹配');
      const row = (
        await tx.query(
          'INSERT INTO documents(project_id,title,body,author_id,formatting) VALUES($1,$2,$3,$4,$5) RETURNING *',
          [p.id, body.title, body.body, user.id, body.formatting ?? null],
        )
      ).rows[0]!;
      await tx.query(
        'INSERT INTO document_versions(document_id,version,title,body,author_id,formatting) VALUES($1,1,$2,$3,$4,$5)',
        [row.id, body.title, body.body, user.id, row.formatting],
      );
      await emit(tx, project.space_id, p.id, 'document.created', row.id);
      return documentDto(row);
    });
    return reply.code(201).send({ document });
  });
  app.patch('/v1/documents/:id', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({
        expectedVersion: z.number().int().positive(),
        title: title.optional(),
        body: z.string().max(100000).optional(),
        formatting: documentFormatSchema.nullable().optional(),
      })
      .strict()
      .parse(req.body);
    const document = await transaction(db, async (tx) => {
      const hint = (await tx.query('SELECT project_id FROM documents WHERE id=$1', [p.id])).rows[0];
      if (!hint) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
      const project = await lockProjectMutation(
        tx, hint.project_id, user.id, hash(req.cookies.xiutu_session ?? ''),
      );
      const old = (await tx.query('SELECT * FROM documents WHERE id=$1 FOR UPDATE', [p.id]))
        .rows[0];
      if (!old || old.project_id !== hint.project_id)
        throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
      assertVersion(old.version, body.expectedVersion);
      const text = body.body ?? old.body;
      const formatting = body.formatting === undefined ? rebaseDocumentFormat(old.body, text, old.formatting) : body.formatting;
      if (formatting && !formatMatchesBody(text, formatting))
        throw new HttpError(400, 'DOCUMENT_FORMAT_MISMATCH', '文字排版与正文不匹配');
      const row = (
        await tx.query(
          'UPDATE documents SET title=$2,body=$3,formatting=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [p.id, body.title ?? old.title, text, formatting],
        )
      ).rows[0]!;
      await tx.query(
        'INSERT INTO document_versions(document_id,version,title,body,author_id,formatting) VALUES($1,$2,$3,$4,$5,$6)',
        [p.id, row.version, row.title, row.body, user.id, row.formatting],
      );
      await emit(tx, project.space_id, project.id, 'document.updated', p.id);
      return documentDto(row);
    });
    return { document };
  });
  app.get('/v1/events', async (req, reply) => {
    const user = requireUser(req);
    const tokenHash = hash(req.cookies.xiutu_session ?? '');
    const p = z
      .object({
        spaceId: id,
        after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
        waitMs: z.coerce.number().int().min(0).max(20000).default(0),
      })
      .parse(req.query);
    const deadline = Date.now() + p.waitMs;
    const disconnect = new AbortController();
    const abort = () => disconnect.abort();
    reply.raw.once('close', abort);
    if (reply.raw.destroyed) abort();
    try {
      while (!disconnect.signal.aborted) {
        await spaceRole(db, p.spaceId, user.id);
        if (disconnect.signal.aborted) break;
        const active = await db.query(
          `SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
           WHERE s.user_id=$1 AND s.token_hash=$2 AND s.expires_at>clock_timestamp() AND u.status='active'`,
          [user.id, tokenHash],
        );
        if (!active.rowCount) throw new HttpError(401, 'AUTH_REQUIRED', '会话已失效');
        if (disconnect.signal.aborted) break;
        const { rows } = await db.query(
          `SELECT seq,type,project_id AS "projectId",entity_id AS "entityId",created_at AS "createdAt"
           FROM events WHERE space_id=$1 AND seq>$2 AND EXISTS (
             SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN sessions s ON s.user_id=u.id
             WHERE m.space_id=$1 AND m.user_id=$3 AND u.status='active'
             AND s.token_hash=$4 AND s.expires_at>clock_timestamp()
           ) ORDER BY seq LIMIT 100`,
          [p.spaceId, p.after, user.id, tokenHash],
        );
        if (rows.length || Date.now() >= deadline)
          return {
            events: rows.map((r) => ({ ...r, seq: Number(r.seq) })),
            nextCursor: rows.length ? Number(rows.at(-1)!.seq) : p.after,
          };
        await delay(Math.min(500, deadline - Date.now()), undefined, { signal: disconnect.signal });
      }
    } catch (error) {
      if (!(disconnect.signal.aborted && error instanceof Error && error.name === 'AbortError'))
        throw error;
    } finally {
      reply.raw.off('close', abort);
    }
    return { events: [], nextCursor: p.after };
  });
}
