import { useId, useRef, useState } from 'react';
import { UsersThree, CloudCheck, CloudSlash, ArrowClockwise } from '@phosphor-icons/react';
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
}: {
  collaboration: CollaborationState;
  onReload: () => void;
  onFork: () => void;
  teamVoice?: TeamVoiceState;
  captureVoiceContext?: () => Promise<AssistantContext>;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const details = usePresence(open, 'collaboration-details'),
    conflict = usePresence(!!c.error, 'collaboration-conflict');
  const lastError = useRef(c.error);
  if (c.error) lastError.current = c.error;
  const members = c.enabled ? (c.snapshot?.presences ?? []) : [],
    leases = c.enabled ? (c.snapshot?.leases ?? []) : [];
  return (
    <aside
      className="collaboration-status"
      data-motion="collaboration-status"
      data-state={c.status}
    >
      <button
        className="collaboration-summary"
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => setOpen((value) => !value)}
      >
        <UsersThree size={17} />
        <span>{!c.enabled && teamVoice ? '团队语音' : labels[c.status]}</span>
        <small>
          {teamVoice?.state === 'connected'
            ? '语音 ' + teamVoice.roster.members.length
            : members.length || '—'}
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
          aria-label={c.enabled ? '实时编辑协作状态' : '团队语音状态'}
        >
          {teamVoice && <TeamVoiceControls room={teamVoice} capture={captureVoiceContext} />}
          <p>
            {c.enabled
              ? '已发布的协作调整会同步到当前作品。游标与半透明范围表示队员的位置和未发布的预览。'
              : '在当前作品中与队员通话。编辑协作尚未连接。'}
          </p>
          <ul>
            {members.map((member) => (
              <li key={member.id}>
                <strong>
                  {member.displayName}
                  {member.id === c.session?.id ? '（本窗口）' : ''}
                </strong>
                <span>{member.tool ?? '查看画面'}</span>
              </li>
            ))}
          </ul>
          {leases.length > 0 && (
            <ul className="collaboration-leases">
              {leases.map((lease) => (
                <li key={lease.id}>
                  <span>{lease.displayName}</span>
                  <small>正在调整 {targetLabel(lease.target)}</small>
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
                确认并发布
              </button>
              <button onClick={c.discardDraft}>取消未发布预览</button>
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
          <p>{c.error ?? lastError.current}</p>
          <div className="collaboration-actions">
            <button onClick={c.retry}>
              <ArrowClockwise size={14} />
              重试同步
            </button>
            <button onClick={c.reconnect}>重新连接</button>
            <button onClick={onFork}>另存本地草稿</button>
            <button onClick={onReload}>载入最新版本</button>
          </div>
        </section>
      )}
    </aside>
  );
}
