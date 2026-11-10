import { audit, emit, claimAssistantGrant, type Queryable } from '@ai-xiutu/db';
import { parseEditorRecipe } from '@ai-xiutu/editor';
import { recipeHash, needsNativeSpatialCheck } from '@ai-xiutu/assistant';
import { HttpError } from '../core.js';
import { appendArtworkRevision } from '../revision-commands.js';
import { lockedAssistantAccess } from './context.js';

/** One authority for browser retry and durable, server-side automatic execution.
 * Must run in a transaction. No model call or retry occurs in this function. */
export async function applyAuthorizedCandidate(
  tx: Queryable,
  input: {
    candidateId: string;
    actorId: string;
    expectedVersion?: number;
    recipe?: unknown;
    requireSavedBase?: boolean;
  },
) {
  const { candidateId, actorId } = input;
  const hint = (
    await tx.query(
      `SELECT c.project_id,COALESCE(t.config->'historyScope',t.scope,v.scope) AS access_scope,
    COALESCE(t.scope,v.scope) AS execution_scope
    FROM assistant_candidates c LEFT JOIN assistant_turns t ON t.id=c.turn_id LEFT JOIN voice_sessions v ON v.id=c.voice_id
    WHERE c.id=$1 AND c.actor_id=$2`,
      [candidateId, actorId],
    )
  ).rows[0];
  if (!hint) throw new HttpError(404, 'CANDIDATE_NOT_FOUND', '候选不存在或无权访问');
  const access = await lockedAssistantAccess(tx, actorId, hint.project_id, hint.access_scope);
  const row = (
    await tx.query('SELECT * FROM assistant_candidates WHERE id=$1 AND actor_id=$2 FOR UPDATE', [
      candidateId,
      actorId,
    ])
  ).rows[0]!;
  if (row.applied_revision_id)
    return { artworkId: row.artwork_id, revisionId: row.applied_revision_id, replayed: true };
  if (
    row.kind !== 'edit' ||
    row.decision === 'rejected' ||
    new Date(row.expires_at).getTime() <= Date.now()
  )
    throw new HttpError(409, 'CANDIDATE_UNAVAILABLE', '此候选不能自动执行');
  if (
    row.payload.baseRecipe &&
    needsNativeSpatialCheck(
      parseEditorRecipe(row.payload.baseRecipe),
      parseEditorRecipe(row.payload.recipe),
    ) &&
    (row.payload.observation?.fullResolutionChecked !== true ||
      row.payload.observation?.inspectedRecipeHash !== recipeHash(row.payload.recipe))
  )
    throw new HttpError(
      409,
      'NATIVE_PIXEL_CHECK_REQUIRED',
      '局部修复或质感候选尚未通过原尺寸渲染检查，请先检查或预览确认',
    );
  const grantId = hint.execution_scope?.executionGrantId;
  if (!grantId) throw new HttpError(403, 'AUTOMATIC_GRANT_REQUIRED', '自动执行需要有效授权');
  await claimAssistantGrant(tx, {
    grantId,
    actorId,
    projectId: row.project_id,
    key: `candidate:${candidateId}`,
    action: 'edit',
    modelId: '',
    units: 0,
    automatic: true,
  });
  const artwork = (
    await tx.query('SELECT * FROM artworks WHERE id=$1 AND project_id=$2 FOR UPDATE', [
      row.artwork_id,
      row.project_id,
    ])
  ).rows[0];
  // A voice session may have accepted a newer context or a different artwork.
  // Its opening snapshot is not the candidate's source. Resolve the immutable
  // revision that was current when THIS candidate was created, for old and new rows.
  const base = (
    await tx.query(
      `SELECT r.recipe,s.asset_id FROM revisions r
      JOIN revision_sources s ON s.revision_id=r.id
      WHERE r.artwork_id=$1 AND r.version=$2`,
      [row.artwork_id, row.base_version],
    )
  ).rows[0];
  if (
    !artwork ||
    !base ||
    artwork.head_version !== row.base_version ||
    (input.expectedVersion !== undefined && input.expectedVersion !== row.base_version) ||
    (input.recipe !== undefined && recipeHash(input.recipe) !== row.base_recipe_hash) ||
    artwork.asset_id !== base.asset_id
  )
    throw new HttpError(409, 'CANDIDATE_STALE', '图片或本地参数已变化，自动执行已停止');
  if (input.requireSavedBase) {
    if (recipeHash(base.recipe) !== row.base_recipe_hash)
      throw new HttpError(
        409,
        'AUTOMATIC_UNSAVED_BASE',
        '本轮包含未保存参数，请先预览确认或保存后继续自动执行',
      );
  }
  // The shared revision trigger rejects all conflicting collaboration leases.
  const saved = await appendArtworkRevision(tx, {
    artwork,
    actorId,
    assetId: artwork.asset_id,
    recipe: parseEditorRecipe(row.payload.recipe),
    label: 'AI 授权自动编辑（可从历史恢复）',
  });
  await tx.query(
    "UPDATE assistant_candidates SET decision='previewed',applied_revision_id=$2 WHERE id=$1",
    [candidateId, saved.revision.id],
  );
  await audit(tx, actorId, 'assistant.candidate.applied', 'artwork', artwork.id, {
    candidateId,
    grantId,
    revisionId: saved.revision.id,
  });
  await emit(tx, access.space_id, row.project_id, 'artwork.revised', artwork.id);
  return { artworkId: artwork.id, revisionId: saved.revision.id, replayed: false };
}
