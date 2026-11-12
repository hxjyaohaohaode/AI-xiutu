import { useEffect, type RefObject } from 'react';
import { KineticValue } from '../motion/kinetic';

/**
 * Ref31 ScrollExpand + Ref35 AnimatedContent: scroll expansion and once-only
 * entry translation. Native page scrolling owns reading; motion owns no content.
 * Source, licence and adaptations are recorded in docs/design/reference-209-*.
 */
export function useOverviewMotion(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const expanded = element.querySelector<HTMLElement>('[data-scroll-expand]');
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const smooth = (value: number) => value * value * (3 - 2 * value);
    let frame = 0;
    let disposed = false;
    const expansion = new KineticValue(1, { stiffness: 150, damping: 26, precision: 0.0001 });
    expansion.setReduced(media.matches);
    expansion.subscribe((value) => {
      if (!expanded) return;
      const phone = window.innerWidth < 760;
      const progress = smooth(clamp(value));
      expanded.style.setProperty(
        '--frame-scale',
        String(1 - (phone ? 0.03 : 0.16) * (1 - progress)),
      );
      expanded.style.setProperty(
        '--frame-radius',
        String((phone ? 12 : 24) - (phone ? 4 : 14) * progress) + 'px',
      );
    });
    const reveals = new Map<HTMLElement, { spring: KineticValue; entered: boolean }>();
    for (const node of element.querySelectorAll<HTMLElement>('[data-scroll-reveal]')) {
      const entered = media.matches || node.getBoundingClientRect().top < window.innerHeight * 0.94;
      const spring = new KineticValue(entered ? 0 : window.innerWidth < 760 ? 14 : 24);
      spring.setReduced(media.matches);
      spring.subscribe((value) => node.style.setProperty('--entry-shift', value.toFixed(2) + 'px'));
      reveals.set(node, { spring, entered });
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const state = reveals.get(entry.target as HTMLElement);
          if (!state || state.entered) continue;
          state.entered = true;
          state.spring.setTarget(0);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.06, rootMargin: '0px 0px -16px 0px' },
    );
    for (const [node, state] of reveals) if (!state.entered) observer.observe(node);

    const measure = (immediate = false) => {
      frame = 0;
      if (disposed || element.getClientRects().length === 0) return;
      const height = window.innerHeight;
      const total = document.documentElement.scrollHeight - height;
      element.style.setProperty(
        '--overview-progress',
        String(total > 0 ? clamp(window.scrollY / total) : 0),
      );
      if (expanded) {
        const top = expanded.getBoundingClientRect().top;
        const target = media.matches
          ? 1
          : clamp((height * 0.92 - top) / Math.max(1, height * 0.64));
        if (immediate) expansion.jump(target);
        else expansion.setTarget(target);
      }
    };
    const schedule = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(() => measure());
    };
    const preference = () => {
      expansion.setReduced(media.matches);
      for (const [node, state] of reveals) {
        state.spring.setReduced(media.matches);
        if (media.matches) {
          state.entered = true;
          state.spring.jump(0);
          observer.unobserve(node);
        }
      }
      measure(true);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    media.addEventListener('change', preference);
    measure(true);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      expansion.dispose();
      for (const [node, state] of reveals) {
        state.spring.dispose();
        node.style.removeProperty('--entry-shift');
      }
      expanded?.style.removeProperty('--frame-scale');
      expanded?.style.removeProperty('--frame-radius');
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      media.removeEventListener('change', preference);
    };
  }, [root]);
}
