import { t, useLocale } from '../i18n';
import { useState } from 'react';
import { MotionDetails } from '../motion/Presence';
import type { AssistantCandidate, AssistantGrant, AssistantWorkspace } from '@ai-xiutu/contracts';
import { StudioGlyph, type StudioGlyphName } from '../components/StudioGlyph';

const sectionGlyph: Record<AssistantWorkspace['sections'][number]['type'], StudioGlyphName> = {
  clarification: 'ai',
  budget: 'usage',
  references: 'works',
  parameters: 'editor',
  candidates: 'compare',
};

function ReferencePreview({ id, index }: { id: string; index: number }) {
  const [failed, setFailed] = useState(false);
  const locale = useLocale();
  const unavailable =
    locale === 'en' ? 'Preview unavailable' : locale === 'zh-TW' ? '預覽暫不可用' : '预览暂不可用';
  return (
    <figure className="workspace-reference">
      {failed ? (
        <span className="workspace-reference-unavailable">
          <StudioGlyph name="works" size={22} />
          <span>{unavailable}</span>
        </span>
      ) : (
        <img
          src={`/v1/assets/${encodeURIComponent(id)}/thumbnail`}
          alt={t('本次明确共享的参考图')}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      <figcaption>{String(index + 1).padStart(2, '0')}</figcaption>
    </figure>
  );
}

export function WorkspaceCards({
  spec,
  candidates,
  grant,
  disabled,
  canExecute,
  onDecision,
  onPrompt,
}: {
  spec: AssistantWorkspace;
  candidates: AssistantCandidate[];
  grant: AssistantGrant | null;
  disabled: boolean;
  canExecute: boolean;
  onDecision: (candidate: AssistantCandidate, decision: 'previewed' | 'rejected') => void;
  onPrompt: (text: string) => void;
}) {
  const locale = useLocale();
  const operations = locale === 'en' ? 'Operations' : locale === 'zh-TW' ? '操作次數' : '操作次数';
  return (
    <section className="assistant-workspace" aria-label={spec.title}>
      <h3>{spec.title}</h3>
      {spec.sections.map((section, index) => (
        <article
          key={`${index}:${section.type}`}
          className={`assistant-candidate workspace-section workspace-section-${section.type}`}
        >
          <h4>
            <StudioGlyph name={sectionGlyph[section.type]} size={16} />
            {section.title}
          </h4>
          {section.type === 'clarification' && (
            <>
              <p>{section.question}</p>
              <div className="workspace-choices">
                {section.choices.map((choice, i) => (
                  <button key={i} disabled={disabled} onClick={() => onPrompt(choice)}>
                    {choice}
                  </button>
                ))}
              </div>
            </>
          )}
          {section.type === 'budget' &&
            (grant ? (
              <div className="workspace-budget">
                <div>
                  <span>{t('服务点')}</span>
                  <strong>
                    {grant.usedUnits}
                    <small> / {grant.unitLimit}</small>
                  </strong>
                  <meter
                    min={0}
                    max={grant.unitLimit || 1}
                    value={grant.usedUnits}
                    aria-label={t('服务点')}
                  />
                </div>
                <div>
                  <span>{operations}</span>
                  <strong>
                    {grant.usedSteps}
                    <small> / {grant.stepLimit}</small>
                  </strong>
                  <meter
                    min={0}
                    max={grant.stepLimit || 1}
                    value={grant.usedSteps}
                    aria-label={operations}
                  />
                </div>
              </div>
            ) : (
              <p>{t('尚未建立本次执行授权。实际报价以所选模型与生成规格为准。')}</p>
            ))}
          {section.type === 'references' && (
            <div className="workspace-references">
              {section.assetIds.map((id, index) => (
                <ReferencePreview key={id} id={id} index={index} />
              ))}
            </div>
          )}
          {section.type === 'parameters' && candidates[section.candidateIndex]?.changes?.length ? (
            <div className="workspace-parameter-scroll" tabIndex={0}>
              <table>
                <thead>
                  <tr>
                    <th>{t('参数')}</th>
                    <th>{t('原值')}</th>
                    <th>{t('建议')}</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates[section.candidateIndex]!.changes!.map((change, i) => (
                    <tr key={i}>
                      <td>{change.label}</td>
                      <td>{change.before}</td>
                      <td className="workspace-proposed-value">{change.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {section.type === 'candidates' &&
            section.candidateIndices.map((i) => {
              const candidate = candidates[i];
              if (!candidate) return <p key={i}>{t('候选暂不可用，请刷新会话。')}</p>;
              return (
                <div key={candidate.id} className="workspace-candidate">
                  <p>{candidate.summary}</p>
                  {candidate.kind === 'generation' && (
                    <MotionDetails>
                      <summary>{t('生图要求')}</summary>
                      <p>{candidate.prompt}</p>
                    </MotionDetails>
                  )}
                  <div>
                    <button
                      className="ai-candidate-primary"
                      disabled={
                        disabled ||
                        !canExecute ||
                        candidate.decision === 'rejected' ||
                        !!candidate.appliedRevisionId ||
                        (candidate.kind === 'edit' && candidate.decision === 'previewed')
                      }
                      onClick={() => onDecision(candidate, 'previewed')}
                    >
                      {candidate.appliedRevisionId
                        ? t('已保存新版本')
                        : candidate.decision === 'rejected'
                          ? t('已退回')
                          : candidate.kind === 'edit'
                            ? candidate.decision === 'previewed'
                              ? t('已放入画布预览')
                              : t('在画布预览')
                            : t('选择生图模型与规格')}
                    </button>
                    <button
                      disabled={disabled || candidate.decision !== 'pending'}
                      onClick={() => onDecision(candidate, 'rejected')}
                    >
                      {t('退回')}
                    </button>
                  </div>
                </div>
              );
            })}
        </article>
      ))}
    </section>
  );
}
