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
  '确认 AI 调整': 'Apply AI adjustments',
  '本地编辑': 'Local editing',
  "格式像素上限": "Pixel limits by format",
  "高精度导入暂不可用，普通图片仍可在本地编辑。": "High-precision import is unavailable. Standard images can still be edited locally.",
  "与 PSD 合成图；RAW / EXR / Radiance 暂不可用。": "and PSD composites; RAW, EXR and Radiance are currently unavailable.",
  "原件和派生图计入空间存储。关闭后暂停上传，已开始的处理会继续。": "Originals and derived images use workspace storage. Closing pauses uploads; processing already started continues.",
  语言: 'Language',
  简体中文: 'Simplified Chinese',
  繁體中文: 'Traditional Chinese',
};
