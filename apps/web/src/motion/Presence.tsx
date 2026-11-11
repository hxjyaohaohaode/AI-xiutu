import { t } from '../i18n';
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type DetailsHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { motionEntryDuration, motionExitDuration, type MotionRole } from './registry';
import { usePresence, useReducedMotion } from './usePresence';
import { reduceMotionSwitch } from './switch-model';

type SurfaceProps = Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'children'> & {
  role?: MotionRole;
  children: ReactNode;
};

/** Own one surface lifecycle; exiting descendants cannot remain interactive. */
export function MotionSurface({
  open,
  keepMounted = false,
  role = 'popover',
  children,
  ...props
}: SurfaceProps & { open: boolean; keepMounted?: boolean }) {
  const presence = usePresence(open, role);
  if (!presence.present && !keepMounted) return null;
  return (
    <div
      {...props}
      data-motion={role}
      data-motion-state={presence.phase}
      data-motion-owner
      inert={!open}
      aria-hidden={!open}
    >
      {children}
    </div>
  );
}

/** Retain the outgoing view, then enter the latest view; same-key inputs update immediately. */
export function MotionSwitch({
  switchKey,
  role = 'view-transition',
  children,
  className = '',
  ...props
}: SurfaceProps & { switchKey: string }) {
  const reduced = useReducedMotion();
  const [state, dispatch] = useReducer(reduceMotionSwitch, {
    key: switchKey,
    pendingKey: switchKey,
    phase: reduced ? ('idle' as const) : ('enter' as const),
  });
  const previous = useRef(children);
  if (switchKey === state.key) previous.current = children;
  useLayoutEffect(() => dispatch({ type: 'sync', key: switchKey, reduced }), [switchKey, reduced]);
  useEffect(() => {
    if (reduced || state.phase === 'idle' || state.phase === 'hidden') return;
    const timer = setTimeout(
      () => dispatch({ type: 'settled', ...state }),
      state.phase === 'exit' ? motionExitDuration(role) : motionEntryDuration(role),
    );
    return () => clearTimeout(timer);
  }, [state, reduced, role]);
  const exiting = state.phase === 'exit' || state.key !== switchKey;
  return (
    <div
      {...props}
      className={`motion-switch ${className}`}
      data-motion={role}
      data-motion-state={state.phase}
      data-motion-owner
      inert={exiting}
      aria-hidden={exiting}
    >
      <div key={state.key} className="motion-switch-content">
        {state.key === switchKey ? children : previous.current}
      </div>
    </div>
  );
}

/** Expand a retained subtree without measuring or animating the user's inputs. */
export function MotionDisclosure({
  open,
  keepMounted = true,
  children,
  className = '',
  ...props
}: Omit<SurfaceProps, 'role'> & { open: boolean; keepMounted?: boolean }) {
  const presence = usePresence(open, 'disclosure');
  if (!presence.present && !keepMounted) return null;
  return (
    <div
      {...props}
      className={`motion-disclosure ${className}`}
      data-motion="disclosure"
      data-motion-state={presence.phase}
      data-motion-owner
      inert={!open}
      aria-hidden={!open}
    >
      <div className="motion-disclosure-content">{children}</div>
    </div>
  );
}

/** Native summary semantics with a retained, inert closing body and no draft reset. */
export function MotionDetails({
  children,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  ...props
}: Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'open' | 'onToggle'> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const presence = usePresence(open, 'disclosure');
  const id = useId();
  const nodes = Children.toArray(children);
  const index = nodes.findIndex((node) => isValidElement(node) && node.type === 'summary');
  const summary = (index >= 0 ? nodes[index] : <summary>{t('详细设置')}</summary>) as ReactElement<
    HTMLAttributes<HTMLElement>
  >;
  const body = nodes.filter((_, at) => at !== index);
  return (
    <details {...props} open={open || presence.present}>
      {cloneElement(summary, {
        'aria-expanded': open,
        'aria-controls': id,
        onClick(event) {
          summary.props.onClick?.(event);
          if (event.defaultPrevented) return;
          if (
            event.target instanceof Element &&
            event.target !== event.currentTarget &&
            event.target.closest('a, button, input, select, textarea')
          )
            return;
          event.preventDefault();
          if (controlledOpen === undefined) setInternalOpen(!open);
          onOpenChange?.(!open);
        },
      })}
      <div
        id={id}
        className="motion-disclosure"
        data-motion="disclosure"
        data-motion-state={presence.phase}
        data-motion-owner
        inert={!open}
        aria-hidden={!open}
      >
        <div className="motion-disclosure-content">{body}</div>
      </div>
    </details>
  );
}
