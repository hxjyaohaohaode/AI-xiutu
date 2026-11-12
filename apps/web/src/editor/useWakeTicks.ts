import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useKinetic } from '../motion/useKinetic';

/** React Bits 124: a velocity-shaped, directional wake that returns to a flat track. */
export function useWakeTicks(
  element: RefObject<HTMLDivElement | null>,
  position: number,
  pointer: boolean,
) {
  const state = useRef({ head: position * 36, speed: 0 });
  const paint = () => {
    const bars = element.current?.children;
    if (!bars) return;
    const velocity = state.current.speed;
    const strength = Math.min(1, Math.abs(velocity) / 38);
    const amplitude = strength * strength * (3 - 2 * strength);
    const reach = 1.5 + 4.5 * amplitude;
    const direction = Math.sign(velocity);
    for (let index = 0; index < bars.length; index++) {
      const delta = index - state.current.head;
      const radius = reach * (delta * direction < 0 ? 1.6 : 0.7);
      const wave =
        Math.abs(delta) < radius ? Math.cos(((Math.abs(delta) / radius) * Math.PI) / 2) ** 2 : 0;
      const bar = bars[index] as HTMLElement;
      const base = index % 6 === 0 ? 8 : 4;
      bar.style.height = `${base + 21 * amplitude * wave}px`;
      bar.style.opacity = `${0.35 + 0.5 * amplitude * wave}`;
    }
  };
  const speed = useKinetic(
    0,
    (value) => {
      state.current.speed = value;
      paint();
    },
    { stiffness: 400, damping: 40, precision: 0.01 },
  );
  const head = useKinetic(
    position * 36,
    (value, velocity) => {
      state.current.head = value;
      speed.setTarget(velocity);
      paint();
    },
    { stiffness: 946, damping: 61.5, precision: 0.005 },
  );
  useLayoutEffect(() => {
    if (pointer) head.setTarget(position * 36);
    else {
      head.jump(position * 36);
      speed.jump(0);
    }
  }, [position, pointer, head, speed]);
}
