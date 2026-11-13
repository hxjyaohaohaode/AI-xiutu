import { t } from '../i18n';
import type { SourceFrame } from '@ai-xiutu/contracts';
import {
  createAdjustmentRegionV3,
  MAX_V3_REGION_EDITS,
  getSelectionBoundsV3,
  type LayeredRecipe,
} from '@ai-xiutu/editor';
import { validatePortraitAnalysis, type PortraitAnalysis } from '@ai-xiutu/portrait';

export type PortraitSelectionKind = 'subject' | 'skin' | 'hair' | 'background';
export const portraitSelectionLabels: Record<PortraitSelectionKind, string> = {
  subject: '人物选区',
  skin: '皮肤选区',
  hair: '头发选区',
  background: '背景选区',
};

export function portraitSelectionMatchesSource(
  analysis: PortraitAnalysis | null,
  frame: SourceFrame | null,
) {
  return !!(
    analysis &&
    frame &&
    analysis.frame.contentHash === frame.contentHash &&
    analysis.frame.width === frame.width &&
    analysis.frame.height === frame.height &&
    analysis.frame.coordinates === frame.coordinates &&
    analysis.frame.orientation === frame.orientation
  );
}

/** Copy a validated source-space mask into an independent neutral adjustment. */
export function preparePortraitSelection(
  recipe: LayeredRecipe,
  analysis: PortraitAnalysis | null,
  frame: SourceFrame | null,
  kind: PortraitSelectionKind,
  id: string,
) {
  if (!frame || !portraitSelectionMatchesSource(analysis, frame))
    throw new Error('人物分析与当前原图不一致，请重新识别后建立选区。');
  const checked = validatePortraitAnalysis(analysis, frame);
  const mask = checked.segmentation?.[kind];
  if (!mask) throw new Error(t('这次分析没有提供该范围，可到“局部”手动建立选区。'));
  const bounds = getSelectionBoundsV3(mask, frame);
  if (mask.type === 'raster' && (bounds.width === 0 || bounds.height === 0))
    throw new Error(t('该范围没有识别到有效像素。'));
  if (recipe.regionEdits.length >= MAX_V3_REGION_EDITS)
    throw new Error(
      t('局部选区已达到 {count} 个，请先整理后再添加。', { count: MAX_V3_REGION_EDITS }),
    );
  if (recipe.regionEdits.some((region) => region.id === id))
    throw new Error('这个选区标识已经存在，请重新建立选区。');
  const region = createAdjustmentRegionV3({
    id,
    name: `${t(portraitSelectionLabels[kind])} ${recipe.regionEdits.length + 1}`,
    mask,
  });
  return {
    recipe: { ...recipe, regionEdits: [...recipe.regionEdits, region] } as LayeredRecipe,
    regionId: region.id,
  };
}
