import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { usePresence } from '../motion/usePresence';
import type { MotionPhase } from '../motion/registry';
import { X, WarningCircle, CheckCircle, Info, SpinnerGap } from '@phosphor-icons/react';
import type { Notice } from '../lib/types';
import { DEFAULT_BRAND } from '../lib/brand';

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
      {label}
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
      <span>{message ?? last.current}</span>
    </div>
  ) : null;
}
export function Toast({ notice, dismiss }: { notice: Notice | null; dismiss: () => void }) {
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
  return (
    <div
      className={`toast ${visible.tone}`}
      role={visible.tone === 'error' ? 'alert' : 'status'}
      data-motion="notice"
      data-motion-state={presence.phase}
      inert={!notice}
      aria-hidden={!notice}
    >
      <Symbol size={21} />
      <span>{visible.message}</span>
      <IconButton label="关闭提示" onClick={dismiss}>
        <X size={16} />
      </IconButton>
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  className = '',
  canClose,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  canClose?: () => boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const context = useContext(DialogMotionContext);
  const [closing, setClosing] = useState(false);
  const presence = usePresence(!closing, 'modal-frame');
  const open = context?.open ?? !closing;
  const phase = context?.phase ?? presence.phase;
  const closedOnce = useRef(false);
  useEffect(() => {
    if (!context && closing && !presence.present && !closedOnce.current) {
      closedOnce.current = true;
      closeRef.current();
    }
  }, [context, closing, presence.present]);
  const requestClose = () => {
    if (canClose && !canClose()) return;
    if (context) onClose();
    else setClosing(true);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const onCancel = (event: Event) => {
      event.preventDefault();
      requestCloseRef.current();
    };
    element?.addEventListener('cancel', onCancel);
    return () => {
      element?.removeEventListener('cancel', onCancel);
      element?.close();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`modal ${wide ? 'modal-wide' : ''} ${className}`}
      aria-label={title}
      data-motion={className.includes('drawing') ? 'drawing-frame' : 'modal-frame'}
      data-motion-state={phase}
      data-motion-pixels="true"
      inert={!open}
      aria-hidden={!open}
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
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <IconButton label="关闭窗口" onClick={requestClose}>
          <X size={20} />
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
      {logoUrl ? (
        <img className="brand-logo" src={logoUrl} alt="" />
      ) : (
        <span className="brand-symbol" aria-hidden>
          <i />
          <i />
        </span>
      )}
      <span>{name}</span>
      {!compact && <small>创作空间</small>}
    </div>
  );
}
