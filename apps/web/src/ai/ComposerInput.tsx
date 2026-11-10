import { forwardRef, useEffect, useLayoutEffect, useRef } from 'react';

export function composerSubmitKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode?: number;
}): boolean {
  return (
    event.key === 'Enter' &&
    (event.ctrlKey || event.metaKey) &&
    !event.shiftKey &&
    !event.altKey &&
    !event.isComposing &&
    event.keyCode !== 229
  );
}

/** One growing input. Resizing never changes focus or scrolls its ancestors. */
export const ComposerInput = forwardRef<
  HTMLTextAreaElement,
  {
    value: string;
    onChange: (value: string) => void;
    label: string;
    placeholder: string;
    maxLength: number;
    canSubmit: boolean;
    disabled?: boolean;
    readOnly?: boolean;
  }
>(function ComposerInput(
  { value, onChange, label, placeholder, maxLength, canSubmit, disabled, readOnly },
  forwardedRef,
) {
  const input = useRef<HTMLTextAreaElement | null>(null);
  const composing = useRef(false);
  function fit() {
    const element = input.current;
    if (!element || element.clientWidth === 0) return;
    const style = getComputedStyle(element);
    const minimum = Number.parseFloat(style.minHeight) || 32;
    const maximum = Number.parseFloat(style.maxHeight) || 144;
    const scrollTop = element.scrollTop;
    element.style.height = '0px';
    element.style.height = `${Math.min(maximum, Math.max(minimum, element.scrollHeight))}px`;
    element.scrollTop = scrollTop;
  }
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fit();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <textarea
      ref={(element) => {
        input.current = element;
        if (typeof forwardedRef === 'function') forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }}
      className="ai-composer-input"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      rows={1}
      maxLength={maxLength}
      disabled={disabled}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(event) => {
        if (
          !canSubmit ||
          disabled ||
          readOnly ||
          !composerSubmitKey({
            key: event.key,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            isComposing: composing.current || event.nativeEvent.isComposing,
            keyCode: event.nativeEvent.keyCode,
          })
        )
          return;
        event.preventDefault();
        event.currentTarget.form?.requestSubmit();
      }}
    />
  );
});
