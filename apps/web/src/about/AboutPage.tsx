import { useEffect, useRef } from 'react';
import {
  ArrowDown, ArrowUp, ArrowUpRight, Check, ChatsCircle,
  FolderSimple, ImageSquare, Microphone, SlidersHorizontal,
  Sparkle, Stack, TextAa, UsersThree,
} from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { BrandMark } from '../components/BrandMark';
import { DEFAULT_BRAND, brandLogoUrl } from '../lib/brand';
import type { PublicConfig } from '../lib/types';
import { overviewCopy } from './overview-copy';
import { useOverviewMotion } from './useOverviewMotion';
import { getSampleImage, type SampleSettings } from './sample-settings';

export const DEMO_IMAGE = getSampleImage();
export type AboutIntent = 'login' | 'register' | 'studio' | 'sample';

type ScreenName = 'workspace' | 'local' | 'portrait' | 'layers' | 'tablet' | 'phone';

function ProductScreen({ name, priority = false, className = '' }: {
  name: ScreenName;
  priority?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const c = overviewCopy(locale);
  const phone = name === 'phone';
  return (
    <figure className={'overview-screen ' + className} data-product-screen={name}>
      <img
        key={name + locale}
        src={'/about/' + name + '-' + locale + '.webp'}
        alt={c.alts[name]}
        width={phone ? 390 : name === 'tablet' ? 1024 : 1440}
        height={phone ? 844 : name === 'tablet' ? 768 : 960}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        decoding="async"
      />
    </figure>
  );
}

function Lines({ lines }: { lines: string[] }) {
  return <>{lines.map((line) => <span key={line}>{line}</span>)}</>;
}

function FeatureList({ items }: { items: string[][] }) {
  return (
    <dl className="overview-features">
      {items.map(([title, body]) => (
        <div key={title}>
          <dt>{title}</dt>
          <dd>{body}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AboutPage({ config, onEnter, hasStudio }: {
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
    <div ref={root} className="about-page product-overview-root" id="top" lang={locale} data-locale={locale}>
      <a className="overview-skip" href="#about-content">{c.skip}</a>
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
          <button type="button" className="overview-sign-in" onClick={() => onEnter('login')}>{c.login}</button>
          <button type="button" className="overview-start" onClick={open}>
            {action}<ArrowUpRight size={16} />
          </button>
        </div>
        <span className="overview-progress" aria-hidden="true" />
      </header>

      <main id="about-content">
        <section className="overview-hero" data-product-section="hero" aria-labelledby="about-title">
          <div className="overview-container overview-hero-copy">
            <p className="overview-eyebrow">{c.heroLabel}</p>
            <h1 id="about-title"><Lines lines={c.heroTitle} /></h1>
            <div className="overview-hero-bottom">
              <p>{c.heroBody}</p>
              <button type="button" className="overview-primary" onClick={open}>
                {action}<ArrowUpRight size={23} />
              </button>
            </div>
          </div>
          <div className="overview-hero-media" data-scroll-expand>
            <ProductScreen name="workspace" priority />
          </div>
          <div className="overview-container overview-hero-caption">
            <span><span className="overview-status-dot" aria-hidden="true" />{c.screen}</span>
            <a href="#tools">{c.scroll}<ArrowDown size={17} /></a>
          </div>
        </section>

        <section id="tools" className="overview-section overview-craft" data-product-section="craft" aria-labelledby="craft-title">
          <div className="overview-container overview-feature-layout">
            <div className="overview-section-copy" data-scroll-reveal>
              <p className="overview-eyebrow">{c.craftLabel}</p>
              <h2 id="craft-title"><Lines lines={c.craftTitle} /></h2>
              <p className="overview-body">{c.craftBody}</p>
              <FeatureList items={c.craftItems} />
            </div>
            <div className="overview-media-well overview-well-gold" data-scroll-reveal>
              <ProductScreen name="local" />
            </div>
          </div>
        </section>

        <section className="overview-section overview-portrait" data-product-section="portrait" aria-labelledby="portrait-title">
          <div className="overview-container overview-feature-layout overview-reverse">
            <div className="overview-section-copy" data-scroll-reveal>
              <p className="overview-eyebrow">{c.portraitLabel}</p>
              <h2 id="portrait-title"><Lines lines={c.portraitTitle} /></h2>
              <p className="overview-body">{c.portraitBody}</p>
              <ul className="overview-keywords">{c.portraitItems.map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div className="overview-media-well overview-well-rose" data-scroll-reveal>
              <ProductScreen name="portrait" />
            </div>
          </div>
        </section>

        <section className="overview-section overview-layers" data-product-section="layers" aria-labelledby="layers-title">
          <div className="overview-container overview-feature-layout">
            <div className="overview-section-copy" data-scroll-reveal>
              <p className="overview-eyebrow">{c.layersLabel}</p>
              <h2 id="layers-title"><Lines lines={c.layersTitle} /></h2>
              <p className="overview-body">{c.layersBody}</p>
              <ul className="overview-keywords">{c.layersItems.map((item) => <li key={item}>{item}</li>)}</ul>
              <div className="overview-tool-marks" aria-hidden="true">
                <ImageSquare /><TextAa /><SlidersHorizontal /><Stack />
              </div>
            </div>
            <div className="overview-media-well overview-well-blue" data-scroll-reveal>
              <ProductScreen name="layers" />
            </div>
          </div>
        </section>

        <section id="agent" className="overview-section overview-assistant" data-product-section="assistant" aria-labelledby="assistant-title">
          <div className="overview-container">
            <div className="overview-wide-heading" data-scroll-reveal>
              <div>
                <p className="overview-eyebrow">{c.assistantLabel}</p>
                <h2 id="assistant-title"><Lines lines={c.assistantTitle} /></h2>
              </div>
              <p className="overview-body">{c.assistantBody}</p>
            </div>
            <ol className="overview-assistant-steps">
              {c.assistantSteps.map(([title, body], index) => {
                const Icon = [Microphone, Sparkle, Check][index]!;
                return (
                  <li key={title} data-scroll-reveal>
                    <div className="overview-step-top">
                      <span className="overview-step-number">{'0' + (index + 1)}</span>
                      <Icon size={40} weight="light" aria-hidden="true" />
                    </div>
                    <h3>{title}</h3><p>{body}</p>
                  </li>
                );
              })}
            </ol>
            <p className="overview-service-note">{c.assistantNote}</p>
          </div>
        </section>

        <section id="together" className="overview-section overview-together" data-product-section="together" aria-labelledby="together-title">
          <div className="overview-container">
            <div className="overview-wide-heading" data-scroll-reveal>
              <div>
                <p className="overview-eyebrow">{c.togetherLabel}</p>
                <h2 id="together-title"><Lines lines={c.togetherTitle} /></h2>
              </div>
              <p className="overview-body">{c.togetherBody}</p>
            </div>
            <div className="overview-team-features">
              {c.togetherItems.map(([title, body], index) => {
                const Icon = [FolderSimple, ChatsCircle, UsersThree][index]!;
                return (
                  <article key={title} data-scroll-reveal>
                    <Icon size={30} weight="light" aria-hidden="true" />
                    <h3>{title}</h3><p>{body}</p>
                  </article>
                );
              })}
            </div>
            <div className="overview-device-heading" data-scroll-reveal>
              <h3>{c.devicesTitle}</h3><p>{c.devicesBody}</p>
            </div>
            <div className="overview-device-stage">
              <div data-scroll-reveal><ProductScreen name="tablet" /><span>{c.deviceLabels[0]}</span></div>
              <div data-scroll-reveal><ProductScreen name="phone" /><span>{c.deviceLabels[1]}</span></div>
            </div>
          </div>
        </section>

        <section className="overview-section overview-delivery" data-product-section="delivery" aria-labelledby="delivery-title">
          <div className="overview-container overview-delivery-layout">
            <div data-scroll-reveal>
              <p className="overview-eyebrow">{c.deliveryLabel}</p>
              <h2 id="delivery-title"><Lines lines={c.deliveryTitle} /></h2>
            </div>
            <div data-scroll-reveal>
              <p className="overview-body">{c.deliveryBody}</p>
              <ul className="overview-delivery-options">
                {c.deliveryItems.map((item) => <li key={item}><Check size={19} aria-hidden="true" />{item}</li>)}
              </ul>
              <button type="button" className="overview-text-action" onClick={open}>
                {c.deliveryAction}<ArrowUpRight size={21} />
              </button>
            </div>
          </div>
        </section>

        <section id="questions" className="overview-section overview-questions" data-product-section="questions" aria-labelledby="questions-title">
          <div className="overview-container">
            <h2 id="questions-title">{c.questionsTitle}</h2>
            <dl>
              {c.questions.map(([question, answer]) => (
                <div key={question} data-scroll-reveal><dt>{question}</dt><dd>{answer}</dd></div>
              ))}
            </dl>
          </div>
        </section>

        <section className="overview-end" data-product-section="end" aria-labelledby="end-title">
          <div className="overview-container" data-scroll-reveal>
            <BrandMark logoUrl={logo} />
            <h2 id="end-title">{c.endTitle}</h2>
            <button type="button" className="overview-primary" onClick={open}>
              {action}<ArrowUpRight size={23} />
            </button>
          </div>
        </section>
      </main>

      <footer className="overview-footer overview-container">
        <div><span>{brand}</span><small>{c.footer}</small></div>
        <a href="#top">{c.backTop}<ArrowUp size={16} /></a>
      </footer>
    </div>
  );
}
