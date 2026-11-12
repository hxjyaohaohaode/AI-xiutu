import { useLayoutEffect, type RefObject } from 'react';
import { KineticValue } from '../motion/kinetic';
import { useReducedMotion } from '../motion/usePresence';

/** React Bits Dock: cosine-squared magnification over the resting button centers. */
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
          const lift = compact ? 0 : 7.5;
          const scale = compact ? 0 : 0.58;
          const proximity = Math.max(0, value);
          icon.style.setProperty('--dock-lift', `${-proximity * lift}px`);
          icon.style.setProperty('--dock-zoom', String(1 + proximity * scale));
          icon.style.setProperty('--dock-warmth', String(proximity));
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
    let moveFrame = 0;
    let lastX = 0;
    const cancelMove = () => { cancelAnimationFrame(moveFrame); moveFrame = 0; };
    const hover = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || compact || reduced) return;
      lastX = event.clientX;
      if (moveFrame) return;
      moveFrame = requestAnimationFrame(() => { moveFrame = 0; point(lastX); });
    };
    const launch = (event: MouseEvent) => {
      if (compact || reduced) return;
      const icon = event.target instanceof Element
        ? event.target.closest('[data-dock-tool]')?.querySelector('.dock-icon > svg')
        : null;
      // The source dock hops and rebounds; translate the face rather than the button.
      icon?.getAnimations().forEach((motion) => {
        if (motion.id === 'dock-hop') motion.cancel();
      });
      if (icon) {
        const hop = icon.animate([
          { translate: '0 0', offset: 0 },
          { translate: '0 -7px', offset: 0.33 },
          { translate: '0 0', offset: 0.66 },
          { translate: '0 -2px', offset: 0.82 },
          { translate: '0 0', offset: 1 },
        ], { duration: 390, easing: 'ease-out' });
        hop.id = 'dock-hop';
      }
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
      cancelMove();
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
    element.addEventListener('click', launch);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', leave);
    element.addEventListener('pointerdown', press);
    element.addEventListener('pointerup', leave);
    element.addEventListener('pointercancel', reset);
    window.addEventListener('blur', reset);
    return () => {
      cancelMove();
      element.removeEventListener('pointermove', hover);
      element.removeEventListener('click', launch);
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
