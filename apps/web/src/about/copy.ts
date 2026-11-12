import type { Locale } from '../i18n';

// Only the public shell's live loading, recovery and return labels belong here.
// Product overview content is maintained in overview-copy.ts.
const simplified = {
  homeLabel: '返回介绍页',
  loadingStudio: '正在打开工作台',
  loadError: '工作台暂时没有加载完成',
  loadErrorBody: '请检查网络后重试。',
  retry: '重试',
};
const english: typeof simplified = {
  homeLabel: 'Return to the overview',
  loadingStudio: 'Opening the studio',
  loadError: 'The studio could not finish loading',
  loadErrorBody: 'Check your connection and try again.',
  retry: 'Try again',
};
const traditional: typeof simplified = {
  homeLabel: '返回介紹頁',
  loadingStudio: '正在開啟工作台',
  loadError: '工作台暫時沒有載入完成',
  loadErrorBody: '請檢查網路後重試。',
  retry: '重試',
};
export const aboutCopy = (locale: Locale) =>
  locale === 'en' ? english : locale === 'zh-TW' ? traditional : simplified;
