import { t } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PrecisionRange } from './PrecisionRange';
import { ParameterGlyph } from './ParameterGlyph';
import { useKinetic } from '../motion/useKinetic';
import { WarmTooltip } from '../components/control-motion';

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
  /** Optional semantic domain, e.g. portrait:eyeWidth. Never selected from translated text. */
  glyph?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  onReset?: () => void;
  integer?: boolean;
  gradient?: string;
};
export function shelfControlAdjusted(control: Pick<ShelfControl, 'value' | 'neutral'>): boolean {
  return control.neutral !== undefined && Math.abs(control.value - control.neutral) > 1e-8;
}
/** One precise active control; adjacent tools stay discoverable without a wall of sliders. */
export function ParameterShelf({
  controls,
  label,
  onCommit,
  onCancel,
  headingAccessory,
  target,
}: {
  controls: ShelfControl[];
  label: string;
  onCommit?: (label: string) => void;
  onCancel?: () => void;
  headingAccessory?: ReactNode;
  target?: string;
}) {
  const [selectedId, setSelectedId] = useState(
    controls.find((control) => !control.disabled)?.id ?? controls[0]?.id ?? '',
  );
  const shelf = useRef<HTMLElement>(null);
  const current = useRef<HTMLDivElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const selection = useRef<HTMLSpanElement>(null);
  const markerBox = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const markerReady = useRef(false);
  const paintMarker = () => {
    const marker = selection.current;
    if (!marker) return;
    const box = markerBox.current;
    marker.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;
    marker.style.width = `${box.width}px`;
    marker.style.height = `${box.height}px`;
  };
  const markerX = useKinetic(
    0,
    (value) => {
      markerBox.current.x = value;
      paintMarker();
    },
    { stiffness: 380, damping: 32 },
  );
  const markerY = useKinetic(
    0,
    (value) => {
      markerBox.current.y = value;
      paintMarker();
    },
    { stiffness: 380, damping: 32 },
  );
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
    const rail = choices.current;
    const selected = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !selected || rail.scrollWidth <= rail.clientWidth) return;
    const visible = rail.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    if (item.left < visible.left) rail.scrollLeft += item.left - visible.left - 4;
    else if (item.right > visible.right) rail.scrollLeft += item.right - visible.right + 4;
  }, [active?.id]);
  // Measured selection slots adapt React Bits RubberSegment. See REFERENCE-SOURCES.md.
  useLayoutEffect(() => {
    const rail = choices.current;
    const marker = selection.current;
    if (!rail || !marker) return;
    const measure = () => {
      const style = getComputedStyle(rail);
      if (style.display === 'grid') {
        // Fit complete rows, including translated two-line labels. A fixed
        // pixel cap used to cut the third portrait row halfway through its name.
        const rows = new Map<number, number>();
        for (const button of rail.querySelectorAll<HTMLButtonElement>('button')) {
          const top = button.offsetTop;
          if (!rows.has(top) && rows.size === 3) break;
          rows.set(top, Math.max(rows.get(top) ?? 0, top + button.offsetHeight));
        }
        const bottom = Math.max(0, ...rows.values()) + parseFloat(style.paddingBottom || '0');
        const height = `${bottom}px`;
        if (rail.style.getPropertyValue('--parameter-grid-height') !== height)
          rail.style.setProperty('--parameter-grid-height', height);
      } else if (rail.style.getPropertyValue('--parameter-grid-height')) {
        rail.style.removeProperty('--parameter-grid-height');
      }
      if (style.display === 'flex') {
        const gap = parseFloat(style.columnGap) || 0;
        const available =
          rail.clientWidth -
          (parseFloat(style.paddingLeft) || 0) -
          (parseFloat(style.paddingRight) || 0);
        const count = Math.max(
          1,
          Math.min(controls.length, Math.floor((available + gap) / (60 + gap))),
        );
        const width = `${Math.max(44, (available - gap * (count - 1)) / count)}px`;
        if (rail.style.getPropertyValue('--parameter-slot-width') !== width)
          rail.style.setProperty('--parameter-slot-width', width);
      }
      const disc = rail.querySelector<HTMLElement>('[aria-pressed="true"] .parameter-glyph-disc');
      if (!disc) return;
      const base = rail.getBoundingClientRect();
      const bounds = disc.getBoundingClientRect();
      markerBox.current.width = bounds.width;
      markerBox.current.height = bounds.height;
      const x = bounds.left - base.left + rail.scrollLeft;
      const y = bounds.top - base.top + rail.scrollTop;
      if (!markerReady.current) {
        markerX.jump(x);
        markerY.jump(y);
        markerReady.current = true;
      } else {
        markerX.setTarget(x);
        markerY.setTarget(y);
      }
      paintMarker();
      marker.dataset.ready = 'true';
    };
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(rail);
    for (const button of rail.querySelectorAll<HTMLButtonElement>('button'))
      observer.observe(button);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active?.id, controls.length]);
  useEffect(() => {
    if (target && controls.some(({ id, disabled }) => id === target && !disabled)) {
      revealRequested.current = true;
      setSelectedId(target);
    }
  }, [target, controls.some(({ id, disabled }) => id === target && !disabled)]);
  if (!active) return <p className="control-note">{t('当前范围没有可调整的参数。')}</p>;
  function selectControl(id: string) {
    if (active && active.id !== id) onCommit?.(active.label);
    revealRequested.current = true;
    setSelectedId(id);
    if (active?.id === id) revealCurrent();
  }
  return (
    <section ref={shelf} className="parameter-shelf" aria-label={t(label)}>
      <div ref={current} className="parameter-shelf-current" data-motion="parameter-current">
        <PrecisionRange
          key={active.id}
          label={t(active.label)}
          value={active.value}
          min={active.min}
          max={active.max}
          step={active.step}
          neutral={active.neutral}
          unit={active.unit === 'ratio' ? '' : t(active.unit ?? '')}
          disabled={active.disabled}
          integer={active.integer}
          description={active.description ? t(active.description) : undefined}
          glyph={<ParameterGlyph id={active.glyph ?? active.id} />}
          primary
          headingAccessory={headingAccessory}
          gradient={active.gradient}
          onChange={active.onChange}
          onCommit={() => onCommit?.(active.label)}
          onCancel={onCancel}
          onReset={active.onReset}
        />
      </div>
      {controls.length > 1 && (
        <div
          ref={choices}
          className="parameter-shelf-options"
          role="group"
          aria-label={t('{name}选项', { name: t(label) })}
          data-motion="parameter-options"
          onKeyDown={(event) => {
            if (
              !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(
                event.key,
              )
            )
              return;
            const buttons = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
            ];
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            if (index < 0) return;
            event.preventDefault();
            const columns =
              getComputedStyle(event.currentTarget).display === 'grid'
                ? Math.max(
                    1,
                    buttons.filter((button) => button.offsetTop === buttons[0]?.offsetTop).length,
                  )
                : 1;
            const delta =
              event.key === 'ArrowUp'
                ? -columns
                : event.key === 'ArrowDown'
                  ? columns
                  : event.key === 'ArrowLeft'
                    ? -1
                    : 1;
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? buttons.length - 1
                  : Math.max(0, Math.min(buttons.length - 1, index + delta));
            const target = buttons[next];
            if (!target) return;
            target.focus({ preventScroll: true });
            const id = target.dataset.controlId;
            if (id) selectControl(id);
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
          <span ref={selection} className="parameter-active-disc" aria-hidden="true" />
          {controls.map((control) => (
            <WarmTooltip key={control.id} content={t(control.label)}>
              <button
                type="button"
                key={control.id}
                data-control-id={control.id}
                aria-pressed={active.id === control.id}
                disabled={control.disabled}
                tabIndex={active.id === control.id ? 0 : -1}
                aria-label={t('{v0}，{v1}{v2}{v3}', {
                  v0: t(control.label),
                  v1: Number(control.value.toFixed(4)),
                  v2: control.unit === 'ratio' ? '' : t(control.unit ?? ''),
                  v3: shelfControlAdjusted(control) ? t('，已调整') : '',
                })}
                data-adjusted={shelfControlAdjusted(control) ? 'true' : undefined}
                title={control.disabled && control.description ? t(control.description) : undefined}
                onClick={() => selectControl(control.id)}
              >
                <span className="parameter-glyph-disc">
                  <ParameterGlyph id={control.glyph ?? control.id} />
                </span>
                <span className="parameter-short-label">{t(control.label)}</span>
                {shelfControlAdjusted(control) && <i aria-hidden="true" />}
              </button>
            </WarmTooltip>
          ))}
        </div>
      )}
    </section>
  );
}
