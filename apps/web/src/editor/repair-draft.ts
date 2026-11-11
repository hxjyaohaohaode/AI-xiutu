import { createHealingOperationV4, createRetouchRegionV4, type RecipeV4 } from '@ai-xiutu/editor';
import { t } from '../i18n';

export function appendRepairRegion(
  recipe: RecipeV4,
  mode: 'healing' | 'retouch',
  id: string,
): RecipeV4 {
  const mask = { type: 'brush' as const, strokes: [], invert: false };
  if (mode === 'healing') {
    const operation = createHealingOperationV4({
      id,
      name: t('纹理修复 ') + (recipe.healing.length + 1),
      mask,
    });
    return { ...recipe, healing: [...recipe.healing, operation] };
  }
  const operation = createRetouchRegionV4({
    id,
    name: t('局部质感 ') + (recipe.retouch.length + 1),
    mask,
    algorithm: 'guided-v4',
  });
  return { ...recipe, retouch: [...recipe.retouch, operation] };
}
