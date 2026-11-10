import { Fragment, useId, useState, type ReactNode } from 'react';
import { CaretDown, Copy, Receipt } from '@phosphor-icons/react';
import { Busy } from '../components/Ui';
import { MotionDisclosure } from '../motion/Presence';
import { usePresence } from '../motion/usePresence';
import type { Space } from '../lib/types';
import { usageModelName, type UsageQuote } from './catalog';
import {
  entryAmount,
  pointText,
  usageKinds,
  usageLabels,
  usageOperationName,
  usageSourceLabels,
  type UsageEntry,
  type UsageReport,
} from './model';

export type UsageMember = { userId: string; displayName: string; role: string };
const shortTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const fullTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});
function timeText(value: string, full = false) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? (full ? fullTime : shortTime).format(date)
    : '时间未记录';
}
function taskFamily(operation: string | null) {
  return operation === 'assistant-turn'
    ? '对话轮次'
    : operation === 'realtime-voice'
      ? '语音会话'
      : 'AI 任务';
}
function UsageDetailRow({
  open,
  id,
  children,
}: {
  open: boolean;
  id: string;
  children: ReactNode;
}) {
  const presence = usePresence(open, 'disclosure');
  if (!presence.present) return null;
  return (
    <tr className="usage-detail-row" id={id}>
      <td colSpan={4}>
        <MotionDisclosure open={open}>
          <div className="usage-detail-inner">{children}</div>
        </MotionDisclosure>
      </td>
    </tr>
  );
}
export function UsageLedger({
  report,
  quotes,
  members,
  spaces,
  currentUserId,
  more,
  error,
  onMore,
  onJob,
}: {
  report: UsageReport;
  quotes: UsageQuote[];
  members: readonly UsageMember[];
  spaces: readonly Space[];
  currentUserId?: string | null;
  more: boolean;
  error: string | null;
  onMore: () => void;
  onJob?: (entry: UsageEntry) => void;
}) {
  const tableId = useId();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; message: string } | null>(null);
  const actorName = (entry: UsageEntry) =>
    !entry.actorId
      ? '系统'
      : members.find((member) => member.userId === entry.actorId)?.displayName ||
        (entry.actorId === currentUserId ? '我' : `成员 ${entry.actorId.slice(0, 8)}`);
  async function copyTask(entry: UsageEntry) {
    if (!entry.jobId) return;
    try {
      await navigator.clipboard.writeText(entry.jobId);
      setCopied({ id: entry.id, message: '已复制任务 ID' });
    } catch {
      setCopied({ id: entry.id, message: '未能复制，请选择完整 ID 后复制。' });
    }
  }
  return (
    <section
      className="usage-card usage-ledger"
      aria-labelledby={`${tableId}-title`}
      data-motion="usage-ledger"
    >
      <div className="usage-section-heading">
        <div>
          <h2 id={`${tableId}-title`}>
            <Receipt size={18} aria-hidden /> 用量明细
          </h2>
          <p>
            已载入 {report.entries.length.toLocaleString('zh-CN')} 条
            {report.nextCursor ? ' · 还有更早记录' : ' · 已载入全部'}
          </p>
        </div>
        <span className="usage-timezone">北京时间</span>
      </div>
      {report.entries.length ? (
        <div className="usage-table-scroll">
          <table className="usage-table">
            <caption className="usage-sr-only">
              用量明细，所选期间的结算流水；展开记录可查看完整任务与账本标识。
            </caption>
            <thead>
              <tr>
                <th scope="col">时间 / 成员</th>
                <th scope="col">流水 / 用途</th>
                <th scope="col">服务点</th>
                <th scope="col">
                  <span className="usage-sr-only">记录详情</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {report.entries.map((entry) => {
                const amount = entryAmount(entry);
                const open = expanded === entry.id;
                const detailId = `${tableId}-entry-${entry.id}`;
                return (
                  <Fragment key={entry.id}>
                    <tr className="usage-ledger-row" data-expanded={open}>
                      <td className="usage-row-time">
                        <time dateTime={entry.createdAt}>{timeText(entry.createdAt)}</time>
                        <small>{actorName(entry)}</small>
                      </td>
                      <td className="usage-row-purpose">
                        <div>
                          <span className="usage-kind" data-kind={entry.kind}>
                            {usageLabels[entry.kind] ?? entry.kind}
                          </span>
                          <strong>
                            {entry.operation
                              ? usageOperationName(entry.operation)
                              : entry.reason ||
                                usageSourceLabels[entry.sourceKind ?? ''] ||
                                '额度变动'}
                          </strong>
                        </div>
                        <small>
                          {entry.modelId
                            ? usageModelName(quotes, entry.modelId, entry.operation)
                            : usageSourceLabels[entry.sourceKind ?? ''] || '来源未记录'}
                        </small>
                      </td>
                      <td className="usage-row-amount">
                        <strong>
                          {amount !== null && entry.kind === 'adjusted' && amount > 0 ? '+' : ''}
                          {pointText(amount)}
                        </strong>
                        {amount !== null && <span> 点</span>}
                        {!entry.movementComplete && <small>分摊不完整</small>}
                      </td>
                      <td className="usage-row-toggle">
                        <button
                          type="button"
                          className="usage-detail-button"
                          aria-expanded={open}
                          aria-controls={detailId}
                          aria-label={`${open ? '收起' : '展开'}记录 ${entry.id}`}
                          onClick={() => {
                            setExpanded(open ? null : entry.id);
                            setCopied(null);
                          }}
                        >
                          <span>详情</span>
                          <CaretDown size={16} aria-hidden />
                        </button>
                      </td>
                    </tr>
                    <UsageDetailRow open={open} id={detailId}>
                      <dl className="usage-detail-grid">
                        <div>
                          <dt>记录时间</dt>
                          <dd>{timeText(entry.createdAt, true)} · 北京时间</dd>
                        </div>
                        <div>
                          <dt>账本状态</dt>
                          <dd>
                            {usageLabels[entry.kind]}
                            {amount === null ? ' · 金额未记录' : ''}
                          </dd>
                        </div>
                        <div>
                          <dt>模型</dt>
                          <dd>
                            {entry.modelId ? (
                              <>
                                <span>
                                  {usageModelName(quotes, entry.modelId, entry.operation)}
                                </span>
                                <code>{entry.modelId}</code>
                              </>
                            ) : (
                              '未记录'
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>用途</dt>
                          <dd>
                            {usageOperationName(entry.operation)}
                            {entry.operation && <code>{entry.operation}</code>}
                          </dd>
                        </div>
                        <div>
                          <dt>空间</dt>
                          <dd>
                            {spaces.find((space) => space.id === entry.spaceId)?.name || '空间'}
                            <code>{entry.spaceId}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>成员</dt>
                          <dd>
                            {actorName(entry)}
                            {entry.actorId && <code>{entry.actorId}</code>}
                          </dd>
                        </div>
                        <div className="usage-detail-wide">
                          <dt>{taskFamily(entry.operation)}</dt>
                          <dd>
                            {entry.jobId ? (
                              <div className="usage-copy-value">
                                <code>{entry.jobId}</code>
                                {onJob && (
                                  <button
                                    className="button button-secondary usage-job-open"
                                    type="button"
                                    onClick={() => onJob(entry)}
                                  >
                                    查看任务调用与费用
                                  </button>
                                )}
                                <button
                                  className="text-button"
                                  type="button"
                                  onClick={() => void copyTask(entry)}
                                  aria-label={`复制${taskFamily(entry.operation)} ID`}
                                >
                                  <Copy size={15} aria-hidden /> 复制 ID
                                </button>
                              </div>
                            ) : (
                              '未关联任务'
                            )}
                            {copied?.id === entry.id && (
                              <span role="status" className="usage-copy-status">
                                {copied.message}
                              </span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>权益来源</dt>
                          <dd>
                            {usageSourceLabels[entry.sourceKind ?? ''] ?? '未记录'}
                            {entry.lotId && <code>{entry.lotId}</code>}
                          </dd>
                        </div>
                        <div>
                          <dt>预占标识</dt>
                          <dd>{entry.holdId ? <code>{entry.holdId}</code> : '未关联预占'}</dd>
                        </div>
                        <div>
                          <dt>流水标识</dt>
                          <dd>
                            <code>{entry.id}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>备注</dt>
                          <dd>{entry.reason || '无'}</dd>
                        </div>
                        <div className="usage-detail-wide">
                          <dt>服务点变动</dt>
                          <dd className="usage-movements">
                            {usageKinds
                              .filter((kind) => entry.movement[kind] !== undefined)
                              .map((kind) => (
                                <span key={kind}>
                                  {usageLabels[kind]}{' '}
                                  <strong>{pointText(entry.movement[kind])}</strong>
                                </span>
                              ))}
                            {!Object.keys(entry.movement).length && '未记录分摊'}
                            {!entry.movementComplete && <small>这条记录的分摊不完整。</small>}
                          </dd>
                        </div>
                      </dl>
                    </UsageDetailRow>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="usage-ledger-empty">
          <Receipt size={30} aria-hidden />
          <h3>这个范围还没有记录</h3>
          <p>试试其他日期或成员范围。</p>
        </div>
      )}
      {error && (
        <p className="usage-page-error" role="alert">
          {error} 已载入的明细仍保留。
        </p>
      )}
      {report.nextCursor && (
        <div className="usage-ledger-footer">
          <button
            className="button button-secondary usage-load-more"
            type="button"
            disabled={more}
            onClick={onMore}
          >
            {more ? <Busy label="读取中" /> : error ? '重试更多明细' : '更多明细'}
          </button>
        </div>
      )}
    </section>
  );
}
