import type { Locale } from '../i18n';

const copy = {
  'zh-CN': {
    custom: '已自定',
    updating: '预览更新中',
    open: '开始自己的作品',
    labels: {
      exposure: '曝光',
      warmth: '色温',
      contrast: '对比度',
      saturation: '饱和度',
      highlights: '高光',
      shadows: '阴影',
      vibrance: '鲜艳度',
      clarity: '清晰度',
    },
  },
  'zh-TW': {
    custom: '已自訂',
    updating: '預覽更新中',
    open: '開始自己的作品',
    labels: {
      exposure: '曝光',
      warmth: '色溫',
      contrast: '對比度',
      saturation: '飽和度',
      highlights: '高光',
      shadows: '陰影',
      vibrance: '鮮豔度',
      clarity: '清晰度',
    },
  },
  en: {
    custom: 'Custom',
    updating: 'Updating preview',
    open: 'Start your own work',
    labels: {
      exposure: 'Exposure',
      warmth: 'Warmth',
      contrast: 'Contrast',
      saturation: 'Saturation',
      highlights: 'Highlights',
      shadows: 'Shadows',
      vibrance: 'Vibrance',
      clarity: 'Clarity',
    },
  },
} as const;

export function studyCopy(locale: Locale) {
  return copy[locale];
}
