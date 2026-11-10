import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from '../components/ChoiceSelect';
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
  const [selectedId, setSelectedId] = useState(
    controls.find((control) => !control.disabled)?.id ?? controls[0]?.id ?? '',
  );
  const shelf = useRef<HTMLElement>(null);
  const current = useRef<HTMLDivElement>(null);
  const revealRequested = useRef(false);
  const active =
    controls.find((control) => control.id === selectedId && !control.disabled) ??
    controls.find((control) => !control.disabled) ??
    controls[0];
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
  function selectControl(id: string) {
    if (active && active.id !== id) onCommit?.(active.label);
    revealRequested.current = true;
    setSelectedId(id);
    if (active?.id === id) revealCurrent();
  }
  return (
    <section ref={shelf} className="parameter-shelf" aria-label={label}>
      <div
        className="parameter-shelf-options"
        role="group"
        aria-label={label + '选项'}
        data-motion="parameter-options"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ];
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
          const target = buttons[next];
          if (!target) return;
          target.focus({ preventScroll: true });
          const rail = event.currentTarget;
          const viewport = rail.getBoundingClientRect();
          const item = target.getBoundingClientRect();
          const left = viewport.left + rail.clientLeft;
          const top = viewport.top + rail.clientTop;
          if (item.left < left) rail.scrollLeft += item.left - left;
          else if (item.right > left + rail.clientWidth)
            rail.scrollLeft += item.right - left - rail.clientWidth;
          if (item.top < top) rail.scrollTop += item.top - top;
          else if (item.bottom > top + rail.clientHeight)
            rail.scrollTop += item.bottom - top - rail.clientHeight;
        }}
      >
        {controls.map((control) => (
          <button
            type="button"
            key={control.id}
            aria-pressed={active.id === control.id}
            disabled={control.disabled}
            aria-label={`${control.label}，${Number(control.value.toFixed(4))}${control.unit === 'ratio' ? '' : (control.unit ?? '')}${Math.abs(control.value - (control.neutral ?? 0)) > 1e-8 ? '，已调整' : ''}`}
            data-adjusted={
              Math.abs(control.value - (control.neutral ?? 0)) > 1e-8 ? 'true' : undefined
            }
            title={control.disabled ? control.description : undefined}
            onClick={() => selectControl(control.id)}
          >
            <span>{control.label}</span>
            <small>
              {Number(control.value.toFixed(4))}
              {control.unit === 'ratio' ? '' : control.unit}
            </small>
            {Math.abs(control.value - (control.neutral ?? 0)) > 1e-8 && <i aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div ref={current} className="parameter-shelf-current" data-motion="parameter-current">
        <ChoiceSelect
          className="parameter-compact-picker"
          ariaLabel={'选择' + label}
          size="compact"
          value={active.id}
          onValueChange={selectControl}
          options={controls.map((control) => ({
            value: control.id,
            label: control.label,
            disabled: control.disabled,
          }))}
        />
        <PrecisionRange
          key={active.id}
          label={active.label}
          value={active.value}
          min={active.min}
          max={active.max}
          step={active.step}
          neutral={active.neutral}
          unit={active.unit === 'ratio' ? '' : active.unit}
          disabled={active.disabled}
          integer={active.integer}
          onChange={active.onChange}
          onCommit={() => onCommit?.(active.label)}
          onCancel={onCancel}
          onReset={active.onReset}
        />
      </div>
      {active.description && (
        <MotionDetails key={active.id + '-description'} className="parameter-description">
          <summary>{active.label}说明</summary>
          <p className="control-note">{active.description}</p>
        </MotionDetails>
      )}
    </section>
  );
}
