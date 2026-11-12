import { ArrowClockwise } from '@phosphor-icons/react';
import { t } from '../i18n';

export function ModelReadStatus({ label, error, retry }: { label: string; error?: string; retry?: () => void }) {
  return (
    <div className="ai-model-read-status" data-error={!!error}>
      {!error && <span className="ai-lattice" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span>}
      <span role={error ? 'alert' : 'status'} title={error ? t(error) : undefined}>{label}</span>
      {error && <button type="button" className="text-button" onClick={retry}><ArrowClockwise size={15} />{t('重新加载')}</button>}
    </div>
  );
}
