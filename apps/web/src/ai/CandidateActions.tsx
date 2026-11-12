import { ArrowCounterClockwise, Check, Eye, X } from '@phosphor-icons/react';
import type { AssistantCandidate } from '@ai-xiutu/contracts';
import { t } from '../i18n';

export function CandidateActions({
  candidate,
  disabled,
  canExecute,
  previewing = false,
  confirmed = false,
  onDecision,
  onConfirm,
  onCancel,
}: {
  candidate: AssistantCandidate;
  disabled: boolean;
  canExecute: boolean;
  previewing?: boolean;
  confirmed?: boolean;
  onDecision: (candidate: AssistantCandidate, decision: 'previewed' | 'rejected') => void;
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const finished = candidate.appliedRevisionId
    ? t('已保存新版本')
    : candidate.decision === 'rejected'
      ? t('已退回')
      : confirmed
        ? t('已确认调整')
        : null;
  if (finished)
    return <div className="ai-candidate-outcome" role="status"><Check size={16} />{finished}</div>;
  if (candidate.kind === 'edit' && previewing)
    return (
      <div className="ai-candidate-preview">
        <span className="ai-candidate-outcome" role="status"><Eye size={16} />{t('画布预览中')}</span>
        <div className="ai-candidate-actions">
          <button type="button" disabled={disabled || !onCancel} onClick={onCancel}>
            <X size={16} />{t('取消预览')}
          </button>
          <button type="button" className="ai-candidate-primary" disabled={disabled || !canExecute || !onConfirm} onClick={onConfirm}>
            <Check size={16} />{t('确认调整')}
          </button>
        </div>
      </div>
    );
  return (
    <div className="ai-candidate-actions">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onDecision(candidate, 'rejected')}
      >
        <X size={16} />{t('退回')}
      </button>
      <button
        type="button"
        className="ai-candidate-primary"
        disabled={disabled || !canExecute}
        onClick={() => onDecision(candidate, 'previewed')}
      >
        {candidate.decision === 'previewed' ? <ArrowCounterClockwise size={16} /> : <Eye size={16} />}
        {candidate.kind === 'edit'
          ? candidate.decision === 'previewed' ? t('重新预览') : t('在画布预览')
          : t('选择生图模型与规格')}
      </button>
    </div>
  );
}
