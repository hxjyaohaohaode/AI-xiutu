import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PHOTO_TRASH_HOURS, type PhotoTrashKind } from '@ai-xiutu/contracts';
import { transaction, audit, emit, type Database, type Queryable } from '@ai-xiutu/db';
import { HttpError, id, requireUser, hash, lockProjectMutation, assertVersion } from './core.js';

export const photoTrashRetention = `interval '${PHOTO_TRASH_HOURS} hours'`;
const kind = z.enum(['asset', 'artwork']);
const cursorSchema = z.object({ at: z.string().datetime({ offset: true }), token: id }).strict();
const tableFor = (kind: PhotoTrashKind) => kind === 'asset' ? 'assets' : 'artworks';
const nameFor = (kind: PhotoTrashKind) => kind === 'asset' ? 'name' : 'title';
const unavailable = () => new HttpError(404, 'PHOTO_NOT_FOUND', '照片或作品不存在或无权访问');
const expired = () => new HttpError(410, 'PHOTO_TRASH_EXPIRED', '已超过 48 小时恢复期限');
const windowOpen = `deleted_at > clock_timestamp() - ${photoTrashRetention}`;

function entryDto(kind: PhotoTrashKind, row: Record<string, any>, projectTitle: string) {
  return {
    kind, id: row.id, token: row.trash_token,
    title: row[nameFor(kind)], projectId: row.project_id, projectTitle,
    deletedAt: row.deleted_at, expiresAt: row.expires_at,
  };
}

async function lockPhoto(tx: Queryable, kind: PhotoTrashKind, photoId: string, actorId: string, authHash: string) {
  const table = tableFor(kind);
  const hint = (await tx.query(`SELECT project_id FROM ${table} WHERE id=$1`, [photoId])).rows[0];
  if (!hint) throw unavailable();
  const project = await lockProjectMutation(tx, hint.project_id, actorId, authHash);
  const row = (await tx.query(
    `SELECT *,${windowOpen} AS recoverable,deleted_at+${photoTrashRetention} AS expires_at
     FROM ${table} WHERE id=$1 AND project_id=$2 FOR UPDATE`,
    [photoId, project.id],
  )).rows[0];
  if (!row) throw unavailable();
  return { project, row };
}

async function checkOriginalReferences(tx: Queryable, assetId: string) {
  const result = await tx.query(
    `SELECT 1 FROM artworks WHERE asset_id=$1 AND purged_at IS NULL
     UNION ALL
     SELECT 1 FROM revision_sources s
       JOIN revisions r ON r.id=s.revision_id JOIN artworks a ON a.id=r.artwork_id
       WHERE s.asset_id=$1 AND a.purged_at IS NULL
     UNION ALL
     SELECT 1 FROM revision_image_layers l
       JOIN revisions r ON r.id=l.revision_id JOIN artworks a ON a.id=r.artwork_id
       WHERE l.asset_id=$1 AND a.purged_at IS NULL
     LIMIT 1`,
    [assetId],
  );
  if (result.rowCount)
    throw new HttpError(409, 'ASSET_IN_USE', '作品、历史版本或合成图层仍引用这张原图');
}

export function registerPhotoTrash(app: FastifyInstance, db: Database) {
  app.get('/v1/photo-trash', async (req) => {
    const user = requireUser(req);
    const options = z.object({
      cursor: z.string().min(1).max(256).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).strict().parse(req.query);
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (options.cursor) {
      try {
        cursor = cursorSchema.parse(JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')));
      } catch {
        throw new HttpError(400, 'INVALID_CURSOR', '回收站翻页位置无效');
      }
    }
    const { rows } = await db.query(
      `WITH recycled AS (
        SELECT 'asset' AS kind,id,name AS label,project_id,deleted_at,trash_token
          FROM assets WHERE trash_token IS NOT NULL AND purged_at IS NULL AND ${windowOpen}
        UNION ALL
        SELECT 'artwork' AS kind,id,title AS label,project_id,deleted_at,trash_token
          FROM artworks WHERE deleted_at IS NOT NULL AND purged_at IS NULL AND ${windowOpen}
      )
      SELECT r.*,p.title AS project_title,
        to_char(r.deleted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
        r.deleted_at+${photoTrashRetention} AS expires_at
      FROM recycled r JOIN projects p ON p.id=r.project_id AND p.deleted_at IS NULL
      JOIN memberships m ON m.space_id=p.space_id AND m.user_id=$1 AND m.role IN ('owner','admin','editor')
      WHERE $2::timestamptz IS NULL OR (r.deleted_at,r.trash_token)<($2::timestamptz,$3::uuid)
      ORDER BY r.deleted_at DESC,r.trash_token DESC LIMIT $4`,
      [user.id, cursor?.at ?? null, cursor?.token ?? null, options.limit + 1],
    );
    const page = rows.slice(0, options.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => entryDto(row.kind, { ...row, [nameFor(row.kind)]: row.label }, row.project_title)),
      nextCursor: rows.length > options.limit && last
        ? Buffer.from(JSON.stringify({ at: last.cursor_at, token: last.trash_token })).toString('base64url')
        : null,
    };
  });

  for (const itemKind of kind.options) {
    app.delete(`/v1/${tableFor(itemKind)}/:id`, async (req) => {
      const user = requireUser(req);
      const params = z.object({ id }).parse(req.params);
      const expectedVersion = itemKind === 'artwork'
        ? z.object({ expectedVersion: z.coerce.number().int().positive() }).strict()
            .parse(req.query).expectedVersion
        : undefined;
      return transaction(db, async (tx) => {
        const { project, row } = await lockPhoto(
          tx, itemKind, params.id, user.id, hash(req.cookies.xiutu_session ?? ''),
        );
        if (row.deleted_at) {
          if (!row.trash_token) throw unavailable();
          if (row.purged_at || !row.recoverable) throw expired();
          return { ok: true, item: entryDto(itemKind, row, project.title) };
        }
        if (expectedVersion !== undefined) {
          assertVersion(row.head_version, expectedVersion);
          const lease = await tx.query(
            `SELECT 1 FROM collaboration_leases l JOIN collaboration_sessions c ON c.id=l.session_id
             JOIN sessions s ON s.token_hash=c.auth_session_hash AND s.user_id=c.user_id AND s.expires_at>clock_timestamp()
             JOIN users u ON u.id=c.user_id AND u.status='active'
             WHERE l.artwork_id=$1 AND l.expires_at>clock_timestamp() AND c.expires_at>clock_timestamp()`,
            [row.id],
          );
          if (lease.rowCount)
            throw new HttpError(409, 'COLLABORATION_LOCKED', '作品正在协作编辑，请在当前操作完成后再删除');
          await tx.query('DELETE FROM collaboration_sessions WHERE artwork_id=$1', [row.id]);
        } else {
          await checkOriginalReferences(tx, row.id);
        }
        const moved = (await tx.query(
          `UPDATE ${tableFor(itemKind)} SET deleted_at=clock_timestamp(),trash_token=gen_random_uuid()
           WHERE id=$1 RETURNING *,deleted_at+${photoTrashRetention} AS expires_at`,
          [row.id],
        )).rows[0]!;
        await audit(tx, user.id, `${itemKind}.trash`, itemKind, row.id);
        await emit(tx, project.space_id, project.id, `${itemKind}.deleted`, row.id);
        return { ok: true, item: entryDto(itemKind, moved, project.title) };
      });
    });
  }

  app.post('/v1/photo-trash/:kind/:id/restore', async (req) => {
    const user = requireUser(req);
    const params = z.object({ kind, id }).parse(req.params);
    const body = z.object({ token: id }).strict().parse(req.body);
    return transaction(db, async (tx) => {
      const { project, row } = await lockPhoto(
        tx, params.kind, params.id, user.id, hash(req.cookies.xiutu_session ?? ''),
      );
      if (!row.deleted_at || row.trash_token !== body.token)
        throw new HttpError(409, 'PHOTO_TRASH_CHANGED', '回收站条目已变化，请刷新后重试');
      if (row.purged_at || !row.recoverable) throw expired();
      const restored = await tx.query(
        `UPDATE ${tableFor(params.kind)} SET deleted_at=NULL,trash_token=NULL
         WHERE id=$1 AND purged_at IS NULL AND ${windowOpen} RETURNING id`,
        [row.id],
      );
      if (!restored.rowCount) throw expired();
      await audit(tx, user.id, `${params.kind}.restore`, params.kind, row.id);
      await emit(tx, project.space_id, project.id, `${params.kind}.restored`, row.id);
      return { ok: true, projectId: project.id };
    });
  });
}
