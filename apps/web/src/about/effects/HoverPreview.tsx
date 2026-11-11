import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import './effects.css';

/**
 * Normalized pointer tilt and damped spring adapted from React Bits TiltedCard.
 * Copyright (c) 2026 David Haz. See LICENSE.react-bits.md.
 * Restrained to 4 degrees; no gyro permissions, global pointer listeners or flip.
 */
export interface HoverPreviewProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function HoverPreview({ children, className = '', ...props }: HoverPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const surface = surfaceRef.current;
    if (!root || !surface) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const state = { rx: 0, ry: 0, lift: 0, vrx: 0, vry: 0, vlift: 0 };
    let nx = 0;
    let ny = 0;
    let inside = false;
    let focused = false;
    let visible = true;
    let raf = 0;
    let last = 0;
    let live = true;
    const clamp = (value: number) => Math.max(-1, Math.min(1, value));
    const step = (key: 'rx' | 'ry' | 'lift', goal: number, dt: number) => {
      const velocity = `v${key}` as 'vrx' | 'vry' | 'vlift';
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      const omega = 16;
      const zeta = 0.92;
      for (let i = 0; i < steps; i += 1) {
        state[velocity] += (omega * omega * (goal - state[key]) - 2 * zeta * omega * state[velocity]) * h;
        state[key] += state[velocity] * h;
      }
      const settled = Math.abs(goal - state[key]) < 0.001 && Math.abs(state[velocity]) < 0.01;
      if (settled) { state[key] = goal; state[velocity] = 0; }
      return !settled;
    };
    const paint = () => {
      const active = inside || focused;
      root.dataset.active = active ? 'true' : 'false';
      surface.style.transform = `translate3d(0,${(-2 * state.lift).toFixed(2)}px,0) rotateX(${state.rx.toFixed(3)}deg) rotateY(${state.ry.toFixed(3)}deg)`;
      surface.style.setProperty('--hover-light-x', `${(50 + state.ry / 4 * 38).toFixed(2)}%`);
      surface.style.setProperty('--hover-light-y', `${(50 - state.rx / 4 * 38).toFixed(2)}%`);
      surface.style.setProperty('--hover-light-opacity', (state.lift * 0.18).toFixed(3));
    };
    const frame = (now: number) => {
      raf = 0;
      if (!live || !visible || document.hidden) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const motion = !reduce.matches && fine.matches;
      const tilt = motion && inside;
      let busy = step('rx', tilt ? -ny * 4 : 0, dt);
      busy = step('ry', tilt ? nx * 4 : 0, dt) || busy;
      busy = step('lift', motion && (inside || focused) ? 1 : 0, dt) || busy;
      paint();
      if (busy) raf = requestAnimationFrame(frame);
    };
    const wake = () => {
      if (!raf && live && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); }
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !fine.matches || reduce.matches) return;
      const rect = root.getBoundingClientRect();
      nx = clamp((event.clientX - rect.left - rect.width / 2) / Math.max(1, rect.width / 2));
      ny = clamp((event.clientY - rect.top - rect.height / 2) / Math.max(1, rect.height / 2));
      inside = true;
      wake();
    };
    const onLeave = () => { inside = false; nx = 0; ny = 0; wake(); };
    const onFocus = () => { focused = true; wake(); };
    const onBlur = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && root.contains(event.relatedTarget)) return;
      focused = false;
      wake();
    };
    const reset = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      inside = false;
      nx = ny = 0;
      Object.assign(state, { rx: 0, ry: 0, lift: 0, vrx: 0, vry: 0, vlift: 0 });
      paint();
    };
    const onVisibility = () => { if (document.hidden) reset(); else wake(); };
    const intersection = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting);
      if (!visible) reset(); else wake();
    });
    intersection?.observe(root);
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('focusin', onFocus);
    root.addEventListener('focusout', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    reduce.addEventListener('change', reset);
    fine.addEventListener('change', reset);
    return () => {
      live = false;
      reset();
      intersection?.disconnect();
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('focusin', onFocus);
      root.removeEventListener('focusout', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      reduce.removeEventListener('change', reset);
      fine.removeEventListener('change', reset);
    };
  }, []);

  return (
    <div {...props} ref={rootRef} className={`about-hover-preview ${className}`}>
      <div ref={surfaceRef} className="about-hover-preview__surface">
        {children}
        <span className="about-hover-preview__light" aria-hidden="true" />
      </div>
    </div>
  );
}
