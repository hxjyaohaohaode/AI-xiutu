import { useEffect, type RefObject } from 'react';

/**
 * Scroll-driven frame expansion and entry translations, adapted from the public
 * React Bits ScrollExpand / AnimatedContent sources. See product-reference-notes.md.
 * Content is visible without this hook, and motion never controls disclosure.
 */
export function useOverviewMotion(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let disposed = false;
    const expanded = element.querySelector<HTMLElement>('[data-scroll-expand]');
    const reveal = Array.from(element.querySelectorAll<HTMLElement>('[data-scroll-reveal]'));
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const smooth = (value: number) => value * value * (3 - 2 * value);
    const paint = () => {
      frame = 0;
      if (disposed) return;
      const height = window.innerHeight;
      const total = document.documentElement.scrollHeight - height;
      element.style.setProperty('--overview-progress', String(total > 0 ? clamp(window.scrollY / total) : 0));
      if (media.matches) {
        expanded?.style.removeProperty('--frame-inset');
        for (const node of reveal) node.style.removeProperty('--entry-shift');
        return;
      }
      if (expanded) {
        const rect = expanded.getBoundingClientRect();
        const progress = smooth(clamp((height - rect.top) / Math.max(1, height * 0.9)));
        // A small change in the frame; never crop or transform the interface itself.
        expanded.style.setProperty('--frame-inset', (3.2 * (1 - progress)).toFixed(3) + '%');
      }
      for (const node of reveal) {
        const rect = node.getBoundingClientRect();
        if (rect.bottom < -80 || rect.top > height + 80) continue;
        const progress = smooth(clamp((height - rect.top) / Math.max(1, height * 0.38)));
        node.style.setProperty('--entry-shift', ((1 - progress) * 22).toFixed(2) + 'px');
      }
    };
    const schedule = () => { if (!frame && !disposed) frame = requestAnimationFrame(paint); };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    media.addEventListener('change', schedule);
    paint();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      media.removeEventListener('change', schedule);
    };
  }, [root]);
}
