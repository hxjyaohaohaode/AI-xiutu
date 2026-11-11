import { audit, emit, claimAssistantGrant, QuotaError, type Queryable } from '@ai-xiutu/db';
import type { AssistantCandidate } from '@ai-xiutu/contracts';
import { parseEditorRecipe } from '@ai-xiutu/editor';
import { recipeHash, needsNativeSpatialCheck } from '@ai-xiutu/assistant';
import { HttpError } from '../core.js';
import { appendArtworkRevision } from '../revision-commands.js';
import { lockedAssistantAccess } from './context.js';

export async function executeAutomaticCandidate(
  tx: Queryable,
  options: {
    actorId: string;
    grantId?: string;
    authHash?: string;
    candidates: AssistantCandidate[];
    selectedIndex?: number;
    completed: boolean;
    imageShared: boolean;
  },
) {
  if (!options.grantId) return;
  const grant = (
    await tx.query('SELECT mode FROM assistant_grants WHERE id=$1 AND actor_id=$2', [
      options.grantId,
      options.actorId,
    ])
  ).rows[0];
  if (grant?.mode !== 'auto') return;
  const selected =
    options.selectedIndex === undefined ? undefined : options.candidates[options.selectedIndex];
  const edits =
    selected?.kind === 'edit'
      ? [selected]
      : options.candidates.filter(({ kind }) => kind === 'edit');
  if (!edits.length) return;
  if (!options.completed)
    return { state: 'review_required' as const, code: 'MODEL_TURN_INCOMPLETE' };
  if (options.imageShared && !selected)
    return { state: 'review_required' as const, code: 'CANDIDATE_REVIEW_REQUIRED' };
  if (edits.length !== 1)
    return { state: 'review_required' as const, code: 'ALTERNATIVE_CANDIDATES' };
  const candidate = edits[0]!;
  await tx.query('SAVEPOINT automatic_edit');
  try {
    const saved = await applyAuthorizedCandidate(tx, {
      candidateId: candidate.id,
      actorId: options.actorId,
      authHash: options.authHash,
      requireSavedBase: true,
    });
    await tx.query('RELEASE SAVEPOINT automatic_edit');
    candidate.decision = 'previewed';
    candidate.appliedRevisionId = saved.revisionId;
    return { state: 'applied' as const, candidateId: candidate.id, ...saved };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT automatic_edit');
    await tx.query('RELEASE SAVEPOINT automatic_edit');
    const code =
      error instanceof HttpError || error instanceof QuotaError
        ? error.code
        : error instanceof Error && error.message.includes('COLLABORATION_')
          ? 'COLLABORATION_LOCKED'
          : 'AUTOMATIC_EDIT_BLOCKED';
    return { state: 'blocked' as const, candidateId: candidate.id, code };
  }
}

export async function assertVoiceCandidateContext(
  tx: Queryable,
  row: {
    voice_id?: string | null;
    payload: { voiceContextEpoch?: number };
  },
) {
  if (!row.voice_id || row.payload.voiceContextEpoch === undefined) return;
  const voice = (
    await tx.query('SELECT context_epoch FROM voice_sessions WHERE id=$1 FOR SHARE', [row.voice_id])
  ).rows[0];
  if (voice?.context_epoch !== row.payload.voiceContextEpoch)
    throw new HttpError(409, 'VOICE_CONTEXT_CHANGED', '通话中的编辑画面已更新，请重新生成候选');
}

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
    confirmed?: boolean;
    authHash?: string;
  },
) {
  const { candidateId, actorId } = input;
  const hint = (
    await tx.query(
      `SELECT c.project_id,COALESCE(t.config->'historyScope',t.scope,v.config->'historyScope',v.scope) AS access_scope,
    COALESCE(t.scope,v.scope) AS execution_scope,
    COALESCE(t.model_id,v.backend_model_id) AS model_id
    FROM assistant_candidates c LEFT JOIN assistant_turns t ON t.id=c.turn_id LEFT JOIN voice_sessions v ON v.id=c.voice_id
    WHERE c.id=$1 AND c.actor_id=$2`,
      [candidateId, actorId],
    )
  ).rows[0];
  if (!hint) throw new HttpError(404, 'CANDIDATE_NOT_FOUND', '候选不存在或无权访问');
  const access = await lockedAssistantAccess(
    tx,
    actorId,
    hint.project_id,
    hint.access_scope,
    input.authHash,
  );
  const row = (
    await tx.query('SELECT * FROM assistant_candidates WHERE id=$1 AND actor_id=$2 FOR UPDATE', [
      candidateId,
      actorId,
    ])
  ).rows[0]!;
  if (
    (input.expectedVersion !== undefined && input.expectedVersion !== row.base_version) ||
    (input.recipe !== undefined && recipeHash(input.recipe) !== row.base_recipe_hash)
  )
    throw new HttpError(409, 'CANDIDATE_STALE', '候选与这次确认的基准不一致');
  if (row.applied_revision_id)
    return { artworkId: row.artwork_id, revisionId: row.applied_revision_id, replayed: true };
  if (
    row.kind !== 'edit' ||
    row.decision === 'rejected' ||
    (!input.confirmed && row.payload.autoEligible === false) ||
    new Date(row.expires_at).getTime() <= Date.now()
  )
    throw new HttpError(409, 'CANDIDATE_UNAVAILABLE', '此候选不能执行');
  if (input.confirmed && row.decision !== 'previewed')
    throw new HttpError(409, 'CANDIDATE_PREVIEW_REQUIRED', '请先预览此候选，再确认保存');
  if (
    !input.confirmed &&
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
  if (grantId)
    await claimAssistantGrant(tx, {
      grantId,
      actorId,
      projectId: row.project_id,
      key: `candidate:${candidateId}`,
      action: 'edit',
      modelId: hint.model_id,
      units: 0,
      automatic: !input.confirmed,
    });
  await assertVoiceCandidateContext(tx, row);
  if (!grantId && !input.confirmed)
    throw new HttpError(403, 'AUTOMATIC_GRANT_REQUIRED', '自动执行需要有效授权');
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
    artwork.asset_id !== base.asset_id
  )
    throw new HttpError(409, 'CANDIDATE_STALE', '图片或本地参数已变化，自动执行已停止');
  if (input.requireSavedBase) {
    if (recipeHash(base.recipe) !== row.base_recipe_hash)
      throw new HttpError(
        409,
        input.confirmed ? 'CANDIDATE_UNSAVED_BASE' : 'AUTOMATIC_UNSAVED_BASE',
        '本轮包含未保存参数，请先预览确认或保存后继续自动执行',
      );
  }
  // The shared revision trigger rejects all conflicting collaboration leases.
  const saved = await appendArtworkRevision(tx, {
    artwork,
    actorId,
    assetId: artwork.asset_id,
    recipe: parseEditorRecipe(row.payload.recipe),
    label: input.confirmed ? '明确确认 AI 编辑建议' : 'AI 授权自动编辑（可从历史恢复）',
    origin: {
      kind: input.confirmed ? 'assistant-confirm' : 'assistant-auto',
      operationId: candidateId,
    },
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
