import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { CaretDown, DownloadSimple, FileText, Trash, WarningCircle } from '@phosphor-icons/react';
import { downloadBlob, errorMessage, filenameBase } from '../lib/api';
import { MotionDisclosure } from '../motion/Presence';
import { accountDraftActionAllowed } from './account-model';
import { documentDrafts, serializeDocumentDraft, type DocumentDraft } from './document-drafts';

const emptyDrafts: readonly DocumentDraft[] = Object.freeze([]);
const serverDrafts = () => emptyDrafts;
const capturedTime = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const draftTime = (value: number) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? capturedTime.format(date) : '时间待确认';
};
type Feedback = { actor: string; kind: 'status' | 'alert'; message: string };

/** Account-scoped page-memory recovery remains reachable without project access. */
export function AccountDocumentDrafts({
  actorId,
  disabled,
  visible,
}: {
  actorId: string | null;
  disabled: boolean;
  visible: boolean;
}) {
  const id = useId();
  const read = useCallback(() => documentDrafts.list(actorId), [actorId]);
  const drafts = useSyncExternalStore(documentDrafts.subscribe, read, serverDrafts);
  const [showAll, setShowAll] = useState(false);
  const [confirmation, setConfirmation] = useState<DocumentDraft | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const discardButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusFrame = useRef(0);
  const owner = useRef({ actorId, disabled, visible, mounted: false });
  owner.current = { ...owner.current, actorId, disabled, visible };

  useEffect(() => {
    owner.current.mounted = true;
    return () => {
      owner.current.mounted = false;
      cancelAnimationFrame(focusFrame.current);
    };
  }, []);

  useEffect(() => {
    if (!confirmation) return;
    if (confirmation.actorId !== actorId) {
      setConfirmation(null);
      return;
    }
    const current = drafts.find((item) => item.projectId === confirmation.projectId);
    if (!accountDraftActionAllowed(actorId, current ?? null, confirmation, 'discard')) {
      setConfirmation(null);
      if (actorId) {
        setFeedback({
          actor: actorId,
          kind: 'status',
          message: current
            ? '草稿或保存状态已经变化，请重新核对后再丢弃。'
            : '这份保留草稿已发生变化，列表已更新。',
        });
      }
    }
  }, [actorId, drafts, confirmation]);

  const canAct = (expected: DocumentDraft) =>
    owner.current.mounted &&
    owner.current.visible &&
    !owner.current.disabled &&
    !!owner.current.actorId &&
    owner.current.actorId === expected.actorId;

  function exportDraft(expected: DocumentDraft) {
    if (!canAct(expected)) return;
    const actor = owner.current.actorId!;
    const current = documentDrafts.get(actor, expected.projectId);
    if (!current || !accountDraftActionAllowed(actor, current, expected, 'export')) {
      setFeedback({ actor, kind: 'alert', message: '草稿已经变化，请核对后重新导出。' });
      return;
    }
    try {
      downloadBlob(
        new Blob([serializeDocumentDraft(current)], { type: 'application/json;charset=utf-8' }),
        `${filenameBase(current.title.trim() || '未命名文档')}-未保存草稿.json`,
      );
      setFeedback({ actor, kind: 'status', message: '已请求下载草稿，请确认文件已保存后再丢弃。' });
    } catch (failure) {
      setFeedback({ actor, kind: 'alert', message: errorMessage(failure) });
    }
  }

  function requestDiscard(expected: DocumentDraft) {
    if (!canAct(expected)) return;
    const actor = owner.current.actorId!;
    const current = documentDrafts.get(actor, expected.projectId);
    if (!current || !accountDraftActionAllowed(actor, current, expected, 'discard')) {
      setFeedback({
        actor,
        kind: 'alert',
        message:
          current?.saveState === 'pending'
            ? '保存正在进行，暂时不能丢弃；你仍可以导出这份草稿。'
            : '草稿已经变化，请重新核对后再丢弃。',
      });
      return;
    }
    setFeedback(null);
    setConfirmation(current);
  }

  function cancelDiscard(expected: DocumentDraft) {
    setConfirmation(null);
    if (canAct(expected))
      discardButtons.current.get(expected.projectId)?.focus({ preventScroll: true });
  }

  function discardConfirmed(expected: DocumentDraft) {
    if (!canAct(expected) || confirmation !== expected) return;
    const actor = owner.current.actorId!;
    const current = documentDrafts.get(actor, expected.projectId);
    if (!current || !accountDraftActionAllowed(actor, current, expected, 'discard')) {
      setConfirmation(null);
      setFeedback({
        actor,
        kind: 'alert',
        message: '草稿或保存状态已经变化，没有丢弃任何内容。请重新核对。',
      });
      return;
    }
    const position = drafts.findIndex((item) => item.projectId === current.projectId);
    const restoreFocus = !!root.current?.contains(document.activeElement);
    if (!documentDrafts.remove(actor, current.projectId, current.revision)) {
      setConfirmation(null);
      setFeedback({
        actor,
        kind: 'alert',
        message: '草稿已经更新，没有丢弃任何内容。请重新确认。',
      });
      return;
    }
    setConfirmation(null);
    setFeedback({ actor, kind: 'status', message: '已丢弃这份本页草稿，云端文档没有被删除。' });
    if (restoreFocus) {
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => {
        if (!owner.current.mounted || owner.current.actorId !== actor || !owner.current.visible)
          return;
        const buttons = root.current?.querySelectorAll<HTMLButtonElement>('[data-draft-primary]');
        const target = buttons?.length
          ? buttons[Math.min(Math.max(0, position), buttons.length - 1)]
          : heading.current;
        target?.focus({ preventScroll: true });
      });
    }
  }

  const shown = showAll ? drafts : drafts.slice(0, 3);
  const currentFeedback = feedback?.actor === actorId ? feedback : null;
  return (
    <section
      className="account-drafts"
      aria-labelledby={`${id}-title`}
      data-testid="account-document-drafts"
      ref={root}
    >
      <header className="account-drafts-heading">
        <FileText size={19} aria-hidden />
        <h4 id={`${id}-title`} ref={heading} tabIndex={-1}>
          保留的文档草稿
        </h4>
        {drafts.length > 0 && <span className="account-draft-count">{drafts.length} 份</span>}
      </header>
      {!actorId ? (
        <p className="account-drafts-empty">重新登录原账号后，可查看自己的保留草稿。</p>
      ) : drafts.length === 0 ? (
        <p className="account-drafts-empty">当前账号在本页没有保留的文档草稿。</p>
      ) : (
        <>
          <p className="account-drafts-description">
            草稿仅保留在本页；刷新、关闭页面或退出登录会清除。项目无法访问时，仍可导出这里的副本。
          </p>
          <ul className="account-draft-list">
            {shown.map((draft, index) => {
              const confirming =
                confirmation?.actorId === actorId &&
                confirmation.projectId === draft.projectId &&
                accountDraftActionAllowed(actorId, draft, confirmation, 'discard');
              const title = draft.title.trim() || '未命名文档';
              return (
                <li
                  className="account-draft-row"
                  key={draft.projectId}
                  data-testid="account-document-draft"
                >
                  <div className="account-draft-title-line">
                    <h5>{title}</h5>
                    <span className="account-draft-state" data-save-state={draft.saveState}>
                      {draft.saveState === 'pending'
                        ? '保存中'
                        : draft.saveState === 'unknown'
                          ? '保存结果待确认'
                          : '未保存'}
                    </span>
                  </div>
                  <p className="account-draft-project">{draft.projectTitle || '未命名项目'}</p>
                  <p className="account-draft-meta">
                    <span>{draft.base ? `基于 V${draft.base.version}` : '新建草稿'}</span>
                    <span>保留于 {draftTime(draft.capturedAt)}</span>
                  </p>
                  <div className="account-draft-actions">
                    <button
                      type="button"
                      className="account-action"
                      disabled={disabled}
                      onClick={() => exportDraft(draft)}
                      data-testid="account-document-draft-export"
                      data-draft-primary
                      aria-label={`导出文档草稿：${title}`}
                    >
                      <DownloadSimple size={16} aria-hidden />
                      导出草稿
                    </button>
                    <button
                      type="button"
                      className="account-text-action account-draft-discard"
                      disabled={disabled || draft.saveState === 'pending'}
                      onClick={() => requestDiscard(draft)}
                      data-testid="account-document-draft-discard"
                      aria-label={`丢弃文档草稿：${title}`}
                      aria-expanded={confirming}
                      aria-controls={`${id}-discard-${index}`}
                      ref={(button) => {
                        if (button) discardButtons.current.set(draft.projectId, button);
                        else discardButtons.current.delete(draft.projectId);
                      }}
                    >
                      <Trash size={16} aria-hidden />
                      丢弃
                    </button>
                  </div>
                  {draft.saveState === 'pending' && (
                    <p className="account-draft-state-note">保存进行中，可以导出，暂时不能丢弃。</p>
                  )}
                  {draft.saveState === 'unknown' && (
                    <p className="account-draft-state-note">
                      上次保存结果尚未确认。丢弃本页草稿不会取消已提交的请求。
                    </p>
                  )}
                  <MotionDisclosure
                    open={!!confirming}
                    id={`${id}-discard-${index}`}
                    className="account-draft-confirmation"
                  >
                    <div
                      className="account-draft-confirmation-body"
                      role="group"
                      aria-label="确认丢弃文档草稿"
                    >
                      <p>
                        丢弃后无法从本页恢复。云端文档不会被删除，已提交的保存请求也不会取消。建议先导出。
                      </p>
                      <div className="account-draft-confirmation-actions">
                        <button
                          type="button"
                          className="account-action account-draft-confirm"
                          data-testid="account-document-draft-confirm"
                          disabled={!confirming || disabled}
                          onClick={() => confirmation && discardConfirmed(confirmation)}
                        >
                          确认丢弃
                        </button>
                        <button
                          type="button"
                          className="account-text-action"
                          disabled={disabled}
                          onClick={() => cancelDiscard(draft)}
                        >
                          保留草稿
                        </button>
                      </div>
                    </div>
                  </MotionDisclosure>
                </li>
              );
            })}
          </ul>
          {drafts.length > 3 && (
            <button
              type="button"
              className="account-text-action account-drafts-expand"
              aria-expanded={showAll}
              disabled={disabled}
              onClick={() => {
                setShowAll((value) => !value);
                setConfirmation(null);
              }}
            >
              {showAll ? '收起列表' : `查看其余 ${drafts.length - 3} 份草稿`}
              <CaretDown size={15} aria-hidden />
            </button>
          )}
          <p className="account-drafts-export-note">JSON 文件包含草稿标题、正文与编辑基准版本。</p>
        </>
      )}
      {currentFeedback && (
        <div
          className={`account-drafts-feedback ${currentFeedback.kind === 'alert' ? 'is-error' : ''}`}
          role={currentFeedback.kind}
        >
          {currentFeedback.kind === 'alert' && <WarningCircle size={16} aria-hidden />}
          <p>{currentFeedback.message}</p>
        </div>
      )}
    </section>
  );
}
