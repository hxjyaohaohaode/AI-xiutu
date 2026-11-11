import { Children, useEffect, useMemo, useRef, type HTMLAttributes, type ReactNode } from 'react';
import './effects.css';

/**
 * Piece opacity/lift progression adapted from React Bits ScrollReveal, with the
 * bounded blur and stagger observed in BlurText / AnimatedContent.
 * Copyright (c) 2026 David Haz. See LICENSE.react-bits.md.
 * Native document scrolling only: no scroll interception or nested scroller.
 */
export interface ScrollRevealProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: 'div' | 'section' | 'p' | 'h2' | 'h3';
  mode?: 'enter' | 'scrub';
  splitWords?: boolean;
}

export function ScrollReveal({
  children,
  as: Tag = 'div',
  mode = 'enter',
  splitWords = false,
  className = '',
  ...props
}: ScrollRevealProps) {
  const rootRef = useRef<HTMLElement>(null);
  const text = useMemo(() => {
    const parts = Children.toArray(children);
    return splitWords && parts.every((part) => typeof part === 'string' || typeof part === 'number')
      ? parts.join('')
      : null;
  }, [children, splitWords]);
  const tokens = useMemo(() => {
    if (text === null) return null;
    // Word segmentation preserves CJK line wrapping, whitespace and punctuation.
    if (typeof Intl.Segmenter !== 'undefined') {
      return Array.from(
        new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text),
        (part) => part.segment,
      );
    }
    return text.split(/(\s+)/);
  }, [text]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pieces = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal-piece]'));
    const targets = pieces.length ? pieces : [root];
    let raf = 0;
    let visible = true;
    let entered = false;
    let started = -1;
    let live = true;
    let rootLift = 0;
    const duration = 520 + Math.min(Math.max(0, targets.length - 1) * 55, 260);
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const clear = () => {
      rootLift = 0;
      targets.forEach((piece) => {
        piece.style.opacity = '';
        piece.style.transform = '';
        piece.style.filter = '';
        piece.style.willChange = '';
      });
    };
    const render = (progress: number) => {
      targets.forEach((piece, index) => {
        const stagger = pieces.length ? Math.min(index * 55, 260) / duration : 0;
        const p = clamp((progress - stagger) / (1 - stagger));
        const reveal = 1 - Math.pow(1 - p, 3);
        const lift = (1 - reveal) * 14;
        // A short presentation blur never touches images, controls, precision values or focus.
        const presentation =
          !piece.matches('button,input,select,canvas,img,output') &&
          !piece.querySelector('button,input,select,canvas,img,output');
        piece.style.filter =
          presentation && p < 1 ? `blur(${((1 - reveal) * 6).toFixed(2)}px)` : '';
        piece.style.opacity = p >= 1 ? '' : (0.28 + reveal * 0.72).toFixed(3);
        piece.style.transform = p >= 1 ? '' : `translateY(${lift.toFixed(2)}px)`;
        if (piece === root) rootLift = p >= 1 ? 0 : lift;
        piece.style.willChange = p > 0 && p < 1 ? 'opacity, transform' : '';
      });
      root.dataset.revealed = progress >= 1 ? 'true' : 'false';
    };
    const scrollProgress = () => {
      const rect = root.getBoundingClientRect();
      const height = window.innerHeight;
      const maximumScroll = Math.max(0, document.documentElement.scrollHeight - height);
      // Read untransformed geometry so the reveal itself cannot shift its trigger.
      const top = rect.top - rootLift + window.scrollY;
      const start = Math.min(top - height * 0.9, maximumScroll - 1);
      const end = Math.max(start + 1, Math.min(top - height * 0.36, maximumScroll));
      return clamp((window.scrollY - start) / (end - start));
    };
    const frame = (now: number) => {
      raf = 0;
      if (!live || document.hidden) return;
      if (reduced.matches || root.contains(document.activeElement)) {
        clear();
        return;
      }
      if (mode === 'scrub') {
        render(scrollProgress());
        return;
      }
      if (!entered || started < 0) return;
      const progress = clamp((now - started) / duration);
      render(progress);
      if (progress < 1) raf = requestAnimationFrame(frame);
    };
    const schedule = () => {
      if (!raf && live && !document.hidden && (visible || mode === 'enter'))
        raf = requestAnimationFrame(frame);
    };
    const onScroll = () => {
      if (mode === 'scrub') schedule();
    };
    const show = () => {
      if (!entered) {
        entered = true;
        started = performance.now();
      }
      schedule();
    };
    const preference = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (reduced.matches) {
        clear();
        root.dataset.revealed = 'true';
      } else schedule();
    };
    const focus = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      clear();
      root.dataset.revealed = 'true';
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              visible = entries.some((entry) => entry.isIntersecting);
              if (visible) {
                if (mode === 'enter') show();
                else schedule();
              } else if (raf && mode === 'scrub') {
                cancelAnimationFrame(raf);
                raf = 0;
              }
            },
            { rootMargin: '0px 0px -5% 0px', threshold: 0 },
          );
    observer?.observe(root);
    if (reduced.matches) clear();
    else if (mode === 'scrub') render(scrollProgress());
    else if (root.getBoundingClientRect().top <= window.innerHeight * 0.9 || !observer) show();
    else render(0);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('visibilitychange', schedule);
    reduced.addEventListener('change', preference);
    root.addEventListener('focusin', focus);
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      clear();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      reduced.removeEventListener('change', preference);
      root.removeEventListener('focusin', focus);
    };
  }, [mode, text]);

  return (
    <Tag
      {...props}
      ref={(node: HTMLElement | null) => {
        rootRef.current = node;
      }}
      className={`about-scroll-reveal ${className}`}
    >
      {tokens ? (
        <>
          <span className="about-effects-sr-only">{text}</span>
          <span aria-hidden="true">
            {tokens.map((part, index) =>
              /^\s+$/.test(part) ? (
                part
              ) : (
                <span className="about-scroll-reveal__piece" data-reveal-piece="" key={index}>
                  {part}
                </span>
              ),
            )}
          </span>
        </>
      ) : (
        children
      )}
    </Tag>
  );
}
