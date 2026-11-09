/** A download/decode may finish after the user edits or changes projects. The
 * recipe is immutable, so reference identity detects edits without comparing a
 * large JSON value on every network/decode checkpoint. */
export interface SourceLoadCheckpoint<Recipe> {
  context: number;
  source: number;
  recipe: Recipe;
}

export type SourceLoadStatus = 'current' | 'superseded' | 'edited';

export function createSourceLoadGuard<Recipe>(read: () => SourceLoadCheckpoint<Recipe>) {
  const initial = read();
  const status = (): SourceLoadStatus => {
    const next = read();
    if (initial.context !== next.context) return 'superseded';
    if (initial.source !== next.source || initial.recipe !== next.recipe) return 'edited';
    return 'current';
  };
  return { isCurrent: () => status() === 'current', status };
}

/** History must use the source captured by that revision, never today's head. */
export function assertRevisionSourceBinding(input: {
  artworkId: string;
  projectId: string;
  revision: { artworkId: string; assetId: string };
  asset: { id: string; projectId: string };
}): void {
  if (
    input.revision.artworkId !== input.artworkId ||
    input.revision.assetId !== input.asset.id ||
    input.asset.projectId !== input.projectId
  )
    throw new Error('作品版本与来源素材不匹配，请刷新项目后重试。');
}
