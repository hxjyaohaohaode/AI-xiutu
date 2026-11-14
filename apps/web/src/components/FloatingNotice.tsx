import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, X } from '@phosphor-icons/react';
import { t } from '../i18n';

export function FloatingNotice({ message, onRetry, onDismiss, className, dismissLabel }: {
  message: string | null; onRetry?: () => void; onDismiss?: () => void;
  className?: string; dismissLabel?: string;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const progress = useRef<HTMLDivElement>(null);
  const dismissCallback = useRef(onDismiss);
  dismissCallback.current = onDismiss;
  useEffect(() => {
    if (!message) { setDismissed(null); return; }
    if (dismissed === message) return;
    const animation = progress.current?.animate(
      [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
      { duration: 3000, fill: 'forwards' },
    );
    const timer = window.setTimeout(() => {
      setDismissed(message);
      dismissCallback.current?.();
    }, 3000);
    return () => { window.clearTimeout(timer); animation?.cancel(); };
  }, [message, dismissed]);

  if (!message || dismissed === message) return null;
  return (
    <div className={['floating-notice', className].filter(Boolean).join(' ')} role="alert">
      <span className="floating-notice-icon" aria-hidden>
        <img src="/import-activity.svg#still" alt="" />
      </span>
      <span>{t(message)}</span>
      {onRetry && (
        <button type="button" aria-label={t('重试')} title={t('重试')} onClick={onRetry}>
          <ArrowClockwise size={17} />
        </button>
      )}
      <button type="button" aria-label={dismissLabel ?? t('关闭提示')} title={dismissLabel ?? t('关闭提示')} onClick={() => {
        setDismissed(message);
        onDismiss?.();
      }}>
        <X size={17} />
      </button>
      <div className="toast-countdown" ref={progress} aria-hidden />
    </div>
  );
}
