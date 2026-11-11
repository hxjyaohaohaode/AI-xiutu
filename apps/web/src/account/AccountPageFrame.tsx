import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight } from '@phosphor-icons/react';
import { Brand } from '../components/Ui';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { useLocale } from '../i18n';
import { brandLogoUrl, DEFAULT_BRAND } from '../lib/brand';
import type { PublicConfig } from '../lib/types';
import { accountPageCopy } from './page-copy';
import './account-page.css';

/** A document page, never a dialog: the retained editor lives outside this surface. */
export function AccountPageFrame({
  title,
  description,
  config,
  onBack,
  onHome,
  backLabel,
  busy = false,
  wide = false,
  className = '',
  children,
}: {
  title: string;
  description?: string;
  config: PublicConfig | null;
  onBack: () => void;
  onHome?: () => void;
  backLabel?: string;
  busy?: boolean;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const c = accountPageCopy(useLocale());
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  useEffect(() => {
    const current = document.activeElement;
    if (!current || current === document.body || current.closest('[hidden], [inert]'))
      heading.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    document.title = `${title} · ${config?.brand.name || DEFAULT_BRAND}`;
  }, [title, config?.brand.name]);
  return (
    <section
      className={`account-page ${wide ? 'account-page--wide' : ''} ${className}`}
      aria-labelledby={titleId}
      data-testid="account-page"
    >
      <header className="account-page-header">
        <button
          type="button"
          className="account-page-brand"
          onClick={onHome ?? onBack}
          disabled={busy}
          aria-label={c.home}
        >
          <Brand name={config?.brand.name} logoUrl={brandLogoUrl(config?.brand)} />
        </button>
        <div className="account-page-header-actions">
          <LanguageSelect compact />
          <button type="button" className="account-page-back" onClick={onBack} disabled={busy}>
            <ArrowLeft size={17} aria-hidden />
            <span>{backLabel ?? c.back}</span>
          </button>
        </div>
      </header>
      <main className="account-page-main">
        {!wide && (
          <aside className="account-page-art" aria-hidden="true">
            <div className="account-page-art-image">
              <img src="/about/color-study.webp" alt="" width="1536" height="1024" />
            </div>
            <div className="account-page-art-copy">
              <span>{c.eyebrow}</span>
              <p>
                {c.lineOne}
                <br />
                {c.lineTwo}
              </p>
            </div>
            <span className="account-page-art-caption">
              {c.caption}
              <ArrowUpRight size={19} />
            </span>
          </aside>
        )}
        <div className="account-page-content">
          <header className="account-page-heading">
            <h1 id={titleId} ref={heading} tabIndex={-1}>
              {title}
            </h1>
            {description && <p>{description}</p>}
          </header>
          {children}
        </div>
      </main>
    </section>
  );
}
