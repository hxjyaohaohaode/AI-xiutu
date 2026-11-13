import {
  Component, lazy, Suspense, useEffect, useId, useMemo, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from 'react';
import {
  ArrowCounterClockwise, ArrowDownRight, ArrowsOutSimple, CheckCircle, ClosedCaptioning,
  ImageSquare, Microphone, MicrophoneSlash, PaintBrush, PaperPlaneRight, PhoneDisconnect, Shapes,
  SlidersHorizontal, Sparkle, TextT, Waveform, X,
} from '@phosphor-icons/react';
import { useReducedMotion } from '../motion/usePresence';
import type { Locale } from '../i18n';
import type { AboutDetailsCopy } from './overview-details';
import { voiceExample, voiceReplay, type OverviewStories } from './overview-stories';
import { recordedExamples } from './recorded-examples';
import { overviewLibrary, overviewDeliveryPhotos } from './overview-library';
import { useSketchRail } from './useSketchRail';
import { overviewSketchTools } from './overview-sketch-tools';

const LightRays = lazy(() => import('../components/react-bits/LightRays'));
const TargetCursor = lazy(() => import('../components/react-bits/TargetCursor'));
const MorphSlider = lazy(() => import('../components/react-bits/MorphSlider'));
const OrbitImages = lazy(() => import('../components/react-bits/OrbitImages'));
const CardSwap = lazy(() => import('../components/react-bits/CardSwap'));
const BounceCards = lazy(() => import('../components/react-bits/BounceCards'));
const HoloCard = lazy(() => import('../components/react-bits/HoloCard'));
const Strands = lazy(() => import('../components/react-bits/Strands'));
const Folder = lazy(() => import('../components/react-bits/Folder'));
const DriftWall = lazy(() => import('../components/react-bits/DriftWall'));

type Theme = 'light' | 'dark';
const review = '/about/review/';
const stories = '/about/stories/';
export const reviewCapture = (name: string, theme: Theme) =>
  review + name + (theme === 'dark' ? '-dark' : '') + '.webp';

class EffectBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function InView({ name, className = '', fallback = null, persistent = false, children }: {
  name?: string;
  className?: string;
  fallback?: ReactNode;
  persistent?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || !ref.current) return;
    if (typeof IntersectionObserver !== 'function') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting && persistent) return;
      setInView(!!entry?.isIntersecting);
    }, { rootMargin: '120px 0px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [reduce, persistent]);
  return (
    <div ref={ref} className={'about-effect ' + className} data-about-effect={name}>
      {!reduce && inView ? (
        <EffectBoundary fallback={fallback}><Suspense fallback={fallback}>{children}</Suspense></EffectBoundary>
      ) : fallback}
    </div>
  );
}

function Photo({ src, alt = '' }: { src: string; alt?: string }) {
  return <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} />;
}

type Exhibit = { src: string; title: string; body?: string };
function ExhibitDialog({ item, closeLabel, onClose }: {
  item: Exhibit;
  closeLabel: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="about-exhibit" aria-label={item.title}
      onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="about-exhibit-head">
        <strong>{item.title}</strong>
        <button type="button" aria-label={closeLabel} onClick={onClose} autoFocus><X size={22} /></button>
      </div>
      <img src={item.src} alt={item.title} decoding="async" />
      {item.body && <p>{item.body}</p>}
    </dialog>
  );
}

export function OpeningEffects({ theme }: { theme: Theme }) {
  const dark = theme === 'dark';
  return (
    <div className="overview-opening-effects" aria-hidden="true">
      <InView name="LightRays" className="opening-rays">
        <LightRays raysColor={dark ? '#edc780' : '#b88b4c'} raysOrigin="top-right"
          tilt={27} rayLength={2.45} raysSpeed={0.46} rayDensity={1.34} lightSpread={0.97}
          raySharpness={0.78} glow={0.43} haze={0.17} atmosphere={0.4}
          intensity={dark ? 1.58 : 1.4} opacity={dark ? 0.86 : 0.85}
          lightMode={!dark} intro={false} cursorShadow followMouse mouseInfluence={0.24}
          clickPulse={false} maxDevicePixelRatio={1} />
      </InView>
    </div>
  );
}

export function OverviewCursor({ scope, theme }: { scope: RefObject<HTMLDivElement | null>; theme: Theme }) {
  const reduce = useReducedMotion();
  if (reduce) return null;
  return (
    <Suspense fallback={null}>
      <TargetCursor container={scope} blendMode="normal" hideDefaultCursor={false} showLabel={false}
        targetSelector=".product-overview-root :is(.overview-primary, .overview-start, .overview-header nav a, .about-portrait-tabs button, .overview-text-action)"
        cursorColor={theme === 'dark' ? '#f4ce78' : '#856330'}
        size={22} cornerSize={5} thickness={1} padding={4} clickEffect />
    </Suspense>
  );
}

export function EditEffects({ labels }: { labels: OverviewStories }) {
  const [index, setIndex] = useState(0);
  const pair = useMemo(() => [
    { image: review + 'tone-still-life.webp', caption: labels.original },
    { image: review + 'tone-still-life-graded.webp', caption: labels.adjusted },
  ], [labels]);
  return (
    <figure className="about-grade-story">
      <InView name="MorphSlider" className="about-grade-photo"
        fallback={<Photo src={pair[index]!.image} alt={pair[index]!.caption} />}>
        <MorphSlider items={pair} selectedIndex={index} onIndexChange={setIndex} radius={0}
          transition="shear" showControls={false} showIndicators={false} showCaptions={false}
          autoplay={false} duration={0.55} intensity={0.08} aria-label={labels.compare} />
      </InView>
      <figcaption className="about-story-caption">
        <span>{labels.tone}</span>
        <div className="about-inline-choice" role="group" aria-label={labels.compare}>
          {pair.map((frame, i) => <button key={frame.caption} type="button"
            onClick={() => setIndex(i)} aria-pressed={index === i}>{frame.caption}</button>)}
        </div>
      </figcaption>
    </figure>
  );
}

const portraitIds = ['skin', 'face', 'body', 'makeup'] as const;

export function PortraitOrbit({ copy, theme, locale }: { copy: AboutDetailsCopy; theme: Theme; locale: Locale }) {
  const [active, setActive] = useState(0);
  const [enlarge, setEnlarge] = useState(false);
  const [title, description] = copy.portraits[active]!;
  const shots = portraitIds.map((id) => reviewCapture('portrait-' + id + '-' + locale, theme));
  const details = portraitIds.map((id, i) => ({
    src: reviewCapture('portrait-' + id + '-detail-' + locale, theme),
    alt: copy.portraits[i]![0],
  }));
  const cover = (
    <div className="about-portrait-focus" data-portrait-mode={portraitIds[active]}>
      <Photo key={shots[active]} src={shots[active]!} alt={title} />
      <button type="button" aria-label={copy.openImage + ' · ' + title} onClick={() => setEnlarge(true)}>
        <ArrowsOutSimple size={16} aria-hidden="true" />
      </button>
    </div>
  );
  return (
    <div className="about-orbit-stage">
      <div className="about-portrait-main">{cover}</div>
      <InView name="OrbitImages" className="about-orbit-decoration">
        <OrbitImages images={details} shape="ellipse" baseWidth={850} radiusX={380} radiusY={270}
          itemSize={100} rotation={0} duration={32} height="100%" itemRadius={11} depth={0.07}
          showPath pathWidth={1} pathDash={4} pathColor="currentColor" intro={false}
          draggable clickToFront hoverScale={1.04} hoverSpeed={0.08} onItemClick={setActive} />
      </InView>
      <div className="about-portrait-tabs" role="group" aria-label={copy.portraitTitle.join(' ')}>
        {copy.portraits.map(([name], i) => (
          <button key={name} type="button" aria-pressed={active === i} onClick={() => setActive(i)}>
            <Photo src={details[i]!.src} />
            <span>{name}</span>
          </button>
        ))}
      </div>
      <p className="about-portrait-description" aria-live="polite">{description}</p>
      {enlarge && <ExhibitDialog item={{ src: shots[active]!, title, body: description }}
        closeLabel={copy.close} onClose={() => setEnlarge(false)} />}
    </div>
  );
}

const stripIds = ['pressure', 'eraser', 'shapes', 'type', 'palette', 'image-layer', 'opacity', 'history', 'arrange', 'reference'] as const;
const featureImage = (id: typeof stripIds[number]) => review + 'sketch-' + id + '.webp';
const deckIds = ['image-layer', 'eraser', 'type', 'shapes'] as const;
const deckIcons = [ImageSquare, PaintBrush, TextT, Shapes];
const featureSize = 83;
const featureGap = 17;

export function LayerEffects({ copy, screen, theme, locale }: {
  copy: AboutDetailsCopy;
  screen: ReactNode;
  theme: Theme;
  locale: Locale;
}) {
  const [exhibit, setExhibit] = useState<Exhibit | null>(null);
  const rail = useSketchRail();
  const items = deckIds.map((id, i) => {
    const Icon = deckIcons[i]!;
    return { image: featureImage(id), title: copy.layerCards[i], icon: <Icon size={16} /> };
  });
  const illustrations = stripIds.map((id, i) => ({
    src: featureImage(id), title: copy.sketchCards[i]![0], body: copy.sketchCards[i]![1],
  }));
  const interfaceShots = overviewSketchTools(locale).map((tool) => ({
    src: reviewCapture('sketch-ui-' + tool.id, theme), title: tool.title, body: tool.body,
  }));
  const featureCards = interfaceShots.flatMap((tool, index) =>
    illustrations[index] ? [illustrations[index], tool] : [tool]);
  const railWidth = featureCards.length * (featureSize + featureGap) + featureGap * 2;
  const railStyle = { '--sketch-rail-width': railWidth + 'px' } as CSSProperties;
  return (
    <>
      <div className="about-layer-stage">
        <div className="about-layer-work">
          {screen}
          <ol className="about-sketch-steps">
            {copy.sketchSteps.map(([title, body]) => <li key={title}><strong>{title}</strong><p>{body}</p></li>)}
          </ol>
        </div>
        <figure className="about-layer-ingredients">
          <InView name="CardSwap" className="about-card-swap" persistent
            fallback={<Photo src={items[0]!.image} alt={items[0]!.title} />}>
            <CardSwap items={items} width={394} height={259} cardDistance={48}
              verticalDistance={53} depth={92} skewAmount={5} bounce={0.68} hoverSpread={0.16}
              visibleCards={4} delay={5000} autoplay pauseOnHover draggable intro
              theme={theme} cardRadius={16} />
          </InView>
        </figure>
      </div>
      <div className="about-sketch-band">
        <div className="about-sketch-scroll" role="region" aria-label={copy.featureStrip}
          tabIndex={0} style={railStyle} {...rail}>
          <InView name="BounceCards" className="about-bounce-cards" persistent
            fallback={<div className="about-static-strip">{featureCards.map((card) =>
              <button type="button" key={card.src} onClick={() => setExhibit(card)} aria-label={card.title}>
                <Photo src={card.src} />
              </button>)}</div>}>
            <BounceCards images={featureCards.map(({ src, title }) => ({ src, alt: title }))}
              containerWidth={railWidth} containerHeight={125}
              cardSize={featureSize} spread={featureSize + featureGap} rotation={7} arc={2}
              animationDelay={0.06} animationStagger={0.024}
              enableHover pushDistance={7} hoverScale={1.11} borderWidth={1}
              borderColor="var(--overview-line)" radius={9}
              onCardClick={(index) => setExhibit(featureCards[index] ?? null)} />
          </InView>
        </div>
      </div>
      {exhibit && <ExhibitDialog item={exhibit} closeLabel={copy.close} onClose={() => setExhibit(null)} />}
    </>
  );
}

export function AIExamples({ labels, copy }: { labels: OverviewStories; copy: AboutDetailsCopy }) {
  const [stage, setStage] = useState(2);
  const { dialogue, image } = recordedExamples;
  const stageIcons = [PaperPlaneRight, SlidersHorizontal, CheckCircle];
  return (
    <div className="about-ai-examples">
      <section className="about-ai-dialogue" aria-labelledby="about-dialogue-title">
        <header className="about-example-heading">
          <h3 id="about-dialogue-title">{labels.dialogueTitle}</h3>
          <span>{labels.recorded}</span>
        </header>
        <div className="about-ai-dialogue-window">
          <Photo src={stories + 'pool.webp'} />
          <div className="about-dialogue-bubbles">
            <div className="about-dialogue-request">
              <small>{copy.assistantUser}</small>
              <p>{copy.dialoguePrompt}</p>
            </div>
            <div className="about-dialogue-response">
              <small><Sparkle size={14} />{copy.assistantName} <span>{dialogue.displayModel}</span></small>
              <p>{copy.dialogueReply}</p>
            </div>
          </div>
        </div>
      </section>
      <section className="about-ai-generation" aria-labelledby="about-generation-title">
        <header className="about-example-heading">
          <h3 id="about-generation-title">{labels.generationTitle}</h3>
          <span>{labels.recorded}</span>
        </header>
        <div className="about-generation-window">
          <ol className="about-generation-steps">
            {copy.generationStages.map(([title], i) => {
              const Icon = stageIcons[i]!;
              return <li key={title}><button type="button" aria-pressed={stage === i} onClick={() => setStage(i)}>
                <Icon size={16} aria-hidden="true" />{title}
              </button></li>;
            })}
          </ol>
          <div className="about-generation-content">
            <div className="about-generation-transcript">
              <div className="about-dialogue-request">
                <small>{copy.assistantUser}</small>
                <p>{copy.generationPrompt}</p>
              </div>
              {stage > 0 && <div className="about-ai-model-line">
                <span>{image.modelLabel}</span>
                <span>{image.width} × {image.height} · {image.format} · ×{image.outputs}</span><span>{copy.imageQuality}</span>
              </div>}
              <p className="about-generation-status" aria-live="polite">{copy.generationStages[stage]![1]}</p>
            </div>
            {stage === 2 && <figure className="about-ai-image-result">
              <Photo src={stories + 'generated-lighthouse.webp'} alt={labels.imageAlt} />
            </figure>}
          </div>
        </div>
      </section>
    </div>
  );
}

const voiceFrames = ['listening', 'response', 'muted'] as const;
type ReplayState = typeof voiceFrames[number] | 'ended';
const voiceColors = ['#e4b76c', '#d8eee6', '#76a69c', '#a2abbf'];
const voiceMutedColors = ['#a7aaa0', '#e0e0d8', '#808c96'];
const voiceTime = (seconds: number) => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');

function VoiceReplayCard({ copy, labels, animate }: {
  copy: AboutDetailsCopy;
  labels: OverviewStories;
  animate: boolean;
}) {
  const [state, setState] = useState<ReplayState>('response');
  const [captions, setCaptions] = useState(true);
  const captionId = useId();
  const muted = state === 'muted';
  const ended = state === 'ended';
  const index = ended ? 2 : voiceFrames.indexOf(state);
  const elapsed = voiceReplay.seconds[index]!;
  const OrbIcon = muted ? MicrophoneSlash : state === 'response' ? Waveform : Microphone;

  useEffect(() => {
    if (state !== 'listening') return;
    const timer = window.setTimeout(() => setState('response'), 1500);
    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <div className="about-voice-interface" data-recorded-voice={state}>
      <div className="about-voice-instrument">
        <div className="about-voice-card-top">
          <div><Waveform size={15} aria-hidden="true" /><span>{copy.voiceReplay}</span></div>
          <strong>{voiceExample.modelLabel}</strong>
          <small>{voiceExample.voice} · {labels.voiceDuration}</small>
        </div>
        <div className="about-voice-card-orb" data-muted={muted || ended} aria-hidden="true">
          <div className="about-voice-orb-art" />
          {animate && !ended && (
            <EffectBoundary fallback={null}>
              <Suspense fallback={null}>
                <Strands colors={muted ? voiceMutedColors : voiceColors} count={19}
                  speed={muted ? 0.2 : state === 'response' ? 1.02 : 0.52} amplitude={state === 'response' ? 1.18 : 0.92}
                  listening={!muted} energy={state === 'response' ? 1.13 : 0.63} level={muted ? 0.06 : state === 'response' ? 0.74 : 0.28}
                  glass glassSize={0.9} glow={0.73} rim={0.92}
                  interactive={false} clickPulse={false} intro={false} maxDevicePixelRatio={1} />
              </Suspense>
            </EffectBoundary>
          )}
          <span className="about-voice-orb-badge"><OrbIcon size={17} /></span>
        </div>
        <div className="about-voice-card-state" aria-live="polite">
          <strong>{ended ? copy.voiceControls.ended : labels.voiceStates[index]}</strong>
          <time dateTime={'PT' + elapsed + 'S'}>{voiceTime(elapsed)}</time>
        </div>
      </div>
      <div className="about-voice-record">
        <div className="about-voice-record-header">
          <span><ImageSquare size={15} aria-hidden="true" />{labels.voiceContext}</span>
          <button type="button" className="about-voice-caption-toggle"
            aria-expanded={captions} aria-controls={captionId} onClick={() => setCaptions((value) => !value)}>
            <ClosedCaptioning size={16} aria-hidden="true" />
            {captions ? copy.voiceControls.hideCaptions : copy.voiceControls.showCaptions}
          </button>
        </div>
        <div className="about-voice-transcript" id={captionId} hidden={!captions} aria-live="polite">
          <p><span>{copy.assistantUser}</span>{copy.voiceTranscript[0]}</p>
          {state !== 'listening' && <p className="about-voice-transcript-reply">
            <span><Sparkle size={13} aria-hidden="true" />{copy.assistantName}</span>{copy.voiceTranscript[1]}
          </p>}
        </div>
        <div className="about-voice-actions" role="group" aria-label={copy.voiceReplay}>
          <button type="button" className="about-voice-replay" onClick={() => {
            setCaptions(true);
            setState('listening');
          }}>
            <ArrowCounterClockwise size={17} aria-hidden="true" />{copy.voiceControls.replay}
          </button>
          <button type="button" aria-label={muted ? copy.voiceControls.unmute : copy.voiceControls.mute}
            aria-pressed={muted} disabled={ended} onClick={() => setState(muted ? 'response' : 'muted')}>
            {muted ? <MicrophoneSlash size={17} /> : <Microphone size={17} />}
          </button>
          <button type="button" className="about-voice-end" aria-label={copy.voiceControls.end}
            disabled={ended} onClick={() => setState('ended')}><PhoneDisconnect size={18} /></button>
        </div>
      </div>
    </div>
  );
}

export function AssistantVoiceStory({ labels, copy, theme }: {
  labels: OverviewStories;
  copy: AboutDetailsCopy;
  theme: Theme;
}) {
  return (
    <figure className="about-voice-capture">
      <InView name="HoloCard" className="about-voice-recording" persistent
        fallback={<VoiceReplayCard copy={copy} labels={labels} animate={false} />}>
        <HoloCard alt={copy.voiceReplay} radius={22}
          style={{ '--hc-w': '100%', '--hc-ratio': 'auto' } as CSSProperties}
          preset="shards" intensity={theme === 'dark' ? 0.28 : 0.23} edgeSparkle={0.58}
          frame={1.2} glare={theme === 'dark' ? 0.11 : 0.13}
          foilColor={theme === 'dark' ? '#b5d6cd' : '#ebce92'}
          tiltMax={7} hoverScale={1.012} idle={false} shadow>
          <VoiceReplayCard copy={copy} labels={labels} animate />
        </HoloCard>
      </InView>
    </figure>
  );
}

export function TeamReviewStory({ copy, theme, locale }: { copy: AboutDetailsCopy; theme: Theme; locale: Locale }) {
  const [enlarge, setEnlarge] = useState(false);
  const src = reviewCapture('team-canvas-' + locale, theme);
  return (
    <figure className="about-team-story">
      <button type="button" className="about-review-shot" aria-label={copy.openImage + ' · ' + copy.canvasReview}
        onClick={() => setEnlarge(true)}>
        <Photo src={src} alt={copy.canvasReview} />
        <span aria-hidden="true"><ArrowsOutSimple size={16} /></span>
      </button>
      <figcaption>{copy.canvasReview}</figcaption>
      {enlarge && <ExhibitDialog item={{ src, title: copy.canvasReview }}
        closeLabel={copy.close} onClose={() => setEnlarge(false)} />}
    </figure>
  );
}

export function LibraryEffects({ copy, theme, locale, screen, heading, description }: {
  copy: AboutDetailsCopy;
  theme: Theme;
  locale: Locale;
  screen: ReactNode;
  heading: string;
  description: string;
}) {
  const [exhibit, setExhibit] = useState<Exhibit | null>(null);
  const { wall, folder } = useMemo(() => overviewLibrary(locale), [locale]);
  const wallSurface = useRef<HTMLDivElement>(null);
  const [wallWidth, setWallWidth] = useState(1440);
  useEffect(() => {
    const surface = wallSurface.current;
    if (!surface) return;
    const update = () => setWallWidth(Math.round(surface.clientWidth));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);
  const columns = Math.max(3, Math.min(6, Math.round(wallWidth / 275)));
  const tileWidth = Math.max(102, Math.round(wallWidth / (columns * 1.07)) - 13);
  const openItem = ({ image, title }: typeof wall[number]) => setExhibit({ src: image, title });
  return (
    <section className="about-library-section" aria-labelledby="about-library-title">
      <div className="about-library-wall" ref={wallSurface}>
        <InView name="DriftWall" className="about-drift-wall"
          fallback={<div className="about-library-static" role="group" aria-label={copy.libraryWall}>
            {wall.slice(0, 12).map((item) => (
              <button type="button" key={item.image} onClick={() => openItem(item)} aria-label={item.title}>
                <Photo src={item.image} />
              </button>
            ))}
          </div>}>
          <DriftWall items={wall} columns={columns} tileWidth={tileWidth} tileHeight={Math.round(tileWidth * .75)} gap={13}
            speed={14} pauseOnHover radius={10} tilt={11} turn={-8} roll={-7} depth={40} perspective={1480}
            parallax={0.76} variance={0.51} lift={48} dim={0.91} repeat={false}
            overlayColor="transparent" onItemClick={(index) => { if (wall[index]) openItem(wall[index]); }}
            ariaLabel={copy.libraryWall} />
        </InView>
      </div>
      <div className="about-library-foreground overview-container">
        <div className="about-library-work">{screen}</div>
        <div className="about-library-aside">
          <div className="about-library-copy">
            <h3 id="about-library-title">{heading}</h3>
            <p className="overview-body">{description}</p>
          </div>
          <div className="about-library-folder">
            <InView name="Folder" className="about-folder-stage" persistent
              fallback={<div className="about-folder-fallback">{folder.map((item) => (
                <button type="button" key={item.image} onClick={() => openItem(item)} aria-label={item.title}>
                  <Photo src={item.image} />
                </button>
              ))}</div>}>
              <Folder items={folder} label={copy.folderName} theme={theme} variant="matte"
                color="#cba454" size={0.86} peek defaultOpen layout="spread" intro={false} closeOnOutsideClick={false}
                onItemClick={(_, index) => { if (folder[index]) openItem(folder[index]); }} />
            </InView>
          </div>
        </div>
      </div>
      {exhibit && <ExhibitDialog item={exhibit} closeLabel={copy.close} onClose={() => setExhibit(null)} />}
    </section>
  );
}

export function DeliveryEffects({ labels, screen }: { labels: OverviewStories; screen: ReactNode }) {
  return (
    <div className="about-delivery-effects">
      <div className="about-delivery-background" aria-hidden="true">
        <InView className="about-poster-field" name="DeliveryPosters" fallback={
          <div className="about-poster-lanes" data-static>
            {overviewDeliveryPhotos.map((lane) => (
              <div key={lane[0]} className="about-poster-lane">
                {lane.slice(0, 4).map((src) => <Photo key={src} src={src} />)}
              </div>
            ))}
          </div>
        }>
          <div className="about-poster-lanes">
            {overviewDeliveryPhotos.map((lane) => (
              <div key={lane[0]} className="about-poster-lane">
                <div className="about-poster-track">
                  {[0, 1].map((cycle) => (
                    <div key={cycle} className="about-poster-run">
                      {lane.map((src) => <Photo key={src} src={src} />)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </InView>
      </div>
      <div className="about-delivery-window">
        {screen}
        <span className="about-screen-caption">{labels.file}<ArrowDownRight size={15} aria-hidden="true" /></span>
      </div>
    </div>
  );
}
