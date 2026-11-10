import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowCounterClockwise, Check } from '@phosphor-icons/react';
import {
  RangeGesture,
  RANGE_KEYS,
  resolveRangeNumber,
  type RangeCompletion,
} from './range-gesture';

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
  const [numberError, setNumberError] = useState<string | null>(null);
  const gesture = useRef(new RangeGesture());
  const range = useRef<HTMLInputElement>(null);
  const ignoredPointer = useRef<number | null>(null);
  const numberEditing = useRef<{ initial: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step)) + (step < 1 ? 1 : 0)));
  const readable = Number(value.toFixed(decimals)).toLocaleString('zh-CN', {
    maximumFractionDigits: decimals,
  });
  useEffect(() => {
    if (editing) {
      input.current?.focus({ preventScroll: true });
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
    if (disabled) {
      cancelRef.current();
      numberEditing.current = null;
      setEditing(false);
      setNumberError(null);
    }
  }, [disabled]);
  function finishNumber() {
    if (!numberEditing.current) return;
    const result = resolveRangeNumber({
      draft,
      initial: numberEditing.current.initial,
      current: latest.current,
      min,
      max,
      integer,
      disabled,
    });
    if (result.status === 'disabled') {
      cancelNumber();
      return;
    }
    if (result.status === 'stale') {
      // Keep the current value; editing can resume after the user sees the update.
      setDraft(String(latest.current));
      numberEditing.current = { initial: latest.current };
      setNumberError('参数已更新，已保留最新值。请重新输入。');
      return;
    }
    if (result.status === 'invalid') {
      setNumberError(`请输入 ${min} 至 ${max} 的${integer ? '整数' : '数值'}。`);
      return;
    }
    const number = result.value;
    numberEditing.current = null;
    if (number !== latest.current) {
      latest.current = number;
      onChange(number);
      onCommit?.();
    }
    setNumberError(null);
    setEditing(false);
    return true;
  }
  function cancelNumber() {
    numberEditing.current = null;
    setEditing(false);
    setNumberError(null);
  }
  function resetControl() {
    if (disabled || !onReset) return;
    cancelNumber();
    cancelGesture();
    onReset();
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
  const percentage = (number: number) =>
    max > min ? Math.max(0, Math.min(100, ((number - min) / (max - min)) * 100)) : 0;
  const position = percentage(value);
  const neutralPosition = percentage(neutral);
  const describedBy =
    [description && `${id}-description`, numberError && `${id}-error`].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div
      className="precision-control"
      data-motion="slider-row"
      data-adjusted={Math.abs(value - neutral) > 1e-10 ? 'true' : undefined}
      data-disabled={disabled || max <= min ? 'true' : undefined}
      style={
        {
          '--control-index': Math.min(index, 7),
          '--range-position': `${position}%`,
          '--range-neutral': `${neutralPosition}%`,
          '--range-fill-start': `${Math.min(position, neutralPosition)}%`,
          '--range-fill-end': `${Math.max(position, neutralPosition)}%`,
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
                inputMode={min < 0 ? 'text' : integer ? 'numeric' : 'decimal'}
                aria-label={`${label}精确数值`}
                aria-invalid={!!numberError}
                aria-describedby={describedBy}
                min={min}
                max={max}
                step={step}
                value={draft}
                disabled={disabled}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setNumberError(null);
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (finishNumber()) range.current?.focus({ preventScroll: true });
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    cancelNumber();
                    range.current?.focus({ preventScroll: true });
                  }
                }}
                onBlur={finishNumber}
              />
              <button
                type="button"
                aria-label={`确认${label}数值`}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (finishNumber()) range.current?.focus({ preventScroll: true });
                }}
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
                if (gesture.current.active) return;
                numberEditing.current = { initial: latest.current };
                setDraft(String(latest.current));
                setNumberError(null);
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
              onPointerDown={(event) => event.preventDefault()}
              onClick={resetControl}
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
          aria-describedby={describedBy}
          title={onReset ? '拖动调整 · 双击重置 · Alt + 方向键精调' : '拖动调整 · Alt + 方向键精调'}
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
          onDoubleClick={resetControl}
        />
      </div>
      <div className="precision-scale" aria-hidden="true">
        <span>{min}</span>
        <span>{max}</span>
      </div>
      {description && (
        <span id={`${id}-description`} className="sr-only">
          {description}
        </span>
      )}
      {numberError && (
        <small id={`${id}-error`} role="alert" className="precision-error">
          {numberError}
        </small>
      )}
    </div>
  );
}
