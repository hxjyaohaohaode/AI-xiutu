import { useLayoutEffect, useRef, useState } from 'react';
import { PrecisionRange } from './PrecisionRange';

/** Reveal only the active control inside its existing scroll surface, never the page. */
export function parameterControlScrollTop({
  scrollTop,
  viewportTop,
  viewportHeight,
  controlTop,
  controlHeight,
}: {
  scrollTop: number;
  viewportTop: number;
  viewportHeight: number;
  controlTop: number;
  controlHeight: number;
}): number {
  const margin = 6;
  if (controlTop < viewportTop + margin || controlHeight > viewportHeight - margin * 2)
    return Math.max(0, scrollTop + controlTop - viewportTop - margin);
  const overflow = controlTop + controlHeight - (viewportTop + viewportHeight - margin);
  return overflow > 0 ? scrollTop + overflow : scrollTop;
}

export type ShelfControl = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  neutral?: number;
  unit?: string;
  description?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onReset?: () => void;
  integer?: boolean;
};
/** One precise active control; adjacent tools stay discoverable without a wall of sliders. */
export function ParameterShelf({
  controls,
  label,
  onCommit,
  onCancel,
}: {
  controls: ShelfControl[];
  label: string;
  onCommit?: (label: string) => void;
  onCancel?: () => void;
}) {
  const [selectedId, setSelectedId] = useState(controls[0]?.id ?? '');
  const shelf = useRef<HTMLElement>(null);
  const current = useRef<HTMLDivElement>(null);
  const revealRequested = useRef(false);
  const active = controls.find((control) => control.id === selectedId) ?? controls[0];
  function revealCurrent() {
    revealRequested.current = false;
    const element = shelf.current;
    if (
      !element ||
      getComputedStyle(element).getPropertyValue('--parameter-shelf-compact').trim() !== '1'
    )
      return;
    const scroller = element.closest<HTMLElement>('.inspector-scroll');
    const control = current.current?.querySelector<HTMLElement>('.precision-control');
    if (!scroller || !control || scroller.clientHeight === 0) return;
    const viewport = scroller.getBoundingClientRect();
    const target = control.getBoundingClientRect();
    scroller.scrollTop = parameterControlScrollTop({
      scrollTop: scroller.scrollTop,
      viewportTop: viewport.top + scroller.clientTop,
      viewportHeight: scroller.clientHeight,
      controlTop: target.top,
      controlHeight: target.height,
    });
  }
  useLayoutEffect(() => {
    if (revealRequested.current) revealCurrent();
  }, [active?.id]);
  if (!active) return <p className="control-note">当前范围没有可调整的参数。</p>;
  return (
    <section ref={shelf} className="parameter-shelf" aria-label={label}>
      <div
        className="parameter-shelf-options"
        role="group"
        aria-label={label + '参数'}
        data-motion="parameter-options"
      >
        {controls.map((control) => (
          <button
            type="button"
            key={control.id}
            aria-pressed={active.id === control.id}
            disabled={control.disabled}
            title={control.description}
            onClick={() => {
              if (active.id !== control.id) onCommit?.(active.label);
              revealRequested.current = true;
              setSelectedId(control.id);
              if (active.id === control.id) revealCurrent();
            }}
          >
            <span>{control.label}</span>
            <small>
              {Number(control.value.toFixed(4))}
              {control.unit === 'ratio' ? '' : control.unit}
            </small>
            {Math.abs(control.value - (control.neutral ?? 0)) > 1e-8 && <i aria-label="已调整" />}
          </button>
        ))}
      </div>
      <div
        ref={current}
        className="parameter-shelf-current"
        key={active.id}
        data-motion="parameter-current"
      >
        <PrecisionRange
          label={active.label}
          value={active.value}
          min={active.min}
          max={active.max}
          step={active.step}
          neutral={active.neutral}
          unit={active.unit === 'ratio' ? '' : active.unit}
          disabled={active.disabled}
          integer={active.integer}
          description={active.description}
          onChange={active.onChange}
          onCommit={() => onCommit?.(active.label)}
          onCancel={onCancel}
          onReset={active.onReset}
        />
        {active.description && <p className="control-note">{active.description}</p>}
      </div>
    </section>
  );
}
