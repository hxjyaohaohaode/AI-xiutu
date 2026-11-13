import { useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';

type Gesture = { pointer: number; origin: number; scroll: number; moved: boolean };

export function useSketchRail() {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  function start(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    const rail = event.currentTarget;
    if (rail.scrollWidth <= rail.clientWidth) return;
    gesture.current = { pointer: event.pointerId, origin: event.clientX, scroll: rail.scrollLeft, moved: false };
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId || !event.buttons) return;
    const rail = event.currentTarget;
    const distance = event.clientX - current.origin;
    if (!current.moved) {
      if (Math.abs(distance) < 6) return;
      current.moved = true;
      suppressClick.current = true;
      rail.setPointerCapture(event.pointerId);
      rail.setAttribute('data-sketch-dragging', '');
    }
    rail.scrollLeft = current.scroll - distance;
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointer !== event.pointerId) return;
    gesture.current = null;
    event.currentTarget.removeAttribute('data-sketch-dragging');
  }

  function click(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current || event.detail === 0) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.currentTarget !== event.target || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const rail = event.currentTarget;
    if (event.key === 'Home' || event.key === 'End')
      rail.scrollLeft = event.key === 'Home' ? 0 : rail.scrollWidth;
    else rail.scrollLeft += event.key === 'ArrowLeft' ? -120 : 120;
  }

  return {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onPointerLeave: (event: PointerEvent<HTMLDivElement>) => {
      if (!gesture.current?.moved) end(event);
    },
    onLostPointerCapture: end,
    onClickCapture: click,
    onKeyDown: keys,
  };
}
