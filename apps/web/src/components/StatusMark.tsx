import type { CSSProperties, ReactNode } from 'react';
import { useReducedMotion } from '../motion/usePresence';

export type StatusMarkState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'unknown';

/**
 * A real lifecycle value controls the drawing. There is no timer that advances
 * the state or invents progress. Callers own any live-region announcements.
 * Mechanism study: React Bits #119; see interaction-reference-notes.md.
 */
export function StatusMark({
  state,
  label,
  progress,
  size = 'normal',
  className = '',
}: {
  state: StatusMarkState;
  label?: ReactNode;
  /** A measured fraction from the operation, never an elapsed-time estimate. */
  progress?: number;
  size?: 'small' | 'normal';
  className?: string;
}) {
  const reduced = useReducedMotion();
  const measured =
    state === 'running' && typeof progress === 'number' && Number.isFinite(progress)
      ? Math.max(0, Math.min(1, progress))
      : undefined;
  return (
    <span
      className={`status-mark ${className}`}
      data-state={state}
      data-size={size}
      data-reduced={reduced || undefined}
      data-measured={measured !== undefined || undefined}
      style={
        measured === undefined ? undefined : ({ '--status-progress': measured } as CSSProperties)
      }
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <circle className="status-mark-track" cx="12" cy="12" r="8.25" />
        {(state === 'pending' || state === 'running') && (
          <g className="status-mark-orbit">
            <circle className="status-mark-progress" cx="12" cy="12" r="8.25" pathLength="1" />
          </g>
        )}
        {state === 'done' && (
          <path className="status-mark-stroke" pathLength="1" d="m7.7 12.2 2.8 2.9 5.9-6.2" />
        )}
        {state === 'failed' && (
          <g className="status-mark-stroke">
            <path pathLength="1" d="M12 7.9v5.3" />
            <path pathLength="1" d="M12 16.1h.01" />
          </g>
        )}
        {state === 'cancelled' && (
          <path className="status-mark-stroke" pathLength="1" d="m9 9 6 6m0-6-6 6" />
        )}
        {state === 'unknown' && (
          <g>
            <path d="M9.5 9.25a2.5 2.5 0 0 1 5 .25c0 1.5-2.5 1.8-2.5 3.35" />
            <path d="M12 16.2h.01" />
          </g>
        )}
      </svg>
      {label !== undefined && label !== null && <span className="status-mark-label">{label}</span>}
    </span>
  );
}
