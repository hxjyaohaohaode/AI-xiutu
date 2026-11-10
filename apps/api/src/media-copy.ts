import { audit, type Queryable } from '@ai-xiutu/db';
import { HttpError, projectAccess } from './core.js';

/** A media original is an authorization-bearing object, not a consequence of
 * identical proxy bytes. Only these explicit, already-authorized copy routes
 * may create a destination link. Acquire all object locks before asset inserts
 * take the destination storage-account lock. */
export async function prepareAuthorizedMediaCopies(
  tx: Queryable,
  context: {
    actorId: string;
    sourceProjectId: string;
    targetProjectId: string;
    sourceAssetIds: readonly string[];
    grantId: string | null;
  },
) {
  const source = await projectAccess(tx, context.sourceProjectId, context.actorId);
  const target = await projectAccess(tx, context.targetProjectId, context.actorId, 'edit');
  // Copying a project uses a repeatable-read snapshot. A concurrent soft delete
  // must either follow this authorized copy or invalidate that snapshot, never
  // silently publish a new copy after its source was already withdrawn.
  for (const projectId of [...new Set([source.id, target.id])].sort()) {
    if (
      !(
        await tx.query('SELECT id FROM projects WHERE id=$1 AND deleted_at IS NULL FOR SHARE', [
          projectId,
        ])
      ).rowCount
    )
      throw new HttpError(409, 'COPY_SOURCE_CHANGED', '来源或目标项目已不可用');
  }
  const policy = (
    await tx.query('SELECT sharing_policy FROM spaces WHERE id=$1 FOR SHARE', [source.space_id])
  ).rows[0]?.sharing_policy;
  if (policy?.allowCopy !== true) throw new HttpError(403, 'COPY_DISABLED', '来源空间不允许复制');
  const targetMember = await tx.query(
    "SELECT m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.space_id=$1 AND m.user_id=$2 AND m.role IN ('owner','admin','editor') AND u.status='active' FOR SHARE OF m,u",
    [target.space_id, context.actorId],
  );
  if (!targetMember.rowCount)
    throw new HttpError(403, 'PROJECT_FORBIDDEN', '目标项目编辑权限已变化');
  if (context.grantId) {
    if (
      !(
        await tx.query(
          "SELECT id FROM share_grants WHERE id=$1 AND project_id=$2 AND target_user_id=$3 AND mode='copy' AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE",
          [context.grantId, source.id, context.actorId],
        )
      ).rowCount
    )
      throw new HttpError(403, 'COPY_GRANT_REQUIRED', '复制授权已失效');
  } else if (
    !(
      await tx.query(
        "SELECT role FROM memberships WHERE space_id=$1 AND user_id=$2 AND role IN ('owner','admin') FOR SHARE",
        [source.space_id, context.actorId],
      )
    ).rowCount
  ) {
    throw new HttpError(403, 'COPY_GRANT_REQUIRED', '来源空间需要明确复制授权');
  }
  const sourceIds = [...new Set(context.sourceAssetIds)].sort();
  const assets = (
    await tx.query(
      'SELECT id FROM assets WHERE project_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL FOR SHARE',
      [source.id, sourceIds],
    )
  ).rows;
  if (assets.length !== sourceIds.length)
    throw new HttpError(409, 'COPY_SOURCE_CHANGED', '来源素材已改变');
  const existing = (
    await tx.query(
      'SELECT m.asset_id,m.object_id FROM media_sources m JOIN media_objects o ON o.id=m.object_id WHERE m.asset_id=ANY($1::uuid[]) AND m.released_at IS NULL AND o.purged_at IS NULL',
      [sourceIds],
    )
  ).rows;
  for (const objectId of [...new Set(existing.map((row) => String(row.object_id)))].sort())
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `media-object:${objectId}`,
    ]);
  const retained = (
    await tx.query(
      'SELECT m.asset_id,m.object_id,m.retained_bytes FROM media_sources m JOIN media_objects o ON o.id=m.object_id WHERE m.asset_id=ANY($1::uuid[]) AND m.released_at IS NULL AND o.purged_at IS NULL FOR SHARE OF m,o',
      [sourceIds],
    )
  ).rows;
  if (
    retained.length !== existing.length ||
    retained.some(
      (row) =>
        !existing.some((old) => old.asset_id === row.asset_id && old.object_id === row.object_id),
    )
  )
    throw new HttpError(409, 'COPY_SOURCE_CHANGED', '原件保留状态已变化，请刷新后重试');
  const sources = new Map(retained.map((row) => [String(row.asset_id), row]));
  const allowedIds = new Set(sourceIds);
  return {
    async link(sourceAssetId: string, targetAssetId: string): Promise<boolean> {
      if (!allowedIds.has(sourceAssetId)) throw new Error('Unauthorized media copy source');
      const original = sources.get(sourceAssetId);
      if (!original) return false;
      // Explicit source id authorizes the original. Hash equality is only an
      // integrity check on this specific copy; it never discovers an original.
      const valid = await tx.query(
        `SELECT b.id FROM assets a JOIN assets b ON b.id=$2
        WHERE a.id=$1 AND a.project_id=$3 AND b.project_id=$4 AND a.deleted_at IS NULL AND b.deleted_at IS NULL
          AND b.storage_key=a.storage_key AND b.content_hash=a.content_hash AND b.bytes=a.bytes`,
        [sourceAssetId, targetAssetId, source.id, target.id],
      );
      if (!valid.rowCount)
        throw new HttpError(409, 'COPY_SOURCE_CHANGED', '目标素材与明确授权的来源不一致');
      await tx.query(
        'INSERT INTO media_sources(asset_id,object_id,retained_bytes) VALUES($1,$2,$3)',
        [targetAssetId, original.object_id, original.retained_bytes],
      );
      await audit(tx, context.actorId, 'asset.media_copy', 'asset', targetAssetId, {
        sourceAssetId,
        sourceProjectId: source.id,
        mediaObjectId: original.object_id,
        retainedBytes: Number(original.retained_bytes),
        grantId: context.grantId,
      });
      return true;
    },
  };
}
