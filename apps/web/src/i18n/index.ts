import { useSyncExternalStore } from 'react';
import { createLocaleStore, isLocale, type Locale, type MessageParams } from './store';

export { locales, isLocale, type Locale, type MessageParams } from './store';
const storageKey = 'yingjian.locale.v1';
const store = createLocaleStore(
  async (locale) =>
    locale === 'en'
      ? (await import('./messages-en')).english
      : (await import('./messages-zh-TW')).traditional,
  (locale, persist) => {
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
    if (persist) {
      try {
        window.localStorage.setItem(storageKey, locale);
      } catch {
        /* Session-only preference. */
      }
    }
  },
);
let initialization: Promise<boolean> | undefined;

export const getLocale = store.getLocale;
export const subscribeLocale = store.subscribe;
export const preloadLocale = store.preload;
export const setLocale = (locale: Locale): Promise<boolean> => store.setLocale(locale);

/** Load a saved dictionary before first render; failure remains visible in the switcher. */
export function initializeLocale(): Promise<boolean> {
  if (initialization) return initialization;
  if (typeof window === 'undefined') return Promise.resolve(true);
  if (typeof document !== 'undefined') document.documentElement.lang = getLocale();
  let saved: unknown;
  try {
    saved = window.localStorage.getItem(storageKey);
  } catch {
    /* Session-only preference. */
  }
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey && isLocale(event.newValue))
      void store.setLocale(event.newValue, false).catch(() => {
        /* Reported by the switcher. */
      });
  });
  initialization = store.setLocale(isLocale(saved) ? saved : 'zh-CN', false).catch(() => false);
  return initialization;
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

export function useLocaleState() {
  return useSyncExternalStore(subscribeLocale, store.getState, store.getState);
}

/** Only call on application copy. User text and wire identifiers remain verbatim. */
export const translate = store.translate;

export function t(source: string, params?: MessageParams): string {
  return translate(source, getLocale(), params);
}

export function useI18n() {
  const locale = useLocale();
  return { locale, t, setLocale };
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

export function formatDateTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  },
): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat(getLocale(), options).format(date)
    : '—';
}
