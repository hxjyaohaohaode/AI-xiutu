import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  motionEntryDuration,
  motionExitDuration,
  type MotionPhase,
  type MotionRole,
} from './registry';

let motionQuery: MediaQueryList | undefined;
const motionSubscribers = new Set<() => void>();

function getMotionQuery() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  return (motionQuery ??= window.matchMedia('(prefers-reduced-motion: reduce)'));
}

/** Use the same preference for CSS transitions and imperative scroll/animation. */
export function prefersReducedMotion() {
  return getMotionQuery()?.matches ?? true;
}

function notifyMotionPreference() {
  for (const notify of motionSubscribers) notify();
}

function subscribeMotionPreference(notify: () => void) {
  const query = getMotionQuery();
  if (!motionSubscribers.size) query?.addEventListener('change', notifyMotionPreference);
  motionSubscribers.add(notify);
  return () => {
    motionSubscribers.delete(notify);
    if (!motionSubscribers.size) query?.removeEventListener('change', notifyMotionPreference);
  };
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotionPreference, prefersReducedMotion, () => true);
}

/** Retain an exiting surface briefly; callers make it inert as soon as open=false. */
export function usePresence(open: boolean, role: MotionRole) {
  const reduced = useReducedMotion();
  const [present, setPresent] = useState(open);
  const [phase, setPhase] = useState<MotionPhase>(open ? 'enter' : 'hidden');
  useEffect(() => {
    if (reduced) {
      setPresent(open);
      setPhase(open ? 'idle' : 'hidden');
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setPresent(true);
      setPhase('enter');
      timer = setTimeout(() => setPhase('idle'), motionEntryDuration(role));
    } else if (present) {
      setPhase('exit');
      timer = setTimeout(() => {
        setPresent(false);
        setPhase('hidden');
      }, motionExitDuration(role));
    } else setPhase('hidden');
    return () => clearTimeout(timer);
    // `present` is intentionally captured when visibility changes. Including it
    // would restart the entry timer as soon as an opening surface is mounted.
  }, [open, role, reduced]);
  return { present, phase, reduced };
}
