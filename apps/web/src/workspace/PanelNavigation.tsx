import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { interactionText } from './interaction-copy';

export type PanelSection = 'adjustments' | 'assistant' | 'collaboration' | 'history';
type Item = { id: PanelSection; label: string; icon: ReactNode; onSelect: () => void };

/** React Bits RubberSegment informed the separate leading/trailing-edge timing.
 * The selection commits immediately; only the background travels. Equal slots
 * keep targets stable and require no pointer sampling or animation dependency. */
export function PanelNavigation({
  selected,
  items,
  focusRequest,
}: {
  selected: PanelSection;
  items: Item[];
  focusRequest?: RefObject<PanelSection | null>;
}) {
  const navigation = useRef<HTMLElement>(null);
  const index = Math.max(
    0,
    items.findIndex((item) => item.id === selected),
  );
  const previous = useRef(index);
  const direction = useMemo(() => (index < previous.current ? 'left' : 'right'), [index]);
  useLayoutEffect(() => {
    previous.current = index;
  }, [index]);
  useEffect(() => {
    if (!focusRequest || focusRequest.current !== selected) return;
    // Each context retains its own navigation DOM. Transfer keyboard focus to
    // the visible owner after its presentation commits, never into an inert
    // outgoing panel, and never steal focus after a pointer selection.
    const frame = requestAnimationFrame(() => {
      const nav = navigation.current;
      if (
        focusRequest.current !== selected ||
        !nav ||
        nav.closest('[inert],[hidden]')
      )
        return;
      // The editing view omits this duplicate row on short surfaces. Returning
      // from AI or collaboration must still land on a visible keyboard target.
      const target = nav.getClientRects().length
        ? nav.querySelector<HTMLElement>('[aria-pressed="true"]')
        : nav.closest('.free-panel')?.querySelector<HTMLElement>(
            '.panel-back-action, .panel-title-drag',
          );
      if (!target?.getClientRects().length) return;
      target.focus({ preventScroll: true });
      focusRequest.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, items, focusRequest]);
  return (
    <nav
      ref={navigation}
      className="studio-context-tabs context-segment"
      aria-label={interactionText('panelSections')}
      style={{ '--context-index': index } as CSSProperties}
      data-direction={direction}
      onKeyDown={(event) => {
        const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const focused = buttons.indexOf(event.target as HTMLButtonElement);
        if (focused < 0) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : (focused + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
        buttons[next]?.focus();
        if (focusRequest && items[next]) focusRequest.current = items[next]!.id;
        items[next]?.onSelect();
      }}
    >
      <span className="context-segment-indicator" aria-hidden />
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          aria-pressed={item.id === selected}
          aria-label={item.label}
          onClick={(event) => {
            if (focusRequest && event.detail === 0) focusRequest.current = item.id;
            item.onSelect();
          }}
        >
          {item.icon}
          <span>
            {item.id === 'collaboration' ? interactionText('collaborationTabShort') : item.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
