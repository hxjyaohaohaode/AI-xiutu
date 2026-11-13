import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { BookmarkSimple, FileImage, Images, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import { ThemeScene } from '../components/ThemeScene';
import type { View } from '../lib/types';
import type { LibraryTab } from '../resources/useLibraryCollection';
import { Modal } from '../components/Ui';
import { StudioGlyph } from '../components/StudioGlyph';
import type { ThemePreference } from './useStudioTheme';
import { t, useI18n, formatNumber } from '../i18n';
import { LanguageSelect } from '../i18n/LanguageSelect';

export const workspaceViews: { id: View; label: string; description: string }[] = [
  { id: 'editor', label: '精修', description: '调色、修饰与图层' },
  { id: 'works', label: '作品', description: '项目图片与素材' },
  { id: 'collaborate', label: '协作', description: '讨论、任务与成员' },
  { id: 'docs', label: '文档', description: '项目说明与记录' },
  { id: 'usage', label: '用量', description: '服务点与使用明细' },
];

export function LibraryNavigation({
  value,
  onChange,
  onProfessionalImport,
  onPhotoTrash,
}: {
  value: LibraryTab;
  onChange: (value: LibraryTab) => void;
  onProfessionalImport: () => void;
  onPhotoTrash: () => void;
}) {
  useI18n();
  return (
    <nav className="library-context-tabs" data-navigation="library" aria-label={t('素材视图')}>
      {([
        ['project', '项目作品', Images],
        ['all', '跨空间查找', MagnifyingGlass],
        ['memory', '长期素材', BookmarkSimple],
      ] as const).map(([tab, label, Glyph]) => (
        <button
          type="button"
          key={tab}
          data-library-tab={tab}
          aria-pressed={value === tab}
          aria-label={t(label)}
          title={t(label)}
          onClick={() => onChange(tab)}
        >
          <Glyph size={17} aria-hidden />
          <span>{t(label)}</span>
        </button>
      ))}
      <button
        type="button"
        className="library-original-action"
        aria-label={t('原片与专业格式')}
        title={t('原片与专业格式')}
        onClick={onProfessionalImport}
      >
        <FileImage size={17} aria-hidden />
        <span>{t('原片与专业格式')}</span>
      </button>
      <button
        type="button"
        aria-label={t('回收站')}
        title={t('回收站')}
        aria-haspopup="dialog"
        onClick={onPhotoTrash}
      >
        <Trash size={17} aria-hidden />
        <span>{t('回收站')}</span>
      </button>
    </nav>
  );
}

export function WorkspaceHelpContent() {
  return (
    <div className="help-list compact-help-list">
      {([
        ['编辑照片', '用底部工具调整，按住对比查看原图。', 'editor'],
        ['保存与版本', '保存到项目后，在编辑记录中打开云端版本。', 'history'],
        ['团队协作', '在协作视图邀请成员、讨论和分配任务。', 'collaborate'],
        ['图片与 AI 授权', '发送时才共享选中的图片和文字。', 'ai'],
      ] as const).map(([label, hint, icon]) => (
        <details key={label}>
          <summary>
            <StudioGlyph name={icon} size={18} />
            {t(label)}
          </summary>
          <p>{t(hint)}</p>
        </details>
      ))}
    </div>
  );
}

export function WorkspaceSettings({
  preference,
  onPreference,
  importSettings,
  onReset,
  onFocus,
  onClose,
  available,
  onUsage,
}: {
  preference: ThemePreference;
  onPreference: (theme: ThemePreference) => void;
  importSettings: ReactNode;
  onReset: () => void;
  onFocus: () => void;
  onClose: () => void;
  available?: number;
  onUsage: () => void;
}) {
  useI18n();
  const [page, setPage] = useState<'settings' | 'formats' | 'help'>('settings');
  const returnTarget = useRef<'formats' | 'help' | null>(null);
  const formatsButton = useRef<HTMLButtonElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const subpage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (page !== 'settings') {
      subpage.current?.focus({ preventScroll: true });
    } else if (returnTarget.current) {
      (returnTarget.current === 'formats' ? formatsButton : helpButton).current?.focus({
        preventScroll: true,
      });
      returnTarget.current = null;
    }
  }, [page]);

  const openPage = (next: 'formats' | 'help') => {
    returnTarget.current = next;
    setPage(next);
  };

  return (
    <Modal
      title={t(page === 'settings' ? '工作台设置' : page === 'formats' ? '图片导入与分辨率' : '工作台帮助')}
      onClose={onClose}
      onBack={page === 'settings' ? undefined : () => setPage('settings')}
      className={page === 'formats' ? 'workspace-settings-dialog import-dialog' : 'workspace-settings-dialog'}
      profile="settings"
    >
      {page !== 'settings' ? (
        <div className="settings-subpage" ref={subpage} tabIndex={-1}>
          {page === 'formats' ? importSettings : <WorkspaceHelpContent />}
        </div>
      ) : (
        <>
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
                  className="theme-choice"
                  key={item.id}
                  data-theme-choice={item.id}
                  aria-pressed={preference === item.id}
                  onClick={() => onPreference(item.id)}
                >
                  {item.id === 'system' ? (
                    <span className="theme-choice-system" aria-hidden><StudioGlyph name="system" size={24} /></span>
                  ) : <ThemeScene dark={item.id === 'dark'} />}
                  <span>{t(item.label)}</span>
                  {preference === item.id && <StudioGlyph name="check" size={13} className="theme-choice-check" />}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-language-section" aria-labelledby="studio-language-title">
            <h3 id="studio-language-title">{t('语言')}</h3>
            <LanguageSelect />
          </section>
          <div className="workspace-settings-list">
            <button type="button" ref={formatsButton} onClick={() => openPage('formats')}>
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
            <button type="button" ref={helpButton} onClick={() => openPage('help')}>
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
        </>
      )}
    </Modal>
  );
}
