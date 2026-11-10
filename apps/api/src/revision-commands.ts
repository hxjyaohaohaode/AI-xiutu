import type { Queryable } from '@ai-xiutu/db';
import type { EditorRecipe } from '@ai-xiutu/editor';
import type { RevisionOriginKind } from '@ai-xiutu/contracts';
import { HttpError, assetDto, artworkDto, revisionDto } from './core.js';
import { validateRecipeReferences } from './recipe-references.js';

export interface RevisionOrigin {
  kind: RevisionOriginKind;
  sourceRevisionId?: string;
  operationId?: string;
  requestDigest?: string;
}

async function insertRevision(
  tx: Queryable,
  input: {
    artworkId: string;
    version: number;
    parentId: string | null;
    recipe: EditorRecipe;
    actorId: string;
    label: string;
    origin: RevisionOrigin;
  },
) {
  return (
    await tx.query(
      `INSERT INTO revisions(artwork_id,version,parent_id,recipe,author_id,label,
        origin_kind,source_revision_id,origin_ref,request_digest)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        input.artworkId,
        input.version,
        input.parentId,
        JSON.stringify(input.recipe),
        input.actorId,
        input.label,
        input.origin.kind,
        input.origin.sourceRevisionId ?? null,
        input.origin.operationId ?? null,
        input.origin.requestDigest ?? null,
      ],
    )
  ).rows[0]!;
}

export async function readArtworkRevision(tx: Queryable, artworkId: string, revisionId: string) {
  return (
    await tx.query(
      'SELECT r.*,s.asset_id FROM revisions r JOIN revision_sources s ON s.revision_id=r.id WHERE r.id=$1 AND r.artwork_id=$2',
      [revisionId, artworkId],
    )
  ).rows[0];
}

/** Old clients lack a request key. Replay an identical lost acknowledgement
 * while its revision is still the head, so the UI can adopt one coherent pair. */
export async function replayHeadWrite(
  tx: Queryable,
  artwork: Record<string, any>,
  actorId: string,
  expectedVersion: number,
  requestDigest: string,
) {
  if (artwork.head_version !== expectedVersion + 1) return undefined;
  const revision = await readArtworkRevision(tx, artwork.id, artwork.head_revision_id);
  if (
    revision?.author_id !== actorId ||
    revision.request_digest !== requestDigest ||
    revision.asset_id !== artwork.asset_id
  )
    return undefined;
  const asset = await requireSourceAsset(tx, artwork.project_id, artwork.asset_id);
  return { artwork: artworkDto(artwork), revision: revisionDto(revision), asset: assetDto(asset) };
}

export async function requireSourceAsset(tx: Queryable, projectId: string, assetId: string) {
  const asset = (
    await tx.query(
      'SELECT * FROM assets WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR SHARE',
      [assetId, projectId],
    )
  ).rows[0];
  if (!asset) throw new HttpError(409, 'SOURCE_UNAVAILABLE', '源图片已不可用，请重新选择');
  return asset;
}

/** Caller owns the artwork row lock and has checked project edit ACL + CAS. */
export async function appendArtworkRevision(
  tx: Queryable,
  input: {
    artwork: Record<string, any>;
    actorId: string;
    recipe: EditorRecipe;
    assetId: string;
    label: string;
    title?: string;
    origin: RevisionOrigin;
  },
) {
  const { artwork } = input;
  const asset = await requireSourceAsset(tx, artwork.project_id, input.assetId);
  await validateRecipeReferences(tx, artwork.project_id, input.recipe);
  // Source and recipe switch together. The insert trigger snapshots this source
  // in revision_sources before either change can be committed.
  if (artwork.asset_id !== input.assetId)
    await tx.query('UPDATE artworks SET asset_id=$2 WHERE id=$1', [artwork.id, input.assetId]);
  const revision = await insertRevision(tx, {
    ...input,
    artworkId: artwork.id,
    version: artwork.head_version + 1,
    parentId: artwork.head_revision_id,
  });
  const updated = (
    await tx.query(
      'UPDATE artworks SET head_version=head_version+1,head_revision_id=$2,title=$3,updated_at=clock_timestamp() WHERE id=$1 RETURNING *',
      [artwork.id, revision.id, input.title ?? artwork.title],
    )
  ).rows[0]!;
  return {
    artwork: artworkDto(updated),
    revision: revisionDto({ ...revision, asset_id: input.assetId }),
    asset: assetDto(asset),
  };
}

export async function createArtworkBranch(
  tx: Queryable,
  input: {
    projectId: string;
    actorId: string;
    assetId: string;
    recipe: EditorRecipe;
    title: string;
    label: string;
    origin?: RevisionOrigin;
  },
) {
  const asset = await requireSourceAsset(tx, input.projectId, input.assetId);
  await validateRecipeReferences(tx, input.projectId, input.recipe);
  const artwork = (
    await tx.query('INSERT INTO artworks(project_id,asset_id,title) VALUES($1,$2,$3) RETURNING *', [
      input.projectId,
      input.assetId,
      input.title,
    ])
  ).rows[0]!;
  const revision = await insertRevision(tx, {
    ...input,
    artworkId: artwork.id,
    version: 1,
    parentId: null,
    origin: input.origin ?? { kind: 'initial' },
  });
  await tx.query('UPDATE artworks SET head_revision_id=$2 WHERE id=$1', [artwork.id, revision.id]);
  return {
    artwork: artworkDto({ ...artwork, head_revision_id: revision.id }),
    revision: revisionDto({ ...revision, asset_id: input.assetId }),
    asset: assetDto(asset),
  };
}
