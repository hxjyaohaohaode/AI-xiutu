import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createRecipeV4,
  localEditorSourceLimits,
  migrateRecipeToV4,
  parseEditorRecipe,
  RecipeValidationError,
} from '@ai-xiutu/editor';
import {
  forkRevisionSchema,
  replaceArtworkSourceSchema,
  revisionHistoryQuerySchema,
} from '@ai-xiutu/contracts';
import { canonical, digest } from '@ai-xiutu/ai';
import {
  transaction,
  audit,
  emit,
  lockAssetStorageKeys,
  discardUnreferencedStorageKeys,
  type Database,
  type Queryable,
} from '@ai-xiutu/db';
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
  hash,
  lockProjectMutation,
} from './core.js';
import type { LocalPrivateStorage } from './storage.js';
import {
  appendArtworkRevision,
  createArtworkBranch,
  readArtworkRevision,
  replayHeadWrite,
  requireSourceAsset,
} from './revision-commands.js';

async function artworkProject(tx: Queryable, artworkId: string): Promise<string> {
  const row = (await tx.query('SELECT project_id FROM artworks WHERE id=$1 AND deleted_at IS NULL', [artworkId])).rows[0];
  if (!row) throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不存在');
  return row.project_id;
}

async function lockArtworkWrite(
  tx: Queryable,
  artworkId: string,
  actorId: string,
  authHash: string,
) {
  const projectId = await artworkProject(tx, artworkId);
  const project = await lockProjectMutation(tx, projectId, actorId, authHash);
  const artwork = (
    await tx.query('SELECT * FROM artworks WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR UPDATE', [
      artworkId,
      projectId,
    ])
  ).rows[0];
  if (!artwork) throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不存在');
  return { artwork, project };
}

const historyRecipeBudget = 4 * 1024 * 1024;

export function validatedRecipe(input: unknown) {
  try {
    return parseEditorRecipe(input);
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
      'SELECT * FROM artworks WHERE project_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC',
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
    const query = z
      .object({ source: z.enum(['upload', 'sketch']).default('upload') })
      .strict()
      .parse(req.query);
    await projectAccess(db, p.id, user.id, 'edit');
    const file = await req.file();
    if (!file) throw new HttpError(400, 'FILE_REQUIRED', '请选择图片');
    const stored = await storage.ingest(file);
    let committed = false;
    try {
      const asset = await transaction(db, async (tx) => {
        await lockAssetStorageKeys(tx, [stored.key]);
        const project = await projectAccess(tx, p.id, user.id, 'edit');
        const row = (
          await tx.query(
            'INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
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
              JSON.stringify({ kind: 'uploaded', declaredSource: query.source }),
            ],
          )
        ).rows[0]!;
        await emit(tx, project.space_id, p.id, 'asset.created', row.id);
        return assetDto(row);
      });
      committed = true;
      return reply.code(201).send({ asset });
    } finally {
      if (!committed) {
        try {
          await discardUnreferencedStorageKeys(db, [stored.key], (key) => storage.discard(key));
        } catch {
          // Preserve private bytes when commit/publication cannot be established.
          process.stderr.write('{"event":"upload_asset_cleanup_deferred"}\n');
        }
      }
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
  app.post('/v1/projects/:id/artworks', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z.object({ assetId: id, title, recipe: z.unknown() }).strict().parse(req.body);
    const recipe = validatedRecipe(body.recipe);
    const result = await transaction(db, async (tx) => {
      const project = await lockProjectMutation(
        tx,
        p.id,
        user.id,
        hash(req.cookies.xiutu_session ?? ''),
      );
      const saved = await createArtworkBranch(tx, {
        projectId: project.id,
        actorId: user.id,
        assetId: body.assetId,
        title: body.title,
        recipe,
        label: '初始版本',
      }).catch((error) => {
        if (error instanceof HttpError && error.code === 'SOURCE_UNAVAILABLE')
          throw new HttpError(400, 'ASSET_MISMATCH', '图片不属于该项目');
        throw error;
      });
      await emit(tx, project.space_id, p.id, 'artwork.created', saved.artwork.id);
      return { artwork: saved.artwork, revision: saved.revision };
    });
    return reply.code(201).send(result);
  });
  app.get('/v1/artworks/:id', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const projectId = await artworkProject(db, p.id);
    await projectAccess(db, projectId, user.id);
    const artwork = (
      await db.query(
        `SELECT a.*, to_jsonb(src) AS base_asset,
          CASE WHEN r.id IS NOT NULL THEN to_jsonb(r)||jsonb_build_object('asset_id',s.asset_id) END AS current_revision
        FROM artworks a
        LEFT JOIN assets src ON src.id=a.asset_id AND src.project_id=a.project_id AND src.deleted_at IS NULL
        LEFT JOIN revisions r ON r.id=a.head_revision_id AND r.artwork_id=a.id AND r.version=a.head_version
        LEFT JOIN revision_sources s ON s.revision_id=r.id
        WHERE a.id=$1 AND a.project_id=$2 AND a.deleted_at IS NULL`,
        [p.id, projectId],
      )
    ).rows[0];
    if (!artwork) throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不存在');
    if (
      artwork.head_revision_id &&
      (!artwork.base_asset || artwork.current_revision?.asset_id !== artwork.asset_id)
    )
      throw new HttpError(409, 'ARTWORK_HEAD_INCONSISTENT', '作品当前版本或来源不可用');
    return {
      artwork: artworkDto(artwork),
      asset: artwork.base_asset ? assetDto(artwork.base_asset) : null,
      revision: artwork.current_revision ? revisionDto(artwork.current_revision) : null,
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
        const recipe = 'recipe' in body ? validatedRecipe(body.recipe) : undefined;
        const requestDigest = digest(
          canonical({ method, id: p.id, body: recipe ? { ...body, recipe } : body }),
        );
        const result = await transaction(db, async (tx) => {
          const { artwork, project } = await lockArtworkWrite(
            tx,
            p.id,
            user.id,
            hash(req.cookies.xiutu_session ?? ''),
          );
          const replay = await replayHeadWrite(
            tx,
            artwork,
            user.id,
            body.expectedVersion,
            requestDigest,
          );
          if (replay) return { artwork: replay.artwork, revision: replay.revision, replayed: true };
          assertVersion(artwork.head_version, body.expectedVersion);
          const old = await readArtworkRevision(tx, artwork.id, artwork.head_revision_id);
          if (!old || old.asset_id !== artwork.asset_id)
            throw new HttpError(409, 'ARTWORK_HEAD_INCONSISTENT', '作品当前版本或来源不可用');
          const saved = await appendArtworkRevision(tx, {
            artwork,
            actorId: user.id,
            assetId: artwork.asset_id,
            recipe: recipe ?? old.recipe,
            title: 'title' in body ? body.title : artwork.title,
            label: 'label' in body ? body.label : '重命名',
            origin: { kind: method === 'POST' ? 'manual' : 'rename', requestDigest },
          });
          await emit(tx, project.space_id, project.id, 'artwork.revised', p.id);
          return { artwork: saved.artwork, revision: saved.revision, replayed: false };
        });
        return reply.code(method === 'POST' && !result.replayed ? 201 : 200).send(result);
      },
    });
  }
  app.get('/v1/artworks/:id/revisions', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const options = revisionHistoryQuerySchema.parse(req.query);
    const artwork = (
      await db.query('SELECT project_id,head_version FROM artworks WHERE id=$1 AND deleted_at IS NULL', [p.id])
    ).rows[0];
    if (!artwork) throw new HttpError(404, 'ARTWORK_NOT_FOUND', '作品不存在');
    await projectAccess(db, artwork.project_id, user.id);
    const summary = options.summary === 'true';
    const candidates = (
      await db.query(
        `SELECT r.id,r.version,CASE WHEN $4::boolean THEN 0 ELSE octet_length(r.recipe::text) END AS bytes
        FROM revisions r JOIN revision_sources s ON s.revision_id=r.id
        WHERE r.artwork_id=$1 AND r.version<=$2 AND ($3::int IS NULL OR r.version<$3)
        ORDER BY r.version DESC LIMIT $5`,
        [p.id, artwork.head_version, options.beforeVersion ?? null, summary, options.limit + 1],
      )
    ).rows;
    const selected: { id: string; version: number }[] = [];
    let recipeBytes = 0;
    for (const row of candidates.slice(0, options.limit)) {
      if (recipeBytes + row.bytes > historyRecipeBudget) {
        if (!selected.length)
          throw new HttpError(
            413,
            'HISTORY_RECIPE_BUDGET',
            '该版本配方超过列表预算，请读取摘要或单个版本',
          );
        break;
      }
      recipeBytes += row.bytes;
      selected.push(row);
    }
    const rows = selected.length
      ? (
          await db.query(
            `SELECT r.id,r.artwork_id,r.version,r.parent_id,r.label,r.author_id,r.created_at,
          r.origin_kind,r.source_revision_id,s.asset_id${summary ? '' : ',r.recipe'}
        FROM revisions r JOIN revision_sources s ON s.revision_id=r.id
        WHERE r.artwork_id=$1 AND r.id=ANY($2::uuid[]) ORDER BY r.version DESC`,
            [p.id, selected.map((item) => item.id)],
          )
        ).rows
      : [];
    return {
      revisions: rows.map(revisionDto),
      page: {
        headVersion: artwork.head_version,
        nextBeforeVersion:
          candidates.length > selected.length ? (selected.at(-1)?.version ?? null) : null,
      },
    };
  });
  app.get('/v1/artworks/:id/revisions/:revisionId', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id, revisionId: id }).parse(req.params);
    const row = (
      await db.query(
        'SELECT r.*,a.project_id,s.asset_id FROM revisions r JOIN artworks a ON a.id=r.artwork_id JOIN revision_sources s ON s.revision_id=r.id WHERE r.id=$1 AND r.artwork_id=$2 AND a.deleted_at IS NULL',
        [p.revisionId, p.id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'REVISION_NOT_FOUND', '版本不存在');
    await projectAccess(db, row.project_id, user.id);
    const asset = (
      await db.query('SELECT * FROM assets WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL', [
        row.asset_id,
        row.project_id,
      ])
    ).rows[0];
    if (!asset) throw new HttpError(409, 'SOURCE_UNAVAILABLE', '此历史版本的源图片不可用');
    return { revision: revisionDto(row), asset: assetDto(asset) };
  });
  app.post('/v1/artworks/:id/source', async (req, reply) => {
    const user = requireUser(req);
    const params = z.object({ id }).parse(req.params);
    const body = replaceArtworkSourceSchema.parse(req.body);
    const requestDigest = digest(canonical({ kind: 'replace-source', artworkId: params.id, body }));
    const result = await transaction(db, async (tx) => {
      const { artwork, project } = await lockArtworkWrite(
        tx,
        params.id,
        user.id,
        hash(req.cookies.xiutu_session ?? ''),
      );
      const replay = await replayHeadWrite(
        tx,
        artwork,
        user.id,
        body.expectedVersion,
        requestDigest,
      );
      if (replay) return { ...replay, replayed: true };
      assertVersion(artwork.head_version, body.expectedVersion);
      if (artwork.asset_id === body.assetId)
        throw new HttpError(409, 'SOURCE_UNCHANGED', '这张图片已是当前底图');
      const nextSource = await requireSourceAsset(tx, artwork.project_id, body.assetId);
      const limits = localEditorSourceLimits(4);
      if (
        nextSource.width * nextSource.height > limits.maxPixels ||
        Math.max(nextSource.width, nextSource.height) > limits.maxDimension
      )
        throw new HttpError(
          413,
          'SOURCE_EDITOR_BUDGET',
          '素材超出当前编辑规格，请先准备较小的工作副本',
        );
      let recipe = createRecipeV4();
      if (body.mode === 'carry-color') {
        const head = await readArtworkRevision(tx, artwork.id, artwork.head_revision_id);
        if (!head || head.asset_id !== artwork.asset_id)
          throw new HttpError(409, 'ARTWORK_HEAD_INCONSISTENT', '作品当前版本或来源不可用');
        const prior = migrateRecipeToV4(validatedRecipe(head.recipe));
        recipe = createRecipeV4({
          adjustments: { ...prior.adjustments, sharpness: 0, soften: 0 },
          curves: prior.curves,
          levels: prior.levels,
          hsl: prior.hsl,
          grading: prior.grading,
        });
      }
      const saved = await appendArtworkRevision(tx, {
        artwork,
        actorId: user.id,
        assetId: body.assetId,
        recipe,
        label: body.mode === 'carry-color' ? '更换底图并沿用全局调色' : '更换底图',
        origin: { kind: 'manual', requestDigest },
      });
      await emit(tx, project.space_id, project.id, 'artwork.revised', artwork.id);
      await audit(tx, user.id, 'artwork.replace-source', 'revision', saved.revision.id, {
        artworkId: artwork.id,
        mode: body.mode,
      });
      return { ...saved, replayed: false };
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
  app.post('/v1/artworks/:id/restore', async (req, reply) => {
    const user = requireUser(req);
    const params = z.object({ id }).parse(req.params);
    const body = z
      .object({ revisionId: id, expectedVersion: z.number().int().positive() })
      .strict()
      .parse(req.body);
    const requestDigest = digest(canonical({ kind: 'restore', artworkId: params.id, body }));
    const result = await transaction(db, async (tx) => {
      const { artwork, project } = await lockArtworkWrite(
        tx,
        params.id,
        user.id,
        hash(req.cookies.xiutu_session ?? ''),
      );
      const replay = await replayHeadWrite(
        tx,
        artwork,
        user.id,
        body.expectedVersion,
        requestDigest,
      );
      if (replay) return { ...replay, replayed: true };
      assertVersion(artwork.head_version, body.expectedVersion);
      const original = await readArtworkRevision(tx, artwork.id, body.revisionId);
      if (!original) throw new HttpError(404, 'REVISION_NOT_FOUND', '版本不属于此作品');
      const saved = await appendArtworkRevision(tx, {
        artwork,
        actorId: user.id,
        recipe: validatedRecipe(original.recipe),
        assetId: original.asset_id,
        label: `恢复版本 ${original.version}`,
        origin: { kind: 'restore', sourceRevisionId: original.id, requestDigest },
      });
      await emit(tx, project.space_id, project.id, 'artwork.revised', artwork.id);
      await audit(tx, user.id, 'artwork.restore', 'revision', saved.revision.id, {
        sourceRevisionId: original.id,
        artworkId: artwork.id,
      });
      return { ...saved, replayed: false };
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
  app.post('/v1/artworks/:id/fork-revision', async (req, reply) => {
    const user = requireUser(req);
    const params = z.object({ id }).parse(req.params);
    const body = forkRevisionSchema.parse(req.body);
    const requestDigest = digest(canonical({ artworkId: params.id, body }));
    const result = await transaction(db, async (tx) => {
      const { project } = await lockArtworkWrite(
        tx, params.id, user.id, hash(req.cookies.xiutu_session ?? ''),
      );
      const projectId = project.id;
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `history-fork:${user.id}:${body.idempotencyKey}`,
      ]);
      const prior = (
        await tx.query(
          `SELECT r.*,s.asset_id,to_jsonb(a) AS branch FROM revisions r
          JOIN artworks a ON a.id=r.artwork_id JOIN revision_sources s ON s.revision_id=r.id
          WHERE r.author_id=$1 AND r.origin_kind='history-fork' AND r.origin_ref=$2`,
          [user.id, body.idempotencyKey],
        )
      ).rows[0];
      if (prior) {
        if (prior.branch.deleted_at)
          throw new HttpError(409, 'FORK_TARGET_UNAVAILABLE', '此分支已移入回收站');
        if (prior.request_digest !== requestDigest || prior.branch.project_id !== projectId)
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '此操作标识已用于其他分支');
        const asset = await requireSourceAsset(tx, projectId, prior.asset_id);
        return {
          artwork: artworkDto({
            ...prior.branch,
            title: body.title,
            asset_id: prior.asset_id,
            head_version: prior.version,
            head_revision_id: prior.id,
            updated_at: prior.created_at,
          }),
          revision: revisionDto(prior),
          asset: assetDto(asset),
          replayed: true,
        };
      }
      const original = await readArtworkRevision(tx, params.id, body.revisionId);
      if (!original) throw new HttpError(404, 'REVISION_NOT_FOUND', '版本不属于此作品');
      const saved = await createArtworkBranch(tx, {
        projectId,
        actorId: user.id,
        assetId: original.asset_id,
        recipe: validatedRecipe(original.recipe),
        title: body.title,
        label: `从版本 ${original.version} 创建分支`,
        origin: {
          kind: 'history-fork',
          sourceRevisionId: original.id,
          operationId: body.idempotencyKey,
          requestDigest,
        },
      });
      await emit(tx, project.space_id, project.id, 'artwork.created', saved.artwork.id);
      await audit(tx, user.id, 'artwork.fork-revision', 'revision', saved.revision.id, {
        sourceRevisionId: original.id,
        artworkId: saved.artwork.id,
      });
      return { ...saved, replayed: false };
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
}
