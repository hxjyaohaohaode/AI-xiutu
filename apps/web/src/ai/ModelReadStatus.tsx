import { ArrowClockwise } from '@phosphor-icons/react';
import { t } from '../i18n';
import LatticeLoader from '../components/react-bits/LatticeLoader';

export function ModelReadStatus({ label, error, retry }: { label: string; error?: string; retry?: () => void }) {
  return (
    <div className="ai-model-read-status" data-error={!!error}>
      <LatticeLoader status={error ? 'error' : 'working'} label={label} errorLabel={label}
        color="var(--ink)" errorColor="var(--danger)" showTimer={!error} />
      {error && <button type="button" className="text-button" onClick={retry}><ArrowClockwise size={15} />{t('重新加载')}</button>}
    </div>
  );
}
