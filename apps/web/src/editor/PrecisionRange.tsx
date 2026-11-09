import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowCounterClockwise, Check } from '@phosphor-icons/react';

/** A slider is the primary control. Numeric entry is an explicit precision affordance. */
export function PrecisionRange({
  label,
  value,
  min,
  max,
  step = 0.1,
  neutral = 0,
  unit = '',
  description,
  onChange,
  onCommit,
  onCancel,
  onReset,
  disabled = false,
  integer = false,
  gradient,
  index = 0,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  neutral?: number;
  unit?: string;
  description?: string;
  onChange: (value: number) => void;
  onCommit?: () => void;
  onCancel?: () => void;
  onReset?: () => void;
  disabled?: boolean;
  integer?: boolean;
  gradient?: string;
  index?: number;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const pointer = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step)) + (step < 1 ? 1 : 0)));
  const readable = Number(value.toFixed(decimals)).toLocaleString('zh-CN', {
    maximumFractionDigits: decimals,
  });
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  function finishNumber() {
    if (!editing) return;
    const number = draft.trim() === '' ? NaN : Number(draft);
    if (
      !Number.isFinite(number) ||
      number < min ||
      number > max ||
      (integer && !Number.isInteger(number))
    ) {
      setInvalid(true);
      return;
    }
    onChange(number);
    onCommit?.();
    setInvalid(false);
    setEditing(false);
  }
  function change(number: number) {
    if (!Number.isFinite(number)) return;
    onChange(
      Math.max(min, Math.min(max, integer ? Math.round(number) : Number(number.toFixed(10)))),
    );
  }
  const position = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div
      className="precision-control"
      data-motion="slider-row"
      style={
        {
          '--control-index': Math.min(index, 7),
          '--range-position': `${position}%`,
          '--range-neutral': `${max > min ? ((neutral - min) / (max - min)) * 100 : 0}%`,
          '--range-gradient': gradient,
        } as CSSProperties
      }
    >
      <div className="precision-heading">
        <label htmlFor={id} title={description}>
          {label}
        </label>
        <div className="precision-readout">
          {editing ? (
            <>
              <input
                ref={input}
                type="number"
                aria-label={`${label}精确数值`}
                aria-invalid={invalid}
                min={min}
                max={max}
                step={step}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setInvalid(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    finishNumber();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setEditing(false);
                    setInvalid(false);
                  }
                }}
                onBlur={finishNumber}
              />
              <button
                type="button"
                aria-label={`确认${label}数值`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={finishNumber}
              >
                <Check size={13} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="precision-value"
              aria-label={`${label}数值 ${readable}${unit}，点击精确输入`}
              disabled={disabled}
              onClick={() => {
                setDraft(String(value));
                setEditing(true);
              }}
            >
              {readable}
              <small>{unit}</small>
            </button>
          )}
          {onReset && (
            <button
              type="button"
              className="precision-reset"
              title={`重置${label}`}
              aria-label={`重置${label}`}
              disabled={disabled || Math.abs(value - neutral) < 1e-10}
              onClick={onReset}
            >
              <ArrowCounterClockwise size={13} />
            </button>
          )}
        </div>
      </div>
      <div className={`precision-track ${gradient ? 'with-gradient' : ''}`}>
        {neutral > min && neutral < max && <i className="precision-neutral" aria-hidden />}
        <input
          id={id}
          type="range"
          aria-label={label}
          aria-valuetext={`${readable}${unit}`}
          aria-describedby={invalid ? `${id}-error` : undefined}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled || max <= min}
          onChange={(event) => change(Number(event.target.value))}
          onPointerDown={() => {
            pointer.current = true;
          }}
          onPointerUp={() => {
            if (pointer.current) {
              pointer.current = false;
              onCommit?.();
            }
          }}
          onPointerCancel={() => {
            pointer.current = false;
            if (onCancel) onCancel();
            else onCommit?.();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel?.();
              return;
            }
            if (
              (event.altKey || event.shiftKey) &&
              ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(event.key)
            ) {
              event.preventDefault();
              const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
              change(latest.current + direction * step * (event.altKey ? (integer ? 1 : 0.1) : 10));
            }
          }}
          onKeyUp={(event) => {
            if (
              [
                'ArrowLeft',
                'ArrowDown',
                'ArrowRight',
                'ArrowUp',
                'Home',
                'End',
                'PageUp',
                'PageDown',
              ].includes(event.key)
            )
              onCommit?.();
          }}
          onBlur={() => {
            if (pointer.current) pointer.current = false;
            onCommit?.();
          }}
          onDoubleClick={onReset}
        />
      </div>
      {invalid && (
        <small id={`${id}-error`} role="alert" className="precision-error">
          请输入 {min} 至 {max} 的{integer ? '整数' : '数值'}。
        </small>
      )}
    </div>
  );
}
