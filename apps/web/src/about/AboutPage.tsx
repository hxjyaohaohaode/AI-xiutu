import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, ArrowClockwise } from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { BrandMark } from '../components/BrandMark';
import { StudioGlyph, type StudioGlyphName } from '../components/StudioGlyph';
import { DEFAULT_BRAND, brandLogoUrl } from '../lib/brand';
import type { PublicConfig } from '../lib/types';
import { overviewCopy, type OverviewScreenName } from './overview-copy';
import { useOverviewMotion } from './useOverviewMotion';
import { getSampleImage, type SampleSettings } from './sample-settings';

export const DEMO_IMAGE = getSampleImage();
export type AboutIntent = 'login' | 'register' | 'studio' | 'sample';

const mobileScreens: Partial<Record<OverviewScreenName, string>> = {
  workspace: 'phone',
  local: 'local-phone',
  portrait: 'portrait-phone',
  layers: 'layers-phone',
  library: 'library-phone',
  collaboration: 'collaboration-phone',
  assistant: 'assistant-phone',
  delivery: 'delivery-phone',
};

/** Every image is captured from the running application by the gated browser workflow. */
function ProductScreen({
  name,
  priority = false,
  className = '',
  responsive = true,
}: {
  name: OverviewScreenName;
  priority?: boolean;
  className?: string;
  responsive?: boolean;
}) {
  const locale = useLocale();
  const c = overviewCopy(locale);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const phone = name === 'phone';
  const mobile = responsive ? mobileScreens[name] : undefined;
  const suffix = retry ? '?reload=' + retry : '';
  useEffect(() => {
    setFailed(false);
    setRetry(0);
  }, [name, locale]);
  return (
    <figure
      className={'overview-screen ' + (phone ? 'overview-screen-phone ' : '') + className}
      data-product-screen={name}
      data-responsive-screen={!!mobile}
    >
      <picture hidden={failed}>
        {mobile && (
          <source
            media="(width < 760px)"
            srcSet={'/about/' + mobile + '-' + locale + '.webp' + suffix}
            width={390}
            height={844}
          />
        )}
        <img
          key={name + locale + retry}
          src={'/about/' + name + '-' + locale + '.webp' + suffix}
          alt={c.alts[name]}
          width={phone ? 390 : name === 'tablet' ? 1024 : 1440}
          height={phone ? 844 : name === 'tablet' ? 768 : 960}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : undefined}
          decoding="async"
          onError={() => setFailed(true)}
        />
      </picture>
      {failed && (
        <div className="overview-image-recovery" role="status">
          <StudioGlyph name="works" size={28} />
          <p>{c.screenError}</p>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setRetry((value) => value + 1);
            }}
          >
            <ArrowClockwise size={16} />
            {c.retry}
          </button>
        </div>
      )}
    </figure>
  );
}
function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </>
  );
}
function Capabilities({ items, icons }: { items: string[][]; icons?: StudioGlyphName[] }) {
  return (
    <dl className="overview-capabilities">
      {items.map(([title, body], index) => (
        <div key={title} data-scroll-reveal>
          {icons?.[index] && <StudioGlyph name={icons[index]} size={20} />}
          <dt>{title}</dt>
          <dd>{body}</dd>
        </div>
      ))}
    </dl>
  );
}
function Keywords({ items }: { items: string[] }) {
  return (
    <ul className="overview-keywords">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function AboutPage({
  config,
  onEnter,
  hasStudio,
}: {
  config: PublicConfig | null;
  onEnter: (intent: AboutIntent, settings?: SampleSettings) => void;
  hasStudio: boolean;
}) {
  const locale = useLocale();
  const c = overviewCopy(locale);
  const brand = config?.brand.name || DEFAULT_BRAND;
  const logo = brandLogoUrl(config?.brand);
  const root = useRef<HTMLDivElement>(null);
  useOverviewMotion(root);
  const open = () => onEnter('studio');
  const action = hasStudio ? c.resume : c.start;
  useEffect(() => {
    document.title = brand + ' · ' + c.footer;
    document.querySelector('meta[name="description"]')?.setAttribute('content', c.heroBody);
  }, [brand, c.footer, c.heroBody]);

  return (
    <div
      ref={root}
      className="about-page product-overview-root"
      id="top"
      lang={locale}
      data-locale={locale}
    >
      <a className="overview-skip" href="#about-content">
        {c.skip}
      </a>
      <header className="overview-header">
        <a href="#top" className="overview-brand" aria-label={brand + ' · ' + c.home}>
          <BrandMark logoUrl={logo} />
          <span>{brand}</span>
        </a>
        <nav aria-label={c.home}>
          <a href="#tools">{c.nav[0]}</a>
          <a href="#agent">{c.nav[1]}</a>
          <a href="#together">{c.nav[2]}</a>
        </nav>
        <div className="overview-header-actions">
          <LanguageSelect compact />
          <button type="button" className="overview-sign-in" onClick={() => onEnter('login')}>
            {c.login}
          </button>
          <button type="button" className="overview-start" onClick={open}>
            {action}
            <ArrowUpRight size={16} />
          </button>
        </div>
        <span className="overview-progress" aria-hidden="true" />
      </header>
      <main id="about-content">
        <section
          className="overview-hero"
          data-product-section="hero"
          aria-labelledby="about-title"
        >
          <div className="overview-container overview-hero-heading">
            <div>
              <p className="overview-eyebrow">{c.heroLabel}</p>
              <h1 id="about-title">
                <Lines lines={c.heroTitle} />
              </h1>
            </div>
            <div className="overview-hero-intro">
              <p>{c.heroBody}</p>
              <button type="button" className="overview-primary" onClick={open}>
                {action}
                <ArrowUpRight size={21} />
              </button>
            </div>
          </div>
          <div className="overview-hero-media" data-scroll-expand>
            <div className="overview-expanding-frame">
              <ProductScreen name="workspace" priority />
            </div>
          </div>
          <div className="overview-container overview-hero-caption">
            <span>{c.screen}</span>
            <a href="#tools">
              {c.scroll}
              <ArrowDown size={16} />
            </a>
          </div>
        </section>
        <section
          id="tools"
          className="overview-section overview-craft"
          data-product-section="craft"
          aria-labelledby="craft-title"
        >
          <div className="overview-container">
            <div className="overview-section-heading">
              <div data-scroll-reveal>
                <p className="overview-eyebrow">{c.craftLabel}</p>
                <h2 id="craft-title">
                  <Lines lines={c.craftTitle} />
                </h2>
              </div>
              <p className="overview-body" data-scroll-reveal>
                {c.craftBody}
              </p>
            </div>
            <div className="overview-showcase overview-showcase-local" data-scroll-reveal>
              <ProductScreen name="local" />
            </div>
            <Capabilities items={c.craftItems} icons={['light', 'curves', 'local', 'compare']} />
          </div>
        </section>
        <section
          className="overview-section overview-portrait"
          data-product-section="portrait"
          aria-labelledby="portrait-title"
        >
          <div className="overview-container overview-split-feature">
            <div className="overview-section-copy" data-scroll-reveal>
              <p className="overview-eyebrow">{c.portraitLabel}</p>
              <h2 id="portrait-title">
                <Lines lines={c.portraitTitle} />
              </h2>
              <p className="overview-body">{c.portraitBody}</p>
              <Keywords items={c.portraitItems} />
            </div>
            <div className="overview-portrait-media" data-scroll-reveal>
              <ProductScreen name="portrait" />
            </div>
          </div>
        </section>
        <section
          className="overview-section overview-layers"
          data-product-section="layers"
          aria-labelledby="layers-title"
        >
          <div className="overview-container">
            <div className="overview-section-heading">
              <div data-scroll-reveal>
                <p className="overview-eyebrow">{c.layersLabel}</p>
                <h2 id="layers-title">
                  <Lines lines={c.layersTitle} />
                </h2>
              </div>
              <div data-scroll-reveal>
                <p className="overview-body">{c.layersBody}</p>
                <Keywords items={c.layersItems} />
              </div>
            </div>
            <div className="overview-showcase overview-showcase-layers" data-scroll-reveal>
              <ProductScreen name="layers" />
            </div>
          </div>
        </section>
        <section
          id="agent"
          className="overview-section overview-assistant"
          data-product-section="assistant"
          aria-labelledby="assistant-title"
        >
          <div className="overview-container">
            <div className="overview-section-heading">
              <div data-scroll-reveal>
                <p className="overview-eyebrow">{c.assistantLabel}</p>
                <h2 id="assistant-title">
                  <Lines lines={c.assistantTitle} />
                </h2>
              </div>
              <p className="overview-body" data-scroll-reveal>
                {c.assistantBody}
              </p>
            </div>
            <div className="overview-assistant-layout">
              <ProductScreen name="assistant" />
              <div>
                <ol className="overview-assistant-steps">
                  {c.assistantSteps.map(([title, body], index) => (
                    <li key={title} data-scroll-reveal>
                      <span className="overview-flow-icon">
                        <StudioGlyph
                          name={(['voice', 'compare', 'check'] as const)[index]}
                          size={24}
                        />
                      </span>
                      <div>
                        <h3>{title}</h3>
                        <p>{body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="overview-service-note">{c.assistantNote}</p>
              </div>
            </div>
          </div>
        </section>
        <section
          id="together"
          className="overview-section overview-together"
          data-product-section="together"
          aria-labelledby="together-title"
        >
          <div className="overview-container">
            <div className="overview-section-heading">
              <div data-scroll-reveal>
                <p className="overview-eyebrow">{c.togetherLabel}</p>
                <h2 id="together-title">
                  <Lines lines={c.togetherTitle} />
                </h2>
              </div>
              <p className="overview-body" data-scroll-reveal>
                {c.togetherBody}
              </p>
            </div>
            <div className="overview-showcase overview-showcase-team" data-scroll-reveal>
              <ProductScreen name="collaboration" />
            </div>
            <Capabilities
              items={c.togetherItems}
              icons={['works', 'collaborate', 'history', 'docs']}
            />
            <div className="overview-library-layout">
              <div data-scroll-reveal>
                <h3>{c.libraryTitle}</h3>
                <p className="overview-body">{c.libraryBody}</p>
              </div>
              <div data-scroll-reveal>
                <ProductScreen name="library" />
              </div>
            </div>
            <div className="overview-devices">
              <div className="overview-device-copy" data-scroll-reveal>
                <StudioGlyph name="system" size={28} />
                <h3>{c.devicesTitle}</h3>
                <p>{c.devicesBody}</p>
              </div>
              <div className="overview-device-tablet" data-scroll-reveal>
                <ProductScreen name="tablet" responsive={false} />
                <span>{c.deviceLabels[0]}</span>
              </div>
              <div className="overview-device-phone" data-scroll-reveal>
                <ProductScreen name="phone" />
                <span>{c.deviceLabels[1]}</span>
              </div>
            </div>
          </div>
        </section>
        <section
          className="overview-section overview-delivery"
          data-product-section="delivery"
          aria-labelledby="delivery-title"
        >
          <div className="overview-container">
            <div className="overview-section-heading">
              <div data-scroll-reveal>
                <p className="overview-eyebrow">{c.deliveryLabel}</p>
                <h2 id="delivery-title">
                  <Lines lines={c.deliveryTitle} />
                </h2>
              </div>
              <div data-scroll-reveal>
                <p className="overview-body">{c.deliveryBody}</p>
                <Keywords items={c.deliveryItems} />
              </div>
            </div>
            <div className="overview-delivery-media" data-scroll-reveal>
              <ProductScreen name="delivery" />
            </div>
            <button type="button" className="overview-text-action" onClick={open}>
              {c.deliveryAction}
              <ArrowUpRight size={19} />
            </button>
          </div>
        </section>
        <section
          id="questions"
          className="overview-section overview-questions"
          data-product-section="questions"
          aria-labelledby="questions-title"
        >
          <div className="overview-container">
            <h2 id="questions-title">{c.questionsTitle}</h2>
            <dl>
              {c.questions.map(([question, answer]) => (
                <div key={question} data-scroll-reveal>
                  <dt>{question}</dt>
                  <dd>{answer}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
        <section className="overview-end" data-product-section="end" aria-labelledby="end-title">
          <div className="overview-container">
            <BrandMark logoUrl={logo} />
            <h2 id="end-title">{c.endTitle}</h2>
            <button type="button" className="overview-primary" onClick={open}>
              {action}
              <ArrowUpRight size={21} />
            </button>
          </div>
        </section>
      </main>
      <footer className="overview-footer overview-container">
        <div>
          <span>{brand}</span>
          <small>{c.footer}</small>
        </div>
        <a href="#top">
          {c.backTop}
          <ArrowUp size={16} />
        </a>
      </footer>
    </div>
  );
}
