import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, ChatCircleDots, ImageSquare, PencilLine, Plus } from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { LanguageSelect } from '../i18n/LanguageSelect';
import { DEFAULT_BRAND, brandLogoUrl } from '../lib/brand';
import type { PublicConfig } from '../lib/types';
import { aboutCopy } from './copy';
import { editorialCopy } from './editorial-copy';
import { ColorStudy } from './ColorStudy';
import { FeatureTour } from './FeatureTour';
import { AgentStory } from './AgentStory';
import { DeviceStory, TeamStory, VoiceStory } from './CreativeStories';
import { EditorialImage } from './AboutArt';
import { HoverPreview, PointerRibbons, ScrollReveal } from './effects';
import { getSampleImage, type SampleSettings } from './sample-settings';

export const DEMO_IMAGE = getSampleImage();
export type AboutIntent = 'login' | 'register' | 'studio' | 'sample';
const pathIcons = [ImageSquare, PencilLine, ChatCircleDots];

export function AboutPage({ config, onEnter, hasStudio }: {
  config: PublicConfig | null;
  onEnter: (intent: AboutIntent, settings?: SampleSettings) => void;
  hasStudio: boolean;
}) {
  const locale = useLocale();
  const c = aboutCopy(locale);
  const e = editorialCopy(locale);
  const brand = config?.brand.name || DEFAULT_BRAND;
  const logo = brandLogoUrl(config?.brand);
  const progress = useRef<HTMLSpanElement>(null);
  const [question, setQuestion] = useState(0);
  const go = () => onEnter(hasStudio ? 'studio' : 'login');
  const openStudio = () => onEnter('studio');
  const questions = [[c.q1, c.a1], [c.q2, c.a2], [c.q3, c.a3], [c.q4, c.a4], [c.q5, c.a5]];
  useEffect(() => {
    document.title = `${brand} · ${c.footer}`;
    document.querySelector('meta[name="description"]')?.setAttribute('content', e.heroBody);
  }, [brand, c.footer, e.heroBody]);
  useEffect(() => {
    let frame = 0;
    const paint = () => {
      frame = 0;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      progress.current?.style.setProperty('--reading-progress', String(total > 0 ? Math.max(0, Math.min(1, window.scrollY / total)) : 0));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    paint();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, []);
  return <div className="about-page" id="top" lang={locale} data-locale={locale}>
    <a className="about-skip" href="#about-content">{locale === 'en' ? 'Skip to content' : locale === 'zh-TW' ? '跳至內容' : '跳至内容'}</a>
    <header className="about-header">
      <a href="#top" className="about-brand" aria-label={`${brand} · ${c.homeLabel}`}>
        {logo ? <img src={logo} alt="" width="25" height="25" /> : <span className="about-symbol" aria-hidden="true"><span /><span /></span>}{brand}</a>
      <nav aria-label={c.overview}><a href="#tools">{e.nav[0]}</a><a href="#agent">{e.nav[1]}</a><a href="#together">{e.nav[2]}</a></nav>
      <div className="about-header-actions"><LanguageSelect compact /><button type="button" className="about-login" onClick={() => onEnter('login')}>{c.login}</button>
        <button type="button" className="about-header-start" onClick={go}>{hasStudio ? c.continue : c.start}<ArrowUpRight size={16} /></button></div>
      <span ref={progress} className="about-reading-progress" aria-hidden="true" />
    </header>
    <main id="about-content">
      <section className="about-hero" aria-labelledby="about-title">
        <PointerRibbons />
        <ScrollReveal className="hero-introduction"><div><p className="about-eyebrow" data-reveal-piece>{e.heroLabel}</p>
          <h1 id="about-title" data-reveal-piece><span>{e.heroTitle[0]}</span><span>{e.heroTitle[1]}</span></h1></div>
          <div className="hero-aside"><p data-reveal-piece>{e.heroBody}</p><div className="about-hero-actions" data-reveal-piece>
            <button type="button" className="about-primary" onClick={go}>{hasStudio ? c.continue : c.start}<ArrowUpRight size={20} /></button>
            <button type="button" className="about-local" onClick={openStudio}>{c.local}<ArrowRight size={16} /></button></div></div>
        </ScrollReveal>
        <div className="hero-artwork" data-pointer-protect>
          <EditorialImage name="hero-editorial" alt={e.heroAlt} eager />
          <svg viewBox="0 0 1200 560" fill="none" aria-hidden="true" className="hero-annotation-lines"><path d="M120 130H264L390 242"/><path d="M948 101H840L740 236"/><path d="M930 465H800L660 389"/></svg>
          {e.heroCallouts.map((text, index) => <span className={`hero-annotation hero-annotation-${index}`} key={text}><i />{text}</span>)}
        </div>
        <div className="hero-bottom"><div>{e.heroNotes.map(note => <span key={note}>{note}</span>)}</div><a href="#tools">{c.scrollLabel}<ArrowDown size={16} /></a></div>
      </section>

      <section className="about-tools about-section" id="tools" aria-labelledby="tools-title">
        <ScrollReveal className="about-section-heading"><span className="about-eyebrow">01 / {e.nav[0]}</span><h2 id="tools-title">{e.tourTitle}</h2></ScrollReveal>
        <FeatureTour copy={e} />
      </section>

      <section className="about-agent about-section" id="agent" aria-labelledby="agent-title">
        <ScrollReveal className="about-section-heading"><span className="about-eyebrow">02 / {e.agentLabel}</span><h2 id="agent-title">{e.agentTitle}</h2><p>{e.agentBody}</p></ScrollReveal>
        <AgentStory copy={e} onOpen={openStudio} />
        <VoiceStory copy={e} />
      </section>

      <section className="about-try about-section" id="try" aria-labelledby="try-title">
        <ScrollReveal className="about-section-heading"><span className="about-eyebrow">03 / {c.adjust}</span><h2 id="try-title">{e.tryTitle}</h2><p>{e.tryBody}</p></ScrollReveal>
        <ColorStudy onOpen={openStudio} /><p className="about-caption study-engine-note">{e.tryNote}</p>
      </section>

      <section className="about-paths about-section" aria-labelledby="paths-title">
        <ScrollReveal className="about-section-heading"><span className="about-eyebrow">04 / {e.pathsLabel}</span><h2 id="paths-title">{e.pathsTitle}</h2></ScrollReveal>
        <div className="creative-paths">{e.paths.map((path, index) => { const Icon = pathIcons[index]!; return <ScrollReveal key={path.title}>
          <HoverPreview><article className="creative-path"><div className="path-illustration" aria-hidden="true" data-path={index}>
            <i /><i /><i /><Icon size={38} weight="light" /><span>0{index + 1}</span></div>
            <span className="path-cue">{path.cue}</span><h3>{path.title}</h3><p>{path.body}</p></article></HoverPreview>
        </ScrollReveal>; })}</div>
        <button type="button" className="about-primary paths-start" onClick={openStudio}>{e.pathsOpen}<ArrowUpRight size={19} /></button>
      </section>

      <div className="about-section"><TeamStory copy={e} onOpen={openStudio} /></div>
      <div className="about-section"><DeviceStory copy={e} /></div>

      <section className="about-faq about-section" id="questions" aria-labelledby="faq-title">
        <ScrollReveal className="about-section-heading"><span className="about-eyebrow">07 / {c.questions}</span><h2 id="faq-title">{e.faqTitle}</h2></ScrollReveal>
        <div className="faq-layout"><div className="about-question-list">{questions.map(([title], index) => <div className="about-question" key={title} data-open={question === index}>
          <h3><button type="button" id={`question-title-${index}`} aria-expanded={question === index} aria-controls={`question-${index}`}
            onClick={() => setQuestion(index)} onPointerEnter={event => { if (event.pointerType === 'mouse') setQuestion(index); }}
            onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? 4 : (index + (event.key === 'ArrowDown' ? 1 : 4)) % 5;
              setQuestion(next); document.getElementById(`question-title-${next}`)?.focus();
            } }}><span>{title}</span><Plus size={18} /></button></h3></div>)}</div>
          <div className="faq-answer-stage">{questions.map(([title, body], index) => <div key={title} id={`question-${index}`} className="question-answer"
            role="region" aria-labelledby={`question-title-${index}`} aria-hidden={question !== index} inert={question !== index} data-active={question === index}>
            <span className="faq-answer-number">0{index + 1}</span><h3>{title}</h3><p>{body}</p></div>)}</div>
        </div>
      </section>
      <section className="about-closing"><PointerRibbons /><ScrollReveal><p>{e.endBody}</p><h2>{e.endTitle}</h2>
        <button type="button" className="about-primary" onClick={go}>{hasStudio ? c.continue : c.start}<ArrowUpRight size={21} /></button></ScrollReveal></section>
    </main>
    <footer className="about-footer"><div className="about-footer-brand">{brand}<small>{c.footer}</small></div><span className="about-image-credit">{e.imageCredit}</span>
      <a href="#questions">{c.privacy}<ArrowUpRight size={14} /></a><a href="#top">{e.backTop}<ArrowUp size={15} /></a></footer>
  </div>;
}
