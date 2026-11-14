import { ArrowClockwise } from '@phosphor-icons/react';
import { t } from '../i18n';
import LatticeLoader from '../components/react-bits/LatticeLoader';

export function ModelReadStatus({ label, error, retry, actionLabel }: {
  label: string;
  error?: string;
  retry?: () => void;
  actionLabel?: string;
}) {
  return (
    <div className="ai-model-read-status" data-error={!!error}>
      <LatticeLoader status={error ? 'error' : 'working'} label={label} errorLabel={label}
        color="var(--ink)" errorColor="var(--danger)" showTimer={!error} />
      {error && <button type="button" className="text-button" onClick={retry}><ArrowClockwise size={15} />{actionLabel ?? t('重新加载')}</button>}
    </div>
  );
}
