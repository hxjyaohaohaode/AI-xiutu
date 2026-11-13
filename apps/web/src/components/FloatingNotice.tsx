import { useEffect, useState } from 'react';
import { ArrowClockwise, X } from '@phosphor-icons/react';
import { t } from '../i18n';

export function FloatingNotice({ message, onRetry, onDismiss }: { message: string | null; onRetry?: () => void; onDismiss?: () => void }) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => { if (!message) setDismissed(null); }, [message]);
  if (!message || dismissed === message) return null;
  return (
    <div className="floating-notice" role="alert">
      <span className="floating-notice-icon" aria-hidden>
        <img src="/import-activity.svg#still" alt="" />
      </span>
      <span>{t(message)}</span>
      {onRetry && (
        <button type="button" aria-label={t('重试')} title={t('重试')} onClick={onRetry}>
          <ArrowClockwise size={17} />
        </button>
      )}
      <button type="button" aria-label={t('关闭提示')} title={t('关闭提示')} onClick={() => {
        setDismissed(message);
        onDismiss?.();
      }}>
        <X size={17} />
      </button>
    </div>
  );
}
