import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { useKinetic } from '../../motion/useKinetic';

type Placement = 'top' | 'bottom';
type Tip = { id: string; anchor: HTMLElement; content: ReactNode; placement: Placement };
type Snapshot = { leader: string | null; tip: Tip | null; revision: number };
const triggers = new Set<string>();
const subscribers = new Set<() => void>();
let snapshot: Snapshot = { leader: null, tip: null, revision: 0 };
let warmUntil = 0;
let openTimer: ReturnType<typeof setTimeout> | undefined;
let exitTimer: ReturnType<typeof setTimeout> | undefined;
let pending: string | null = null;
const suppressed = new Set<string>();
let lastPosition: { x: number; y: number } | null = null;
const now = () => (typeof performance === 'undefined' ? 0 : performance.now());
function notify(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next, revision: snapshot.revision + 1 };
  for (const subscriber of subscribers) subscriber();
}
function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}
function register(id: string) {
  triggers.add(id);
  if (!snapshot.leader) notify({ leader: id });
  return () => {
    triggers.delete(id);
    suppressed.delete(id);
    hide(id, true);
    if (snapshot.leader === id) notify({ leader: triggers.values().next().value ?? null });
  };
}
function hide(id: string, immediate = false) {
  if (pending === id) {
    clearTimeout(openTimer);
    pending = null;
  }
  if (snapshot.tip?.id !== id) return;
  clearTimeout(exitTimer);
  const close = () => {
    if (snapshot.tip?.id === id) {
      warmUntil = now() + 300;
      notify({ tip: null });
    }
  };
  if (immediate) close();
  else exitTimer = setTimeout(close, 80);
}
function show(tip: Tip, instant: boolean) {
  if (suppressed.has(tip.id)) return;
  clearTimeout(openTimer);
  clearTimeout(exitTimer);
  pending = tip.id;
  const open = () => {
    pending = null;
    if (tip.anchor.isConnected && !suppressed.has(tip.id)) notify({ tip });
  };
  if (instant || snapshot.tip !== null || now() < warmUntil) open();
  else openTimer = setTimeout(open, 400);
}

function TooltipLayer({ tip }: { tip: Tip | null }) {
  const bubble = useRef<HTMLDivElement>(null);
  // Keep modal help in the modal's DOM/focus scope. The native popover supplies
  // the top layer and viewport containing block even while that dialog transforms.
  const host =
    tip && typeof document !== 'undefined'
      ? (tip.anchor.closest<HTMLDialogElement>('dialog[open]') ?? document.body)
      : null;
  const xy = useRef(lastPosition ?? { x: 0, y: 0 });
  const paint = () => {
    if (bubble.current)
      bubble.current.style.transform = `translate3d(${xy.current.x}px,${xy.current.y}px,0)`;
  };
  const x = useKinetic(
    xy.current.x,
    (value) => {
      xy.current.x = value;
      paint();
    },
    { stiffness: 330, damping: 31 },
  );
  const y = useKinetic(
    xy.current.y,
    (value) => {
      xy.current.y = value;
      paint();
    },
    { stiffness: 330, damping: 31 },
  );
  const previousId = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!tip || !bubble.current || !host) {
      previousId.current = null;
      return;
    }
    const element = bubble.current;
    const owners: HTMLElement[] = [];
    let owner: HTMLElement | null = tip.anchor;
    while (owner && owner !== document.body) {
      owners.push(owner);
      owner = owner.parentElement;
    }
    const unavailable = () =>
      !tip.anchor.isConnected ||
      tip.anchor.matches(':disabled') ||
      owners.some(
        (node) =>
          node.hidden ||
          node.inert ||
          node.getAttribute('aria-hidden') === 'true' ||
          node.matches('dialog:not([open])'),
      );
    const closeWithOwner = () => {
      if (unavailable()) hide(tip.id, true);
    };
    if (unavailable() || typeof element.showPopover !== 'function') {
      hide(tip.id, true);
      return;
    }
    if (!element.matches(':popover-open')) element.showPopover();
    const position = (animate: boolean) => {
      const element = bubble.current;
      if (!element || unavailable() || !tip.anchor.getClientRects().length) {
        hide(tip.id, true);
        return;
      }
      const rect = tip.anchor.getBoundingClientRect();
      const view = window.visualViewport;
      const viewportLeft = view?.offsetLeft ?? 0,
        viewportTop = view?.offsetTop ?? 0;
      const viewportWidth = view?.width ?? window.innerWidth,
        viewportHeight = view?.height ?? window.innerHeight;
      const margin = 10;
      element.style.maxWidth = `${Math.max(1, Math.min(260, viewportWidth - margin * 2))}px`;
      const bounds = element.getBoundingClientRect();
      const left = Math.max(
        viewportLeft + margin,
        Math.min(
          viewportLeft + viewportWidth - bounds.width - margin,
          rect.left + rect.width / 2 - bounds.width / 2,
        ),
      );
      const above = rect.top - bounds.height - 8,
        below = rect.bottom + 8;
      const fitsAbove = above >= viewportTop + margin;
      const fitsBelow = below + bounds.height <= viewportTop + viewportHeight - margin;
      const preferred =
        tip.placement === 'top'
          ? fitsAbove || !fitsBelow
            ? above
            : below
          : fitsBelow || !fitsAbove
            ? below
            : above;
      const top = Math.max(
        viewportTop + margin,
        Math.min(viewportTop + viewportHeight - bounds.height - margin, preferred),
      );
      lastPosition = { x: left, y: top };
      if (animate) {
        x.setTarget(left);
        y.setTarget(top);
      }
      // ResizeObserver delivers an initial observation after every new anchor.
      // Do not let that unchanged measurement cancel travel to the new target.
      else if (x.target !== left || y.target !== top) {
        x.jump(left);
        y.jump(top);
      }
      element.style.visibility = 'visible';
    };
    position(previousId.current !== null && previousId.current !== tip.id);
    previousId.current = tip.id;
    const reposition = () => position(false);
    const observer = new ResizeObserver(reposition);
    observer.observe(tip.anchor);
    observer.observe(bubble.current);
    const ownerObserver = new MutationObserver(closeWithOwner);
    for (const node of owners) {
      ownerObserver.observe(node, {
        attributes: true,
        attributeFilter: ['open', 'hidden', 'inert', 'aria-hidden', 'disabled'],
      });
      node.addEventListener('close', closeWithOwner);
    }
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      observer.disconnect();
      ownerObserver.disconnect();
      for (const node of owners) node.removeEventListener('close', closeWithOwner);
      if (element.matches(':popover-open')) element.hidePopover();
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
  }, [tip, host, x, y]);
  useEffect(() => {
    if (!tip) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      suppressed.add(tip.id);
      // No exit-presence phase: Escape immediately removes both visible content and describedby.
      hide(tip.id, true);
    };
    const blur = () => hide(tip.id, true);
    const hidden = () => {
      if (document.visibilityState === 'hidden') hide(tip.id, true);
    };
    document.addEventListener('keydown', dismiss, true);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('keydown', dismiss, true);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', blur);
    };
  }, [tip]);
  if (!tip || !host) return null;
  return createPortal(
    <div
      ref={bubble}
      id={tip.id}
      role="tooltip"
      className="warm-tooltip"
      popover="manual"
      style={{ visibility: 'hidden' }}
    >
      {tip.content}
    </div>,
    host,
  );
}

/** Optional help only. Fine-pointer hover and keyboard focus share one measured, travelling bubble. */
export function WarmTooltip({
  content,
  children,
  disabled = false,
  placement = 'top',
}: {
  content: ReactNode;
  children: ReactElement;
  disabled?: boolean;
  placement?: Placement;
}) {
  const id = `tip-${useId()}`;
  const anchor = useRef<HTMLElement | null>(null);
  const state = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
  const props = children.props as HTMLAttributes<HTMLElement> & {
    ref?: Ref<HTMLElement>;
    disabled?: boolean;
    title?: string;
  };
  const nativePopover =
    typeof HTMLElement !== 'undefined' &&
    typeof HTMLElement.prototype.showPopover === 'function';
  useEffect(() => register(id), [id]);
  useEffect(() => {
    if (disabled) hide(id, true);
  }, [disabled, id]);
  const reveal = (instant: boolean) => {
    if (nativePopover && !disabled && !props.disabled && anchor.current)
      show({ id, anchor: anchor.current, content, placement }, instant);
  };
  const describedBy =
    [props['aria-describedby'], state.tip?.id === id ? id : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <>
      {cloneElement(
        children as ReactElement<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>,
        {
          ref: (node: HTMLElement | null) => {
            anchor.current = node;
            if (typeof props.ref === 'function') props.ref(node);
            else if (props.ref) props.ref.current = node;
          },
          title:
            disabled || props.disabled
              ? props.title
              : nativePopover
                ? undefined
                : (props.title ?? (typeof content === 'string' ? content : undefined)),
          'aria-describedby': describedBy,
          onPointerEnter: (event) => {
            props.onPointerEnter?.(event);
            if (!event.defaultPrevented && event.pointerType !== 'touch') reveal(false);
          },
          onPointerLeave: (event) => {
            props.onPointerLeave?.(event);
            suppressed.delete(id);
            hide(id);
          },
          onPointerDown: (event) => {
            props.onPointerDown?.(event);
            hide(id, true);
          },
          onFocus: (event) => {
            props.onFocus?.(event);
            if (!event.defaultPrevented && event.currentTarget.matches(':focus-visible'))
              reveal(true);
          },
          onBlur: (event) => {
            props.onBlur?.(event);
            suppressed.delete(id);
            hide(id, true);
          },
        },
      )}
      {state.leader === id && <TooltipLayer tip={state.tip} />}
    </>
  );
}
