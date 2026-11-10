import type { AssetCopyRecord } from '@ai-xiutu/contracts';
import type { Asset } from '../lib/types';

export interface GenerationDraftInput {
  executionGrantId?: string;
  candidateId: string;
  prompt: string;
  referenceAssetIds: string[];
}

export interface PreparedGenerationDraft extends GenerationDraftInput {
  /** In the original order, using the destination IDs returned by the server. */
  referenceAssets: Asset[];
}

export interface ReferenceCopyAttempt {
  idempotencyKey: string;
  copiedAssetId?: string;
}

export type ReferenceCopyJournal = Map<string, ReferenceCopyAttempt>;

interface PreparationOptions {
  actorScope: string;
  projectId: string;
  journal: ReferenceCopyJournal;
  loadProjectAssets: () => Promise<Asset[]>;
  copyAsset: (
    sourceAssetId: string,
    idempotencyKey: string,
  ) => Promise<{ asset: Asset; copy: AssetCopyRecord }>;
  makeId: (sourceAssetId: string) => string;
  confirmCopy: (count: number) => boolean | Promise<boolean>;
  assertCurrent: () => void;
  onAssetReady: (asset: Asset) => void;
  commit: (draft: PreparedGenerationDraft) => void;
}

/**
 * Prepare real authorized references without adopting the candidate or changing
 * the composer. The caller records the candidate decision first, then invokes
 * the returned commit. Failed/unknown copies retain their original request key.
 */
export async function prepareGenerationDraft(
  input: GenerationDraftInput,
  options: PreparationOptions,
): Promise<(() => void) | null> {
  const draft = { ...input, referenceAssetIds: [...input.referenceAssetIds] };
  options.assertCurrent();
  const projectAssets = draft.referenceAssetIds.length ? await options.loadProjectAssets() : [];
  options.assertCurrent();
  if (projectAssets.some((asset) => asset.projectId !== options.projectId))
    throw new Error('素材列表与当前项目不一致，请刷新后再准备草案。');
  const available = new Map(projectAssets.map((asset) => [asset.id, asset]));
  const resolved = new Map<string, Asset>();
  const journalKey = (sourceId: string) =>
    JSON.stringify([options.actorScope, options.projectId, sourceId]);
  const uniqueReferences = [...new Set(draft.referenceAssetIds)];
  for (const sourceId of uniqueReferences) {
    const direct = available.get(sourceId);
    const prior = options.journal.get(journalKey(sourceId));
    const completed = prior?.copiedAssetId ? available.get(prior.copiedAssetId) : undefined;
    if (direct || completed) resolved.set(sourceId, (direct ?? completed)!);
  }
  const needsCopy = uniqueReferences.filter((sourceId) => !resolved.has(sourceId));
  if (needsCopy.length && !(await options.confirmCopy(needsCopy.length))) return null;
  options.assertCurrent();

  // Publish only actual assets. This also makes newly fetched same-project
  // references immediately visible when the parent list has not refreshed yet.
  for (const asset of resolved.values()) options.onAssetReady(asset);
  let completedThisAttempt = 0;
  try {
    for (const sourceId of needsCopy) {
      options.assertCurrent();
      const key = journalKey(sourceId);
      let attempt = options.journal.get(key);
      if (!attempt) {
        attempt = { idempotencyKey: options.makeId(sourceId) };
        options.journal.set(key, attempt);
      }
      const result = await options.copyAsset(sourceId, attempt.idempotencyKey);
      if (
        result.copy.sourceAssetId !== sourceId ||
        result.copy.targetProjectId !== options.projectId ||
        result.copy.copiedAssetId !== result.asset.id ||
        result.asset.projectId !== options.projectId ||
        result.asset.id === sourceId
      )
        throw new Error('复制回执与来源或目标项目不一致，未采用该素材。');
      // Preserve an acknowledged copy even if the user left during the request.
      // A later retry validates it against a fresh, authorized project listing.
      attempt.copiedAssetId = result.asset.id;
      completedThisAttempt++;
      options.assertCurrent();
      resolved.set(sourceId, result.asset);
      options.onAssetReady(result.asset);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '请求未完成，请重试。';
    throw new Error(
      `参考图尚未完整准备，草案没有切换。${completedThisAttempt ? `本次已确认的 ${completedThisAttempt} 张副本保留在目标项目。` : ''}重试会核验并复用已完成的副本，不会丢弃参考图。${reason}`,
      { cause: error },
    );
  }
  options.assertCurrent();
  const referenceAssets = draft.referenceAssetIds.map((sourceId) => {
    const asset = resolved.get(sourceId);
    if (!asset) throw new Error('参考图未完整准备，草案仍待确认。');
    return asset;
  });
  const prepared: PreparedGenerationDraft = {
    ...draft,
    referenceAssetIds: referenceAssets.map((asset) => asset.id),
    referenceAssets,
  };
  let committed = false;
  return () => {
    if (committed) return;
    options.assertCurrent();
    options.commit(prepared);
    committed = true;
  };
}
