import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowCounterClockwise, Check } from '@phosphor-icons/react';
import { RangeGesture, RANGE_KEYS, type RangeCompletion } from './range-gesture';

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
  const gesture = useRef(new RangeGesture());
  const range = useRef<HTMLInputElement>(null);
  const ignoredPointer = useRef<number | null>(null);
  const numberEditing = useRef(false);
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
  function complete(result: RangeCompletion | null) {
    if (!result?.changed) return;
    if (result.action === 'commit') onCommit?.();
    else {
      latest.current = result.initial;
      // Settings (brush radius, feather) and recipe previews can share a shelf.
      // Restore the controlled value as well as its enclosing recipe transaction.
      onChange(result.initial);
      onCancel?.();
    }
  }
  function cancelGesture() {
    const pointerId = gesture.current.pointerId;
    if (pointerId !== null) ignoredPointer.current = pointerId;
    complete(gesture.current.cancel());
    if (pointerId !== null && range.current?.hasPointerCapture(pointerId))
      range.current.releasePointerCapture(pointerId);
  }
  const cancelRef = useRef(cancelGesture);
  cancelRef.current = cancelGesture;
  useEffect(() => {
    const cancel = () => cancelRef.current();
    const visibility = () => {
      if (document.visibilityState !== 'visible') cancel();
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      // A new source/scope may already own the parent; never roll an old preview into it.
      gesture.current.discard();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (disabled) cancelRef.current();
  }, [disabled]);
  function finishNumber() {
    if (!numberEditing.current) return;
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
    numberEditing.current = false;
    if (number !== latest.current) {
      latest.current = number;
      onChange(number);
      onCommit?.();
    }
    setInvalid(false);
    setEditing(false);
  }
  function change(number: number) {
    if (!Number.isFinite(number)) return;
    const next = Math.max(
      min,
      Math.min(max, integer ? Math.round(number) : Number(number.toFixed(10))),
    );
    latest.current = next;
    gesture.current.change(next);
    onChange(next);
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
                disabled={disabled}
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
                    numberEditing.current = false;
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
                numberEditing.current = true;
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
          ref={range}
          type="range"
          aria-label={label}
          aria-valuetext={`${readable}${unit}`}
          aria-describedby={invalid ? `${id}-error` : undefined}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled || max <= min}
          onFocus={() => {
            if (!gesture.current.active) ignoredPointer.current = null;
          }}
          onChange={(event) => {
            if (ignoredPointer.current !== null) return;
            change(Number(event.target.value));
            if (!gesture.current.active) onCommit?.();
          }}
          onPointerDown={(event) => {
            if (!gesture.current.beginPointer(event.pointerId, latest.current, event.isPrimary)) {
              event.preventDefault();
              return;
            }
            ignoredPointer.current = null;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event) => {
            complete(gesture.current.endPointer(event.pointerId));
            if (ignoredPointer.current === event.pointerId) ignoredPointer.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            if (gesture.current.pointerId === event.pointerId) cancelGesture();
          }}
          onLostPointerCapture={(event) => {
            if (gesture.current.pointerId === event.pointerId) cancelGesture();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelGesture();
              return;
            }
            if (!RANGE_KEYS.has(event.key)) return;
            if (!gesture.current.beginKey(event.key, latest.current)) {
              event.preventDefault();
              return;
            }
            ignoredPointer.current = null;
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
            complete(gesture.current.endKey(event.key));
          }}
          onBlur={() => {
            if (gesture.current.pointerId !== null) cancelGesture();
            else complete(gesture.current.commit());
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
