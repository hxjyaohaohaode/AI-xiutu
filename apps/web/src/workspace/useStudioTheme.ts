import { useEffect, useLayoutEffect, useState } from 'react';
import { readWorkspaceLayout, type Viewport } from './useWorkspaceLayout';

export type ThemePreference = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'image-workspace:theme';

export function readThemePreference(view: Viewport): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    return 'light';
  }
  return readWorkspaceLayout(view).theme;
}

function initialPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'light';
  const width = window.innerWidth;
  const height = window.innerHeight;
  return readThemePreference({
    width,
    height,
    bucket: width < 760 ? 'phone' : width < 1120 ? 'tablet' : 'desktop',
  });
}

/** Theme belongs to the document, not a panel or a screen-size layout bucket. */
export function useStudioTheme() {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);
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

export type StudioThemeController = ReturnType<typeof useStudioTheme>;
