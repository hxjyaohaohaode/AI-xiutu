import type { EditorRecipe } from '@ai-xiutu/editor';
import type { Queryable } from '@ai-xiutu/db';
import { HttpError, id } from './core.js';

/** No external/local URLs and no cross-project reads hidden in a saved recipe.
 * Copying a project remaps all of these references under destination ACL. */
export async function validateRecipeReferences(
  tx: Queryable,
  projectId: string,
  recipe: EditorRecipe,
): Promise<void> {
  if (recipe.schemaVersion < 3 || !('imageLayers' in recipe)) return;
  const ids = [...new Set(recipe.imageLayers.map((layer) => layer.sourceId))].sort();
  for (const sourceId of ids) {
    if (!id.safeParse(sourceId).success)
      throw new HttpError(
        400,
        'LAYER_NOT_UPLOADED',
        '请先上传附加图像层；云端配方只能引用项目内素材',
      );
  }
  if (!ids.length) return;
  const result = await tx.query(
    'SELECT id FROM assets WHERE id=ANY($1::uuid[]) AND project_id=$2 AND deleted_at IS NULL ORDER BY id FOR SHARE',
    [ids, projectId],
  );
  if (result.rowCount !== ids.length)
    throw new HttpError(400, 'LAYER_ASSET_MISMATCH', '合成图层包含已删除或不属于本项目的素材');
}

export function remapRecipeReferences(
  recipe: EditorRecipe,
  mapping: ReadonlyMap<string, string>,
): EditorRecipe {
  const copied = structuredClone(recipe);
  if (copied.schemaVersion >= 3 && 'imageLayers' in copied) {
    for (const layer of copied.imageLayers) {
      const replacement = mapping.get(layer.sourceId);
      if (!replacement)
        throw new HttpError(
          409,
          'COPY_SOURCE_CHANGED',
          '合成图层的来源素材不可复制，请重新检查授权',
        );
      layer.sourceId = replacement;
    }
  }
  return copied;
}
