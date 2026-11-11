import type { Locale } from '../i18n';

// Match the V4-rendered assets documented in docs/design/about-art-r3-20261111.md.
// These are published demo recipes, not a live model response or execution trace.
export const agentDemoRecipes = [
  { exposure: '+0.08', shadows: '+5', highlights: '−5' },
  { exposure: '+0.20', shadows: '+14', highlights: '−10' },
] as const;

const zh = {
  process: '可查看的操作过程',
  example: '流程演示',
  actions: ['读取当前图像', '参数变更', '检查候选', '用户授权'],
  states: ['示例输入', '候选配方', '本地结果', '由你确认'],
  input: '当前画面 · 1536 × 1024',
  compare: '同一源图、两组调整。候选由本站编辑引擎预先渲染。',
  authorize: '选择只更新此处演示。实际应用在工作台确认。',
  exposure: '曝光',
  shadows: '阴影',
  highlights: '高光',
  candidates: '两个方向，选择一个。',
  rendered: '本站编辑引擎 · 预渲染候选',
  selected: '已选',
  select: '选择',
  selectionOnly: '演示选择',
};

const tw: typeof zh = {
  process: '可檢視的操作過程',
  example: '流程示範',
  actions: ['讀取目前圖像', '參數變更', '檢查候選', '使用者授權'],
  states: ['範例輸入', '候選配方', '本地結果', '由你確認'],
  input: '目前畫面 · 1536 × 1024',
  compare: '同一來源、兩組調整。候選由本站編輯引擎預先算繪。',
  authorize: '選擇只更新此處示範。實際套用在工作台確認。',
  exposure: '曝光',
  shadows: '陰影',
  highlights: '高光',
  candidates: '兩個方向，選擇一個。',
  rendered: '本站編輯引擎 · 預先算繪候選',
  selected: '已選',
  select: '選擇',
  selectionOnly: '示範選擇',
};

const en: typeof zh = {
  process: 'Review the actions',
  example: 'Workflow demo',
  actions: [
    'Read the current image',
    'Change parameters',
    'Inspect candidates',
    'User authorization',
  ],
  states: ['Example input', 'Recipe', 'Local results', 'Your decision'],
  input: 'Current image · 1536 × 1024',
  compare:
    'One source, two adjustments. Both previews were rendered with this app’s editing engine.',
  authorize: 'This selection updates the demo. Confirm an actual application in the studio.',
  exposure: 'Exposure',
  shadows: 'Shadows',
  highlights: 'Highlights',
  candidates: 'Two directions. Choose one.',
  rendered: 'App editing engine · pre-rendered previews',
  selected: 'Selected',
  select: 'Choose',
  selectionOnly: 'Demo selection',
};

export function agentProductCopy(locale: Locale) {
  return locale === 'en' ? en : locale === 'zh-TW' ? tw : zh;
}
