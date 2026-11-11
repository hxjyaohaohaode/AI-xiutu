import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ClockCounterClockwise,
  FrameCorners,
  SlidersHorizontal,
} from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { ProductImage } from './AboutArt';
import { productCopy } from './product-copy';

const icons = [FrameCorners, SlidersHorizontal, ClockCounterClockwise];

/** A real capture with an interactive guide; no simulated editing or cloud status. */
export function ProductHero() {
  const c = productCopy(useLocale());
  const [focus, setFocus] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = root.current;
    if (!target) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = target.getBoundingClientRect();
      const progress = reduced.matches
        ? 1
        : Math.max(0, Math.min(1, (innerHeight - rect.top) / (innerHeight * 0.8)));
      target.style.setProperty('--hero-progress', String(progress));
    };
    const schedule = () => {
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    reduced.addEventListener('change', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      reduced.removeEventListener('change', schedule);
    };
  }, []);
  return (
    <div className="hero-artwork product-hero" ref={root} data-focus={focus} data-pointer-protect>
      <div className="product-hero-caption">
        <span>
          <i />
          {c.image}
        </span>
        <span>01 — 03</span>
      </div>
      <div className="product-hero-stage">
        <div className="product-hero-screen">
          <ProductImage name="hero" eager />
          <div className={`product-guide-outline guide-${focus}`} aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="product-hero-rail" aria-label={c.tour}>
          {c.hero.map((item, index) => {
            const Icon = icons[index]!;
            return (
              <button
                type="button"
                className="product-hero-step"
                key={item.title}
                aria-pressed={focus === index}
                onClick={() => setFocus(index)}
                onKeyDown={(event) => {
                  if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(event.key))
                    return;
                  event.preventDefault();
                  const next =
                    (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : 2)) % 3;
                  setFocus(next);
                  (
                    event.currentTarget.parentElement?.children[next] as
                      HTMLButtonElement | undefined
                  )?.focus();
                }}
              >
                <span className="product-step-index">
                  0{index + 1}
                  <Icon size={20} weight="light" />
                </span>
                <strong>
                  {item.title}
                  <ArrowRight size={15} />
                </strong>
                <span className="product-step-body">{item.body}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
