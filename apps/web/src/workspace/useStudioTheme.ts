import { useEffect, useLayoutEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'image-workspace:theme';

function readPreference(fallback: 'light' | 'dark'): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : fallback;
  } catch {
    return fallback;
  }
}

/** Theme belongs to the document, not a panel or a screen-size layout bucket. */
export function useStudioTheme(legacyTheme: 'light' | 'dark' = 'light') {
  const [preference, setPreference] = useState<ThemePreference>(() => readPreference(legacyTheme));
  const [systemDark, setSystemDark] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)').matches : false,
  );
  const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#181c17' : '#f5f5f0');
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* Private mode still works. */
    }
  }, [preference]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      if (event.newValue === 'light' || event.newValue === 'dark' || event.newValue === 'system') {
        setPreference(event.newValue);
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  return {
    theme,
    preference,
    setPreference,
    toggle: () => setPreference(theme === 'light' ? 'dark' : 'light'),
  };
}
