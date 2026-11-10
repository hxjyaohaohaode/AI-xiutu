import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { usePresence } from '../motion/usePresence';
import { StudioGlyph } from './StudioGlyph';
import { choicePlacement, findChoice, moveChoice, type ChoiceOption } from './choice-model';

export type { ChoiceOption } from './choice-model';

/** A select-only combobox. The popover stays inside its owning dialog's DOM. */
export function ChoiceSelect<T extends string>({
  value,
  onValueChange,
  options,
  label,
  ariaLabel,
  ariaDescribedBy,
  id,
  name,
  disabled = false,
  placeholder = '请选择',
  className = '',
  size = 'regular',
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly ChoiceOption<T>[];
  label?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  size?: 'compact' | 'regular';
}) {
  const generatedId = useId();
  const controlId = id ?? `choice-${generatedId}`;
  const listId = `${controlId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [placement, setPlacement] = useState<CSSProperties>({ visibility: 'hidden' });
  const [upward, setUpward] = useState(false);
  const search = useRef({ text: '', time: 0 });
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const active = cursor >= 0 && options[cursor] && !options[cursor].disabled ? cursor : -1;
  const presence = usePresence(open && !disabled, 'popover');
  const hasChoices = options.some((option) => !option.disabled);
  const preferredHeight = Math.min(
    320,
    10 + options.reduce((height, option) => height + (option.description ? 64 : 44), 0),
  );

  function show(edge?: 'first' | 'last') {
    if (disabled || !hasChoices) return;
    setCursor(
      edge === 'first'
        ? moveChoice(options, -1, 1)
        : edge === 'last'
          ? moveChoice(options, 0, -1)
          : selectedIndex >= 0 && !selected?.disabled
            ? selectedIndex
            : moveChoice(options, -1, 1),
    );
    search.current = { text: '', time: 0 };
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled || disabled) return;
    setOpen(false);
    if (option.value !== value) onValueChange(option.value);
    trigger.current?.focus({ preventScroll: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || disabled) return;
    const key = event.key;
    if (key === 'Tab') {
      setOpen(false);
      return;
    }
    if (key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      if (!open) show(key === 'Home' ? 'first' : key === 'End' ? 'last' : undefined);
      else
        setCursor(
          key === 'Home'
            ? moveChoice(options, -1, 1)
            : key === 'End'
              ? moveChoice(options, 0, -1)
              : moveChoice(options, active, key === 'ArrowDown' ? 1 : -1),
        );
      return;
    }
    if (
      key === 'Enter' ||
      (key === ' ' && !(search.current.text && Date.now() - search.current.time < 700))
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (open) choose(active);
      else show();
      return;
    }
    if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      const previous = now - search.current.time < 700 ? search.current.text : '';
      const repeated = previous && [...previous].every((letter) => letter === key);
      const query = repeated ? key : previous + key;
      search.current = { text: query, time: now };
      const index = findChoice(
        options,
        query,
        query.length === 1 ? (open ? active : selectedIndex) : -1,
      );
      if (index >= 0) {
        setCursor(index);
        if (!open && options[index]!.value !== value) onValueChange(options[index]!.value);
      }
    }
  }

  useEffect(() => {
    if (disabled || !hasChoices) setOpen(false);
  }, [disabled, hasChoices]);

  useLayoutEffect(() => {
    if (!presence.present) return;
    const element = popup.current;
    if (!element) return;
    // Native popovers escape clipping while remaining in the modal's focus scope.
    if (typeof element.showPopover === 'function' && !element.matches(':popover-open')) {
      element.showPopover();
    }
    let frame = 0;
    const measure = () => {
      const button = trigger.current;
      if (!button) return;
      const view = window.visualViewport;
      const next = choicePlacement(
        button.getBoundingClientRect(),
        {
          left: view?.offsetLeft ?? 0,
          top: view?.offsetTop ?? 0,
          width: view?.width ?? window.innerWidth,
          height: view?.height ?? window.innerHeight,
        },
        preferredHeight,
      );
      // bottom is expressed against the layout viewport for position:fixed.
      const bottom =
        next.bottom === undefined
          ? undefined
          : window.innerHeight -
            (view?.offsetTop ?? 0) -
            (view?.height ?? window.innerHeight) +
            next.bottom;
      setPlacement({
        left: next.left,
        top: next.top ?? 'auto',
        bottom: bottom ?? 'auto',
        width: next.width,
        maxHeight: next.maxHeight,
        visibility: 'visible',
      });
      setUpward(next.upward);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      if (typeof element.hidePopover === 'function' && element.matches(':popover-open'))
        element.hidePopover();
    };
  }, [presence.present, preferredHeight]);

  useEffect(() => {
    if (!open) return;
    const owner = trigger.current?.closest('dialog');
    const closeWithOwner = () => {
      if (owner?.open && !owner.inert) return;
      setOpen(false);
      const element = popup.current;
      if (element && typeof element.hidePopover === 'function' && element.matches(':popover-open'))
        element.hidePopover();
    };
    const ownerObserver = owner ? new MutationObserver(closeWithOwner) : undefined;
    if (owner) {
      ownerObserver?.observe(owner, { attributes: true, attributeFilter: ['open', 'inert'] });
      owner.addEventListener('close', closeWithOwner);
    }
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !trigger.current?.contains(target) && !popup.current?.contains(target))
        setOpen(false);
    };
    const closeOnFocus = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (target && !trigger.current?.contains(target) && !popup.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', closeOnFocus);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', closeOnFocus);
      ownerObserver?.disconnect();
      owner?.removeEventListener('close', closeWithOwner);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || active < 0) return;
    const list = popup.current;
    const option = list?.querySelector<HTMLElement>(`[data-choice-index="${active}"]`);
    if (!list || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight)
      list.scrollTop = bottom - list.clientHeight;
  }, [open, active, presence.present]);

  return (
    <div className={`choice-select ${className}`} data-size={size}>
      {label && (
        <label className="choice-label" htmlFor={controlId}>
          {label}
        </label>
      )}
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <button
        ref={trigger}
        type="button"
        id={controlId}
        className="choice-trigger"
        role="combobox"
        aria-label={ariaLabel ?? label}
        aria-describedby={[`${controlId}-value`, ariaDescribedBy].filter(Boolean).join(' ')}
        aria-haspopup="listbox"
        aria-expanded={open && !disabled}
        aria-controls={presence.present ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        disabled={disabled || !hasChoices}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <span id={`${controlId}-value`} className="choice-value" data-placeholder={!selected}>
          {selected?.label ?? placeholder}
        </span>
        <StudioGlyph name="chevron" size={16} />
      </button>
      {presence.present && (
        <div
          ref={popup}
          id={listId}
          role="listbox"
          aria-label={ariaLabel ?? label ?? placeholder}
          className="choice-popover"
          popover="manual"
          data-motion="popover"
          data-motion-state={presence.phase}
          data-placement={upward ? 'above' : 'below'}
          style={placement}
          inert={!open || disabled}
          aria-hidden={!open || disabled}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${listId}-${index}`}
              className="choice-option"
              role="option"
              aria-selected={value === option.value}
              aria-disabled={option.disabled || undefined}
              data-choice-index={index}
              data-active={index === active}
              onPointerMove={(event) => {
                if (event.pointerType !== 'touch' && !option.disabled) setCursor(index);
              }}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>
                <span className="choice-option-label">{option.label}</span>
                {option.description && <small>{option.description}</small>}
              </span>
              {value === option.value && <StudioGlyph name="check" size={16} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
