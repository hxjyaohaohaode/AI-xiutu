import { useLayoutEffect, useRef } from 'react';
import { useKinetic } from '../motion/useKinetic';
import { useReducedMotion } from '../motion/usePresence';

/** A project task has three states; it is deliberately not exposed as a checkbox. */
export function TaskStateMark({
  state,
  pending = false,
}: {
  state: 'todo' | 'doing' | 'done';
  pending?: boolean;
}) {
  const surface = useRef<SVGCircleElement>(null);
  const reduced = useReducedMotion();
  const fill = useKinetic(
    Number(state === 'done'),
    (value) => {
      if (!surface.current) return;
      surface.current.style.opacity = `${Math.max(0, Math.min(1, value))}`;
      surface.current.style.transform = `scale(${0.8 + 0.2 * value})`;
    },
    { stiffness: 420, damping: 26, mass: 0.65 },
  );
  useLayoutEffect(() => {
    fill.setTarget(Number(state === 'done'));
  }, [state, fill]);
  return (
    <svg
      className="task-state-mark"
      data-state={state}
      data-pending={pending || undefined}
      data-reduced={reduced || undefined}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="task-state-outline" cx="12" cy="12" r="8.25" />
      <circle ref={surface} className="task-state-fill" cx="12" cy="12" r="8.25" />
      <path className="task-state-clock" d="M12 7.6V12l3.1 1.7" />
      <path className="task-state-tick" pathLength="1" d="m7.8 12 2.8 2.9 5.8-6" />
      {pending && <circle className="task-state-pending" cx="12" cy="12" r="10.8" pathLength="1" />}
    </svg>
  );
}
