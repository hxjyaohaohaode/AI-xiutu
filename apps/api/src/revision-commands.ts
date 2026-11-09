import type { Queryable } from '@ai-xiutu/db';
import type { EditorRecipe } from '@ai-xiutu/editor';
import { HttpError, assetDto, artworkDto, revisionDto } from './core.js';
import { validateRecipeReferences } from './recipe-references.js';

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
  },
) {
  const { artwork } = input;
  const asset = await requireSourceAsset(tx, artwork.project_id, input.assetId);
  await validateRecipeReferences(tx, artwork.project_id, input.recipe);
  // Source and recipe switch together. The insert trigger snapshots this source
  // in revision_sources before either change can be committed.
  await tx.query('UPDATE artworks SET asset_id=$2 WHERE id=$1', [artwork.id, input.assetId]);
  const revision = (
    await tx.query(
      'INSERT INTO revisions(artwork_id,version,parent_id,recipe,label,author_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
      [
        artwork.id,
        artwork.head_version + 1,
        artwork.head_revision_id,
        JSON.stringify(input.recipe),
        input.label,
        input.actorId,
      ],
    )
  ).rows[0]!;
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
  const revision = (
    await tx.query(
      'INSERT INTO revisions(artwork_id,version,recipe,author_id,label) VALUES($1,1,$2,$3,$4) RETURNING *',
      [artwork.id, JSON.stringify(input.recipe), input.actorId, input.label],
    )
  ).rows[0]!;
  await tx.query('UPDATE artworks SET head_revision_id=$2 WHERE id=$1', [artwork.id, revision.id]);
  return {
    artwork: artworkDto({ ...artwork, head_revision_id: revision.id }),
    revision: revisionDto({ ...revision, asset_id: input.assetId }),
    asset: assetDto(asset),
  };
}
