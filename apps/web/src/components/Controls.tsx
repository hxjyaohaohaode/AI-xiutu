import { t } from '../i18n';
import { useId, useState, type ReactNode } from 'react';
import { CaretDown, SlidersHorizontal } from './ControlGlyph';
import { usePresence } from '../motion/usePresence';
import type { MotionRole } from '../motion/registry';

export function Disclosure({
  title,
  summary,
  children,
  defaultOpen = false,
  role = 'popover',
  className = '',
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  role?: MotionRole;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const presence = usePresence(open, role);
  const id = useId();
  return (
    <section className={`progressive-section ${className}`} data-open={open}>
      <button
        className="progressive-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span>{title}</span>
        <span className="progressive-summary">{summary}</span>
        <CaretDown size={16} />
      </button>
      {presence.present && (
        <div
          id={id}
          className="progressive-content"
          data-motion={role}
          data-motion-state={presence.phase}
          inert={!open}
          aria-hidden={!open}
        >
          {children}
        </div>
      )}
    </section>
  );
}

export function OptionChips<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; reason?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="option-chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled || option.disabled}
          title={option.reason}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ValueSlider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [precise, setPrecise] = useState(false);
  const id = useId();
  const normalize = (next: number) => Math.max(min, Math.min(max, next));
  return (
    <div className="value-slider" data-motion="slider-row">
      <div className="value-slider-heading">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className="precise-value"
          aria-label={t('精确设置{v0}', { v0: label })}
          aria-expanded={precise}
          onClick={() => setPrecise(!precise)}
          disabled={disabled}
        >
          {value}
          {unit}
          <SlidersHorizontal size={12} />
        </button>
      </div>
      <input
        id={id}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled || min >= max}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {precise && (
        <label className="precise-field">
          {t('精确值')}
          <input
            type="number"
            aria-label={t('{v0}精确值', { v0: label })}
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onChange(normalize(next));
            }}
          />
          <span>{unit}</span>
          <button type="button" onClick={() => setPrecise(false)}>
            {t('完成')}
          </button>
        </label>
      )}
    </div>
  );
}
