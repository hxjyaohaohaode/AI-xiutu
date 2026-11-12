import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, emit, type Database, type Queryable } from '@ai-xiutu/db';
import {
  HttpError,
  id,
  title,
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
           WHERE project_id=$1
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
          await tx.query('SELECT id FROM artworks WHERE id=$1 AND project_id=$2', [
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
    const body = z.object({ resolved: z.boolean() }).strict().parse(req.body);
    const comment = await transaction(db, async (tx) => {
      const row = (await tx.query('SELECT * FROM comments WHERE id=$1 FOR UPDATE', [p.id])).rows[0];
      if (!row) throw new HttpError(404, 'COMMENT_NOT_FOUND', '评论不存在');
      const project = await projectAccess(tx, row.project_id, user.id, 'comment');
      if (row.author_id !== user.id && !['owner', 'admin', 'editor'].includes(project.role))
        throw new HttpError(403, 'COMMENT_FORBIDDEN', '仅作者或编辑者可以处理评论');
      const updated = (
        await tx.query('UPDATE comments SET resolved=$2 WHERE id=$1 RETURNING *', [
          p.id,
          body.resolved,
        ])
      ).rows[0]!;
      await emit(tx, project.space_id, project.id, 'comment.updated', p.id);
      return commentDto(updated);
    });
    return { comment };
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
    await projectAccess(db, p.id, user.id);
    return {
      documents: (
        await db.query('SELECT * FROM documents WHERE project_id=$1 ORDER BY updated_at DESC', [
          p.id,
        ])
      ).rows.map(documentDto),
    };
  });
  app.post('/v1/projects/:id/documents', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({ title, body: z.string().max(100000).default('') })
      .strict()
      .parse(req.body);
    const document = await transaction(db, async (tx) => {
      const project = await projectAccess(tx, p.id, user.id, 'edit');
      const row = (
        await tx.query(
          'INSERT INTO documents(project_id,title,body,author_id) VALUES($1,$2,$3,$4) RETURNING *',
          [p.id, body.title, body.body, user.id],
        )
      ).rows[0]!;
      await tx.query(
        'INSERT INTO document_versions(document_id,version,title,body,author_id) VALUES($1,1,$2,$3,$4)',
        [row.id, body.title, body.body, user.id],
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
      })
      .strict()
      .parse(req.body);
    const document = await transaction(db, async (tx) => {
      const old = (await tx.query('SELECT * FROM documents WHERE id=$1 FOR UPDATE', [p.id]))
        .rows[0];
      if (!old) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
      const project = await projectAccess(tx, old.project_id, user.id, 'edit');
      assertVersion(old.version, body.expectedVersion);
      const row = (
        await tx.query(
          'UPDATE documents SET title=$2,body=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [p.id, body.title ?? old.title, body.body ?? old.body],
        )
      ).rows[0]!;
      await tx.query(
        'INSERT INTO document_versions(document_id,version,title,body,author_id) VALUES($1,$2,$3,$4,$5)',
        [p.id, row.version, row.title, row.body, user.id],
      );
      await emit(tx, project.space_id, project.id, 'document.updated', p.id);
      return documentDto(row);
    });
    return { document };
  });
  app.get('/v1/events', async (req) => {
    const user = requireUser(req);
    const p = z
      .object({
        spaceId: id,
        after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
        waitMs: z.coerce.number().int().min(0).max(20000).default(0),
      })
      .parse(req.query);
    const deadline = Date.now() + p.waitMs;
    while (true) {
      await spaceRole(db, p.spaceId, user.id);
      const active = await db.query("SELECT id FROM users WHERE id=$1 AND status='active'", [
        user.id,
      ]);
      if (!active.rowCount) throw new HttpError(401, 'AUTH_REQUIRED', '会话已失效');
      const { rows } = await db.query(
        'SELECT seq,type,project_id AS "projectId",entity_id AS "entityId",created_at AS "createdAt" FROM events WHERE space_id=$1 AND seq>$2 ORDER BY seq LIMIT 100',
        [p.spaceId, p.after],
      );
      if (rows.length || Date.now() >= deadline || req.raw.destroyed)
        return {
          events: rows.map((r) => ({ ...r, seq: Number(r.seq) })),
          nextCursor: rows.length ? Number(rows.at(-1)!.seq) : p.after,
        };
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, deadline - Date.now())));
    }
  });
}
