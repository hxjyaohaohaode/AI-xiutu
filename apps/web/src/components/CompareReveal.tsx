import { useEffect, useId, useRef, type Ref } from 'react';
import type { RGBAImage } from '@ai-xiutu/editor';
import { ArrowsHorizontal } from '@phosphor-icons/react';
import { t } from '../i18n';
import { ImagePreview } from './ImagePreview';

/** Original SVG edge motion. Both image planes remain stationary and share the same fit rectangle. */
export function CompareReveal({ before, value, onChange, onClose, inputRef }: {
  before: RGBAImage | null;
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const identifier = 'image-compare-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const area = useRef<HTMLDivElement>(null);
  const clip = useRef<SVGPathElement>(null);
  const edge = useRef<SVGPathElement>(null);
  const particles = useRef<SVGGElement>(null);
  const percent = useRef(value);
  percent.current = value;
  const motion = useRef({ bend: 0, target: 0, speed: 0, dragging: false, lastValue: value, lastTime: 0 });
  const wake = useRef<() => void>(() => {});
  const reset = useRef<() => void>(() => {});
  const straight = 'M' + value / 100 + ' 0V1';
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let previousTime = 0;
    const paint = () => {
      const x = Math.max(0, Math.min(1, percent.current / 100));
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      const offset = reduced.matches ? 0 : Math.max(-Math.min(x, 1 - x), Math.min(Math.min(x, 1 - x), motion.current.bend / width));
      const end = x + offset;
      const curve = 'M' + end + ' 0C' + end + ' .22 ' + x + ' .3 ' + x + ' .5C' + x + ' .7 ' + end + ' .78 ' + end + ' 1';
      edge.current?.setAttribute('d', curve);
      clip.current?.setAttribute('d', curve + 'H0V0Z');
      const strength = Math.min(1, Math.abs(motion.current.bend) / 12);
      Array.from(particles.current?.children ?? []).forEach((particle, index) => {
        const y = (index + 1) / 7;
        const ripple = offset * Math.sin(index * 2.3) * .6;
        particle.setAttribute('cx', String(Math.max(0, Math.min(1, x + ripple))));
        particle.setAttribute('cy', String(y));
        particle.setAttribute('rx', String((1.3 + index % 2 * .5) / width));
        particle.setAttribute('ry', String((1.3 + index % 2 * .5) / height));
        particle.setAttribute('opacity', String(reduced.matches ? 0 : strength * .55));
      });
    };
    const animate = (time: number) => {
      frame = 0;
      if (document.hidden) { reset.current(); return; }
      const dt = Math.min(.025, previousTime ? (time - previousTime) / 1000 : 1 / 60);
      previousTime = time;
      const state = motion.current;
      state.speed += (380 * (state.target - state.bend) - 32 * state.speed) * dt;
      state.bend += state.speed * dt;
      state.target *= Math.exp(-12 * dt);
      if (reduced.matches || (Math.abs(state.bend) < .02 && Math.abs(state.speed) < .1 && Math.abs(state.target) < .02))
        state.bend = state.speed = state.target = 0;
      paint();
      if (state.bend || state.target) frame = requestAnimationFrame(animate);
    };
    wake.current = () => {
      paint();
      if (!reduced.matches && !document.hidden && !frame) {
        previousTime = 0;
        frame = requestAnimationFrame(animate);
      }
    };
    reset.current = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      motion.current.bend = motion.current.target = motion.current.speed = 0;
      motion.current.lastTime = 0;
      paint();
    };
    const onVisibility = () => reset.current();
    const observer = new ResizeObserver(onVisibility);
    observer.observe(element);
    reduced.addEventListener('change', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);
    paint();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reduced.removeEventListener('change', onVisibility);
      document.removeEventListener('visibilitychange', onVisibility);
      wake.current = () => {};
      reset.current = () => {};
    };
  }, []);
  useEffect(() => wake.current(), [value]);
  return (
    <div className="compare-reveal" data-testid="compare-reveal" ref={area}>
      <div className="compare-reveal-layer" style={{ clipPath: 'url(#' + identifier + ')' }}>
        <ImagePreview image={before} label={t('原始图片')} />
      </div>
      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
        <defs><clipPath id={identifier} clipPathUnits="objectBoundingBox"><path ref={clip} d={straight + 'H0V0Z'} /></clipPath></defs>
      </svg>
      <svg className="compare-reveal-edge" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
        <path ref={edge} d={straight} fill="none" stroke="white" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <g ref={particles} fill="white">{Array.from({ length: 6 }, (_, index) => <ellipse key={index} opacity="0" />)}</g>
      </svg>
      <span className="compare-reveal-label compare-reveal-before">{t('原图')}</span>
      <span className="compare-reveal-label compare-reveal-after">{t('当前')}</span>
      <span className="compare-reveal-boundary compare-reveal-handle" style={{ left: value + '%' }} aria-hidden="true"><ArrowsHorizontal size={20} /></span>
      <input ref={inputRef} className="compare-reveal-input" type="range" min="0" max="100" step="1" value={value}
        aria-label={t('原图与当前图的分界')} aria-valuetext={t('原图 {percent}%', { percent: value })}
        onPointerDown={() => { motion.current.dragging = true; motion.current.lastValue = value; motion.current.lastTime = performance.now(); }}
        onPointerUp={() => { motion.current.dragging = false; motion.current.target = 0; wake.current(); }}
        onPointerCancel={() => { motion.current.dragging = false; reset.current(); }}
        onLostPointerCapture={() => { motion.current.dragging = false; motion.current.target = 0; wake.current(); }}
        onBlur={() => { motion.current.dragging = false; reset.current(); }}
        onKeyDown={(event) => {
          motion.current.dragging = false;
          reset.current();
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          const now = performance.now();
          const state = motion.current;
          if (state.dragging && state.lastTime) {
            const velocity = (next - state.lastValue) * (area.current?.clientWidth ?? 1) / 100 / Math.max(8, now - state.lastTime);
            state.target = Math.max(-14, Math.min(14, velocity * 9));
          }
          state.lastValue = next;
          state.lastTime = now;
          percent.current = next;
          onChange(next);
          wake.current();
        }} />
    </div>
  );
}
