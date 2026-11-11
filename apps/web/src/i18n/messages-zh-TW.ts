import { usageTraditional } from './usage-messages';
import { workspaceTraditional } from './workspace-messages';
import { accountTraditional } from './account-messages';
import { traditionalGenerated } from './traditional-generated';

/** Traditional Chinese copy; user content is never passed through this catalog. */
export const traditional: Readonly<Record<string, string>> = {
  ...traditionalGenerated,
  ...usageTraditional,
  ...accountTraditional,
  ...workspaceTraditional,
  语言: '語言',
  简体中文: '簡體中文',
  繁體中文: '繁體中文',
};
