import type { Locale } from '../i18n';

const copy = {
  'zh-CN': {
    inspect: '查看趋势日期',
    previous: '上一条趋势记录',
    next: '下一条趋势记录',
    hint: '滑动查看 · 方向键切换',
    recorded: '已记录',
    latest: '最近记录',
    noValue: '金额待核对',
  },
  'zh-TW': {
    inspect: '查看趨勢日期',
    previous: '上一筆趨勢紀錄',
    next: '下一筆趨勢紀錄',
    hint: '滑動查看 · 方向鍵切換',
    recorded: '已記錄',
    latest: '最近紀錄',
    noValue: '金額待核對',
  },
  en: {
    inspect: 'Inspect trend dates',
    previous: 'Previous trend record',
    next: 'Next trend record',
    hint: 'Slide to inspect · Arrow keys to move',
    recorded: 'Recorded',
    latest: 'Latest record',
    noValue: 'Amount to be confirmed',
  },
} as const;

export function usageExperienceCopy(locale: Locale) {
  return copy[locale];
}
