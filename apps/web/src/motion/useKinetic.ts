import { useLayoutEffect, useRef } from 'react';
import { KineticValue, type SpringOptions } from './kinetic';
import { useReducedMotion } from './usePresence';

/** Paint DOM presentation without scheduling a React render for every animation frame. */
export function useKinetic(
  initial: number,
  paint: (value: number, velocity: number) => void,
  options: SpringOptions = {},
) {
  const callback = useRef(paint);
  callback.current = paint;
  const node = useRef<KineticValue | null>(null);
  if (!node.current) node.current = new KineticValue(initial, options);
  const spring = node.current;
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    spring.setReduced(reduced);
    const unsubscribe = spring.subscribe((value, velocity) => callback.current(value, velocity));
    return () => {
      unsubscribe();
      spring.stop();
    };
  }, [spring, reduced]);
  return spring;
}
