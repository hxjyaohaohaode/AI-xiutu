import { MotionDetails } from '../motion/Presence';
import { useContext, useRef, useState } from 'react';
import {
  ArrowSquareOut,
  CheckCircle,
  GitBranch,
  Prohibit,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import type { Artwork } from '../lib/types';
import { formatDate } from '../lib/api';
import { Busy, InlineError, Modal } from '../components/Ui';
import type { AIJob } from './types';
import {
  currentResultBlock,
  decisionLabels,
  type DecisionDraft,
  type DecisionResponse,
} from './decisions';
import type { ResultDecisionController } from './useResultDecisions';
import './decisions.css';
import { AIVisibilityContext } from './AIVisibility';
import { useRetainedDialogValue } from './useRetainedDialogValue';

export function DecisionHistory({
  controller,
  outputIndex,
}: {
  controller: ResultDecisionController;
  outputIndex?: number;
}) {
  const records = controller.decisions.filter(
    (row) => (row.outputIndex ?? undefined) === outputIndex,
  );
  return (
    <MotionDetails className="ai-decision-history" data-motion="result-provenance">
      <summary>
        {records.length ? decisionLabels[records[0].action] : '尚未记录采用决定'}
        <small>记录与来源</small>
      </summary>
      {controller.loading && <Busy label="读取决定记录" />}
      {!controller.loading && !records.length && (
        <p>完成生成与采用结果分别记录，原始候选会保留。</p>
      )}
      {records.map((row) => (
        <div key={row.id} className="ai-decision-record">
          <span>
            {decisionLabels[row.action]}
            {row.contentEdited ? ' · 经手动编辑' : ''}
          </span>
          <time>{formatDate(row.createdAt)}</time>
          {row.reason && <p>{row.reason}</p>}
          {row.documentVersion && <small>文档 V{row.documentVersion}</small>}
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        disabled={controller.busy}
        onClick={controller.reload}
      >
        刷新记录
      </button>
    </MotionDetails>
  );
}

export function ResultActions({
  job,
  controller,
  artwork,
  isDirty,
  canEdit,
  outputIndex,
  onOpen,
  onDecisionApplied,
}: {
  job: AIJob;
  controller: ResultDecisionController;
  artwork: Artwork | null;
  isDirty: boolean;
  canEdit: boolean;
  outputIndex?: number;
  onOpen: (id: string) => void;
  onDecisionApplied?: (id: string) => void | Promise<void>;
}) {
  const visible = useContext(AIVisibilityContext);
  const [draft, setDraft] = useState<DecisionDraft | null>(null);
  const displayedDraft = useRetainedDialogValue(draft);
  const [result, setResult] = useState<DecisionResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const current = useRef({ artwork, isDirty });
  current.current = { artwork, isDirty };
  const isImage = job.output?.kind === 'image';
  const isPlan = job.output?.kind === 'edit-plan';
  const hasCurrentAction = isImage || isPlan;
  const blocked = currentResultBlock(job, artwork, isDirty);
  const targetChanged =
    draft &&
    'targetArtworkId' in draft &&
    (draft.targetArtworkId !== artwork?.id || draft.expectedVersion !== artwork?.headVersion);
  const matchingUncertain =
    controller.uncertain &&
    controller.uncertain.action !== 'save-text' &&
    ('outputIndex' in controller.uncertain ? controller.uncertain.outputIndex : undefined) ===
      outputIndex;
  const locked = controller.busy || !!controller.uncertain;

  async function confirm(request: DecisionDraft, replay = false) {
    if (
      !replay &&
      (request.action === 'replace' ||
        request.action === 'layer' ||
        request.action === 'apply-plan')
    ) {
      const reason = currentResultBlock(job, current.current.artwork, current.current.isDirty);
      if (
        reason ||
        request.targetArtworkId !== current.current.artwork?.id ||
        request.expectedVersion !== current.current.artwork?.headVersion
      ) {
        setLocalError(reason ?? '作品版本已改变，请重新选择接收结果的位置。');
        return;
      }
    }
    setLocalError(null);
    const response = await controller.decide(request);
    if (!response) return;
    setResult(response);
    setDraft(null);
    if (
      (request.action === 'replace' ||
        request.action === 'layer' ||
        request.action === 'apply-plan') &&
      response.artwork &&
      !current.current.isDirty &&
      current.current.artwork?.id === request.targetArtworkId
    ) {
      try {
        await onDecisionApplied?.(response.artwork.id);
      } catch {
        setLocalError(
          '结果已保存到云端，但当前图片尚未重新打开。可点击“打开已保存结果”，无需再次采用。',
        );
      }
    }
  }
  const openDraft = (next: DecisionDraft) => {
    setLocalError(null);
    setDraft(next);
  };
  return (
    <div className="result-decision-area" data-motion="result-actions">
      <div className="ai-result-actions">
        {hasCurrentAction && (
          <button
            className="text-button"
            disabled={locked || !canEdit}
            onClick={() =>
              openDraft({
                action: 'fork',
                ...(isImage ? { outputIndex: outputIndex ?? 0 } : {}),
                title: (artwork?.title ?? 'AI 创作') + ' · 分支',
              })
            }
          >
            <GitBranch size={16} />
            另存作品
          </button>
        )}
        {hasCurrentAction && (
          <button
            className="text-button"
            disabled={locked || !canEdit || !!blocked}
            title={blocked ?? undefined}
            onClick={() =>
              artwork &&
              openDraft(
                isImage
                  ? {
                      action: 'replace',
                      outputIndex: outputIndex ?? 0,
                      targetArtworkId: artwork.id,
                      expectedVersion: artwork.headVersion,
                    }
                  : {
                      action: 'apply-plan',
                      targetArtworkId: artwork.id,
                      expectedVersion: artwork.headVersion,
                    },
              )
            }
          >
            <ArrowsClockwise size={16} />
            {isImage ? '替换当前作品' : '采纳为新版本'}
          </button>
        )}
        {isImage && (
          <button
            className="text-button"
            disabled={locked || !canEdit || !!blocked}
            title={blocked ?? undefined}
            onClick={() =>
              artwork &&
              openDraft({
                action: 'layer',
                outputIndex: outputIndex ?? 0,
                targetArtworkId: artwork.id,
                expectedVersion: artwork.headVersion,
              })
            }
          >
            作为合成图层
          </button>
        )}
        <button
          className="text-button"
          disabled={locked || !canEdit}
          onClick={() =>
            openDraft({ action: 'reject', ...(isImage ? { outputIndex: outputIndex ?? 0 } : {}) })
          }
        >
          <Prohibit size={16} />
          暂不采用
        </button>
      </div>
      {blocked && hasCurrentAction && <p className="control-note">{blocked}</p>}
      {!canEdit && <p className="control-note">当前项目权限仅允许查看结果，采用需编辑权限。</p>}
      {result && (
        <div className="ai-decision-success" role="status">
          <CheckCircle size={16} />
          <span>{decisionLabels[result.decision.action]}</span>
          {result.artwork && (
            <button className="text-button" onClick={() => onOpen(result.artwork!.id)}>
              <ArrowSquareOut size={15} />
              打开已保存结果
            </button>
          )}
        </div>
      )}
      {matchingUncertain && (
        <button
          className="text-button"
          disabled={controller.busy}
          onClick={() => void confirm(controller.uncertain!, true)}
        >
          {controller.busy ? <Busy label="" /> : <ArrowsClockwise size={16} />}核验并重试同一决定
        </button>
      )}
      <InlineError message={localError} />
      <DecisionHistory controller={controller} outputIndex={outputIndex} />
      {displayedDraft && (
        <Modal
          open={visible && !!draft}
          title={
            displayedDraft.action === 'fork'
              ? '另存独立作品'
              : displayedDraft.action === 'reject'
                ? '暂不采用这个结果'
                : displayedDraft.action === 'layer'
                  ? '把候选加入当前合成'
                  : displayedDraft.action === 'replace'
                    ? '替换当前作品的图片来源'
                    : '采纳调整建议'
          }
          subtitle={
            displayedDraft.action === 'reject'
              ? '候选与已完成任务仍会保留，之后可以再次选择采用。'
              : '确认后保存到云端，并留下可追溯的决定记录。'
          }
          canClose={() => !controller.busy}
          onClose={() => setDraft(null)}
        >
          <div className="ai-decision-confirm" data-motion="result-confirmation">
            {displayedDraft.action === 'fork' && (
              <label>
                新作品名称
                <input
                  aria-label="新作品名称"
                  value={displayedDraft.title ?? ''}
                  maxLength={120}
                  disabled={locked}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, title: event.target.value } : null,
                    )
                  }
                />
              </label>
            )}
            {displayedDraft.action === 'replace' && (
              <p>
                将“{artwork?.title}”的 V{displayedDraft.expectedVersion}{' '}
                作为起点，建立一个使用此候选原图的新版本。旧配方不会继续叠加，旧图片和旧版本都可以在历史中找回。
              </p>
            )}
            {displayedDraft.action === 'layer' && (
              <p>
                保留“{artwork?.title}”的 V{displayedDraft.expectedVersion}{' '}
                原图与已有编辑，将这张候选作为独立合成图层加入新版本。之后可以调整位置、大小、范围、透明度和混合方式。
              </p>
            )}
            {displayedDraft.action === 'apply-plan' && (
              <>
                <p>
                  基于“{artwork?.title}”的 V{displayedDraft.expectedVersion}{' '}
                  新建版本，使用这条建议的完整配方。
                </p>
                {job.output?.kind === 'edit-plan' && (
                  <>
                    <p>{job.output.summary}</p>
                    {!!job.output.parameterChanges?.length && (
                      <ul className="decision-parameter-list">
                        {job.output.parameterChanges.map((change) => (
                          <li key={change.path}>
                            <span>{change.label}</span>
                            <span>
                              {Number(change.before.toFixed(4))} → {Number(change.after.toFixed(4))}
                              {change.unit === 'ratio' ? '' : change.unit}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </>
            )}
            {displayedDraft.action === 'reject' && (
              <>
                <p>这是“暂不使用”的记录。已完成的模型调用不会因此退款，也不会自动再次生成。</p>
                <div className="decision-reasons" aria-label="不采用原因">
                  {['风格不合适', '细节不满意', '构图不合适', '暂时保留'].map((reason) => (
                    <button
                      type="button"
                      key={reason}
                      aria-pressed={displayedDraft.reason === reason}
                      disabled={locked}
                      onClick={() =>
                        setDraft((current) => (current ? { ...current, reason } : null))
                      }
                    >
                      {reason}
                    </button>
                  ))}
                </div>
              </>
            )}
            {(displayedDraft.action === 'replace' ||
              displayedDraft.action === 'layer' ||
              displayedDraft.action === 'apply-plan') &&
              (blocked || targetChanged) && (
                <p className="parameter-error">{blocked ?? '作品版本已改变，请关闭后重新选择。'}</p>
              )}
            <InlineError message={controller.error} />
            <div className="ai-result-actions">
              <button
                className="button button-secondary"
                disabled={controller.busy}
                onClick={() => setDraft(null)}
              >
                返回
              </button>
              <button
                className="button button-primary"
                disabled={
                  locked ||
                  !canEdit ||
                  (displayedDraft.action === 'fork' && !displayedDraft.title?.trim()) ||
                  ((displayedDraft.action === 'replace' ||
                    displayedDraft.action === 'layer' ||
                    displayedDraft.action === 'apply-plan') &&
                    (!!blocked || !!targetChanged))
                }
                onClick={() => {
                  if (visible && draft) void confirm(draft);
                }}
              >
                {controller.busy ? <Busy label="保存决定" /> : '确认'}
              </button>
            </div>
            {matchingUncertain && (
              <button
                className="text-button"
                disabled={controller.busy}
                onClick={() => {
                  if (visible && draft && controller.uncertain)
                    void confirm(controller.uncertain, true);
                }}
              >
                核验并重试同一决定
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
