import { useLayoutEffect, type RefObject } from 'react';
import { KineticValue } from '../motion/kinetic';
import { useReducedMotion } from '../motion/usePresence';

/** #68's distance falloff only moves a short marker. Buttons and hit boxes stay put. */
export function useNavigationProximity(
  root: RefObject<HTMLElement | null>,
  open: boolean,
  rowsKey: string,
) {
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const node = root.current;
    if (!node || !open) return;
    const rows = Array.from(node.querySelectorAll<HTMLElement>('[data-nav-row]')).map((element) => {
      const spring = new KineticValue(0, { stiffness: 360, damping: 38, precision: 0.004 });
      spring.setReduced(reduced);
      const release = spring.subscribe((value) =>
        element.style.setProperty('--nav-proximity', String(value)),
      );
      return { element, spring, release };
    });
    const point = (y: number) => {
      for (const { element, spring } of rows) {
        const rect = element.getBoundingClientRect();
        const distance = Math.abs(y - rect.top - rect.height / 2);
        const progress = Math.max(0, 1 - distance / 78);
        spring.setTarget(reduced ? 0 : progress * progress * (3 - 2 * progress));
      }
    };
    const reset = () => rows.forEach(({ spring }) => spring.setTarget(0));
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches)
        point(event.clientY);
    };
    const focus = (event: FocusEvent) => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-nav-row]')
          : null;
      if (!target) return reset();
      const box = target.getBoundingClientRect();
      point(box.top + box.height / 2);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerleave', reset);
    node.addEventListener('focusin', focus);
    node.addEventListener('focusout', reset);
    node.addEventListener('scroll', reset, { passive: true });
    return () => {
      node.removeEventListener('pointermove', move);
      node.removeEventListener('pointerleave', reset);
      node.removeEventListener('focusin', focus);
      node.removeEventListener('focusout', reset);
      node.removeEventListener('scroll', reset);
      for (const { element, spring, release } of rows) {
        release();
        spring.dispose();
        element.style.removeProperty('--nav-proximity');
      }
    };
  }, [root, open, rowsKey, reduced]);
}
