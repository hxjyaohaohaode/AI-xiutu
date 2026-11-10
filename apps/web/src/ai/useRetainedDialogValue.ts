import { useRef } from 'react';

/** Keep only the closing frame's data; Modal owns its exit, inertness and focus. */
export function useRetainedDialogValue<T>(value: T | null): T | null {
  const retained = useRef(value);
  if (value !== null) retained.current = value;
  return value ?? retained.current;
}
