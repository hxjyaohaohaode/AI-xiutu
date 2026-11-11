export const locales = ['zh-CN', 'zh-TW', 'en'] as const;
export type Locale = (typeof locales)[number];
export type MessageParams = Readonly<Record<string, string | number | boolean | null | undefined>>;
export type Catalog = Readonly<Record<string, string>>;
export type LocaleState = Readonly<{
  locale: Locale;
  pending: Locale | null;
  failed: Locale | null;
}>;
type CatalogLoader = (locale: Exclude<Locale, 'zh-CN'>) => Promise<Catalog>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}

/** The small switcher vocabulary is available even when a language chunk fails. */
const switcherCopy: Readonly<Record<Locale, Catalog>> = {
  'zh-CN': {},
  'zh-TW': {
    语言: '語言',
    '正在加载语言…': '正在載入語言…',
    '语言加载失败，请重试。': '語言載入失敗，請重試。',
    重试: '重試',
  },
  en: {
    语言: 'Language',
    '正在加载语言…': 'Loading language…',
    '语言加载失败，请重试。': 'The language could not load. Please try again.',
    重试: 'Retry',
  },
};

/**
 * Locale is an external preference, not a React tree identity. Publishing it never
 * replaces the editor, its document, its history, or its pending requests.
 */
export function createLocaleStore(
  loadCatalog: CatalogLoader,
  committed: (locale: Locale, persist: boolean) => void = () => {},
) {
  let state: LocaleState = { locale: 'zh-CN', pending: null, failed: null };
  let latestIntent = 0;
  const listeners = new Set<() => void>();
  const catalogs = new Map<Locale, Catalog>([['zh-CN', {}]]);
  const loading = new Map<Locale, Promise<void>>();

  function publish(next: LocaleState) {
    if (
      state.locale === next.locale &&
      state.pending === next.pending &&
      state.failed === next.failed
    )
      return;
    state = next;
    for (const listener of listeners) listener();
  }

  function preload(locale: Locale): Promise<void> {
    if (catalogs.has(locale)) return Promise.resolve();
    const current = loading.get(locale);
    if (current) return current;
    const request = Promise.resolve()
      .then(() => loadCatalog(locale as Exclude<Locale, 'zh-CN'>))
      .then((catalog) => {
        catalogs.set(locale, catalog);
      })
      .finally(() => {
        loading.delete(locale);
      });
    loading.set(locale, request);
    return request;
  }

  async function setLocale(locale: Locale, persist = true): Promise<boolean> {
    if (!isLocale(locale)) return false;
    const intent = ++latestIntent;
    if (!catalogs.has(locale)) {
      publish({ locale: state.locale, pending: locale, failed: null });
      try {
        await preload(locale);
      } catch (error) {
        if (intent !== latestIntent) return false;
        publish({ locale: state.locale, pending: null, failed: locale });
        throw error;
      }
    }
    if (intent !== latestIntent) return false;
    committed(locale, persist);
    publish({ locale, pending: null, failed: null });
    return true;
  }

  function translate(source: string, locale: Locale, params?: MessageParams): string {
    const catalog = catalogs.get(locale);
    const fallback = switcherCopy[locale];
    const message =
      (catalog && Object.hasOwn(catalog, source) ? catalog[source] : undefined) ??
      (Object.hasOwn(fallback, source) ? fallback[source] : undefined) ??
      source;
    if (!params) return message;
    return message.replace(/\{([A-Za-z0-9_]+)\}/g, (token, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : token,
    );
  }

  return {
    getLocale: () => state.locale,
    getState: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    preload,
    setLocale,
    translate,
  };
}
