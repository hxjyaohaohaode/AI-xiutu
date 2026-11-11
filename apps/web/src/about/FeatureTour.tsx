import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  MagicWand,
  Scan,
  SlidersHorizontal,
  Stack,
  X,
} from '@phosphor-icons/react';
import { EditorialImage, ProductImage } from './AboutArt';
import type { EditorialCopy } from './editorial-copy';
import { useLocale } from '../i18n';
import { productCopy } from './product-copy';

const icons = [SlidersHorizontal, Scan, MagicWand, Stack];
const screenshots = ['workspace', 'local', 'portrait', 'layers'];

/** One index owns the list, artwork, callouts and progress. Native scrolling is never intercepted. */
export function FeatureTour({ copy: c }: { copy: EditorialCopy }) {
  const p = productCopy(useLocale());
  const root = useRef<HTMLDivElement>(null);
  const current = useRef(0);
  const artworkStack = useRef<HTMLDivElement>(null);
  const interfaceTrigger = useRef<HTMLButtonElement>(null);
  const interfaceClose = useRef<HTMLButtonElement>(null);
  const overrideAt = useRef<number | null>(null);
  const hover = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(0);
  const [interfaceOpen, setInterfaceOpen] = useState(false);
  const select = (index: number) => {
    // Hover or scroll can change chapters without moving keyboard focus first.
    // Keep it on a visible control before hiding annotations or removing the detail.
    if (artworkStack.current?.contains(document.activeElement))
      interfaceTrigger.current?.focus({ preventScroll: true });
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
  useLayoutEffect(() => {
    if (interfaceOpen) interfaceClose.current?.focus({ preventScroll: true });
  }, [interfaceOpen]);
  useEffect(() => {
    const target = root.current;
    if (!target) return;
    const narrow = window.matchMedia('(max-width: 760px), (max-height: 800px)');
    let frame = 0;
    const update = () => {
      frame = 0;
      if (narrow.matches) return;
      if (
        target.querySelector('.feature-artwork-stage')?.contains(document.activeElement) &&
        document.activeElement?.matches(':focus-visible')
      )
        return;
      if (overrideAt.current !== null) {
        if (Math.abs(window.scrollY - overrideAt.current) < Math.max(180, innerHeight * 0.3))
          return;
        overrideAt.current = null;
      }
      const rect = target.getBoundingClientRect();
      const travel = Math.max(1, target.offsetHeight - window.innerHeight);
      const progress = Math.max(0, Math.min(0.999, (76 - rect.top) / travel));
      const position = progress * 4;
      const next = Math.min(3, Math.floor(position));
      // Four percent hysteresis prevents trackpad jitter at a chapter boundary.
      if (
        next !== current.current &&
        (next > current.current ? position > next + 0.04 : position < next + 0.96)
      )
        select(next);
      target.style.setProperty('--tour-progress', String(progress));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
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
  const closeInterface = () => {
    setInterfaceOpen(false);
    interfaceTrigger.current?.focus({ preventScroll: true });
  };
  return (
    <div className="experience-tour" ref={root} data-active={active}>
      <div className="experience-tour-sticky">
        <div className="experience-feature-list" aria-label={c.tourTitle}>
          {c.features.map((item, index) => {
            const Icon = icons[index]!;
            return (
              <div
                key={item.image}
                className="experience-feature-item"
                data-active={active === index}
              >
                <button
                  type="button"
                  className="experience-feature"
                  aria-pressed={active === index}
                  aria-controls="feature-artwork"
                  onClick={() => selectManually(index)}
                  onFocus={() => selectManually(index)}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'mouse') return;
                    if (hover.current) clearTimeout(hover.current);
                    hover.current = setTimeout(() => {
                      hover.current = null;
                      selectManually(index);
                    }, 280);
                  }}
                  onPointerLeave={() => {
                    if (hover.current) clearTimeout(hover.current);
                    hover.current = null;
                  }}
                >
                  <span className="feature-number">0{index + 1}</span>
                  <Icon size={22} weight="light" />
                  <span>{item.title}</span>
                  <ArrowUpRight size={16} className="feature-arrow" />
                </button>
                <h3 className="feature-mobile-title">
                  <Icon size={22} weight="light" />
                  {item.title}
                </h3>
                <div className="feature-explanation">
                  <div>
                    <p>{item.body}</p>
                    <ul>
                      {item.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="feature-mobile-art">
                  <FeatureArtwork item={item} index={index} />
                </div>
              </div>
            );
          })}
          <div className="tour-scroll-hint" aria-hidden="true">
            <ArrowDown size={16} />
            <span>{c.tourBody}</span>
          </div>
        </div>
        <div className="feature-artwork-stage" id="feature-artwork">
          <div
            className="feature-artwork-stack"
            ref={artworkStack}
            onPointerDownCapture={() => {
              overrideAt.current = window.scrollY;
            }}
          >
            {c.features.map((item, index) => (
              <div
                className="experience-tour-image"
                data-active={active === index}
                key={item.image}
                aria-hidden={active !== index || interfaceOpen}
                inert={active !== index || interfaceOpen}
              >
                <FeatureArtwork item={item} index={index} />
              </div>
            ))}
            {interfaceOpen && (
              <div
                className="feature-interface"
                id="feature-interface"
                role="region"
                aria-label={c.interface}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeInterface();
                  }
                }}
              >
                <ProductImage name={screenshots[active]} />
                <button
                  ref={interfaceClose}
                  type="button"
                  className="feature-interface-close"
                  aria-label={c.closeInterface}
                  onClick={closeInterface}
                >
                  <X size={19} />
                </button>
              </div>
            )}
          </div>
          <div className="feature-artwork-footer">
            <span>{c.features[active]!.detail}</span>
            <button
              ref={interfaceTrigger}
              type="button"
              aria-expanded={interfaceOpen}
              aria-controls={interfaceOpen ? 'feature-interface' : undefined}
              onClick={() => {
                if (interfaceOpen) closeInterface();
                else setInterfaceOpen(true);
              }}
            >
              {interfaceOpen ? p.closeDetail : p.detail}
              <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="feature-chapter-navigation" aria-label={p.progress}>
            <button
              type="button"
              aria-label={c.previous}
              disabled={active === 0}
              onClick={() => selectManually(active - 1)}
            >
              <ArrowLeft size={17} />
            </button>
            <span>
              <b>0{active + 1}</b> / 04
            </span>
            <div className="feature-chapter-track" aria-hidden="true">
              {c.features.map((item, index) => (
                <i key={item.title} data-active={index <= active} />
              ))}
            </div>
            <button
              type="button"
              aria-label={c.next}
              disabled={active === 3}
              onClick={() => selectManually(active + 1)}
            >
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureArtwork({
  item,
  index,
}: {
  item: EditorialCopy['features'][number];
  index: number;
}) {
  const c = productCopy(useLocale());
  const [focus, setFocus] = useState(1);
  return (
    <figure className={`feature-art feature-art-${index} product-feature-art`} data-focus={focus}>
      <div className="feature-product-screen">
        <ProductImage name={screenshots[index]} />
        <div className={`product-guide-outline guide-${focus}`} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </div>
      <div className="feature-product-context">
        <div className="feature-source-swatch">
          <EditorialImage name={item.image} alt={item.alt} />
          <span>{c.sample}</span>
        </div>
        <div className="feature-product-guide" aria-label={c.tour}>
          {c.sections[index]!.map((note, i) => (
            <button
              type="button"
              key={note}
              aria-pressed={focus === i}
              onClick={() => setFocus(i)}
              className={`feature-art-note note-${i}`}
              style={{ '--note-index': i } as CSSProperties}
            >
              <span>0{i + 1}</span>
              {note}
              <i />
            </button>
          ))}
        </div>
      </div>
      <figcaption className="about-sr-only">{item.body}</figcaption>
    </figure>
  );
}
