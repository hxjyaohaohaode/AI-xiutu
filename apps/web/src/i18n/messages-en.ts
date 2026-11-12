import { navigationAiV2English } from './navigation-ai-v2-messages';
import { nativeGradeEnglish } from './native-grade-messages';
import { viewsRedesignEnglish } from './views-redesign-messages';
import { restorationEnglish } from './restoration-messages';
import { aiRedesignEnglish } from './ai-redesign-messages';
import { finalEnglish } from './final-messages';
import { appEnglish } from './app-messages';
import { residualEnglish } from './residual-messages';
import { additionalEnglish } from './additional-messages';
import { registryEnglish } from './registry-messages';
import { aiEnglish } from './ai-messages';
import { usageEnglish } from './usage-messages';
import { workspaceEnglish } from './workspace-messages';
import { accountEnglish } from './account-messages';
import { operationsEnglish } from './operations-messages';
import { coreEnglish } from './core-messages';
import { libraryEnglish } from './library-messages';
import { editorEnglish } from './editor-messages';

/** Application-authored copy only. Source keys keep migration reviewable. */
export const english: Readonly<Record<string, string>> = {
  ...navigationAiV2English,
  ...appEnglish,
  ...residualEnglish,
  ...additionalEnglish,
  ...registryEnglish,
  ...aiEnglish,
  ...usageEnglish,
  ...workspaceEnglish,
  ...accountEnglish,
  ...operationsEnglish,
  ...coreEnglish,
  ...libraryEnglish,
  ...editorEnglish,
  ...finalEnglish,
  ...aiRedesignEnglish,
  ...nativeGradeEnglish,
  ...restorationEnglish,
  ...viewsRedesignEnglish,
  '电影 {v0}': 'Cinema {v0}',
  草图添加元素: 'Add sketch elements',
  裁切像素: 'Crop dimensions',
  笔触粗细: 'Stroke width',
  '发给 AI': 'Send to AI',
  下载: 'Download',
  编辑界面截图: 'Editor screenshot',
  照片预览: 'Photo preview',
  移除附件: 'Remove attachment',
  查看附件: 'View attachment',
  '已替换底图，可在「对比」中恢复上一版本。': 'Source replaced. Restore the previous version in Compare.',
  '请选择支持图片的模型，或移除附件。': 'Choose a model that accepts images, or remove the attachment.',
  '确认 AI 调整': 'Apply AI adjustments',
  本地编辑: 'Local editing',
  格式像素上限: 'Pixel limits by format',
  '高精度导入暂不可用，普通图片仍可在本地编辑。':
    'High-precision import is unavailable. Standard images can still be edited locally.',
  '与 PSD 合成图；RAW / EXR / Radiance 暂不可用。':
    'and PSD composites; RAW, EXR and Radiance are currently unavailable.',
  '原件和派生图计入空间存储。关闭后暂停上传，已开始的处理会继续。':
    'Originals and derived images use workspace storage. Closing pauses uploads; processing already started continues.',
  语言: 'Language',
  简体中文: 'Simplified Chinese',
  繁體中文: 'Traditional Chinese',
};
