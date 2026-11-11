import { t } from '../i18n';
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
import {
  advanceChoiceSearch,
  choiceCursor,
  choicePlacement,
  choicePointerMoved,
  choiceScrollTarget,
  choiceSearchActive,
  moveChoice,
  type ChoiceOption,
} from './choice-model';

export type { ChoiceOption } from './choice-model';

type ChoiceHighlight = {
  value: string;
  left: number;
  top: number;
  width: number;
  height: number;
  animate: boolean;
};

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
  placeholder = t('请选择'),
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
  const track = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cursorValue, setCursorValue] = useState<T | null>(null);
  const [inputMode, setInputMode] = useState<'pointer' | 'keyboard'>('pointer');
  const [highlight, setHighlight] = useState<ChoiceHighlight | null>(null);
  const [placement, setPlacement] = useState<CSSProperties>({ visibility: 'hidden' });
  const [upward, setUpward] = useState(false);
  const search = useRef({ text: '', time: 0 });
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const revealOnOpen = useRef(false);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const active = choiceCursor(options, cursorValue, value);
  const presence = usePresence(open && !disabled, 'popover');
  const hasChoices = options.some((option) => !option.disabled);
  const preferredHeight = Math.min(
    320,
    10 + options.reduce((height, option) => height + (option.description ? 64 : 44), 0),
  );

  function setCursor(index: number) {
    setCursorValue(options[index]?.value ?? null);
  }

  function show(edge?: 'first' | 'last', input: 'pointer' | 'keyboard' = 'pointer') {
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
    pointer.current = null;
    revealOnOpen.current = true;
    setInputMode(input);
    setHighlight(null);
    setPlacement({ visibility: 'hidden' });
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
      setInputMode('keyboard');
      search.current = { text: '', time: 0 };
      if (!open)
        show(
          key === 'Home'
            ? 'first'
            : key === 'End' || (key === 'ArrowUp' && (selectedIndex < 0 || selected?.disabled))
              ? 'last'
              : undefined,
          'keyboard',
        );
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
    if (key === 'Enter' || (key === ' ' && !choiceSearchActive(search.current, Date.now()))) {
      event.preventDefault();
      event.stopPropagation();
      if (open) choose(active);
      else show(undefined, 'keyboard');
      return;
    }
    if ([...key].length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      setInputMode('keyboard');
      const next = advanceChoiceSearch(
        options,
        search.current,
        key,
        Date.now(),
        open ? active : selectedIndex,
      );
      search.current = next.search;
      const index = next.index;
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
    return () => {
      if (typeof element.hidePopover === 'function' && element.matches(':popover-open'))
        element.hidePopover();
    };
  }, [presence.present]);

  useLayoutEffect(() => {
    if (!open || disabled || !presence.present) return;
    const element = popup.current;
    if (!element) return;
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
        // Wrapped descriptions and font changes are measured from the actual menu.
        Math.min(320, element.scrollHeight + element.offsetHeight - element.clientHeight),
      );
      // bottom is expressed against the layout viewport for position:fixed.
      const bottom =
        next.bottom === undefined
          ? undefined
          : window.innerHeight -
            (view?.offsetTop ?? 0) -
            (view?.height ?? window.innerHeight) +
            next.bottom;
      const nextPlacement: CSSProperties = {
        left: next.left,
        top: next.top ?? 'auto',
        bottom: bottom ?? 'auto',
        width: next.width,
        maxHeight: next.maxHeight,
        visibility: 'visible',
      };
      setPlacement((current) =>
        Object.keys(nextPlacement).every(
          (key) =>
            current[key as keyof CSSProperties] === nextPlacement[key as keyof CSSProperties],
        )
          ? current
          : nextPlacement,
      );
      setUpward(next.upward);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    if (trigger.current) observer.observe(trigger.current);
    if (track.current) observer.observe(track.current);
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
    };
  }, [open, disabled, presence.present, preferredHeight]);

  useEffect(() => {
    if (!open) return;
    // Retained panel pages can close without unmounting. Observe every ancestor
    // so a native top-layer popover cannot outlive a hidden/inert workspace owner.
    const owners: HTMLElement[] = [];
    let ancestor = trigger.current?.parentElement;
    while (ancestor && ancestor !== document.body) {
      owners.push(ancestor);
      ancestor = ancestor.parentElement;
    }
    const closeWithOwner = () => {
      if (
        !owners.some((owner) => owner.hidden || owner.inert || owner.matches('dialog:not([open])'))
      )
        return;
      setOpen(false);
      const element = popup.current;
      if (element && typeof element.hidePopover === 'function' && element.matches(':popover-open'))
        element.hidePopover();
    };
    const ownerObserver = new MutationObserver(closeWithOwner);
    for (const owner of owners) {
      ownerObserver.observe(owner, {
        attributes: true,
        attributeFilter: ['open', 'hidden', 'inert'],
      });
      owner.addEventListener('close', closeWithOwner);
    }
    closeWithOwner();
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
      ownerObserver.disconnect();
      for (const owner of owners) owner.removeEventListener('close', closeWithOwner);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || disabled || active < 0 || placement.visibility !== 'visible') return;
    const list = popup.current;
    const content = track.current;
    const option = list?.querySelector<HTMLElement>(`[data-choice-index="${active}"]`);
    if (!list || !content || !option) return;
    if (!revealOnOpen.current && inputMode !== 'keyboard') return;
    const inset = parseFloat(getComputedStyle(list).paddingTop) || 0;
    list.scrollTop = choiceScrollTarget(
      {
        scrollTop: list.scrollTop,
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
        inset,
      },
      { top: content.offsetTop + option.offsetTop, height: option.offsetHeight },
    );
    revealOnOpen.current = false;
  }, [
    open,
    disabled,
    active,
    inputMode,
    presence.present,
    placement.maxHeight,
    placement.visibility,
  ]);

  useLayoutEffect(() => {
    if (!open || disabled || active < 0 || !presence.present) return;
    const content = track.current;
    const option = content?.querySelector<HTMLElement>(`[data-choice-index="${active}"]`);
    const activeValue = options[active]?.value;
    if (!content || !option || activeValue === undefined) return;
    let frame = 0;
    const measure = () => {
      // Layout coordinates remain accurate while the enclosing popover is animating.
      const next = {
        value: activeValue,
        left: option.offsetLeft,
        top: option.offsetTop,
        width: option.offsetWidth,
        height: option.offsetHeight,
      };
      setHighlight((current) =>
        current &&
        current.value === next.value &&
        current.left === next.left &&
        current.top === next.top &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : { ...next, animate: current !== null && current.value !== next.value },
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(content);
    observer.observe(option);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, disabled, active, options, presence.present, placement.width]);

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
        <StudioGlyph name="chevron" size={18} />
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
          data-input-mode={inputMode}
          data-cursor-ready={highlight !== null}
          style={placement}
          inert={!open || disabled}
          aria-hidden={!open || disabled}
        >
          <div className="choice-options" ref={track}>
            {highlight && (
              <span
                className="choice-highlight"
                aria-hidden="true"
                data-animate={highlight.animate}
                data-selected={options[active]?.value === value}
                style={{
                  width: highlight.width,
                  height: highlight.height,
                  transform: `translate(${highlight.left}px, ${highlight.top}px)`,
                }}
              />
            )}
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
                  if (event.pointerType === 'touch') return;
                  const next = { x: event.clientX, y: event.clientY };
                  const moved = choicePointerMoved(pointer.current, next);
                  pointer.current = next;
                  if (option.disabled || (!moved && inputMode === 'keyboard')) return;
                  setInputMode('pointer');
                  setCursor(index);
                }}
                onPointerDown={(event) => {
                  // Mouse presses keep focus in the combobox; touch keeps its native scroll gesture.
                  if (event.pointerType !== 'touch') event.preventDefault();
                }}
                onClick={() => choose(index)}
              >
                <span>
                  <span className="choice-option-label">{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </span>
                <span className="choice-option-mark" aria-hidden="true">
                  {value === option.value && <StudioGlyph name="check" size={18} />}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
