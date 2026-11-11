import type { Locale } from '../i18n';

const copy = {
  'zh-CN': {
    back: '返回对话',
    more: '更多参数',
    limits: '模型详情',
    noModel: '选择模型后设置画幅和质量。',
    complexity: '规划投入',
    complexityHint: '控制构图规划的计算投入，与成像质量独立。',
    encoding: '生成格式',
    encodingHint: '供应商按此格式生成，项目内保存为 PNG。',
    dimensions: '尺寸规则',
    custom: '自定',
    provider: '供应商',
    modelId: '模型标识',
  },
  'zh-TW': {
    back: '返回對話',
    more: '更多參數',
    limits: '模型詳情',
    noModel: '選擇模型後設定畫幅與品質。',
    complexity: '規劃投入',
    complexityHint: '控制構圖規劃的運算投入，與成像品質獨立。',
    encoding: '生成格式',
    encodingHint: '供應商依此格式生成，專案內儲存為 PNG。',
    dimensions: '尺寸規則',
    custom: '自訂',
    provider: '供應商',
    modelId: '模型識別碼',
  },
  en: {
    back: 'Back to conversation',
    more: 'More options',
    limits: 'Model details',
    noModel: 'Choose a model to set dimensions and quality.',
    complexity: 'Planning effort',
    complexityHint: 'Computation for planning the composition, independent of rendering quality.',
    encoding: 'Generation format',
    encodingHint: 'The provider generates this format; project assets are stored as PNG.',
    dimensions: 'Dimension rules',
    custom: 'Custom',
    provider: 'Provider',
    modelId: 'Model identifier',
  },
} as const;

export function modelCopy(locale: Locale) {
  return copy[locale];
}
