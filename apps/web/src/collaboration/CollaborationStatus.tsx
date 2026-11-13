import { t } from '../i18n';
import { useId, useRef, useState } from 'react';
import { UsersThree, CloudCheck, CloudSlash, ArrowClockwise, EyeSlash, X } from '@phosphor-icons/react';
import type { CollaborationState } from './useCollaboration';
import { targetLabel } from './model';
import { usePresence } from '../motion/usePresence';
import type { AssistantContext } from '@ai-xiutu/contracts';
import { TeamVoiceControls } from './TeamVoiceControls';
import type { TeamVoiceState } from './useTeamVoice';
import './collaboration.css';
const labels = {
  off: '本地编辑',
  connecting: '正在加入协作',
  ready: '协作已连接',
  acquiring: '正在取得编辑权',
  previewing: '调整预览中',
  saving: '正在发布调整',
  reconnecting: '连接中断 · 草稿保留',
  conflict: '需要处理编辑冲突',
  forbidden: '协作权限已改变',
};
export function CollaborationStatus({
  collaboration: c,
  onReload,
  onFork,
  teamVoice,
  captureVoiceContext,
  onIndividualVoice,
  onHide,
  onProjectCollaboration,
}: {
  collaboration: CollaborationState;
  onReload: () => void;
  onFork: () => void;
  teamVoice?: TeamVoiceState;
  captureVoiceContext?: () => Promise<AssistantContext>;
  onIndividualVoice?: () => void;
  onHide?: () => void;
  onProjectCollaboration?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const details = usePresence(open, 'collaboration-details'),
    conflict = usePresence(!!c.error, 'collaboration-conflict');
  const lastError = useRef(c.error);
  if (c.error) lastError.current = c.error;
  const members = c.enabled ? (c.snapshot?.presences ?? []) : [],
    leases = c.enabled ? (c.snapshot?.leases ?? []) : [];
  const status = !c.enabled && teamVoice ? t('团队语音') : t(labels[c.status]);
  return (
    <aside
      className="collaboration-status"
      data-motion="collaboration-status"
      data-state={c.status}
    >
      <button
        className="collaboration-summary"
        aria-expanded={open}
        aria-label={members.length ? status + ' · ' + members.length : status}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
      >
        <UsersThree size={17} />
        <span>{status}</span>
        <small>
          {teamVoice?.state === 'connected'
            ? t('语音 ') + teamVoice.roster.members.length
            : members.length || null}
        </small>
        {c.enabled && c.status === 'ready' ? (
          <CloudCheck size={16} />
        ) : c.enabled && c.status === 'reconnecting' ? (
          <CloudSlash size={16} />
        ) : null}
      </button>
      {details.present && (
        <section
          id={detailsId}
          className="collaboration-details"
          data-motion="collaboration-details"
          data-motion-state={details.phase}
          inert={!open}
          aria-hidden={!open}
          aria-label={c.enabled ? t('实时编辑协作状态') : t('团队语音状态')}
        >
          <div className="collaboration-detail-toolbar">
            <strong>{t('协作成员')}</strong>
            {onHide && <button type="button" className="icon-button" aria-label={t('隐藏协作状态')} onClick={onHide}><EyeSlash size={17} /></button>}
            <button type="button" className="icon-button" aria-label={t('收起协作状态')} onClick={() => setOpen(false)}><X size={17} /></button>
          </div>
          <ul>
            {members.map((member) => (
              <li key={member.id}>
                <span className="comment-avatar" aria-hidden>{member.displayName.slice(0, 1)}</span>
                <strong>
                  {member.displayName}
                  {member.id === c.session?.id ? t('（本窗口）') : ''}
                </strong>
                <span>{member.tool ? t(({ light: '明暗', color: '色彩', beauty: '美颜', detail: '细节', crop: '构图', paint: '绘制', local: '局部', repair: '修复', liquify: '液化', composite: '图层' } as Record<string, string>)[member.tool] ?? '编辑中') : t('查看画面')}</span>
              </li>
            ))}
          </ul>
          {teamVoice && <TeamVoiceControls room={teamVoice} capture={captureVoiceContext} onIndividual={onIndividualVoice} />}
          {onProjectCollaboration && (
            <div className="collaboration-actions">
              <button type="button" onClick={() => { setOpen(false); onProjectCollaboration(); }}>
                {t('项目协作')}
              </button>
            </div>
          )}
          {leases.length > 0 && (
            <ul className="collaboration-leases">
              {leases.map((lease) => (
                <li key={lease.id}>
                  <span>{lease.displayName}</span>
                  <small>{t('正在调整 {target}', { target: targetLabel(lease.target) })}</small>
                </li>
              ))}
            </ul>
          )}
          {c.enabled && c.pendingCount > 0 && (
            <div className="collaboration-actions">
              <button
                disabled={c.status === 'saving' || c.status === 'forbidden'}
                onClick={() =>
                  void c.publishCurrent().catch(() => {
                    /* the hook exposes the authoritative error */
                  })
                }
              >
                {t('确认并发布')}
              </button>
              <button onClick={c.discardDraft}>{t('取消未发布预览')}</button>
            </div>
          )}
        </section>
      )}
      {conflict.present && (
        <section
          className="collaboration-conflict"
          role="status"
          data-motion="collaboration-conflict"
          data-motion-state={conflict.phase}
          inert={!c.error}
          aria-hidden={!c.error}
        >
          <p>{t(c.error ?? lastError.current ?? '')}</p>
          <div className="collaboration-actions">
            <button onClick={c.retry}>
              <ArrowClockwise size={14} />
              {t('重试同步')}
            </button>
            <button onClick={c.reconnect}>{t('重新连接')}</button>
            <button onClick={onFork}>{t('另存本地草稿')}</button>
            <button onClick={onReload}>{t('载入最新版本')}</button>
          </div>
        </section>
      )}
    </aside>
  );
}
