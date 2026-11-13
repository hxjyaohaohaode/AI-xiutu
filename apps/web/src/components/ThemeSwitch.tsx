import { createContext, useContext } from 'react';
import { useLocale } from '../i18n';
import type { StudioThemeController } from '../workspace/useStudioTheme';
import { ThemeScene } from './ThemeScene';

export const ThemeContext = createContext<StudioThemeController | null>(null);

const labels = {
  'zh-CN': ['深色模式', '切换深色模式', '切换浅色模式'],
  'zh-TW': ['深色模式', '切換深色模式', '切換淺色模式'],
  en: ['Dark mode', 'Switch to dark mode', 'Switch to light mode'],
} as const;

export function ThemeSwitch({ className = '' }: { className?: string }) {
  const theme = useContext(ThemeContext);
  const [label, enterDark, enterLight] = labels[useLocale()];
  if (!theme) return null;
  const dark = theme.theme === 'dark';
  return (
    <button type="button" className={`theme-switch ${className}`} role="switch"
      aria-label={label} aria-checked={dark} title={dark ? enterLight : enterDark}
      onClick={theme.toggle}>
      <ThemeScene dark={dark} />
    </button>
  );
}
