import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  CirclesThreePlus,
  Cursor,
  GitBranch,
  ImageSquare,
  Stack,
  MagicWand,
  Plus,
  Scan,
  SlidersHorizontal,
  Sparkle,
  UsersThree,
} from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { DEFAULT_BRAND, brandLogoUrl } from '../lib/brand';
import type { PublicConfig } from '../lib/types';
import { aboutCopy } from './copy';
import { experienceCopy } from './experience-copy';
import { ColorStudy } from './ColorStudy';
import { HoverPreview, PointerRibbons, ScrollReveal } from './effects';
import { getSampleImage, type SampleSettings } from './sample-settings';

export const DEMO_IMAGE = getSampleImage();
export type AboutIntent = 'login' | 'register' | 'studio' | 'sample';
const samplePresets: SampleSettings[] = [
  { sampleId: 'coast', warmth: 12, exposure: 0.05, preset: 'natural' },
  { sampleId: 'portrait', warmth: 4, exposure: 0.15, preset: 'soft' },
  { sampleId: 'color-study', warmth: 18, exposure: 0.1, preset: 'vivid' },
];
const featureIcons = [SlidersHorizontal, Scan, MagicWand, Stack];
const screenshotNames = ['workspace', 'local', 'portrait', 'layers'];

function ProductImage({
  name = 'workspace',
  eager = false,
  mobile = false,
}: {
  name?: string;
  eager?: boolean;
  mobile?: boolean;
}) {
  const locale = useLocale();
  const e = experienceCopy(locale);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);
  const src = `/about/${name}-${locale}.webp`;
  const toolIndex = Math.max(0, screenshotNames.indexOf(name));
  useEffect(() => {
    setFailed(false);
    setLoaded(Boolean(imageRef.current?.complete && imageRef.current?.naturalWidth));
  }, [src, attempt]);
  return (
    <div
      className={'experience-product-image' + (mobile ? ' is-phone' : '')}
      data-pointer-protect
      aria-busy={!loaded && !failed}
    >
      <img
        key={attempt}
        ref={imageRef}
        src={src}
        width={mobile ? 390 : 1440}
        height={mobile ? 844 : 960}
        alt={mobile ? e.phoneAlt : `${e.features[toolIndex]!.title} · ${e.screenshotAlt}`}
        loading={eager ? 'eager' : 'lazy'}
        fetchPriority={eager ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      {!loaded && !failed && <span className="experience-image-pending" aria-hidden="true" />}
      {failed && (
        <span className="experience-image-failed" role="status">
          <ImageSquare size={28} />
          {e.imageFailed}
          <button type="button" onClick={() => setAttempt((value) => value + 1)}>
            {locale === 'en' ? 'Try again' : locale === 'zh-TW' ? '重新載入' : '重新加载'}
          </button>
        </span>
      )}
    </div>
  );
}

function AgentDiagram({ step }: { step: number }) {
  const locale = useLocale();
  const e = experienceCopy(locale);
  const icons = [ImageSquare, CirclesThreePlus, SlidersHorizontal, GitBranch];
  const ActiveIcon = icons[step]!;
  return (
    <figure className="experience-agent-diagram" aria-label={e.diagram} data-step={step}>
      <div className="agent-diagram-top">
        <span className="agent-diagram-mark">
          <Sparkle size={24} weight="light" />
        </span>
        <span>{e.diagram}</span>
        <span className="agent-diagram-count">0{step + 1} / 04</span>
      </div>
      <div className="agent-art-stage">
        <div className="agent-art-source">
          <img src="/about/coast.webp" alt="" loading="lazy" width="1536" height="1024" />
          <span>
            <ImageSquare size={14} />
            {e.agentSteps[0]!.items[0]}
          </span>
        </div>
        <svg className="agent-art-connectors" viewBox="0 0 540 360" fill="none" aria-hidden="true">
          <path d="M110 95C200 95 165 180 270 180S330 265 430 265" />
          <path
            className="agent-art-flow"
            d="M110 95C200 95 165 180 270 180S330 265 430 265"
            pathLength="1"
            style={{ strokeDasharray: 1, strokeDashoffset: 1 - (step + 1) / 4 }}
          />
        </svg>
        <div className="agent-art-node" key={step}>
          <ActiveIcon size={35} weight="light" />
          <span>{e.agentSteps[step]!.detail}</span>
        </div>
        <div className="agent-art-output">
          <div>
            {e.agentSteps[step]!.items.map((item, i) => (
              <span key={item}>
                <i style={{ '--item-index': i } as CSSProperties} />
                {item}
              </span>
            ))}
          </div>
          <Check size={19} />
        </div>
      </div>
      <figcaption>
        {e.agentSteps[step]!.title}
        <ArrowRight size={18} />
      </figcaption>
    </figure>
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
  const c = aboutCopy(locale);
  const e = experienceCopy(locale);
  const brand = config?.brand.name || DEFAULT_BRAND;
  const logo = brandLogoUrl(config?.brand);
  const page = useRef<HTMLDivElement>(null);
  const progress = useRef<HTMLSpanElement>(null);
  const tour = useRef<HTMLDivElement>(null);
  const [feature, setFeature] = useState(0);
  const [step, setStep] = useState(0);
  const [question, setQuestion] = useState<number | null>(0);
  const hoverOpenedQuestion = useRef<number | null>(null);
  const go = () => onEnter(hasStudio ? 'studio' : 'register');
  useEffect(() => {
    document.title = brand + ' · ' + c.footer;
    document.querySelector('meta[name="description"]')?.setAttribute('content', e.heroDetail);
  }, [brand, c.footer, e.heroDetail]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const full = document.documentElement.scrollHeight - innerHeight;
      progress.current?.style.setProperty(
        '--reading-progress',
        String(full > 0 ? Math.min(1, scrollY / full) : 0),
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);
  useEffect(() => {
    if (!tour.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.chapter);
            if (Number.isFinite(index)) setFeature(index);
          }
      },
      { rootMargin: '-24% 0px -50% 0px', threshold: 0 },
    );
    tour.current.querySelectorAll('[data-chapter]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);
  const questions = [
    [c.q1, c.a1],
    [c.q2, c.a2],
    [c.q3, c.a3],
    [c.q4, c.a4],
    [c.q5, c.a5],
  ];
  return (
    <div className="about-page experience-page" ref={page} data-locale={locale} id="top">
      <a className="about-skip" href="#about-main">
        {locale === 'en' ? 'Skip to content' : locale === 'zh-TW' ? '跳至主要內容' : '跳至主要内容'}
      </a>
      <header className="about-header">
        <a className="about-brand" href="#/" aria-label={brand}>
          {logo ? (
            <img src={logo} alt="" />
          ) : (
            <span className="about-symbol" aria-hidden="true">
              <span />
              <span />
            </span>
          )}
          <span>{brand}</span>
        </a>
        <nav aria-label={c.overview}>
          <div className="experience-nav-explore">
            <a href="#create">
              {e.navigation}
              <Plus size={12} />
            </a>
            <div className="experience-nav-preview">
              <img src="/about/coast.webp" alt="" width="1536" height="1024" />
              <div>
                <a href="#create">
                  {c.precise}
                  <ArrowUpRight size={14} />
                </a>
                <a href="#agent">
                  {e.agent}
                  <ArrowUpRight size={14} />
                </a>
                <a href="#samples">
                  {e.samples}
                  <ArrowUpRight size={14} />
                </a>
              </div>
            </div>
          </div>
          <a href="#agent">Agent</a>
          <a href="#samples">{e.samples}</a>
        </nav>
        <div className="about-header-actions">
          <LanguageSelect compact />
          <button type="button" className="about-login" onClick={() => onEnter('login')}>
            {c.login}
          </button>
          <button type="button" className="about-header-start" onClick={go}>
            {hasStudio ? c.continue : c.start}
            <ArrowUpRight size={16} />
          </button>
        </div>
        <span className="experience-reading-track" aria-hidden="true">
          <span ref={progress} />
        </span>
      </header>
      <main id="about-main">
        <section className="about-hero">
          <PointerRibbons tone="ink" />
          <div className="about-hero-copy">
            <p className="about-eyebrow">
              <span />
              {e.heroLabel}
            </p>
            <h1>
              <span>{c.titleOne}</span>
              <span>
                {locale === 'en'
                  ? 'entirely yours.'
                  : locale === 'zh-TW'
                    ? '自由成像。'
                    : '自由成像。'}
              </span>
            </h1>
            <p className="about-intro">{e.heroDetail}</p>
            <div className="about-hero-actions">
              <button type="button" className="about-primary" onClick={go}>
                {hasStudio ? c.continue : c.start}
                <ArrowUpRight size={21} />
              </button>
              <button type="button" className="about-local" onClick={() => onEnter('studio')}>
                {c.local}
                <ArrowRight size={17} />
              </button>
            </div>
            <span className="experience-hero-note">{e.heroNote}</span>
          </div>
          <div className="experience-hero-studio" data-pointer-protect>
            <div className="experience-window-label">
              <span>
                <i />
                <i />
                <i />
              </span>
              <span>{e.heroImage}</span>
              <span>{e.screenshot}</span>
            </div>
            <HoverPreview className="experience-hero-window">
              <ProductImage eager />
            </HoverPreview>
            <div className="experience-hero-caption">
              <span>
                <SlidersHorizontal size={16} />
                {e.features[0]!.caption}
              </span>
              <a href="#create">
                {e.explore}
                <ArrowDown size={15} />
              </a>
            </div>
          </div>
        </section>

        <section className="about-create experience-section" id="create">
          <div className="experience-section-top">
            <span className="about-index">01 / {e.navigation}</span>
            <span>{brand}</span>
          </div>
          <ScrollReveal as="h2" mode="scrub" splitWords>
            {e.tourTitle}
          </ScrollReveal>
          <p className="experience-section-intro">{e.tourBody}</p>
          <div className="experience-tour" ref={tour}>
            <div className="experience-feature-list">
              {e.features.map((item, index) => {
                const Icon = featureIcons[index]!;
                return (
                  <article
                    className="experience-feature"
                    data-active={feature === index}
                    data-chapter={index}
                    key={index}
                    onPointerEnter={(event) => {
                      if (event.pointerType === 'mouse') setFeature(index);
                    }}
                    onFocus={() => setFeature(index)}
                  >
                    <h3>
                      <button
                        type="button"
                        onClick={() => setFeature(index)}
                        aria-pressed={feature === index}
                        aria-controls="tour-preview"
                      >
                        <span className="experience-feature-number">0{index + 1}</span>
                        <span>{item.title}</span>
                        <Icon size={23} weight="light" />
                      </button>
                    </h3>
                    <p>{item.body}</p>
                    <div className="experience-tags">
                      {item.tags.map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                    <div className="experience-feature-mobile">
                      <ProductImage name={screenshotNames[index]} />
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="experience-tour-visual" id="tour-preview">
              <HoverPreview>
                <figure className="experience-tour-frame" data-pointer-protect>
                  <div className="experience-tour-images">
                    {screenshotNames.map((name, index) => (
                      <div
                        className="experience-tour-image"
                        key={name}
                        data-active={feature === index}
                        aria-hidden={feature !== index}
                      >
                        <ProductImage name={name} />
                      </div>
                    ))}
                  </div>
                  <figcaption>
                    <span>
                      0{feature + 1} / {e.screenshot}
                    </span>
                    <p>{e.features[feature]!.caption}</p>
                  </figcaption>
                </figure>
              </HoverPreview>
            </div>
          </div>
        </section>

        <section className="experience-agent" id="agent">
          <div className="experience-agent-heading">
            <span className="about-index">02 / {e.agentLabel}</span>
            <ScrollReveal as="h2" mode="scrub" splitWords>
              {e.agentTitle}
            </ScrollReveal>
            <p>{e.agentBody}</p>
          </div>
          <div className="experience-agent-layout">
            <AgentDiagram step={step} />
            <div className="experience-agent-steps">
              {e.agentSteps.map((item, index) => (
                <button
                  type="button"
                  key={index}
                  data-active={step === index}
                  aria-pressed={step === index}
                  onPointerEnter={(event) => {
                    if (event.pointerType === 'mouse') setStep(index);
                  }}
                  onFocus={() => setStep(index)}
                  onClick={() => setStep(index)}
                >
                  <span>0{index + 1}</span>
                  <span className="experience-agent-step-copy">
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </span>
                  <ArrowUpRight size={19} />
                </button>
              ))}
            </div>
          </div>
          <div className="experience-agent-bottom">
            <button type="button" className="about-primary" onClick={() => onEnter('studio')}>
              {e.agentOpen}
              <ArrowUpRight size={20} />
            </button>
            <p>{e.agentAvailability}</p>
          </div>
        </section>

        <section className="experience-live experience-section" id="try">
          <ScrollReveal className="experience-live-copy">
            <span className="about-index">03 / {e.liveLabel}</span>
            <h2>{e.liveTitle}</h2>
            <p>{e.liveBody}</p>
            <div className="experience-live-signature">
              <SlidersHorizontal size={27} weight="light" />
              <span>{e.liveNote}</span>
            </div>
          </ScrollReveal>
          <ColorStudy onOpen={(settings) => onEnter('sample', settings)} />
        </section>

        <section className="experience-samples experience-section" id="samples">
          <div className="experience-section-top">
            <span className="about-index">04 / {e.samples}</span>
            <span>{e.sampleGenerated}</span>
          </div>
          <ScrollReveal as="h2" mode="scrub" splitWords>
            {e.sampleTitle}
          </ScrollReveal>
          <p className="experience-section-intro">{e.sampleBody}</p>
          <div className="experience-sample-grid">
            {samplePresets.map((settings, index) => (
              <HoverPreview className="experience-sample" key={settings.sampleId}>
                <button
                  type="button"
                  onClick={() => onEnter('sample', settings)}
                  aria-label={`${e.sampleItems[index]!.title} · ${e.sampleOpen}`}
                >
                  <div className="experience-sample-image">
                    <img
                      src={getSampleImage(settings)}
                      alt={e.sampleItems[index]!.alt}
                      loading="lazy"
                      decoding="async"
                      width="1536"
                      height="1024"
                    />
                    <span className="experience-sample-open">
                      {e.sampleOpen}
                      <ArrowUpRight size={21} />
                    </span>
                  </div>
                  <div className="experience-sample-caption">
                    <div>
                      <h3>{e.sampleItems[index]!.title}</h3>
                      <p>{e.sampleItems[index]!.description}</p>
                    </div>
                    <ArrowUpRight size={25} weight="light" />
                  </div>
                </button>
              </HoverPreview>
            ))}
          </div>
        </section>

        <section className="experience-team experience-section" id="together">
          <div className="experience-team-copy">
            <span className="about-index">05 / {e.teamLabel}</span>
            <ScrollReveal as="h2" mode="scrub" splitWords>
              {e.teamTitle}
            </ScrollReveal>
            <p>{e.teamBody}</p>
            <div className="experience-team-links">
              {e.teamItems.map((item, index) => (
                <span key={item}>
                  {index === 0 ? (
                    <ImageSquare size={19} />
                  ) : index === 1 ? (
                    <GitBranch size={19} />
                  ) : (
                    <UsersThree size={19} />
                  )}
                  {item}
                </span>
              ))}
            </div>
          </div>
          <HoverPreview className="experience-team-art">
            <figure aria-label={e.teamFigure}>
              <div className="experience-shared-photo">
                <img src="/about/coast.webp" width="1536" height="1024" alt="" loading="lazy" />
                <span className="experience-region region-a">
                  <Cursor size={23} weight="fill" />
                </span>
                <span className="experience-region region-b">
                  <Cursor size={23} weight="fill" />
                </span>
              </div>
              <div className="experience-team-version">
                <GitBranch size={17} />
                <span>{e.teamVersion}</span>
                <span />
                <span />
                <span />
              </div>
              <figcaption>
                <span>{e.teamFigure}</span>
                <span>{e.teamRegion}</span>
              </figcaption>
            </figure>
          </HoverPreview>
        </section>

        <section className="experience-device experience-section">
          <div className="experience-device-copy">
            <span className="about-index">06 / {c.workspaceTitle}</span>
            <ScrollReveal as="h2" mode="scrub" splitWords>
              {e.phoneTitle}
            </ScrollReveal>
            <p>{e.phoneBody}</p>
            <button type="button" className="about-text-action" onClick={() => onEnter('studio')}>
              {c.workspaceOpen}
              <ArrowUpRight size={20} />
            </button>
          </div>
          <div className="experience-device-composition">
            <div className="experience-device-desktop">
              <ProductImage />
            </div>
            <figure className="experience-device-phone">
              <ProductImage name="phone" mobile />
              <figcaption>{e.phoneScreenshot}</figcaption>
            </figure>
          </div>
        </section>

        <section className="about-faq experience-section" id="questions">
          <div>
            <span className="about-index">07 / {c.questions}</span>
            <h2>{c.detailsTitle}</h2>
            <p>{e.faqHint}</p>
          </div>
          <div className="about-question-list">
            {questions.map(([title, body], index) => (
              <div className="about-question" key={index} data-open={question === index}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={question === index}
                    aria-controls={'question-' + index}
                    onPointerEnter={(event) => {
                      if (event.pointerType === 'mouse' && question !== index) {
                        hoverOpenedQuestion.current = index;
                        setQuestion(index);
                      }
                    }}
                    onPointerLeave={() => {
                      hoverOpenedQuestion.current = null;
                    }}
                    onClick={(event) => {
                      // The click that follows a hover-open keeps the answer visible.
                      // A second click, keyboard activation or touch can still close it.
                      if (event.detail > 0 && hoverOpenedQuestion.current === index) {
                        hoverOpenedQuestion.current = null;
                        return;
                      }
                      hoverOpenedQuestion.current = null;
                      setQuestion(question === index ? null : index);
                    }}
                  >
                    {title}
                    <Plus size={18} />
                  </button>
                </h3>
                <div
                  className="question-answer"
                  id={'question-' + index}
                  inert={question !== index}
                  aria-hidden={question !== index}
                >
                  <div>
                    <p>{body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="about-closing">
          <PointerRibbons tone="light" />
          <div>
            <p>{c.finalBody}</p>
            <ScrollReveal as="h2" splitWords>
              {c.final}
            </ScrollReveal>
            <button type="button" className="about-primary" onClick={go}>
              {hasStudio ? c.continue : c.start}
              <ArrowUpRight size={22} />
            </button>
          </div>
        </section>
      </main>
      <footer className="about-footer">
        <span className="about-footer-brand">
          {brand}
          <small>{c.footer}</small>
        </span>
        <a href="#questions">
          {c.privacy}
          <ArrowUpRight size={13} />
        </a>
        <a href="#questions">
          {c.terms}
          <ArrowUpRight size={13} />
        </a>
        <a href="#top">
          {e.backTop}
          <ArrowUpRight size={13} />
        </a>
        <LanguageSelect compact />
      </footer>
    </div>
  );
}
