import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useKinetic } from '../../motion/useKinetic';

export type SegmentOption<T extends string = string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
};

/** Measured leading/trailing springs from React Bits 131, with native keyboard activation. */
export function RubberSegment<T extends string>({
  value,
  onChange,
  options,
  label,
  className = '',
  disabled = false,
  motionId,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentOption<T>[];
  label: string;
  className?: string;
  disabled?: boolean;
  motionId?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const edges = useRef({ left: 0, right: 0 });
  const first = useRef(true);
  const paint = () => {
    if (!indicator.current) return;
    indicator.current.style.transform = `translate3d(${edges.current.left}px,0,0)`;
    indicator.current.style.width = `${Math.max(0, edges.current.right - edges.current.left)}px`;
  };
  const left = useKinetic(0, (position) => {
    edges.current.left = position;
    paint();
  });
  const right = useKinetic(0, (position) => {
    edges.current.right = position;
    paint();
  });
  const current = useRef(value);
  current.current = value;
  const drag = useRef<{
    id: number;
    start: number;
    previous: number;
    time: number;
    speed: number;
    moved: boolean;
    startValue: T;
  } | null>(null);
  const suppressClick = useRef(false);
  const optionsKey = options
    .map((option) => `${option.value}:${Number(option.disabled)}`)
    .join('|');
  const measure = (selected = current.current, immediate = false) => {
    const element = root.current?.querySelector<HTMLElement>(
      `[data-segment-value="${CSS.escape(selected)}"]`,
    );
    if (!element) return;
    const x = element.offsetLeft;
    const end = x + element.offsetWidth;
    const forwards = x > left.target;
    left.configure({ stiffness: forwards ? 245 : 440, damping: forwards ? 29 : 34 });
    right.configure({ stiffness: forwards ? 440 : 245, damping: forwards ? 34 : 29 });
    if (immediate || first.current) {
      left.jump(x);
      right.jump(end);
      first.current = false;
    } else {
      left.setTarget(x);
      right.setTarget(end);
    }
  };
  const cancel = () => {
    if (!drag.current) return;
    const id = drag.current.id;
    drag.current = null;
    suppressClick.current = true;
    if (root.current?.hasPointerCapture(id)) root.current.releasePointerCapture(id);
    measure();
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useLayoutEffect(() => {
    cancelRef.current();
    measure();
    const observer = new ResizeObserver(() => measure(current.current, true));
    if (root.current) {
      observer.observe(root.current);
      for (const child of root.current.querySelectorAll('button')) observer.observe(child);
    }
    return () => observer.disconnect();
  }, [value, optionsKey, disabled]);
  useLayoutEffect(() => {
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
  const optionAt = (clientX: number) => {
    const buttons = [
      ...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ];
    return buttons.reduce<HTMLButtonElement | undefined>((nearest, button) => {
      const rect = button.getBoundingClientRect();
      const previous = nearest?.getBoundingClientRect();
      return !previous ||
        Math.abs(clientX - rect.x - rect.width / 2) <
          Math.abs(clientX - previous.x - previous.width / 2)
        ? button
        : nearest;
    }, undefined);
  };
  return (
    <div
      ref={root}
      className={`rubber-segment ${className}`}
      data-motion={motionId}
      role="group"
      aria-label={label}
      onPointerDown={(event) => {
        if (
          disabled ||
          event.button !== 0 ||
          event.isPrimary === false ||
          drag.current ||
          (event.target instanceof Element && event.target.closest('button:disabled'))
        )
          return;
        suppressClick.current = false;
        drag.current = {
          id: event.pointerId,
          start: event.clientX,
          previous: event.clientX,
          time: event.timeStamp,
          speed: 0,
          moved: false,
          startValue: value,
        };
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.id !== event.pointerId) return;
        if (
          !active.moved &&
          Math.abs(event.clientX - active.start) < (event.pointerType === 'touch' ? 10 : 4)
        )
          return;
        active.moved = true;
        if (!event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.setPointerCapture(event.pointerId);
        const elapsed = event.timeStamp - active.time;
        if (elapsed > 0) active.speed = (event.clientX - active.previous) / elapsed;
        active.previous = event.clientX;
        active.time = event.timeStamp;
        const target = optionAt(event.clientX)?.dataset.segmentValue as T | undefined;
        if (target) measure(target);
      }}
      onPointerUp={(event) => {
        const active = drag.current;
        if (!active || active.id !== event.pointerId) return;
        drag.current = null;
        if (!active.moved) return;
        suppressClick.current = true;
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
        const speed = event.timeStamp - active.time > 100 ? 0 : active.speed;
        const target = optionAt(event.clientX + speed * 75);
        const next = target?.dataset.segmentValue as T | undefined;
        if (next && next !== current.current) onChange(next);
        measure();
        target?.focus({ preventScroll: true });
      }}
      onPointerCancel={(event) => {
        if (drag.current?.id === event.pointerId) cancel();
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.id === event.pointerId) cancel();
      }}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          cancel();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
          return;
        }
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
          return;
        const enabled = options.filter((option) => !disabled && !option.disabled);
        if (!enabled.length) return;
        const index = Math.max(
          0,
          enabled.findIndex((option) => option.value === value),
        );
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? enabled.length - 1
              : (index +
                  (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) +
                  enabled.length) %
                enabled.length;
        event.preventDefault();
        const choice = enabled[next]!;
        if (choice.value !== value) onChange(choice.value);
        root.current
          ?.querySelector<HTMLButtonElement>(`[data-segment-value="${CSS.escape(choice.value)}"]`)
          ?.focus({ preventScroll: true });
      }}
    >
      <span ref={indicator} className="rubber-segment-indicator" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-segment-value={option.value}
          aria-pressed={value === option.value}
          aria-label={option.ariaLabel}
          disabled={disabled || option.disabled}
          tabIndex={
            value === option.value ||
            (!options.some((item) => item.value === value && !item.disabled) &&
              options.find((item) => !item.disabled)?.value === option.value)
              ? 0
              : -1
          }
          onClick={(event) => {
            const ignore = suppressClick.current && event.detail > 0;
            suppressClick.current = false;
            if (!ignore && value !== option.value) onChange(option.value);
          }}
        >
          {option.icon}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
