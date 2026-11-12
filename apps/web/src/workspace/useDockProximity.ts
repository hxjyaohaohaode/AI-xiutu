import { useLayoutEffect, type RefObject } from 'react';
import { KineticValue } from '../motion/kinetic';
import { useReducedMotion } from '../motion/usePresence';

/** React Bits 88: measured cosine-squared neighbours, without moving any hit target. */
export function dockProximity(distance: number, reach: number): number {
  if (!Number.isFinite(distance) || reach <= 0 || Math.abs(distance) >= reach) return 0;
  return Math.cos(((Math.abs(distance) / reach) * Math.PI) / 2) ** 2;
}

export function useDockProximity(
  root: RefObject<HTMLElement | null>,
  compact: boolean,
  identity: string,
) {
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const nodes = [...element.querySelectorAll<HTMLButtonElement>('[data-dock-tool]')].map(
      (button) => {
        const icon = button.querySelector<HTMLElement>('.dock-icon');
        const spring = new KineticValue(0, { stiffness: 150, damping: 12, mass: 0.1 });
        spring.setReduced(reduced);
        spring.subscribe((value) => {
          if (!icon) return;
          const lift = compact ? 1.5 : 4;
          const scale = compact ? 0.12 : 0.34;
          icon.style.transform = `translate3d(0, ${-Math.max(0, value) * lift}px, 0) scale(${1 + Math.max(0, value) * scale})`;
        });
        return { button, spring };
      },
    );
    const reset = () => nodes.forEach(({ spring }) => spring.setTarget(0));
    const point = (clientX: number, target?: HTMLElement) => {
      if (reduced) {
        reset();
        return;
      }
      for (const { button, spring } of nodes) {
        const rect = button.getBoundingClientRect();
        const reach = Math.max(80, rect.width * 2.2);
        // Phones keep stable, independently-sized slots. Only the active/focused
        // icon reacts; neighbours follow the cursor on fine-pointer desktops.
        spring.setTarget(
          compact
            ? Number(button === target)
            : dockProximity(clientX - rect.left - rect.width / 2, reach),
        );
      }
    };
    const hover = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || compact) return;
      point(event.clientX);
    };
    const focus = (event: FocusEvent) => {
      const target =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('[data-dock-tool]')
          : null;
      if (!target || !target.matches(':focus-visible')) return;
      const rect = target.getBoundingClientRect();
      point(rect.left + rect.width / 2, target);
    };
    const leave = () => {
      const focused = element.querySelector<HTMLElement>('[data-dock-tool]:focus-visible');
      if (focused) {
        const rect = focused.getBoundingClientRect();
        point(rect.left + rect.width / 2, focused);
      } else reset();
    };
    const press = (event: PointerEvent) => {
      if (!compact || event.pointerType !== 'touch') return;
      const target =
        event.target instanceof HTMLElement
          ? event.target.closest<HTMLElement>('[data-dock-tool]')
          : null;
      if (target) point(event.clientX, target);
    };
    element.addEventListener('pointermove', hover);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', leave);
    element.addEventListener('pointerdown', press);
    element.addEventListener('pointerup', leave);
    element.addEventListener('pointercancel', reset);
    window.addEventListener('blur', reset);
    return () => {
      element.removeEventListener('pointermove', hover);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('focusin', focus);
      element.removeEventListener('focusout', leave);
      element.removeEventListener('pointerdown', press);
      element.removeEventListener('pointerup', leave);
      element.removeEventListener('pointercancel', reset);
      window.removeEventListener('blur', reset);
      nodes.forEach(({ spring }) => {
        spring.jump(0);
        spring.dispose();
      });
    };
  }, [root, compact, identity, reduced]);
}
