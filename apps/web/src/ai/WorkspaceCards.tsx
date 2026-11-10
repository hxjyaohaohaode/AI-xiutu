import type { AssistantCandidate, AssistantGrant, AssistantWorkspace } from '@ai-xiutu/contracts';

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
  return (
    <section className="assistant-workspace" aria-label={spec.title}>
      <h3>{spec.title}</h3>
      {spec.sections.map((section, index) => (
        <article key={`${index}:${section.type}`} className="assistant-candidate">
          <h4>{section.title}</h4>
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
          {section.type === 'budget' && (
            <p>
              {grant
                ? `已使用 ${grant.usedUnits} / ${grant.unitLimit} 服务点，${grant.usedSteps} / ${grant.stepLimit} 次操作。生图规格的报价在提交前单独显示。`
                : '尚未建立本次执行授权。实际报价以所选模型与生成规格为准。'}
            </p>
          )}
          {section.type === 'references' && (
            <div className="workspace-references">
              {section.assetIds.map((id) => (
                <img
                  key={id}
                  src={`/v1/assets/${id}/thumbnail`}
                  alt="本次明确共享的参考图"
                  loading="lazy"
                />
              ))}
            </div>
          )}
          {section.type === 'parameters' && candidates[section.candidateIndex]?.changes?.length ? (
            <table>
              <thead>
                <tr>
                  <th>参数</th>
                  <th>原值</th>
                  <th>建议</th>
                </tr>
              </thead>
              <tbody>
                {candidates[section.candidateIndex]!.changes!.map((change, i) => (
                  <tr key={i}>
                    <td>{change.label}</td>
                    <td>{change.before}</td>
                    <td>{change.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {section.type === 'candidates' &&
            section.candidateIndices.map((i) => {
              const candidate = candidates[i];
              if (!candidate) return <p key={i}>候选暂不可用，请刷新会话。</p>;
              return (
                <div key={candidate.id} className="workspace-candidate">
                  <p>{candidate.summary}</p>
                  {candidate.kind === 'generation' && (
                    <details>
                      <summary>生图要求</summary>
                      <p>{candidate.prompt}</p>
                    </details>
                  )}
                  <div>
                    <button
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
                        ? '已保存新版本'
                        : candidate.decision === 'rejected'
                          ? '已退回'
                          : candidate.kind === 'edit'
                            ? candidate.decision === 'previewed'
                              ? '已放入画布预览'
                              : '在画布预览'
                            : '选择生图模型与规格'}
                    </button>
                    <button
                      disabled={disabled || candidate.decision !== 'pending'}
                      onClick={() => onDecision(candidate, 'rejected')}
                    >
                      退回
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
