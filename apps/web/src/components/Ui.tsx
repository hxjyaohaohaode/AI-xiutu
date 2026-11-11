import { t } from '../i18n';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { usePresence } from '../motion/usePresence';
import type { MotionPhase } from '../motion/registry';
import { X, WarningCircle, CheckCircle, Info, SpinnerGap } from '@phosphor-icons/react';
import type { Notice } from '../lib/types';
import { DEFAULT_BRAND } from '../lib/brand';
import { BrandMark } from './BrandMark';
import { StudioGlyph } from './StudioGlyph';
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
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
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
      <SpinnerGap className="spin" size={17} aria-hidden />
      {t(label)}
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
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" data-motion="empty-state">
      <div className="empty-symbol" aria-hidden>
        {icon}
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
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
      <WarningCircle size={18} aria-hidden />
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
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismiss, notice.tone === 'error' ? 9000 : 5000);
    return () => clearTimeout(t);
  }, [notice, dismiss]);
  const retained = useRef(notice);
  if (notice) retained.current = notice;
  const presence = usePresence(!!notice, 'notice');
  const visible = notice ?? retained.current;
  if (!presence.present || !visible) return null;
  const Symbol =
    visible.tone === 'success' ? CheckCircle : visible.tone === 'error' ? WarningCircle : Info;
  const content = (
    <div
      className={`toast ${visible.tone}`}
      role={visible.tone === 'error' ? 'alert' : 'status'}
      data-motion="notice"
      data-motion-state={presence.phase}
      inert={!notice}
      aria-hidden={!notice}
    >
      <Symbol size={21} />
      <span>{t(visible.message)}</span>
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
  wide = false,
  className = '',
  canClose,
  initialFocusRef,
  open: controlledOpen,
  keepMounted = false,
  profile: requestedProfile,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
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
          .filter(
            (candidate) =>
              candidate.tabIndex >= 0 &&
              !candidate.matches(':disabled') &&
              !candidate.closest('[inert], [hidden], [aria-hidden="true"]') &&
              candidate.getClientRects().length > 0 &&
              getComputedStyle(candidate).visibility !== 'hidden',
          )
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
        <div>
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
      {!compact && <small>{t('创作空间')}</small>}
    </div>
  );
}
