import { useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { useKinetic } from '../motion/useKinetic';

/** Native checkbox semantics with a small, independently sized SVG surface. */
export function CheckControl({
  checked,
  label,
  className = '',
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children' | 'size' | 'defaultChecked'> & {
  checked: boolean;
  label: ReactNode;
}) {
  const fill = useRef<SVGRectElement>(null);
  const spring = useKinetic(
    Number(checked),
    (value) => {
      if (!fill.current) return;
      fill.current.style.opacity = `${Math.max(0, Math.min(1, value))}`;
      fill.current.style.transform = `scale(${0.8 + 0.2 * value})`;
    },
    { stiffness: 420, damping: 26, mass: 0.65 },
  );
  useLayoutEffect(() => {
    spring.setTarget(Number(checked));
  }, [checked, spring]);
  return (
    <label
      className={`check-control ${className}`}
      data-checked={checked}
      data-disabled={props.disabled || undefined}
    >
      <span className="check-control-target">
        <input {...props} type="checkbox" checked={checked} />
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
          <rect className="check-control-track" x="3" y="3" width="18" height="18" rx="5" />
          <rect
            ref={fill}
            className="check-control-fill"
            x="3"
            y="3"
            width="18"
            height="18"
            rx="5"
          />
          <path className="check-control-tick" pathLength="1" d="m7.5 12 3.1 3.1 6-6.2" />
        </svg>
      </span>
      <span className="check-control-label">{label}</span>
    </label>
  );
}
