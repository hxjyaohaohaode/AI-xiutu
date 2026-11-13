import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, audit, emit, type Database } from '@ai-xiutu/db';
import { parseEditorRecipe } from '@ai-xiutu/editor';
import { remapRecipeReferences } from './recipe-references.js';
import { createArtworkBranch } from './revision-commands.js';
import { prepareAuthorizedMediaCopies } from './media-copy.js';
import {
  HttpError,
  id,
  title,
  phoneSchema,
  requireUser,
  spaceRole,
  projectAccess,
  projectDto,
  maskPhone,
  hash,
} from './core.js';

export const sharingPolicy = z
  .object({
    allowReference: z.boolean(),
    allowCopy: z.boolean(),
    maxActiveGrants: z.number().int().min(0).max(100),
    maxCopyAssets: z.number().int().min(0).max(100),
  })
  .strict();
export function registerSharing(app: FastifyInstance, db: Database): void {
  app.get('/v1/spaces/:id/sharing-policy', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await spaceRole(db, p.id, user.id);
    return {
      policy: (await db.query('SELECT sharing_policy FROM spaces WHERE id=$1', [p.id])).rows[0]!
        .sharing_policy,
    };
  });
  app.put('/v1/spaces/:id/sharing-policy', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const policy = sharingPolicy.parse(req.body);
    await transaction(db, async (tx) => {
      await spaceRole(tx, p.id, user.id, ['owner', 'admin']);
      await tx.query('UPDATE spaces SET sharing_policy=$2 WHERE id=$1', [
        p.id,
        JSON.stringify(policy),
      ]);
      await audit(tx, user.id, 'sharing.policy', 'space', p.id, policy);
      await emit(tx, p.id, null, 'sharing.policy', p.id);
    });
    return { policy };
  });
  app.get('/v1/projects/:id/grants', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    await projectAccess(db, p.id, user.id, 'admin');
    const rows = (
      await db.query(
        'SELECT g.*,u.display_name,u.phone FROM share_grants g JOIN users u ON u.id=g.target_user_id WHERE project_id=$1 ORDER BY created_at DESC',
        [p.id],
      )
    ).rows;
    return {
      grants: rows.map((g) => ({
        id: g.id,
        projectId: g.project_id,
        targetUserId: g.target_user_id,
        targetName: g.display_name,
        phoneMasked: maskPhone(g.phone),
        mode: g.mode,
        expiresAt: g.expires_at,
        revokedAt: g.revoked_at,
        copiedProjectId: g.copied_project_id,
        createdAt: g.created_at,
      })),
    };
  });
  app.post('/v1/projects/:id/grants', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({
        targetPhone: phoneSchema,
        mode: z.enum(['reference', 'copy']),
        expiresInDays: z.number().int().min(1).max(30).default(7),
      })
      .strict()
      .parse(req.body);
    const grant = await transaction(db, async (tx) => {
      const project = await projectAccess(tx, p.id, user.id, 'admin');
      const space = (
        await tx.query('SELECT sharing_policy FROM spaces WHERE id=$1 FOR UPDATE', [
          project.space_id,
        ])
      ).rows[0]!;
      const policy = sharingPolicy.parse(space.sharing_policy);
      if (
        (body.mode === 'reference' && !policy.allowReference) ||
        (body.mode === 'copy' && !policy.allowCopy)
      )
        throw new HttpError(403, 'SHARING_DISABLED', '空间策略尚未允许此分享方式');
      const count = (
        await tx.query(
          'SELECT count(*) FROM share_grants g JOIN projects p ON p.id=g.project_id WHERE p.space_id=$1 AND g.revoked_at IS NULL AND g.expires_at>clock_timestamp()',
          [project.space_id],
        )
      ).rows[0]!;
      if (Number(count.count) >= policy.maxActiveGrants)
        throw new HttpError(409, 'SHARE_CAP_REACHED', '有效分享数已达空间上限');
      const target = (
        await tx.query("SELECT id FROM users WHERE phone=$1 AND status='active'", [
          body.targetPhone,
        ])
      ).rows[0];
      if (!target)
        throw new HttpError(
          400,
          'SHARE_TARGET_UNAVAILABLE',
          '无法向该账号发出邀请，请确认对方已注册',
        );
      if (target.id === user.id)
        throw new HttpError(400, 'INVALID_SHARE_TARGET', '无需向自己创建分享');
      const row = (
        await tx.query(
          'INSERT INTO share_grants(project_id,target_user_id,mode,expires_at,created_by) VALUES($1,$2,$3,clock_timestamp()+($4::text||\' days\')::interval,$5) RETURNING id,mode,expires_at AS "expiresAt",target_user_id AS "targetUserId"',
          [p.id, target.id, body.mode, body.expiresInDays, user.id],
        )
      ).rows[0]!;
      await audit(tx, user.id, 'sharing.grant', 'project', p.id, {
        grantId: row.id,
        targetUserId: target.id,
        mode: body.mode,
      });
      await emit(tx, project.space_id, p.id, 'sharing.changed', row.id);
      return row;
    });
    return reply.code(201).send({ grant });
  });
  app.delete('/v1/projects/:id/grants/:grantId', async (req) => {
    const user = requireUser(req);
    const p = z.object({ id, grantId: id }).parse(req.params);
    await transaction(db, async (tx) => {
      const project = await projectAccess(tx, p.id, user.id, 'admin');
      await tx.query(
        'UPDATE share_grants SET revoked_at=clock_timestamp() WHERE id=$1 AND project_id=$2',
        [p.grantId, p.id],
      );
      await audit(tx, user.id, 'sharing.revoke', 'grant', p.grantId);
      await emit(tx, project.space_id, p.id, 'sharing.revoked', p.grantId);
    });
    return { ok: true };
  });
  app.post('/v1/projects/:id/copy', async (req, reply) => {
    const user = requireUser(req);
    const p = z.object({ id }).parse(req.params);
    const body = z
      .object({
        title: title.optional(),
        targetSpaceId: id.optional(),
        idempotencyKey: z.string().min(8).max(128).optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const project = await transaction(db, async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      const source = await projectAccess(tx, p.id, user.id);
      const policy = sharingPolicy.parse(
        (
          await tx.query('SELECT sharing_policy FROM spaces WHERE id=$1 FOR SHARE', [
            source.space_id,
          ])
        ).rows[0]!.sharing_policy,
      );
      if (!policy.allowCopy) throw new HttpError(403, 'COPY_DISABLED', '来源空间不允许复制');
      const ownSource = ['owner', 'admin'].includes(source.role);
      const grant = ownSource
        ? null
        : (
            await tx.query(
              "SELECT * FROM share_grants WHERE project_id=$1 AND target_user_id=$2 AND mode='copy' AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
              [p.id, user.id],
            )
          ).rows[0];
      if (!ownSource && !grant)
        throw new HttpError(403, 'COPY_GRANT_REQUIRED', '需要当前有效的复制授权');
      if (ownSource && !body.idempotencyKey)
        throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', '跨空间复制需要唯一操作标识');
      const destination = body.targetSpaceId
        ? { id: body.targetSpaceId }
        : (await tx.query("SELECT id FROM spaces WHERE kind='personal' AND owner_id=$1", [user.id]))
            .rows[0]!;
      await spaceRole(tx, destination.id, user.id, ['owner', 'admin', 'editor']);
      const requestHash = hash(
        JSON.stringify({
          sourceProjectId: p.id,
          targetSpaceId: destination.id,
          title: body.title ?? null,
        }),
      );
      if (body.idempotencyKey) {
        await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `copy:${user.id}:${body.idempotencyKey}`,
        ]);
        const prior = (
          await tx.query('SELECT * FROM project_copies WHERE actor_id=$1 AND idempotency_key=$2', [
            user.id,
            body.idempotencyKey,
          ])
        ).rows[0];
        if (prior) {
          if (prior.request_hash !== requestHash)
            throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '此复制标识已用于其他请求');
          return projectDto(await projectAccess(tx, prior.copied_project_id, user.id));
        }
      }
      if (
        grant &&
        (
          await tx.query('SELECT copy_id FROM asset_copy_requests WHERE grant_id=$1 LIMIT 1', [
            grant.id,
          ])
        ).rowCount
      )
        throw new HttpError(
          409,
          'COPY_ALREADY_USED',
          '此授权已用于复制素材到指定项目；完整项目复制需要另一个授权',
        );
      if (grant?.copied_project_id) {
        const prior = await projectAccess(tx, grant.copied_project_id, user.id);
        if (prior.space_id !== destination.id)
          throw new HttpError(409, 'COPY_ALREADY_USED', '此授权已复制到另一个空间');
        return projectDto(prior);
      }
      const assets = (
        await tx.query(
          'SELECT * FROM assets WHERE project_id=$1 AND deleted_at IS NULL ORDER BY id FOR SHARE',
          [p.id],
        )
      ).rows;
      if (assets.length > policy.maxCopyAssets)
        throw new HttpError(409, 'COPY_CAP_REACHED', '源项目的资源数超过复制上限');
      const row = (
        await tx.query(
          'INSERT INTO projects(space_id,title,description,created_by) VALUES($1,$2,$3,$4) RETURNING *',
          [
            destination.id,
            body.title ?? `${source.title.slice(0, 110)}（副本）`,
            source.description,
            user.id,
          ],
        )
      ).rows[0]!;
      const assetMap = new Map<string, string>();
      const mediaCopy = await prepareAuthorizedMediaCopies(tx, {
        actorId: user.id,
        sourceProjectId: source.id,
        targetProjectId: row.id,
        sourceAssetIds: assets.map((asset) => String(asset.id)),
        grantId: grant?.id ?? null,
      });
      for (const a of assets) {
        const copied = (
          await tx.query(
            'INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,provenance,created_by,annotations) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',
            [
              row.id,
              a.name,
              a.storage_key,
              a.mime,
              a.width,
              a.height,
              a.bytes,
              a.content_hash,
              JSON.stringify({
                ...a.provenance,
                copiedFrom: { assetId: a.id, projectId: p.id, contentHash: a.content_hash },
              }),
              user.id,
              JSON.stringify(a.annotations ?? {}),
            ],
          )
        ).rows[0]!;
        await mediaCopy.link(a.id, copied.id);
        assetMap.set(a.id, copied.id);
      }
      const arts = (
        await tx.query(
          'SELECT a.*,r.recipe FROM artworks a JOIN revisions r ON r.id=a.head_revision_id WHERE a.project_id=$1 AND a.deleted_at IS NULL ORDER BY a.id FOR SHARE OF a',
          [p.id],
        )
      ).rows;
      for (const a of arts) {
        const assetId = assetMap.get(a.asset_id);
        if (!assetId) throw new HttpError(409, 'COPY_SOURCE_CHANGED', '源资源已改变，请刷新');
        const recipe = remapRecipeReferences(parseEditorRecipe(a.recipe), assetMap);
        await createArtworkBranch(tx, {
          projectId: row.id,
          actorId: user.id,
          assetId,
          title: a.title,
          recipe,
          label: '授权复制的当前版本',
          origin: { kind: 'project-copy' },
        });
      }
      const docs = (
        await tx.query('SELECT * FROM documents WHERE project_id=$1 ORDER BY id FOR SHARE', [p.id])
      ).rows;
      for (const d of docs) {
        const doc = (
          await tx.query(
            'INSERT INTO documents(project_id,title,body,author_id) VALUES($1,$2,$3,$4) RETURNING id',
            [row.id, d.title, d.body, user.id],
          )
        ).rows[0]!;
        await tx.query(
          'INSERT INTO document_versions(document_id,version,title,body,author_id) VALUES($1,1,$2,$3,$4)',
          [doc.id, d.title, d.body, user.id],
        );
      }
      if (grant)
        await tx.query('UPDATE share_grants SET copied_project_id=$2 WHERE id=$1', [
          grant.id,
          row.id,
        ]);
      if (body.idempotencyKey)
        await tx.query(
          'INSERT INTO project_copies(actor_id,idempotency_key,source_project_id,target_space_id,copied_project_id,request_hash) VALUES($1,$2,$3,$4,$5,$6)',
          [user.id, body.idempotencyKey, p.id, destination.id, row.id, requestHash],
        );
      await audit(tx, user.id, 'sharing.copy', 'project', row.id, {
        sourceProjectId: p.id,
        grantId: grant?.id ?? null,
        assetCount: assets.length,
      });
      await emit(tx, destination.id, row.id, 'project.created', row.id);
      if (
        grant &&
        !(
          await tx.query(
            'SELECT id FROM share_grants WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',
            [grant.id],
          )
        ).rowCount
      )
        throw new HttpError(403, 'COPY_GRANT_REQUIRED', '复制授权已到期，本次复制未提交');
      return projectDto({ ...row, role: await spaceRole(tx, destination.id, user.id) });
    });
    return reply.code(201).send({ project });
  });
}
