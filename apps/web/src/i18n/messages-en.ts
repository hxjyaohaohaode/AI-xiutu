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
  语言: 'Language',
  简体中文: 'Simplified Chinese',
  繁體中文: 'Traditional Chinese',
};
