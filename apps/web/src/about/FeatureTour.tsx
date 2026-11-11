import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowUpRight, MagicWand, Scan, SlidersHorizontal, Stack, X } from '@phosphor-icons/react';
import { EditorialImage, ProductImage } from './AboutArt';
import type { EditorialCopy } from './editorial-copy';

const icons = [SlidersHorizontal, Scan, MagicWand, Stack];
const screenshots = ['workspace', 'local', 'portrait', 'layers'];

/** One index owns the list, artwork, callouts and progress. Native scrolling is never intercepted. */
export function FeatureTour({ copy: c }: { copy: EditorialCopy }) {
  const root = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const interfaceTrigger = useRef<HTMLButtonElement>(null);
  const overrideAt = useRef<number | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(0);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const select = (index: number) => {
    current.current = index;
    setActive(index);
    setInterfaceOpen(false);
  };
  const selectManually = (index: number) => {
    if (hover.current) clearTimeout(hover.current);
    hover.current = null;
    overrideAt.current = window.scrollY;
    select(index);
  };
  useEffect(() => {
    const target = root.current;
    if (!target) return;
    const narrow = window.matchMedia('(max-width: 760px), (max-height: 800px)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (narrow.matches) return;
      if (target.querySelector('.feature-interface')?.contains(document.activeElement) && document.activeElement?.matches(':focus-visible')) return;
      if (overrideAt.current !== null) {
        if (Math.abs(window.scrollY - overrideAt.current) < 64) return;
        overrideAt.current = null;
      }
      const rect = target.getBoundingClientRect();
      const travel = Math.max(1, target.offsetHeight - window.innerHeight);
      const progress = Math.max(0, Math.min(0.999, (76 - rect.top) / travel));
      const position = progress * 4;
      const next = Math.min(3, Math.floor(position));
      // Four percent hysteresis prevents trackpad jitter at a chapter boundary.
      if (next !== current.current && (next > current.current ? position > next + 0.04 : position < next + 0.96)) select(next);
      target.style.setProperty('--tour-progress', String(progress));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    narrow.addEventListener('change', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      if (hover.current) clearTimeout(hover.current);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      narrow.removeEventListener('change', schedule);
    };
  }, []);
  const closeInterface = () => { setInterfaceOpen(false); interfaceTrigger.current?.focus({ preventScroll: true }); };
  return <div className="experience-tour" ref={root} data-active={active}>
    <div className="experience-tour-sticky">
      <div className="experience-feature-list" aria-label={c.tourTitle}>
        {c.features.map((item, index) => {
          const Icon = icons[index]!;
          return <div key={item.image} className="experience-feature-item" data-active={active === index}>
            <button type="button" className="experience-feature" aria-pressed={active === index}
              aria-controls="feature-artwork" onClick={() => selectManually(index)} onFocus={() => selectManually(index)}
              onPointerEnter={event => {
                if (event.pointerType !== 'mouse') return;
                if (hover.current) clearTimeout(hover.current);
                hover.current = setTimeout(() => { hover.current = null; selectManually(index); }, 140);
              }} onPointerLeave={() => { if (hover.current) clearTimeout(hover.current); hover.current = null; }}>
              <span className="feature-number">0{index + 1}</span><Icon size={22} weight="light" />
              <span>{item.title}</span><ArrowUpRight size={16} className="feature-arrow" />
            </button>
            <h3 className="feature-mobile-title"><Icon size={22} weight="light" />{item.title}</h3>
            <div className="feature-explanation">
              <div><p>{item.body}</p><ul>{item.tags.map(tag => <li key={tag}>{tag}</li>)}</ul></div>
            </div>
            <div className="feature-mobile-art"><FeatureArtwork item={item} index={index} /></div>
          </div>;
        })}
        <div className="tour-scroll-hint" aria-hidden="true"><ArrowDown size={16} /><span>{c.tourBody}</span></div>
      </div>
      <div className="feature-artwork-stage" id="feature-artwork">
        <div className="feature-artwork-stack">
          {c.features.map((item, index) => <div className="experience-tour-image" data-active={active === index}
            key={item.image} aria-hidden={active !== index} inert={active !== index}>
            <FeatureArtwork item={item} index={index} />
          </div>)}
          {interfaceOpen && <div className="feature-interface" role="region" aria-label={c.interface} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); closeInterface(); } }}>
            <ProductImage name={screenshots[active]} /><button type="button" className="feature-interface-close"
              aria-label={c.closeInterface} onClick={closeInterface}><X size={19} /></button>
          </div>}
        </div>
        <div className="feature-artwork-footer"><span>{c.features[active]!.detail}</span>
          <button ref={interfaceTrigger} type="button" aria-expanded={interfaceOpen} onClick={() => setInterfaceOpen(value => !value)}>
            {interfaceOpen ? c.closeInterface : c.interface}<ArrowUpRight size={15} /></button></div>
      </div>
    </div>
  </div>;
}

function FeatureArtwork({ item, index }: { item: EditorialCopy['features'][number]; index: number }) {
  return <figure className={`feature-art feature-art-${index}`}>
    <EditorialImage name={item.image} alt={item.alt} />
    <svg className="feature-art-lines" viewBox="0 0 720 530" fill="none" aria-hidden="true">
      <path d={['M60 76H172L238 172', 'M60 76H188L300 220', 'M60 76H154L324 180', 'M60 76H170L300 205'][index]} />
      <path d={['M664 235H568L472 288', 'M664 235H580L506 360', 'M664 235H552L410 282', 'M664 235H585L465 270'][index]} />
      <path d={['M76 459H182L270 360', 'M76 459H180L295 330', 'M76 459H205L365 346', 'M76 459H225L340 400'][index]} />
      {index === 1 && <ellipse cx="326" cy="273" rx="98" ry="138" transform="rotate(-12 326 273)" className="feature-selection" />}
    </svg>
    {item.notes.map((note, i) => <span key={note} className={`feature-art-note note-${i}`} style={{ '--note-index': i } as CSSProperties}>
      <i />{note}</span>)}
    <figcaption className="about-sr-only">{item.body}</figcaption>
  </figure>;
}
