import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { transaction, audit, emit, type Database, type Queryable } from '@ai-xiutu/db';
import {
  assetCopyRequestSchema,
  type AssetCopyRecord,
  type StorageAccountSummary,
} from '@ai-xiutu/contracts';
import {
  HttpError,
  id,
  reason,
  hash,
  requireUser,
  requireOperator,
  projectAccess,
  spaceRole,
  assetDto,
  assertVersion,
} from './core.js';
import { sharingPolicy } from './sharing.js';

async function storageAccount(tx: Queryable, spaceId: string) {
  if (!(await tx.query('SELECT id FROM spaces WHERE id=$1', [spaceId])).rowCount)
    throw new HttpError(404, 'SPACE_NOT_FOUND', '空间不存在');
  await tx.query('INSERT INTO space_storage_accounts(space_id) VALUES($1) ON CONFLICT DO NOTHING', [
    spaceId,
  ]);
  return (await tx.query('SELECT * FROM space_storage_accounts WHERE space_id=$1', [spaceId]))
    .rows[0]!;
}
const storageDto = (row: Record<string, any>): StorageAccountSummary => ({
  spaceId: row.space_id,
  version: row.version,
  maxBytes: Number(row.max_bytes),
  maxAssets: Number(row.max_assets),
  retainedBytes: Number(row.retained_bytes),
  retainedAssets: Number(row.retained_assets),
  accounting: 'retained-logical-assets' as const,
  softDeleteReclaimsCapacity: false,
});
const copyDto = (row: Record<string, any>): AssetCopyRecord => ({
  id: row.id,
  sourceAssetId: row.source_asset_id,
  sourceProjectId: row.source_project_id,
  targetProjectId: row.target_project_id,
  copiedAssetId: row.copied_asset_id,
  createdAt: row.created_at,
});

export function registerAssetCopy(app: FastifyInstance, db: Database): void {
  app.get('/v1/spaces/:id/storage', async (req) => {
    const user = requireUser(req);
    const params = z.object({ id }).parse(req.params);
    await spaceRole(db, params.id, user.id);
    return { storage: storageDto(await storageAccount(db, params.id)) };
  });
  app.get('/v1/ops/spaces/:id/storage', async (req) => {
    const actor = requireOperator(req);
    const params = z.object({ id }).parse(req.params);
    return transaction(db, async (tx) => {
      const storage = storageDto(await storageAccount(tx, params.id));
      await audit(tx, actor.id, 'operator.storage_view', 'space', params.id);
      return { storage };
    });
  });
  app.put('/v1/ops/spaces/:id/storage', async (req) => {
    const actor = requireOperator(req);
    const params = z.object({ id }).parse(req.params);
    const body = z
      .object({
        expectedVersion: z.number().int().positive(),
        maxBytes: z
          .number()
          .int()
          .min(0)
          .max(10 * 1024 ** 4),
        maxAssets: z.number().int().min(0).max(1_000_000),
        reason,
      })
      .strict()
      .parse(req.body);
    return transaction(db, async (tx) => {
      await storageAccount(tx, params.id);
      const current = (
        await tx.query('SELECT * FROM space_storage_accounts WHERE space_id=$1 FOR UPDATE', [
          params.id,
        ])
      ).rows[0]!;
      assertVersion(current.version, body.expectedVersion);
      const updated = (
        await tx.query(
          'UPDATE space_storage_accounts SET max_bytes=$2,max_assets=$3,version=version+1,updated_at=clock_timestamp() WHERE space_id=$1 RETURNING *',
          [params.id, body.maxBytes, body.maxAssets],
        )
      ).rows[0]!;
      await audit(tx, actor.id, 'operator.storage_policy', 'space', params.id, {
        oldMaxBytes: Number(current.max_bytes),
        oldMaxAssets: Number(current.max_assets),
        maxBytes: body.maxBytes,
        maxAssets: body.maxAssets,
        reason: body.reason,
      });
      await emit(tx, params.id, null, 'storage.policy', params.id);
      return { storage: storageDto(updated) };
    });
  });
  app.post('/v1/assets/:id/copy', async (req, reply) => {
    const user = requireUser(req);
    const params = z.object({ id }).parse(req.params);
    const body = assetCopyRequestSchema.parse(req.body);
    const requestHash = hash(
      JSON.stringify({ sourceAssetId: params.id, targetProjectId: body.targetProjectId }),
    );
    const result = await transaction(db, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `asset-copy-request:${user.id}:${body.idempotencyKey}`,
      ]);
      const previous = (
        await tx.query(
          'SELECT r.request_hash,c.* FROM asset_copy_requests r JOIN asset_copies c ON c.id=r.copy_id WHERE r.actor_id=$1 AND r.idempotency_key=$2',
          [user.id, body.idempotencyKey],
        )
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '此复制标识已用于其他素材或项目');
        // Completed independent copies remain owned by the destination. A retry
        // creates no new copy and requires current destination edit permission.
        await projectAccess(tx, previous.target_project_id, user.id, 'edit');
        const copied = (
          await tx.query(
            'SELECT * FROM assets WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL',
            [previous.copied_asset_id, previous.target_project_id],
          )
        ).rows[0];
        if (!copied)
          throw new HttpError(409, 'COPY_TARGET_UNAVAILABLE', '原复制已提交，但目标素材已不可用');
        return { asset: assetDto(copied), copy: copyDto(previous), replayed: true, reused: true };
      }
      const sourceAsset = (
        await tx.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [
          params.id,
        ])
      ).rows[0];
      if (!sourceAsset) throw new HttpError(404, 'ASSET_NOT_FOUND', '素材不存在或已删除');
      const source = await projectAccess(tx, sourceAsset.project_id, user.id);
      if (source.id === body.targetProjectId)
        throw new HttpError(400, 'SAME_PROJECT', '同项目素材可直接引用，不需要复制');
      if (
        !(
          await tx.query('SELECT id FROM projects WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [
            source.id,
          ])
        ).rowCount
      )
        throw new HttpError(404, 'PROJECT_NOT_FOUND', '来源项目已不可用');
      const policy = sharingPolicy.parse(
        (
          await tx.query('SELECT sharing_policy FROM spaces WHERE id=$1 FOR SHARE', [
            source.space_id,
          ])
        ).rows[0]!.sharing_policy,
      );
      if (!policy.allowCopy) throw new HttpError(403, 'COPY_DISABLED', '来源空间不允许复制');
      if (policy.maxCopyAssets < 1)
        throw new HttpError(409, 'COPY_CAP_REACHED', '来源空间未提供素材复制额度');
      const ownSource = ['owner', 'admin'].includes(source.role);
      let grant: Record<string, any> | null = null;
      if (ownSource) {
        const membership = (
          await tx.query(
            "SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2 AND role IN ('owner','admin') FOR SHARE",
            [source.space_id, user.id],
          )
        ).rows[0];
        if (!membership)
          throw new HttpError(403, 'COPY_GRANT_REQUIRED', '来源权限已变化，请刷新后重试');
      } else {
        grant =
          (
            await tx.query(
              "SELECT * FROM share_grants WHERE project_id=$1 AND target_user_id=$2 AND mode='copy' AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
              [source.id, user.id],
            )
          ).rows[0] ?? null;
        if (!grant) throw new HttpError(403, 'COPY_GRANT_REQUIRED', '需要当前有效的复制授权');
        if (grant.copied_project_id)
          throw new HttpError(
            409,
            'COPY_ALREADY_USED',
            '此授权已用于完整项目复制，请从已复制的项目取用素材',
          );
        const bound = (
          await tx.query(
            'SELECT DISTINCT c.target_project_id FROM asset_copy_requests r JOIN asset_copies c ON c.id=r.copy_id WHERE r.grant_id=$1',
            [grant.id],
          )
        ).rows;
        if (bound.some((item) => item.target_project_id !== body.targetProjectId))
          throw new HttpError(409, 'COPY_ALREADY_USED', '此授权已绑定另一个目标项目');
      }
      const target = await projectAccess(tx, body.targetProjectId, user.id, 'edit');
      if (
        !(
          await tx.query('SELECT id FROM projects WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [
            target.id,
          ])
        ).rowCount
      )
        throw new HttpError(404, 'PROJECT_NOT_FOUND', '目标项目已不可用');
      const targetMembership = (
        await tx.query(
          "SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2 AND role IN ('owner','admin','editor') FOR SHARE",
          [target.space_id, user.id],
        )
      ).rows[0];
      if (!targetMembership)
        throw new HttpError(403, 'PROJECT_FORBIDDEN', '目标项目编辑权限已变化');
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `asset-copy-pair:${source.id}:${target.id}`,
      ]);
      if (
        grant &&
        !(
          await tx.query(
            'SELECT id FROM share_grants WHERE id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()',
            [grant.id],
          )
        ).rowCount
      )
        throw new HttpError(403, 'COPY_GRANT_REQUIRED', '复制授权已到期，请重新申请');
      let copy = (
        await tx.query(
          'SELECT c.* FROM asset_copies c JOIN assets a ON a.id=c.copied_asset_id WHERE c.source_asset_id=$1 AND c.target_project_id=$2 AND a.deleted_at IS NULL ORDER BY c.created_at DESC,c.id DESC LIMIT 1',
          [sourceAsset.id, target.id],
        )
      ).rows[0];
      let copied: Record<string, any>;
      const reused = !!copy;
      if (copy)
        copied = (
          await tx.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [
            copy.copied_asset_id,
          ])
        ).rows[0]!;
      else {
        const count = Number(
          (
            await tx.query(
              'SELECT count(DISTINCT source_asset_id) AS n FROM asset_copies WHERE source_project_id=$1 AND target_project_id=$2',
              [source.id, target.id],
            )
          ).rows[0]!.n,
        );
        const previouslyCopied = (
          await tx.query(
            'SELECT id FROM asset_copies WHERE source_asset_id=$1 AND target_project_id=$2 LIMIT 1',
            [sourceAsset.id, target.id],
          )
        ).rowCount;
        if (!previouslyCopied && count >= policy.maxCopyAssets)
          throw new HttpError(409, 'COPY_CAP_REACHED', '此来源项目到目标项目的素材数已达复制上限');
        copied = (
          await tx.query(
            'INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,provenance,created_by,annotations) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
            [
              target.id,
              sourceAsset.name,
              sourceAsset.storage_key,
              sourceAsset.mime,
              sourceAsset.width,
              sourceAsset.height,
              sourceAsset.bytes,
              sourceAsset.content_hash,
              JSON.stringify({
                ...sourceAsset.provenance,
                copiedFrom: {
                  assetId: sourceAsset.id,
                  projectId: source.id,
                  contentHash: sourceAsset.content_hash,
                },
              }),
              user.id,
              JSON.stringify(sourceAsset.annotations ?? {}),
            ],
          )
        ).rows[0]!;
        copy = (
          await tx.query(
            'INSERT INTO asset_copies(source_asset_id,source_project_id,target_project_id,copied_asset_id,actor_id,grant_id,source_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [
              sourceAsset.id,
              source.id,
              target.id,
              copied.id,
              user.id,
              grant?.id ?? null,
              sourceAsset.content_hash,
            ],
          )
        ).rows[0]!;
        await emit(tx, target.space_id, target.id, 'asset.created', copied.id);
      }
      if (!copied)
        throw new HttpError(
          409,
          'COPY_TARGET_UNAVAILABLE',
          '目标素材已改变，请使用同一操作标识重试',
        );
      await tx.query(
        'INSERT INTO asset_copy_requests(actor_id,idempotency_key,request_hash,copy_id,grant_id) VALUES($1,$2,$3,$4,$5)',
        [user.id, body.idempotencyKey, requestHash, copy.id, grant?.id ?? null],
      );
      await audit(tx, user.id, 'asset.copy', 'asset-copy', copy.id, {
        sourceAssetId: sourceAsset.id,
        sourceProjectId: source.id,
        targetProjectId: target.id,
        copiedAssetId: copied.id,
        sourceHash: sourceAsset.content_hash,
        grantId: grant?.id ?? null,
        reused,
      });
      // Capacity/event locks may have waited after the earlier grant check.
      // A grant expiring during that wait must roll back this new publication.
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
      return { asset: assetDto(copied), copy: copyDto(copy), replayed: false, reused };
    });
    return reply.code(result.replayed || result.reused ? 200 : 201).send(result);
  });
}
