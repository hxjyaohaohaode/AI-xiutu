import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X, WarningCircle, CheckCircle, Info, SpinnerGap } from '@phosphor-icons/react';
import type { Notice } from '../lib/types';
import { DEFAULT_BRAND } from '../lib/brand';

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
    <div className="empty-state">
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
  return message ? (
    <div className="inline-error" role="alert">
      <WarningCircle size={18} aria-hidden />
      <span>{message}</span>
    </div>
  ) : null;
}
export function Toast({ notice, dismiss }: { notice: Notice | null; dismiss: () => void }) {
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(dismiss, notice.tone === 'error' ? 9000 : 5000);
    return () => clearTimeout(t);
  }, [notice, dismiss]);
  if (!notice) return null;
  const Symbol =
    notice.tone === 'success' ? CheckCircle : notice.tone === 'error' ? WarningCircle : Info;
  return (
    <div className={`toast ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      <Symbol size={21} />
      <span>{notice.message}</span>
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
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const onCancel = (event: Event) => {
      event.preventDefault();
      closeRef.current();
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
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header className="modal-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <IconButton label="关闭窗口" onClick={onClose}>
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
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
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
