import { t } from '../i18n';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../motion/usePresence';
import type { MotionPhase } from '../motion/registry';
import { X, Info } from '@phosphor-icons/react';
import type { Notice } from '../lib/types';
import { DEFAULT_BRAND } from '../lib/brand';
import { BrandMark } from './BrandMark';
import { StudioGlyph } from './StudioGlyph';
import { StatusMark } from './StatusMark';
import { ModalCloseRequests } from './modal-close';
import {
  modalMotionRole,
  modalProfiles,
  modalProfileStyle,
  resolveModalProfile,
  type ModalProfileName,
} from './modal-profiles';

export const DialogMotionContext = createContext<{ open: boolean; phase: MotionPhase } | null>(
  null,
);

export function IconButton({
  label,
  children,
  className = '',
  ...props
}: ComponentPropsWithRef<'button'> & { label: string }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  );
}
export function Busy({ label = '正在处理' }: { label?: string }) {
  return (
    <span className="busy">
      <StatusMark state="running" size="small" label={label ? t(label) : undefined} />
    </span>
  );
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" data-motion="empty-state">
      <div className="empty-symbol" aria-hidden>
        {icon}
      </div>
      <h2>{title}</h2>
      {description?.trim() && <p>{description}</p>}
      {action}
    </div>
  );
}
export function InlineError({ message }: { message: string | null }) {
  const last = useRef(message);
  if (message) last.current = message;
  const presence = usePresence(!!message, 'inline-error');
  return presence.present ? (
    <div
      className="inline-error"
      role="alert"
      data-motion="inline-error"
      data-motion-state={presence.phase}
      inert={!message}
      aria-hidden={!message}
    >
      <StatusMark state="failed" size="small" />
      <span>{t(message ?? last.current ?? '')}</span>
    </div>
  ) : null;
}
export function Toast({
  notice,
  dismiss,
  container,
}: {
  notice: Notice | null;
  dismiss: () => void;
  container?: HTMLElement | null;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(
    () => typeof document !== 'undefined' && document.hidden,
  );
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const clock = useRef<{ notice: Notice | null; remaining: number }>({
    notice: null,
    remaining: 5000,
  });
  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!notice) {
      setHovered(false);
      setFocused(false);
    }
  }, [notice]);
  useEffect(() => {
    if (clock.current.notice !== notice) clock.current = { notice, remaining: 5000 };
    // Errors remain available until explicitly dismissed. Pointer, keyboard and
    // hidden-page pauses share the same remaining time, rather than restarting it.
    if (!notice || notice.tone === 'error' || hovered || focused || pageHidden) return;
    const current = clock.current;
    const started = performance.now();
    const timer = setTimeout(() => dismissRef.current(), current.remaining);
    return () => {
      clearTimeout(timer);
      current.remaining = Math.max(0, current.remaining - (performance.now() - started));
    };
  }, [notice, hovered, focused, pageHidden]);
  const retained = useRef(notice);
  if (notice) retained.current = notice;
  const presence = usePresence(!!notice, 'notice');
  const visible = notice ?? retained.current;
  if (!presence.present || !visible) return null;
  const content = (
    <div
      className={`toast ${visible.tone}`}
      role={visible.tone === 'error' ? 'alert' : 'status'}
      data-motion="notice"
      data-motion-state={presence.phase}
      inert={!notice}
      aria-hidden={!notice}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {visible.tone === 'info' ? (
        <Info size={20} aria-hidden />
      ) : (
        <StatusMark state={visible.tone === 'success' ? 'done' : 'failed'} />
      )}
      <span className="toast-message">{t(visible.message)}</span>
      <IconButton label={t('关闭提示')} onClick={dismiss}>
        <X size={16} />
      </IconButton>
    </div>
  );
  return container ? createPortal(content, container) : content;
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  onBack,
  hideTitle = false,
  wide = false,
  className = '',
  canClose,
  initialFocusRef,
  open: controlledOpen,
  keepMounted = false,
  profile: requestedProfile,
}: {
  title: ReactNode;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  onBack?: () => void;
  hideTitle?: boolean;
  wide?: boolean;
  className?: string;
  canClose?: () => boolean | Promise<boolean>;
  initialFocusRef?: { readonly current: HTMLElement | null };
  /** Controlled visibility can preserve an expensive editor or an unsaved draft. */
  open?: boolean;
  keepMounted?: boolean;
  /** Distinct geometry and motion; native dialog semantics remain shared. */
  profile?: ModalProfileName;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const context = useContext(DialogMotionContext);
  const [closing, setClosing] = useState(false);
  const open = controlledOpen ?? context?.open ?? !closing;
  const profile = resolveModalProfile(requestedProfile, className, wide);
  const motionRole = modalMotionRole(profile);
  const presence = usePresence(open, motionRole);
  // An explicitly controlled child dialog owns its lifecycle, even inside the
  // provider used by a different application dialog.
  const phase = controlledOpen === undefined ? (context?.phase ?? presence.phase) : presence.phase;
  const present = controlledOpen === undefined && context ? phase !== 'hidden' : presence.present;
  const titleId = useId();
  const subtitleId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const closedOnce = useRef(false);
  const initiallyFocused = useRef(false);
  const [closeRequests] = useState(() => new ModalCloseRequests());
  const mode = controlledOpen !== undefined ? 'controlled' : context ? 'context' : 'self';
  const owner = useRef({ open, mode, mounted: false, generation: 0, requested: false });
  if (owner.current.open !== open || owner.current.mode !== mode) {
    owner.current = {
      ...owner.current,
      open,
      mode,
      generation: owner.current.generation + 1,
      requested: false,
    };
    closeRequests.invalidate();
  }
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const guardRef = useRef(canClose);
  guardRef.current = canClose;
  useEffect(() => {
    owner.current.mounted = true;
    return () => {
      owner.current.mounted = false;
      owner.current.generation++;
      closeRequests.invalidate();
    };
  }, [closeRequests]);

  function closeNativeDialog(element = dialog.current) {
    if (!element) return;
    const shouldRestore =
      !document.activeElement ||
      document.activeElement === document.body ||
      element.contains(document.activeElement);
    if (element.open) element.close();
    const target = returnFocus.current;
    if (shouldRestore && target?.isConnected && !target.closest('[inert]'))
      target.focus({ preventScroll: true });
    returnFocus.current = null;
    initiallyFocused.current = false;
  }

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      returnFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      closedOnce.current = false;
      element.showModal();
    } else if (!present) closeNativeDialog();
  }, [open, present, keepMounted]);

  useEffect(() => {
    if (!open || phase === 'hidden' || phase === 'exit' || initiallyFocused.current) return;
    const frame = requestAnimationFrame(() => {
      const element = dialog.current;
      if (!element?.open) return;
      const focusTarget =
        initialFocusRef?.current ??
        element.querySelector<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
        );
      if (focusTarget) {
        if (initialFocusRef?.current || !element.contains(document.activeElement))
          focusTarget.focus({ preventScroll: true });
        initiallyFocused.current = true;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, phase, initialFocusRef]);
  useEffect(() => {
    if (
      controlledOpen === undefined &&
      !context &&
      closing &&
      !presence.present &&
      !closedOnce.current
    ) {
      closedOnce.current = true;
      closeRef.current();
    }
  }, [context, closing, presence.present, controlledOpen]);
  const requestClose = () => {
    const generation = owner.current.generation;
    const element = dialog.current;
    void closeRequests.request({
      isCurrent: () =>
        owner.current.mounted &&
        owner.current.open &&
        !owner.current.requested &&
        owner.current.generation === generation &&
        element === dialog.current &&
        !!element?.open,
      canClose: () => guardRef.current?.() ?? true,
      close: () => {
        owner.current.requested = true;
        if (owner.current.mode === 'self') setClosing(true);
        else closeRef.current();
      },
    });
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const onCancel = (event: Event) => {
      event.preventDefault();
      requestCloseRef.current();
    };
    element.addEventListener('cancel', onCancel);
    return () => {
      element.removeEventListener('cancel', onCancel);
      closeNativeDialog(element);
    };
  }, [present || keepMounted]);
  if (!present && !keepMounted) return null;
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'modal-wide' : ''} ${className}`}
      data-dialog-profile={profile}
      data-dialog-mobile={modalProfiles[profile].mobile}
      style={modalProfileStyle(profile) as CSSProperties}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      data-motion={motionRole}
      data-motion-state={phase}
      data-motion-pixels="true"
      data-motion-owner
      inert={!open}
      aria-hidden={!open}
      onKeyDown={(event) => {
        if (
          event.key !== 'Tab' ||
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !open ||
          (event.target as Element).closest('dialog') !== event.currentTarget
        )
          return;
        const element = event.currentTarget;
        const stops = Array.from(
          element.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, a[href], area[href], summary, iframe, [tabindex], [contenteditable]:not([contenteditable="false"])',
          ),
        )
          .filter((candidate) => {
            if (
              candidate.tabIndex < 0 ||
              candidate.matches(':disabled') ||
              candidate.closest('[inert], [hidden], [aria-hidden="true"]') ||
              candidate.getClientRects().length === 0 ||
              getComputedStyle(candidate).visibility === 'hidden'
            ) {
              return false;
            }
            // Closed disclosures can retain geometry for their unpainted content.
            // Only their first direct summary belongs in the keyboard cycle.
            for (
              let parent = candidate.parentElement;
              parent && parent !== element;
              parent = parent.parentElement
            ) {
              if (
                parent instanceof HTMLDetailsElement &&
                !parent.open &&
                !parent.querySelector(':scope > summary')?.contains(candidate)
              ) {
                return false;
              }
            }
            return true;
          })
          .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
        const first = stops[0];
        const last = stops.at(-1);
        const active = document.activeElement;
        // Native modality makes the background inert, but Chromium can still
        // move focus into browser chrome at a boundary. Keep this dialog's
        // keyboard cycle explicit without intercepting ordinary field traversal.
        if (!first || !last) {
          event.preventDefault();
          element.focus({ preventScroll: true });
        } else if (event.shiftKey && (active === first || active === element)) {
          event.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!event.shiftKey && (active === last || active === element)) {
          event.preventDefault();
          first.focus({ preventScroll: true });
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            requestClose();
        }
      }}
    >
      <header className="modal-header" data-motion="modal-header" data-motion-state={phase}>
        {onBack && <IconButton label={t('返回')} className="modal-back" onClick={onBack}><span aria-hidden="true">←</span></IconButton>}
        <div className={hideTitle ? 'review-sr-only' : undefined}>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p id={subtitleId}>{subtitle}</p>}
        </div>
        <IconButton label={t('关闭窗口')} onClick={requestClose}>
          <StudioGlyph name="close" size={20} />
        </IconButton>
      </header>
      {children}
    </dialog>
  );
}
export function Brand({
  name = DEFAULT_BRAND,
  logoUrl,
  compact = false,
}: {
  name?: string;
  logoUrl?: string | null;
  compact?: boolean;
}) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`} data-motion="brand">
      <BrandMark logoUrl={logoUrl} className="brand-logo" />
      <span>{name}</span>
    </div>
  );
}
