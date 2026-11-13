import {
  OpeningEffects, OverviewCursor, EditEffects, PortraitOrbit, LayerEffects, AIExamples,
  AssistantVoiceStory, TeamReviewStory, LibraryEffects, DeliveryEffects, reviewCapture,
} from './AboutEffects';
import { useContext, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, ArrowClockwise } from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { BrandMark } from '../components/BrandMark';
import { ThemeContext, ThemeSwitch } from '../components/ThemeSwitch';
import { aboutDetails } from './overview-details';
import { StudioGlyph, type StudioGlyphName } from '../components/StudioGlyph';
import { DEFAULT_BRAND, brandLogoUrl } from '../lib/brand';
import type { PublicConfig } from '../lib/types';
import { overviewCopy, type OverviewScreenName } from './overview-copy';
import { useOverviewMotion } from './useOverviewMotion';
import { overviewStories } from './overview-stories';
import { getSampleImage, type SampleSettings } from './sample-settings';

export const DEMO_IMAGE = getSampleImage();
export type AboutIntent = 'login' | 'register' | 'studio' | 'sample';

const captureNames: Partial<Record<OverviewScreenName, string>> = {
  layers: 'sketch',
};
const mobileScreens: Partial<Record<OverviewScreenName, string>> = {
  workspace: 'phone',
  local: 'local-phone',
  collaboration: 'collaboration-phone',
  library: 'library-phone',
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
  const theme = useContext(ThemeContext)?.theme ?? 'light';
  const screen = captureNames[name] ?? name;
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const phone = name === 'phone';
  const mobile = responsive ? mobileScreens[name] : undefined;
  const suffix = retry ? '?reload=' + retry : '';
  useEffect(() => {
    setFailed(false);
    setRetry(0);
  }, [name, locale, theme]);
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
            srcSet={reviewCapture(mobile + '-' + locale, theme) + suffix}
            width={390}
            height={844}
          />
        )}
        {responsive && name === 'workspace' && (
          <source
            media="(min-width: 760px) and (max-width: 1100px)"
            srcSet={reviewCapture('tablet-' + locale, theme) + suffix}
            width={1024}
            height={768}
          />
        )}
        <img
          key={name + locale + theme + retry}
          src={reviewCapture(screen + '-' + locale, theme) + suffix}
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
  const story = overviewStories(locale);
  const details = aboutDetails(locale);
  const theme = useContext(ThemeContext)?.theme ?? 'light';
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
      <OverviewCursor scope={root} theme={theme} />
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
          <ThemeSwitch />
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
          <OpeningEffects theme={theme} />
          <div className="overview-container overview-hero-heading">
            <div>
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
          <div className="overview-hero-media overview-annotated">
            <img className="overview-annotation-art" src="/about/editing-annotations.webp" alt="" decoding="async" />
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
                <h2 id="craft-title">
                  <Lines lines={c.craftTitle} />
                </h2>
              </div>
              <p className="overview-body" data-scroll-reveal>
                {c.craftBody}
              </p>
            </div>
            <div className="about-craft-story">
              <EditEffects labels={story} />
              <div className="overview-showcase overview-showcase-local" data-scroll-reveal>
                <ProductScreen name="local" />
                <div className="about-local-caption">
                  <strong>{details.local}</strong>
                  <dl>{details.localValues.map(([label, value]) =>
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                  )}</dl>
                </div>
              </div>
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
              <h2 id="portrait-title">
                <Lines lines={details.portraitTitle} />
              </h2>
              <p className="overview-body">{details.portraitIntro}</p>
            </div>
            <div className="overview-portrait-media" data-scroll-reveal>
              <PortraitOrbit copy={details} theme={theme} locale={locale} />
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
              <LayerEffects copy={details} theme={theme} locale={locale} screen={<ProductScreen name="layers" />} />
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
                <h2 id="assistant-title">
                  <Lines lines={c.assistantTitle} />
                </h2>
              </div>
              <p className="overview-body" data-scroll-reveal>
                {c.assistantBody}
              </p>
            </div>
            <AIExamples labels={story} copy={details} />
            <section className="overview-assistant-layout about-voice-section" aria-labelledby="about-voice-title">
              <header className="about-voice-heading">
                <h3 id="about-voice-title">{story.voiceTitle}</h3>
                <p>{details.voiceLead}</p>
              </header>
              <AssistantVoiceStory labels={story} copy={details} theme={theme} />
            </section>
            <div className="about-assistant-followup">
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
                <h2 id="together-title">
                  <Lines lines={c.togetherTitle} />
                </h2>
              </div>
              <p className="overview-body" data-scroll-reveal>
                {c.togetherBody}
              </p>
            </div>
            <div className="overview-showcase overview-showcase-team" data-scroll-reveal>
              <TeamReviewStory copy={details} theme={theme} locale={locale} />
              <div>
                <ProductScreen name="collaboration" />
                <span className="about-screen-caption">{details.reviewQueue}</span>
              </div>
            </div>
            <Capabilities
              items={c.togetherItems}
              icons={['works', 'collaborate', 'history', 'docs']}
            />
          </div>
          <LibraryEffects copy={details} theme={theme} locale={locale}
            heading={c.libraryTitle} description={c.libraryBody} screen={<ProductScreen name="library" />} />
          <div className="overview-container">
            <div className="overview-devices">
              <div className="overview-device-copy" data-scroll-reveal>
                <h3>{c.devicesTitle}</h3>
                <p>{c.devicesBody}</p>
              </div>
              <div className="overview-device-desktop" data-scroll-reveal>
                <ProductScreen name="desktop-flow" responsive={false} />
                <p><strong>{story.desktop[0]}</strong> · {story.desktop[1]}</p>
              </div>
              <div className="overview-device-phone" data-scroll-reveal>
                <ProductScreen name="phone" />
                <p><strong>{story.phone[0]}</strong> · {story.phone[1]}</p>
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
              <DeliveryEffects labels={story} screen={<ProductScreen name="delivery" />} />
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
            <h2 id="end-title">{c.endTitle}</h2>
            <button type="button" className="overview-primary" onClick={open}>
              {action}
              <ArrowUpRight size={21} />
            </button>
          </div>
          <div className="overview-end-flow">
            {[false, true].map((repeat) => (
              <div className="overview-end-line" key={String(repeat)} aria-hidden={repeat || undefined}>
                {details.closing.map((line) => (
                  <span key={line}><BrandMark logoUrl={logo} /><span>{line}</span></span>
                ))}
              </div>
            ))}
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
