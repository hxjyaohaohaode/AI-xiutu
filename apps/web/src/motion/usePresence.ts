import { useEffect, useState } from 'react';
import {
  motionEntryDuration,
  motionExitDuration,
  type MotionPhase,
  type MotionRole,
} from './registry';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined'
      ? true
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
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
    let timer: ReturnType<typeof setTimeout>;
    if (open) {
      setPresent(true);
      setPhase('enter');
      timer = setTimeout(() => setPhase('idle'), motionEntryDuration(role));
    } else {
      setPhase('exit');
      timer = setTimeout(() => {
        setPresent(false);
        setPhase('hidden');
      }, motionExitDuration(role));
    }
    return () => clearTimeout(timer);
  }, [open, role, reduced]);
  return { present, phase, reduced };
}
