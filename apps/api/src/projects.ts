import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseRecipe, RecipeValidationError } from '@ai-xiutu/editor';
import { transaction, audit, emit, type Database } from '@ai-xiutu/db';
import {
  HttpError,
  id,
  title,
  requireUser,
  spaceRole,
  projectAccess,
  projectDto,
  assetDto,
  artworkDto,
  revisionDto,
  assertVersion,
} from './core.js';
import type { LocalPrivateStorage } from './storage.js';

export function validatedRecipe(input: unknown) {
  try {
    return parseRecipe(input);
  } catch (error) {
    if (error instanceof RecipeValidationError)
      throw new HttpError(400, 'INVALID_RECIPE', '编辑配方无效', { errors: error.errors });
    throw error;
  }
}
export function registerProjects(
  app: FastifyInstance,
  db: Database,
  storage: LocalPrivateStorage,
): void {
  app.get('/v1/projects', async (req) => {
    const user = requireUser(req);
    const p = z.object({ spaceId: id.optional() }).parse(req.query);
    if (p.spaceId) await spaceRole(db, p.spaceId, user.id);
    const { rows } = await db.query(
      `SELECT p.*,COALESCE(m.role,'reviewer') AS role FROM projects p JOIN spaces s ON s.id=p.space_id LEFT JOIN memberships m ON m.space_id=p.space_id AND m.user_id=$1
      WHERE p.deleted_at IS NULL AND ($2::uuid IS NULL OR p.space_id=$2) AND (m.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM share_grants g WHERE g.project_id=p.id AND g.target_user_id=$1 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp() AND ((g.mode='reference' AND (s.sharing_policy->>'allowReference')::boolean) OR (g.mode='copy' AND (s.sharing_policy->>'allowCopy')::boolean)))) ORDER BY p.updated_at DESC LIMIT 200`,
      [user.id, p.spaceId ?? null],
    );
    return { projects: rows.map(projectDto) };
  });
  app.post('/v1/projects', async (req, reply) => {
    const user = requireUser(req);
    const p = z
      .object({ spaceId: id, title, description: z.string().max(4000).default('') })
      .strict()
      .parse(req.body);
    const project = await transaction(db, async (tx) => {
      const r = await spaceRole(tx, p.spaceId, user.id, ['owner', 'admin', 'editor']);
      const row = (
        await tx.query(
          'INSERT INTO projects(space_id,title,description,created_by) VALUES($1,$2,$3,$4) RETURNING *',
          [p.spaceId, p.title, p.description, user.id],
        )
      ).rows[0]!;
      await emit(tx, p.spaceId, row.id, 'project.created', row.id);
      return projectDto({ ...row, role: r });
    });
    return reply.code(201).send({ project });
  });
  app.get('/v1/projects/:id', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const project = await projectAccess(db, p.id, user.id);
    const assets = await db.query(
      'SELECT * FROM assets WHERE project_id=$1 AND deleted_at IS NULL ORDER BY created_at',
      [p.id],
    );
    const artworks = await db.query(
      'SELECT * FROM artworks WHERE project_id=$1 ORDER BY updated_at DESC',
      [p.id],
    );
    return {
      project: projectDto(project),
      assets: assets.rows.map(assetDto),
      artworks: artworks.rows.map(artworkDto),
    };
  });
  app.patch('/v1/projects/:id', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({
        expectedVersion: z.number().int().positive(),
        title: title.optional(),
        description: z.string().max(4000).optional(),
      })
      .strict()
      .parse(req.body);
    const project = await transaction(db, async (tx) => {
      const access = await projectAccess(tx, p.id, user.id, 'edit');
      const old = (await tx.query('SELECT * FROM projects WHERE id=$1 FOR UPDATE', [p.id]))
        .rows[0]!;
      assertVersion(old.version, body.expectedVersion);
      const row = (
        await tx.query(
          'UPDATE projects SET title=$2,description=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
          [p.id, body.title ?? old.title, body.description ?? old.description],
        )
      ).rows[0]!;
      await emit(tx, access.space_id, p.id, 'project.updated', p.id);
      return projectDto({ ...row, role: access.role });
    });
    return { project };
  });
  app.delete('/v1/projects/:id', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await transaction(db, async (tx) => {
      const project = await projectAccess(tx, p.id, user.id, 'admin');
      await tx.query(
        'UPDATE projects SET deleted_at=clock_timestamp(),version=version+1 WHERE id=$1',
        [p.id],
      );
      await tx.query(
        'UPDATE share_grants SET revoked_at=clock_timestamp() WHERE project_id=$1 AND revoked_at IS NULL',
        [p.id],
      );
      await emit(tx, project.space_id, p.id, 'project.deleted', p.id);
      await audit(tx, user.id, 'project.delete', 'project', p.id);
    });
    return { ok: true };
  });
  app.post('/v1/projects/:id/assets', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await projectAccess(db, p.id, user.id, 'edit');
    const file = await req.file();
    if (!file) throw new HttpError(400, 'FILE_REQUIRED', '请选择图片');
    const stored = await storage.ingest(file);
    let committed = false;
    try {
      const asset = await transaction(db, async (tx) => {
        const project = await projectAccess(tx, p.id, user.id, 'edit');
        const row = (
          await tx.query(
            'INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
            [
              p.id,
              file.filename.slice(0, 200) || 'image.png',
              stored.key,
              stored.mime,
              stored.width,
              stored.height,
              stored.bytes,
              stored.hash,
              user.id,
            ],
          )
        ).rows[0]!;
        await emit(tx, project.space_id, p.id, 'asset.created', row.id);
        return assetDto(row);
      });
      committed = true;
      return reply.code(201).send({ asset });
    } finally {
      if (!committed) await storage.discard(stored.key);
    }
  });
  app.get('/v1/assets/:id/file', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const asset = (
      await db.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL', [p.id])
    ).rows[0];
    if (!asset) throw new HttpError(404, 'ASSET_NOT_FOUND', '资源不存在');
    await projectAccess(db, asset.project_id, user.id);
    return reply
      .type(asset.mime)
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Length', String(asset.bytes))
      .header('Content-Disposition', `inline; filename="${asset.id}.png"`)
      .send(storage.stream(asset.storage_key));
  });
  app.get('/v1/assets/:id/thumbnail', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const asset = (
      await db.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL', [p.id])
    ).rows[0];
    if (!asset) throw new HttpError(404, 'ASSET_NOT_FOUND', '资源不存在');
    await projectAccess(db, asset.project_id, user.id);
    const thumbnail = await storage.thumbnail(asset.storage_key);
    // Cold-cache work can take time; deletion or grant revocation during it must
    // not turn a newly generated private derivative into an authorized response.
    if (
      !(await db.query('SELECT id FROM assets WHERE id=$1 AND deleted_at IS NULL', [p.id])).rowCount
    )
      throw new HttpError(404, 'ASSET_NOT_FOUND', '资源不存在');
    await projectAccess(db, asset.project_id, user.id);
    return reply
      .type(thumbnail.mime)
      .header('Cache-Control', 'private, no-store')
      .header('Content-Length', String(thumbnail.bytes))
      .header('Content-Disposition', `inline; filename="${asset.id}-thumbnail.webp"`)
      .send(storage.thumbnailStream(asset.storage_key));
  });
  app.delete('/v1/assets/:id', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await transaction(db, async (tx) => {
      const asset = (
        await tx.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [p.id])
      ).rows[0];
      if (!asset) throw new HttpError(404, 'ASSET_NOT_FOUND', '资源不存在');
      const project = await projectAccess(tx, asset.project_id, user.id, 'edit');
      if ((await tx.query('SELECT id FROM artworks WHERE asset_id=$1 LIMIT 1', [p.id])).rowCount)
        throw new HttpError(409, 'ASSET_IN_USE', '作品仍引用此资源');
      await tx.query('UPDATE assets SET deleted_at=clock_timestamp() WHERE id=$1', [p.id]);
      await emit(tx, project.space_id, project.id, 'asset.deleted', p.id);
    });
    return { ok: true };
  });
  app.post('/v1/projects/:id/artworks', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z.object({ assetId: id, title, recipe: z.unknown() }).strict().parse(req.body);
    const recipe = validatedRecipe(body.recipe);
    const result = await transaction(db, async (tx) => {
      const project = await projectAccess(tx, p.id, user.id, 'edit');
      const asset = (
        await tx.query(
          'SELECT id FROM assets WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR SHARE',
          [body.assetId, p.id],
        )
      ).rows[0];
      if (!asset) throw new HttpError(400, 'ASSET_MISMATCH', '图片不属于该项目');
      const artwork = (
        await tx.query(
          'INSERT INTO artworks(project_id,asset_id,title) VALUES($1,$2,$3) RETURNING *',
          [p.id, body.assetId, body.title],
        )
      ).rows[0]!;
      const revision = (
        await tx.query(
          'INSERT INTO revisions(artwork_id,version,recipe,author_id,label) VALUES($1,1,$2,$3,$4) RETURNING *',
          [artwork.id, JSON.stringify(recipe), user.id, '初始版本'],
        )
      ).rows[0]!;
      await tx.query('UPDATE artworks SET head_revision_id=$2 WHERE id=$1', [
        artwork.id,
        revision.id,
      ]);
      await emit(tx, project.space_id, p.id, 'artwork.created', artwork.id);
      return {
        artwork: artworkDto({ ...artwork, head_revision_id: revision.id }),
        revision: revisionDto(revision),
      };
    });
    return reply.code(201).send(result);
  });
  app.get('/v1/artworks/:id', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const artwork = (await db.query('SELECT * FROM artworks WHERE id=$1', [p.id])).rows[0];
    if (!artwork) throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不存在');
    await projectAccess(db, artwork.project_id, user.id);
    const asset = (
      await db.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL', [artwork.asset_id])
    ).rows[0];
    const revision = (
      await db.query('SELECT * FROM revisions WHERE id=$1', [artwork.head_revision_id])
    ).rows[0];
    return {
      artwork: artworkDto(artwork),
      asset: asset ? assetDto(asset) : null,
      revision: revision ? revisionDto(revision) : null,
    };
  });
  for (const method of ['POST', 'PATCH'] as const) {
    const url = method === 'POST' ? '/v1/artworks/:id/revisions' : '/v1/artworks/:id';
    app.route({
      method,
      url,
      handler: async (req, reply) => {
        const user = requireUser(req);
        const p = z.object({ id }).parse(req.params);
        const body = (
          method === 'POST'
            ? z.object({
                expectedVersion: z.number().int().positive(),
                recipe: z.unknown(),
                label: z.string().max(200).default('编辑保存'),
              })
            : z.object({ expectedVersion: z.number().int().positive(), title })
        )
          .strict()
          .parse(req.body);
        const result = await transaction(db, async (tx) => {
          const artwork = (await tx.query('SELECT * FROM artworks WHERE id=$1 FOR UPDATE', [p.id]))
            .rows[0];
          if (!artwork) throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不存在');
          const project = await projectAccess(tx, artwork.project_id, user.id, 'edit');
          assertVersion(artwork.head_version, body.expectedVersion);
          const old = (
            await tx.query('SELECT recipe FROM revisions WHERE id=$1', [artwork.head_revision_id])
          ).rows[0]!;
          const recipe = 'recipe' in body ? validatedRecipe(body.recipe) : old.recipe;
          const label = 'label' in body ? body.label : '重命名';
          const revision = (
            await tx.query(
              'INSERT INTO revisions(artwork_id,version,parent_id,recipe,label,author_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
              [
                p.id,
                artwork.head_version + 1,
                artwork.head_revision_id,
                JSON.stringify(recipe),
                label,
                user.id,
              ],
            )
          ).rows[0]!;
          const updated = (
            await tx.query(
              'UPDATE artworks SET head_version=head_version+1,head_revision_id=$2,title=$3,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
              [p.id, revision.id, 'title' in body ? body.title : artwork.title],
            )
          ).rows[0]!;
          await emit(tx, project.space_id, project.id, 'artwork.revised', p.id);
          return { artwork: artworkDto(updated), revision: revisionDto(revision) };
        });
        return reply.code(method === 'POST' ? 201 : 200).send(result);
      },
    });
  }
  app.get('/v1/artworks/:id/revisions', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const artwork = (await db.query('SELECT project_id FROM artworks WHERE id=$1', [p.id])).rows[0];
    if (!artwork) throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不存在');
    await projectAccess(db, artwork.project_id, user.id);
    return {
      revisions: (
        await db.query(
          'SELECT * FROM revisions WHERE artwork_id=$1 ORDER BY version DESC LIMIT 100',
          [p.id],
        )
      ).rows.map(revisionDto),
    };
  });
  app.get('/v1/artworks/:id/revisions/:revisionId', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id, revisionId: id }).parse(req.params);
    const row = (
      await db.query(
        'SELECT r.*,a.project_id FROM revisions r JOIN artworks a ON a.id=r.artwork_id WHERE r.id=$1 AND r.artwork_id=$2',
        [p.revisionId, p.id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'REVISION_NOT_FOUND', '版本不存在');
    await projectAccess(db, row.project_id, user.id);
    return { revision: revisionDto(row) };
  });
}
