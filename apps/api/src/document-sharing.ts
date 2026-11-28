import type { FastifyInstance, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { isPresentationBody, readOfficeBlock, readPresentation } from '@ai-xiutu/contracts';
import { transaction, audit, emit, lockAssetStorageKeys, type Database } from '@ai-xiutu/db';
import {
  HttpError,
  id,
  requireUser,
  projectAccess,
  lockActiveUser,
  lockActiveSession,
  hash,
  rateLimit,
} from './core.js';
import type { LocalPrivateStorage } from './storage.js';

/**
 * Read-only share links for project documents (Google Docs "anyone with the link
 * can view"). Managing links needs project edit permission and a space policy
 * that allows document links; the policy, expiry, revocation and document
 * existence are re-checked on every anonymous read. The token is returned once
 * and stored only as a SHA-256 hash. Anonymous readers get the title, content
 * and images referenced by the document — never members, phone numbers,
 * history, comments or other project data.
 */
const MAX_ACTIVE_LINKS = 10;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const createInput = z
  .object({
    expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]).nullable(),
    allowDownload: z.boolean(),
  })
  .strict();

const roleAccess: Record<string, 'edit' | 'comment' | 'view'> = {
  owner: 'edit',
  admin: 'edit',
  editor: 'edit',
  reviewer: 'comment',
  viewer: 'view',
};

const linkDto = (row: Record<string, any>) => ({
  id: row.id,
  allowDownload: row.allow_download,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  viewCount: row.view_count,
  lastViewedAt: row.last_viewed_at,
  createdBy: row.created_by_name ?? null,
});

/** Asset IDs that the current document body actually embeds. */
export function referencedAssetIds(body: string): Set<string> {
  const ids = new Set<string>();
  if (isPresentationBody(body)) {
    for (const slide of readPresentation(body)?.slides ?? [])
      for (const element of slide.elements) if (element.kind === 'image') ids.add(element.assetId);
  } else
    for (const line of body.split(/\r\n?|\n/)) {
      const block = readOfficeBlock(line);
      if (block?.kind === 'image') ids.add(block.assetId);
    }
  return ids;
}

async function documentProject(db: Database, documentId: string) {
  const doc = (await db.query('SELECT id, project_id FROM documents WHERE id=$1', [documentId])).rows[0];
  if (!doc) throw new HttpError(404, 'DOCUMENT_NOT_FOUND', '文档不存在');
  return doc as { id: string; project_id: string };
}

/** Resolves an anonymous token to a live link, or a uniform 404. */
async function liveLink(db: Database, token: string) {
  if (!tokenPattern.test(token)) throw new HttpError(404, 'SHARE_LINK_NOT_FOUND', '分享链接无效或已失效');
  const row = (
    await db.query(
      `SELECT l.*, d.title, d.body, d.formatting, d.version, d.updated_at
       FROM document_share_links l
       JOIN documents d ON d.id = l.document_id
       JOIN projects p ON p.id = l.project_id AND p.deleted_at IS NULL
       JOIN spaces s ON s.id = p.space_id
       WHERE l.token_hash = $1 AND l.revoked_at IS NULL
         AND (l.expires_at IS NULL OR l.expires_at > clock_timestamp())
         AND d.project_id = l.project_id
         AND COALESCE((s.sharing_policy->>'allowDocumentLinks')::boolean, false)`,
      [hash(token)],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, 'SHARE_LINK_NOT_FOUND', '分享链接无效或已失效');
  return row;
}

function publicHeaders(reply: FastifyReply) {
  return reply
    .header('Cache-Control', 'private, no-store')
    .header('X-Robots-Tag', 'noindex, nofollow')
    .header('Referrer-Policy', 'no-referrer');
}

export function registerDocumentSharing(app: FastifyInstance, db: Database, storage: LocalPrivateStorage) {
  app.get('/v1/documents/:id/sharing', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const doc = await documentProject(db, p.id);
    reply.header('Cache-Control', 'private, no-store');
    return transaction(db, async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const project = await projectAccess(tx, doc.project_id, user.id);
      const canManage = ['owner', 'admin', 'editor'].includes(project.role);
      const policy = (
        await tx.query('SELECT sharing_policy FROM spaces WHERE id=$1', [project.space_id])
      ).rows[0]!.sharing_policy as { allowDocumentLinks?: boolean };
      // Who can open the document inside the space: members only, display names only.
      const members = await tx.query(
        `SELECT u.id, u.display_name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.space_id = $1 AND u.status = 'active' ORDER BY
         array_position(ARRAY['owner','admin','editor','reviewer','viewer'], m.role), u.display_name LIMIT 200`,
        [project.space_id],
      );
      const links = canManage
        ? await tx.query(
            `SELECT l.*, u.display_name AS created_by_name FROM document_share_links l
             JOIN users u ON u.id = l.created_by
             WHERE l.document_id = $1 ORDER BY l.created_at DESC LIMIT 50`,
            [p.id],
          )
        : { rows: [] };
      return {
        canManage,
        linksAllowed: policy.allowDocumentLinks === true,
        role: project.role,
        access: members.rows.map((m) => ({
          userId: m.id,
          name: m.display_name,
          role: m.role,
          access: roleAccess[m.role] ?? 'view',
          you: m.id === user.id,
        })),
        links: links.rows.map(linkDto),
      };
    });
  });

  app.post('/v1/documents/:id/share-links', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = createInput.parse(req.body);
    const doc = await documentProject(db, p.id);
    const token = randomBytes(32).toString('base64url');
    const link = await transaction(db, async (tx) => {
      await lockActiveUser(tx, user.id);
      await lockActiveSession(tx, user.id, hash(req.cookies.xiutu_session ?? ''));
      const project = await projectAccess(tx, doc.project_id, user.id, 'edit');
      const policy = (
        await tx.query('SELECT sharing_policy FROM spaces WHERE id=$1 FOR SHARE', [project.space_id])
      ).rows[0]!.sharing_policy as { allowDocumentLinks?: boolean };
      if (policy.allowDocumentLinks !== true)
        throw new HttpError(403, 'DOCUMENT_LINKS_DISABLED', '空间策略尚未允许文档链接分享');
      await tx.query('SELECT id FROM documents WHERE id=$1 FOR UPDATE', [p.id]);
      const active = await tx.query(
        `SELECT count(*)::int AS n FROM document_share_links WHERE document_id=$1 AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > clock_timestamp())`,
        [p.id],
      );
      if (active.rows[0]!.n >= MAX_ACTIVE_LINKS)
        throw new HttpError(409, 'SHARE_LINK_LIMIT', `每个文档最多保留 ${MAX_ACTIVE_LINKS} 个有效链接`);
      const row = (
        await tx.query(
          `INSERT INTO document_share_links (document_id, project_id, token_hash, allow_download, created_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::integer IS NULL THEN NULL ELSE clock_timestamp() + make_interval(days => $6::integer) END)
           RETURNING *`,
          [p.id, doc.project_id, hash(token), body.allowDownload, user.id, body.expiresInDays],
        )
      ).rows[0]!;
      await audit(tx, user.id, 'document.share_link.create', 'document', p.id, {
        linkId: row.id,
        allowDownload: body.allowDownload,
        expiresInDays: body.expiresInDays,
      });
      await emit(tx, project.space_id, project.id, 'document.sharing', p.id);
      return row;
    });
    reply.code(201).header('Cache-Control', 'private, no-store');
    return { link: linkDto({ ...link, created_by_name: user.display_name }), token };
  });

  app.delete('/v1/documents/:id/share-links/:linkId', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id, linkId: id }).parse(req.params);
    const doc = await documentProject(db, p.id);
    return transaction(db, async (tx) => {
      await lockActiveUser(tx, user.id);
      await lockActiveSession(tx, user.id, hash(req.cookies.xiutu_session ?? ''));
      const project = await projectAccess(tx, doc.project_id, user.id, 'edit');
      const row = (
        await tx.query(
          `UPDATE document_share_links SET revoked_at = clock_timestamp(), revoked_by = $3
           WHERE id = $1 AND document_id = $2 AND revoked_at IS NULL RETURNING *`,
          [p.linkId, p.id, user.id],
        )
      ).rows[0];
      if (!row) throw new HttpError(404, 'SHARE_LINK_NOT_FOUND', '分享链接不存在或已停用');
      await audit(tx, user.id, 'document.share_link.revoke', 'document', p.id, { linkId: p.linkId });
      await emit(tx, project.space_id, project.id, 'document.sharing', p.id);
      return { link: linkDto(row) };
    });
  });

  app.get('/v1/shared/documents/:token', async (req, reply) => {
    const p = z.object({ token: z.string().max(64) }).parse(req.params);
    await rateLimit(db, `shared-document-ip:${hash(req.ip)}`, 120, 60);
    const row = await liveLink(db, p.token);
    await db.query(
      'UPDATE document_share_links SET view_count = view_count + 1, last_viewed_at = clock_timestamp() WHERE id = $1',
      [row.id],
    );
    publicHeaders(reply);
    return {
      document: {
        title: row.title,
        body: row.body,
        ...(row.formatting ? { formatting: row.formatting } : {}),
        version: row.version,
        updatedAt: row.updated_at,
      },
      allowDownload: row.allow_download,
      expiresAt: row.expires_at,
    };
  });

  app.get('/v1/shared/documents/:token/assets/:assetId', async (req, reply) => {
    const p = z.object({ token: z.string().max(64), assetId: id }).parse(req.params);
    await rateLimit(db, `shared-document-asset-ip:${hash(req.ip)}`, 600, 60);
    const row = await liveLink(db, p.token);
    // Only images the current document version embeds, from the link's own project.
    if (!referencedAssetIds(row.body).has(p.assetId))
      throw new HttpError(404, 'ASSET_NOT_FOUND', '资源不存在');
    const asset = (
      await db.query('SELECT * FROM assets WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL', [
        p.assetId,
        row.project_id,
      ])
    ).rows[0];
    if (!asset) throw new HttpError(404, 'ASSET_NOT_FOUND', '资源不存在');
    const thumbnail = await storage.thumbnail(asset.storage_key, (publish) =>
      transaction(db, async (tx) => {
        await lockAssetStorageKeys(tx, [asset.storage_key]);
        const retained = await tx.query(
          'SELECT 1 FROM assets WHERE storage_key=$1 AND purged_at IS NULL LIMIT 1',
          [asset.storage_key],
        );
        if (!retained.rowCount) throw new HttpError(404, 'ASSET_NOT_FOUND', '资源不存在');
        await publish();
      }),
    );
    // Re-check after possibly slow derivative work: revocation must win.
    await liveLink(db, p.token);
    return publicHeaders(reply)
      .type(thumbnail.mime)
      .header('Content-Length', String(thumbnail.bytes))
      .header('Content-Disposition', `inline; filename="${asset.id}.webp"`)
      .send(storage.thumbnailStream(asset.storage_key));
  });
}
