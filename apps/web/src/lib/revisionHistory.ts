import type { RevisionSummary } from './types';

export type RevisionHistoryPage = {
  revisions: RevisionSummary[];
  page?: { headVersion: number; nextBeforeVersion: number | null };
};

/** Append immutable history without mistaking a bounded page for the complete list. */
export function appendRevisionHistoryPage(
  previous: RevisionSummary[],
  response: RevisionHistoryPage,
  artworkId: string,
  beforeVersion?: number,
) {
  const invalid = () => new Error('版本分页信息不一致，请重新打开作品后重试。');
  const entries = new Map(previous.map((revision) => [revision.id, revision]));
  for (const revision of response.revisions) {
    if (
      revision.artworkId !== artworkId ||
      !Number.isInteger(revision.version) ||
      revision.version < 1 ||
      (beforeVersion !== undefined && revision.version >= beforeVersion)
    )
      throw invalid();
    const existing = entries.get(revision.id);
    if (
      existing &&
      (existing.version !== revision.version ||
        existing.artworkId !== revision.artworkId ||
        existing.assetId !== revision.assetId)
    )
      throw invalid();
    entries.set(revision.id, revision);
  }
  const revisions = [...entries.values()].sort((a, b) => b.version - a.version);
  if (new Set(revisions.map((revision) => revision.version)).size !== revisions.length)
    throw invalid();
  const nextBeforeVersion = response.page?.nextBeforeVersion ?? null;
  if (
    nextBeforeVersion !== null &&
    (!Number.isInteger(nextBeforeVersion) ||
      nextBeforeVersion < 1 ||
      response.revisions.length === 0 ||
      nextBeforeVersion !== Math.min(...response.revisions.map((revision) => revision.version)) ||
      (beforeVersion !== undefined && nextBeforeVersion >= beforeVersion))
  )
    throw invalid();
  const headVersion = response.page?.headVersion ?? null;
  if (
    headVersion !== null &&
    (!Number.isInteger(headVersion) ||
      headVersion < 1 ||
      revisions.some((revision) => revision.version > headVersion))
  )
    throw invalid();
  return { revisions, nextBeforeVersion, headVersion };
}
