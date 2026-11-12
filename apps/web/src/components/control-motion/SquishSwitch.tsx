import { useEffect, useLayoutEffect, useRef } from 'react';
import { useKinetic } from '../../motion/useKinetic';

/** A controlled boolean. Dragging previews a choice; only release/click writes it. */
export function SquishSwitch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  id,
  className = '',
  showLabel = true,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  showLabel?: boolean;
}) {
  const track = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const position = useKinetic(
    Number(checked),
    (value, velocity) => {
      const travel = Math.max(
        0,
        (track.current?.clientWidth ?? 38) - (thumb.current?.offsetWidth ?? 16) - 4,
      );
      const squash = 1 + Math.min(0.24, Math.abs(velocity) * 0.024);
      if (thumb.current)
        thumb.current.style.transform = `translate3d(${Math.max(-0.08, Math.min(1.08, value)) * travel}px,0,0) scale(${squash},${1 / squash})`;
    },
    { stiffness: 170, damping: 21.5, mass: 0.9 },
  );
  const current = useRef(checked);
  current.current = checked;
  const gesture = useRef<{
    id: number;
    start: number;
    travel: number;
    initial: number;
    preview: number;
    moved: boolean;
  } | null>(null);
  const suppress = useRef(false);
  function cancel() {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    suppress.current = true;
    if (button.current?.hasPointerCapture(active.id))
      button.current.releasePointerCapture(active.id);
    position.setTarget(Number(current.current));
  }
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useLayoutEffect(() => {
    cancelRef.current();
    position.setTarget(Number(checked));
  }, [checked, disabled, position]);
  useEffect(() => {
    const cancelActive = () => cancelRef.current();
    const hidden = () => {
      if (document.visibilityState !== 'visible') cancelActive();
    };
    window.addEventListener('blur', cancelActive);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('blur', cancelActive);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  return (
    <button
      ref={button}
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`squish-switch ${className}`}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || event.isPrimary === false || gesture.current) return;
        suppress.current = false;
        const travel = Math.max(
          1,
          (track.current?.clientWidth ?? 38) - (thumb.current?.offsetWidth ?? 16) - 4,
        );
        gesture.current = {
          id: event.pointerId,
          start: event.clientX,
          travel,
          initial: Number(checked),
          preview: Number(checked),
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const active = gesture.current;
        if (!active || event.pointerId !== active.id) return;
        if (
          !active.moved &&
          Math.abs(event.clientX - active.start) < (event.pointerType === 'touch' ? 8 : 4)
        )
          return;
        active.moved = true;
        if (!event.currentTarget.hasPointerCapture(active.id))
          event.currentTarget.setPointerCapture(active.id);
        active.preview = Math.max(
          0,
          Math.min(1, active.initial + (event.clientX - active.start) / active.travel),
        );
        position.setTarget(active.preview);
      }}
      onPointerUp={(event) => {
        const active = gesture.current;
        if (!active || event.pointerId !== active.id) return;
        gesture.current = null;
        if (!active.moved) return;
        suppress.current = true;
        if (event.currentTarget.hasPointerCapture(active.id))
          event.currentTarget.releasePointerCapture(active.id);
        const next = active.preview >= 0.5;
        if (next !== current.current) onCheckedChange(next);
        position.setTarget(Number(current.current));
      }}
      onPointerCancel={(event) => {
        if (gesture.current?.id === event.pointerId) cancel();
      }}
      onLostPointerCapture={(event) => {
        if (gesture.current?.id === event.pointerId) cancel();
      }}
      onBlur={cancel}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && gesture.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
      onClick={(event) => {
        const ignore = suppress.current && event.detail > 0;
        suppress.current = false;
        if (!ignore) onCheckedChange(!checked);
      }}
    >
      <span ref={track} className="squish-switch-track" aria-hidden="true">
        <span ref={thumb} className="squish-switch-thumb" />
      </span>
      {showLabel && <span className="squish-switch-label">{label}</span>}
    </button>
  );
}
