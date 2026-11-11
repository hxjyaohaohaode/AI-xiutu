import { useEffect, useId, useRef, type RefObject } from 'react';
import { ArrowsHorizontal } from '@phosphor-icons/react';

/**
 * Independent implementation of a velocity-bent comparison edge, inspired by the
 * publicly playable Aceternity Compare Slider. No paid implementation is copied.
 * Only the clipping boundary moves; edited image pixels stay sharp and stationary.
 */
export function ElasticCompare({ value, onChange, label, canvasRef }: {
  value: number; onChange: (value: number) => void; label: string;
  canvasRef: RefObject<HTMLCanvasElement | null>;
}) {
  const id = `compare-${useId().replace(/:/g, '')}`;
  const root = useRef<HTMLDivElement>(null);
  const clip = useRef<SVGPathElement>(null);
  const line = useRef<SVGPathElement>(null);
  const sparks = useRef<SVGGElement>(null);
  const valueRef = useRef(value);
  const wake = useRef<() => void>(() => {});
  const bend = useRef({ value: 0, velocity: 0, target: 0, lastX: 0, lastTime: 0 });
  valueRef.current = value;
  useEffect(() => {
    const target = root.current;
    const canvas = canvasRef.current;
    if (!target || !canvas) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    canvas.style.clipPath = `url(#${id})`;
    let frame = 0;
    let last = 0;
    let visible = true;
    const paint = () => {
      const width = target.clientWidth || 1;
      const x = valueRef.current / 100;
      const amount = reduce.matches ? 0 : Math.max(-Math.min(x, 1 - x), Math.min(Math.min(x, 1 - x), bend.current.value / width));
      const edge = x - amount;
      const curve = `M${edge} 0C${edge} .2 ${x} .3 ${x} .5C${x} .7 ${edge} .8 ${edge} 1`;
      clip.current?.setAttribute('d', `${curve}H1V0Z`);
      line.current?.setAttribute('d', curve);
      if (sparks.current) {
        const strength = reduce.matches ? 0 : Math.min(1, Math.abs(bend.current.value) / 18);
        Array.from(sparks.current.children).forEach((element, index) => {
          const y = (index + 1) / 9;
          const off = Math.sin(index * 2.1) * amount * 0.75;
          element.setAttribute('cx', String(Math.max(0, Math.min(1, x + off))));
          element.setAttribute('cy', String(y));
          element.setAttribute('rx', String((1.5 + index % 3 * 0.4) / width));
          element.setAttribute('ry', String((1.5 + index % 3 * 0.4) / Math.max(1, target.clientHeight)));
          element.setAttribute('opacity', String(strength * (0.65 - index % 3 * 0.1)));
        });
      }
    };
    const tick = (now: number) => {
      frame = 0;
      if (document.hidden || !visible) return;
      const dt = Math.min(1 / 30, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      const state = bend.current;
      const steps = Math.max(1, Math.ceil(dt * 240));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        state.velocity += (440 * (state.target - state.value) - 36 * state.velocity) * h;
        state.value += state.velocity * h;
        state.target *= Math.exp(-h * 11);
      }
      if (reduce.matches || (Math.abs(state.value) < 0.015 && Math.abs(state.velocity) < 0.05 && Math.abs(state.target) < 0.01)) {
        state.value = state.velocity = state.target = 0;
      }
      paint();
      if (state.value !== 0 || state.target !== 0) frame = requestAnimationFrame(tick);
    };
    wake.current = () => {
      paint();
      if (!reduce.matches && !frame && visible && !document.hidden) { last = 0; frame = requestAnimationFrame(tick); }
    };
    const reset = () => {
      cancelAnimationFrame(frame); frame = 0;
      bend.current.value = bend.current.velocity = bend.current.target = 0;
      bend.current.lastTime = 0;
      paint();
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (!visible) reset();
    });
    observer?.observe(target);
    reduce.addEventListener('change', reset);
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('resize', reset, { passive: true });
    paint();
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect(); wake.current = () => {};
      reduce.removeEventListener('change', reset);
      document.removeEventListener('visibilitychange', reset);
      window.removeEventListener('resize', reset);
      canvas.style.clipPath = '';
    };
  }, [canvasRef, id]);
  useEffect(() => { wake.current(); }, [value]);
  return <div className="elastic-compare" ref={root}>
    <svg className="compare-definitions" width="0" height="0" aria-hidden="true"><defs><clipPath id={id} clipPathUnits="objectBoundingBox">
      <path ref={clip} d={`M${value / 100} 0V1H1V0Z`} /></clipPath></defs></svg>
    <svg className="compare-edge" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      <path ref={line} d={`M${value / 100} 0V1`} vectorEffect="non-scaling-stroke" />
      <g ref={sparks}>{Array.from({ length: 8 }, (_, index) => <ellipse key={index} opacity="0" />)}</g>
    </svg>
    <input className="study-compare" type="range" min="0" max="100" step="1" value={value} aria-label={label}
      aria-valuetext={`${Math.round(value)}%`} onChange={event => onChange(Number(event.currentTarget.value))}
      onPointerMove={event => {
        if (event.pointerType !== 'mouse' && event.buttons === 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
        const state = bend.current;
        const time = performance.now();
        const dt = state.lastTime ? Math.max(8, time - state.lastTime) : 16;
        if (state.lastTime && dt < 100) state.target = Math.max(-28, Math.min(28, (x - state.lastX) / dt * 18));
        state.lastX = x; state.lastTime = time;
        // Hover previews use image coordinates; pressed drags use the native
        // range track only, so competing geometries cannot jump near an edge.
        if (event.pointerType === 'mouse' && event.buttons === 0) onChange(Math.round(x / Math.max(1, bounds.width) * 100));
        wake.current();
      }} onPointerLeave={() => { bend.current.lastTime = 0; bend.current.target = 0; wake.current(); }}
      onKeyDown={() => { bend.current.target = bend.current.value = bend.current.velocity = 0; }} />
    <span className="study-divider-handle" style={{ left: `${value}%` }} aria-hidden="true"><ArrowsHorizontal size={20} /></span>
  </div>;
}
