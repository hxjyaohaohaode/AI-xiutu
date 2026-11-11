import { GlobeHemisphereWest } from '@phosphor-icons/react';
import { isLocale, preloadLocale, setLocale, t, useLocaleState } from './index';
import './language.css';

export function LanguageSelect({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  const { locale, pending, failed } = useLocaleState();
  const prepareLanguages = () => {
    for (const next of ['en', 'zh-TW'] as const)
      void preloadLocale(next).catch(() => {
        /* A deliberate switch offers retry. */
      });
  };
  return (
    <div className={`language-select${compact ? ' language-select--compact' : ''} ${className}`}>
      <label className="language-select__control" onPointerEnter={prepareLanguages}>
        {pending ? (
          <span className="language-select__busy" aria-hidden />
        ) : (
          <GlobeHemisphereWest size={17} aria-hidden />
        )}
        <span className="sr-only">{t('语言')}</span>
        <select
          aria-label={t('语言')}
          aria-busy={!!pending}
          value={pending ?? locale}
          onFocus={prepareLanguages}
          onChange={(event) => {
            if (isLocale(event.target.value))
              void setLocale(event.target.value).catch(() => {
                /* Visible status below. */
              });
          }}
        >
          <option lang="zh-CN" value="zh-CN">
            {compact ? '简中' : '简体中文'}
          </option>
          <option lang="zh-TW" value="zh-TW">
            {compact ? '繁中' : '繁體中文'}
          </option>
          <option lang="en" value="en">
            {compact ? 'EN' : 'English'}
          </option>
        </select>
      </label>
      {pending && (
        <span className="sr-only" role="status">
          {t('正在加载语言…')}
        </span>
      )}
      {failed && (
        <div className="language-select__feedback" role="alert">
          <p>{t('语言加载失败，请重试。')}</p>
          <button
            type="button"
            onClick={() => {
              void setLocale(failed).catch(() => {});
            }}
          >
            {t('重试')}
          </button>
        </div>
      )}
    </div>
  );
}
