import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ImageSquare, Microphone, MicrophoneSlash, Waveform } from '@phosphor-icons/react';
import { useReducedMotion } from '../motion/usePresence';
import { voiceExample, type OverviewStories } from './overview-stories';
import { recordedExamples } from './recorded-examples';

const GridMotion = lazy(() => import('../components/react-bits/GridMotion'));
const LightRays = lazy(() => import('../components/react-bits/LightRays'));
const GridDistortion = lazy(() => import('../components/react-bits/GridDistortion'));
const TargetCursor = lazy(() => import('../components/react-bits/TargetCursor'));
const PixelTransition = lazy(() => import('../components/react-bits/PixelTransition'));
const OrbitImages = lazy(() => import('../components/react-bits/OrbitImages'));
const LaserFlow = lazy(() => import('../components/react-bits/LaserFlow'));
const CardSwap = lazy(() => import('../components/react-bits/CardSwap'));
const CircularGallery = lazy(() => import('../components/react-bits/CircularGallery'));
const FlyingPosters = lazy(() => import('../components/react-bits/FlyingPosters'));
const Folder = lazy(() => import('../components/react-bits/Folder'));
const MorphSlider = lazy(() => import('../components/react-bits/MorphSlider'));
const ReflectiveCard = lazy(() => import('../components/react-bits/ReflectiveCard'));
const DriftWall = lazy(() => import('../components/react-bits/DriftWall'));
const BounceCards = lazy(() => import('../components/react-bits/BounceCards'));
const Strands = lazy(() => import('../components/react-bits/Strands'));

class EffectBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function InView({ name, className = '', fallback = null, children }: {
  name?: string;
  className?: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || !ref.current) return;
    const observer = new IntersectionObserver(([entry]) => setInView(!!entry?.isIntersecting), {
      rootMargin: '100px 0px', threshold: 0,
    });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [reduce]);
  return (
    <div ref={ref} className={'about-effect ' + className} data-about-effect={name}>
      {!reduce && inView ? (
        <EffectBoundary fallback={fallback}><Suspense fallback={fallback}>{children}</Suspense></EffectBoundary>
      ) : fallback}
    </div>
  );
}

const art = {
  original: '/about/stories/ceramics-original.webp',
  graded: '/about/stories/ceramics-graded.webp',
  layers: '/about/stories/ginkgo.webp',
  review: '/about/stories/gallery.webp',
  delivery: '/about/stories/railway.webp',
  coast: '/about/stories/shore.webp',
  pool: '/about/stories/pool.webp',
  tulip: '/about/stories/tulip.webp',
  portrait: '/about/portrait.webp',

};

const photo = (src: string, alt = '') => <img src={src} alt={alt} loading="lazy" decoding="async" />;

export function OpeningEffects() {
  const colors = ['#c2b694', '#d0c6af', '#7b9185', '#8a938b', '#bb9567', '#6e8291'];
  return (
    <div className="overview-opening-effects" aria-hidden="true">
      <InView name="GridMotion" className="opening-grid">
        <GridMotion items={colors.map((color) => <i key={color} className="opening-tile" style={{ backgroundColor: color }} />)}
          rows={3} speed={5} radius={7} gap={10} spotlight={0.1} parallax={0.22} dim={0.5} fade={0.55} />
      </InView>
      <InView name="LightRays" className="opening-rays">
        <LightRays raysColor="#ceaa64" raysOrigin="top-right" rayLength={0.9} raysSpeed={0.35}
          lightSpread={0.45} haze={0.12} opacity={0.28} maxDevicePixelRatio={1} followMouse />
      </InView>
      <InView name="TargetCursor" className="opening-cursor">
        <TargetCursor targetSelector=".overview-hero .overview-primary" cursorColor="#9b7430" hideDefaultCursor={false}
          cornerSize={5} size={22} thickness={1} clickEffect />
      </InView>
    </div>
  );
}

export function EditEffects({ labels }: { labels: OverviewStories }) {
  const [graded, setGraded] = useState(false);
  const pair = useMemo(() => [
    { image: art.original, caption: labels.original },
    { image: art.graded, caption: labels.adjusted },
  ], [labels]);
  return (
    <figure className="about-grade-story">
      <div className="about-grade-photo" aria-label={labels.compare}>
        <InView name="GridDistortion" className="about-grade-detail" fallback={photo(art.original)}>
          <GridDistortion imageSrc={art.original} grid={22} radius={0.16} strength={0.045} relaxation={0.14} intro={false} />
        </InView>
        <InView name="MorphSlider" className="about-grade-result" fallback={photo(graded ? art.graded : art.original)}>
          <MorphSlider items={pair} selectedIndex={graded ? 1 : 0} onIndexChange={(index) => setGraded(index === 1)}
            radius={0} transition="shear" showControls={false} showIndicators={false} showCaptions={false}
            autoplay={false} duration={0.65} intensity={0.09} aria-label={labels.compare} />
        </InView>
      </div>
      <figcaption className="about-story-caption">
        <span>{labels.tone}</span>
        <div className="about-inline-choice" role="group" aria-label={labels.compare}>
          <button type="button" onClick={() => setGraded(false)} aria-pressed={!graded}>{labels.original}</button>
          <button type="button" onClick={() => setGraded(true)} aria-pressed={graded}>{labels.adjusted}</button>
        </div>
      </figcaption>
    </figure>
  );
}

export function PortraitOrbit({ screen }: { screen: ReactNode }) {
  return (
    <div className="about-orbit-stage">
      {screen}
      <InView name="OrbitImages" className="about-orbit-decoration">
        <OrbitImages images={[art.portrait]} responsive radiusX={125} radiusY={24}
          duration={26} itemSize={56} rotation={-6} height="100%" width="100%" itemRadius={50} />
      </InView>
    </div>
  );
}

export function LayerEffects({ labels, screen }: { labels: OverviewStories; screen: ReactNode }) {
  const ingredients = [
    { image: art.layers, title: labels.layerNames[0] },
    { image: '/about/stories/layer-ink.svg', title: labels.layerNames[1] },
    { image: '/about/stories/layer-type.svg', title: labels.layerNames[2] },
    { image: '/about/stories/layer-shapes.svg', title: labels.layerNames[3] },
  ];
  return (
    <div className="about-layer-stage">
      <figure className="about-layer-ingredients">
        <InView name="CardSwap" className="about-card-swap" fallback={photo(art.layers, labels.layerNames[0])}>
          <CardSwap items={ingredients} width={405} height={230} cardDistance={18} verticalDistance={10}
            autoplay={false} cardRadius={9} visibleCards={3} intro />
        </InView>
        <figcaption className="about-story-caption">{labels.layers}</figcaption>
      </figure>
      <div className="about-layer-work">
        {screen}
        <div className="about-layer-parts">
          <InView name="BounceCards" className="about-bounce-cards" fallback={photo(ingredients[1]!.image)}>
            <BounceCards images={ingredients.map((item) => item.image)} cardSize={83} spread={52}
              rotation={10} enableHover pushDistance={20} borderWidth={1} radius={7} />
          </InView>
        </div>
      </div>
    </div>
  );
}

export function AIExamples({ labels }: { labels: OverviewStories }) {
  const { dialogue, image } = recordedExamples;
  return (
    <div className="about-ai-examples">
      <section className="about-ai-dialogue" aria-label={labels.dialogueTitle}>
        <h3>{labels.dialogueTitle}</h3>
        <div className="about-ai-model-line">
          <span>{dialogue.displayModel}</span>
          <span>{labels.outputLimit} · {dialogue.maxOutputTokens} tokens</span>
        </div>
        <figure className="about-ai-dialogue-window">
          {photo('/about/stories/assistant-conversation.webp', labels.dialogueTitle)}
        </figure>
        <blockquote className="sr-only" lang="zh-CN">{dialogue.answer.replaceAll('**', '')}</blockquote>
        <small>{labels.recorded}</small>
      </section>
      <section className="about-ai-generation" aria-label={labels.generationTitle}>
        <div>
          <h3>{labels.generationTitle}</h3>
          <div className="about-ai-model-line">
            <span>{image.modelLabel}</span><span>{image.width} × {image.height} · {image.format} · ×{image.outputs}</span>
          </div>
          <blockquote className="about-ai-image-prompt" lang="zh-CN">{image.prompt}</blockquote>
          <small>{labels.recorded} · {image.quality}</small>
        </div>
        <figure className="about-ai-image-result">
          {photo('/about/stories/generated-lighthouse.webp', labels.imageAlt)}
        </figure>
      </section>
    </div>
  );
}

export function AssistantVoiceStory({ labels }: { labels: OverviewStories }) {
  const [mode, setMode] = useState(0);
  const rail = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce || !rail.current) return;
    const observer = new IntersectionObserver((entries) => {
      const current = entries.find((entry) => entry.isIntersecting);
      if (current) setMode(Number((current.target as HTMLElement).dataset.voiceStep));
    }, { rootMargin: '-34% 0px -42%', threshold: 0 });
    rail.current.querySelectorAll('[data-voice-step]').forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [reduce]);
  const paused = mode === 2;
  const VoiceIcon = paused ? MicrophoneSlash : mode === 1 ? Waveform : Microphone;
  const capture = ['listening', 'response', 'muted'][mode]!;
  return (
    <div className="about-voice-layout">
      <div className="about-voice-window">
        <InView name="LaserFlow" className="about-assistant-beam">
          <LaserFlow color="#d1a65d" beamPosition={0.62} theme="dark" intensity={0.38}
            fog={0.16} dust={0.08} dpr={0.85} mouseInteraction={false} />
        </InView>
        <figure className="about-voice-capture" data-recorded-voice={capture}>
          <div className="about-voice-recording">
            {photo('/about/stories/voice-' + capture + '.webp', labels.voiceStates[mode])}
            <button type="button" className="about-voice-preview-toggle"
              aria-label={labels.voiceStates[paused ? 0 : 2]} aria-pressed={paused}
              onClick={() => setMode(paused ? 0 : 2)}>
              <InView className={'about-voice-orb voice-strands-orb' + (paused ? ' is-muted' : '')}>
                <Strands colors={['#eec467', '#f0e8d4', '#719790']} count={13} speed={paused ? 0.1 : mode === 1 ? 0.92 : 0.38}
                  intensity={mode === 1 ? 1 : 0.65} listening={mode === 0} maxDevicePixelRatio={1.25} interactive={false} />
              </InView>
              <VoiceIcon size={18} className="about-voice-orb-glyph" aria-hidden />
            </button>
          </div>
          <figcaption>{labels.recorded}</figcaption>
        </figure>
        <div className="about-voice-story" aria-label={labels.voiceDemo}>
          <div className="about-voice-model">
            <strong>{voiceExample.modelLabel}</strong>
            <span>{voiceExample.voice} · {labels.voiceDuration}</span>
            <span className="about-voice-context"><ImageSquare size={14} aria-hidden />{labels.voiceContext}</span>
            <p className="about-voice-state" aria-live="polite">
              <VoiceIcon size={17} aria-hidden />{labels.voiceStates[mode]}
            </p>
          </div>
        </div>
      </div>
      <div ref={rail} className="about-voice-choices" role="group" aria-label={labels.voiceDemo}>
        {labels.voiceStates.map((state, index) => (
          <button key={state} type="button" data-voice-step={index} aria-pressed={mode === index} onClick={() => setMode(index)}>
            <strong>{state}</strong>
            <small>{labels.voiceDetails[index]}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

export function TeamReviewStory({ labels }: { labels: OverviewStories }) {
  const [active, setActive] = useState<number | null>(0);
  return (
    <figure className="about-team-story">
      <div className="about-team-screen">
        {photo('/about/stories/team-review-canvas.webp', labels.reviewDemo)}
        {labels.reviewNotes.map((note, index) => (
          <div key={note} className="about-team-pin" data-pin={index} data-active={active === index}>
            <button type="button" aria-label={note} aria-pressed={active === index}
              onClick={() => setActive(active === index ? null : index)} />
            {active === index && (
              <span className="about-team-note">
                <strong>{labels.editors[index]}</strong>{note}
              </span>
            )}
          </div>
        ))}
      </div>
      <figcaption>{labels.reviewDemo}</figcaption>
    </figure>
  );
}

export function LibraryEffects({ labels, locale }: { labels: OverviewStories; locale: string }) {
  const pictures = useMemo(() => [
    art.coast, art.tulip, art.pool,
    '/about/local-' + locale + '.webp',
    '/about/layers-' + locale + '.webp',
    '/about/desktop-flow-' + locale + '.webp',
  ].map((image, index) => ({ image, text: labels.galleryNames[index], alt: labels.galleryNames[index] })), [labels, locale]);
  const [active, setActive] = useState(0);
  const [requested, setRequested] = useState<number | undefined>();
  function move(delta: number) {
    const index = (active + delta + pictures.length) % pictures.length;
    setRequested(index);
    setActive(index);
  }
  return (
    <div className="about-library-effects">
      <InView name="DriftWall" className="about-drift-wall">
        <DriftWall items={pictures.map(({ image }) => ({ image }))} columns={5} tileWidth={134}
          tileHeight={118} gap={9} speed={9} pauseOnHover radius={6} tilt={7} />
      </InView>
      <InView name="Folder" className="about-folder-stage" fallback={photo(art.coast)}>
        <Folder items={pictures.slice(0, 3).map(({ image, text }) => ({ image, title: text }))}
          label={labels.galleryNames[0].split(' · ')[0]} theme="light" variant="matte" color="#cba454" size={0.72}
          peek defaultOpen layout="spread" />
      </InView>
      <div className="about-library-browser">
        <div className="about-library-image-fallback" aria-hidden>{photo(pictures[active]!.image)}</div>
        <InView name="CircularGallery" className="about-circular-gallery">
          <CircularGallery items={pictures} activeIndex={requested} onActiveChange={setActive} aria-label={labels.galleryNames[active]}
            font="600 18px system-ui" bend={0.52} itemSize={1.05} itemAspect={1.24} dpr={1}
            showTitles={false} fadeEdges={0.25} snap openOnClick={false} intro={false} />
        </InView>
        <div className="about-library-caption">
          <button type="button" aria-label={labels.galleryArrows[0]} onClick={() => move(-1)}><ArrowLeft size={17} /></button>
          <span aria-live="polite">{pictures[active]?.text}</span>
          <button type="button" aria-label={labels.galleryArrows[1]} onClick={() => move(1)}><ArrowRight size={17} /></button>
        </div>
      </div>
    </div>
  );
}

export function DeliveryEffects({ labels, screen }: { labels: OverviewStories; screen: ReactNode }) {
  return (
    <div className="about-delivery-effects">
      <figure className="about-delivery-art">
        <InView name="FlyingPosters" className="about-flying-posters" fallback={photo(art.delivery)}>
          <FlyingPosters items={[art.delivery]} planeWidth={240} planeHeight={245}
            columns={2} axis="horizontal" distortion={0.16} gap={14} rotation={12}
            pageScroll={0.14} speed={7} drag wheel={false} />
        </InView>
        <InView name="PixelTransition" className="about-delivery-proof" fallback={photo(art.delivery)}>
          <PixelTransition firstContent={photo(art.delivery)}
            secondContent={<img src={art.delivery} style={{ filter: 'grayscale(1)' }} alt="" />}
            trigger="hover" pattern="ripple" pixelColor="#bfa465" gridSize={20} animationStepDuration={0.28} aspectRatio="3/2" />
        </InView>
      </figure>
      <div className="about-delivery-window">
        {screen}
        <InView name="ReflectiveCard" className="about-reflective" fallback={<span>{labels.file}</span>}>
          <ReflectiveCard theme="light" name={labels.file} width="100%" height="100%" radius={9}
            tint="#b29a64" enableTilt tiltStrength={3} metalness={0.29} glare={0.22}>
            <span>PNG · JPEG · WebP</span>
          </ReflectiveCard>
        </InView>
      </div>
    </div>
  );
}
