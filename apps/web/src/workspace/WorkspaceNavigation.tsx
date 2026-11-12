import type { View } from '../lib/types';
import { Modal } from '../components/Ui';
import { StudioGlyph } from '../components/StudioGlyph';
import type { ThemePreference } from './useStudioTheme';
import { t, useI18n, formatNumber } from '../i18n';
import { LanguageSelect } from '../i18n/LanguageSelect';

export const workspaceViews: { id: View; label: string; description: string }[] = [
  { id: 'editor', label: '精修', description: '调色、修饰与图层' },
  { id: 'works', label: '作品', description: '项目图片与素材' },
  { id: 'compare', label: '对比', description: '前后效果与版本' },
  { id: 'collaborate', label: '协作', description: '讨论、任务与成员' },
  { id: 'docs', label: '文档', description: '项目说明与记录' },
  { id: 'deliver', label: '交付', description: '图片与配方导出' },
  { id: 'usage', label: '用量', description: '服务点与使用明细' },
];

export function WorkspaceNavigation({
  view,
  onView,
  onClose,
}: {
  view: View;
  onView: (view: View) => void;
  onClose: () => void;
}) {
  useI18n();
  return (
    <Modal title={t('工作视图')} onClose={onClose} className="workspace-navigation-dialog">
      <nav className="workspace-destinations" aria-label={t('切换工作视图')}>
        {workspaceViews.map((item) => (
          <button
            type="button"
            key={item.id}
            data-view={item.id}
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => onView(item.id)}
          >
            <StudioGlyph name={item.id} size={22} />
            <span>
              <strong>{t(item.label)}</strong>
            </span>
            {view === item.id && <StudioGlyph name="check" size={18} />}
          </button>
        ))}
      </nav>
    </Modal>
  );
}

export function WorkspaceSettings({
  preference,
  onPreference,
  onImportSettings,
  onReset,
  onFocus,
  onHelp,
  onClose,
  available,
  onUsage,
}: {
  preference: ThemePreference;
  onPreference: (theme: ThemePreference) => void;
  onImportSettings: () => void;
  onReset: () => void;
  onFocus: () => void;
  onHelp: () => void;
  onClose: () => void;
  available?: number;
  onUsage: () => void;
}) {
  useI18n();
  return (
    <Modal title={t('工作台设置')} onClose={onClose} className="workspace-settings-dialog">
      <section className="settings-theme-section" aria-labelledby="studio-appearance-title">
        <h3 id="studio-appearance-title">{t('外观')}</h3>
        <div className="settings-theme-choices" role="group" aria-label={t('外观模式')}>
          {(
            [
              { id: 'light', label: '浅色', icon: 'sun' },
              { id: 'dark', label: '深色', icon: 'moon' },
              { id: 'system', label: '跟随系统', icon: 'system' },
            ] as const
          ).map((item) => (
            <button
              type="button"
              key={item.id}
              data-theme-choice={item.id}
              aria-pressed={preference === item.id}
              onClick={() => onPreference(item.id)}
            >
              <StudioGlyph name={item.icon} size={22} />
              <span>{t(item.label)}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="settings-language-section" aria-labelledby="studio-language-title">
        <h3 id="studio-language-title">{t('语言')}</h3>
        <LanguageSelect />
      </section>
      <div className="workspace-settings-list">
        <button type="button" onClick={onImportSettings}>
          <StudioGlyph name="import" />
          <span>{t('图片格式与分辨率')}</span>
          <StudioGlyph name="chevron" size={16} />
        </button>
        <button type="button" onClick={onReset}>
          <StudioGlyph name="settings" />
          <span>{t('重置当前屏幕布局')}</span>
        </button>
        <button type="button" onClick={onFocus}>
          <StudioGlyph name="focus" />
          <span>{t('专注画面')}</span>
          <kbd>F</kbd>
        </button>
        <button type="button" onClick={onHelp}>
          <StudioGlyph name="docs" />
          <span>{t('使用说明')}</span>
          <StudioGlyph name="chevron" size={16} />
        </button>
        {available !== undefined && (
          <button type="button" onClick={onUsage}>
            <StudioGlyph name="usage" />
            <span>{t('服务点与明细')}</span>
            <strong>{formatNumber(available)}</strong>
          </button>
        )}
      </div>
    </Modal>
  );
}
