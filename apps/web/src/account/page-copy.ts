import type { Locale } from '../i18n';

const copy = {
  'zh-CN': {
    back: '返回创作',
    home: '返回首页',
    eyebrow: '你的创作空间',
    lineOne: '灵感有去处。',
    lineTwo: '作品有归处。',
    caption: '从一张照片，继续所有想法。',
    login: '继续你的创作。',
    register: '为下一件作品，留一个位置。',
    reset: '找回账号，接着创作。',
    ready: '一切就绪。',
    account: '你的账号、空间与使用记录。',
    loading: '正在读取账号信息',
    waiting: '正在完成当前请求，请稍候。',
  },
  'zh-TW': {
    back: '返回創作',
    home: '返回首頁',
    eyebrow: '你的創作空間',
    lineOne: '靈感有去處。',
    lineTwo: '作品有歸處。',
    caption: '從一張照片，繼續所有想法。',
    login: '繼續你的創作。',
    register: '為下一件作品，留一個位置。',
    reset: '找回帳號，接著創作。',
    ready: '一切就緒。',
    account: '你的帳號、空間與使用紀錄。',
    loading: '正在讀取帳號資訊',
    waiting: '正在完成目前的請求，請稍候。',
  },
  en: {
    back: 'Back to creating',
    home: 'Back to home',
    eyebrow: 'Your creative space',
    lineOne: 'A place for ideas.',
    lineTwo: 'A home for your work.',
    caption: 'One photograph. Every possibility.',
    login: 'Pick up where you left off.',
    register: 'Make room for your next creation.',
    reset: 'Recover your account. Keep creating.',
    ready: 'You’re ready to create.',
    account: 'Your account, spaces and activity.',
    loading: 'Loading your account',
    waiting: 'Finishing the current request. Please wait.',
  },
} as const;

export function accountPageCopy(locale: Locale) {
  return copy[locale];
}
