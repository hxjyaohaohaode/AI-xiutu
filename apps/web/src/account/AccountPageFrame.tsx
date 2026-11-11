import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowClockwise, ArrowLeft, ImageSquare } from '@phosphor-icons/react';
import { Brand } from '../components/Ui';
import { BrandMark } from '../components/BrandMark';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { useLocale } from '../i18n';
import { brandLogoUrl, DEFAULT_BRAND } from '../lib/brand';
import type { PublicConfig } from '../lib/types';
import { accountPageCopy } from './page-copy';
import './account-page.css';

function ProductPreview({ config }: { config: PublicConfig | null }) {
  const locale = useLocale();
  const c = accountPageCopy(locale);
  const src = `/about/workspace-${locale}.webp`;
  const img = useRef<HTMLImageElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'pending' | 'ready' | 'error'>('pending');
  useEffect(() => {
    setState(img.current?.complete && img.current.naturalWidth ? 'ready' : 'pending');
  }, [src, attempt]);

  return (
    <figure className="account-product">
      <figcaption className="account-product-caption">
        <BrandMark logoUrl={brandLogoUrl(config?.brand)} />
        <span>{config?.brand.name || DEFAULT_BRAND}</span>
        <small>{c.workbench}</small>
      </figcaption>
      <div
        className="account-product-preview"
        data-image-state={state}
        aria-busy={state === 'pending'}
      >
        <img
          ref={img}
          key={`${src}:${attempt}`}
          src={src}
          alt={c.previewAlt}
          width="1440"
          height="960"
          decoding="async"
          onLoad={() => setState('ready')}
          onError={() => setState('error')}
        />
        {state === 'pending' && <span className="account-product-skeleton" aria-hidden="true" />}
        {state === 'error' && (
          <div className="account-product-error" role="status">
            <ImageSquare size={22} aria-hidden />
            <span>{c.previewFailed}</span>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              <ArrowClockwise size={15} aria-hidden />
              {c.retry}
            </button>
          </div>
        )}
      </div>
      <ul className="account-product-notes" aria-label={c.features}>
        <li>
          <i aria-hidden="true">01</i>
          {c.color}
        </li>
        <li>
          <i aria-hidden="true">02</i>
          {c.versions}
        </li>
        <li>
          <i aria-hidden="true">03</i>
          {c.assistant}
        </li>
      </ul>
    </figure>
  );
}

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
          <aside className="account-page-art" aria-label={c.eyebrow}>
            <div className="account-page-art-copy">
              <span>{c.eyebrow}</span>
              <p>
                {c.lineOne}
                <br />
                {c.lineTwo}
              </p>
            </div>
            <ProductPreview config={config} />
            <span className="account-page-art-caption">{c.caption}</span>
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
