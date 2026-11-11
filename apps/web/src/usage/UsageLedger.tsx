import { t, useLocale, formatNumber, formatDateTime } from '../i18n';
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
const shortTime: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};
const fullTime: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};
function timeText(value: string, full = false) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? formatDateTime(date, full ? fullTime : shortTime)
    : t('时间未记录');
}
function taskFamily(operation: string | null) {
  return operation === 'assistant-turn'
    ? t('对话轮次')
    : operation === 'realtime-voice'
      ? t('语音会话')
      : t('AI 任务');
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
  useLocale();
  const tableId = useId();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; message: string } | null>(null);
  const actorName = (entry: UsageEntry) =>
    !entry.actorId
      ? t('系统')
      : members.find((member) => member.userId === entry.actorId)?.displayName ||
        (entry.actorId === currentUserId
          ? t('我')
          : t('成员 {id}', { id: entry.actorId.slice(0, 8) }));
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
            <Receipt size={18} aria-hidden /> {t('用量明细')}
          </h2>
          <p>
            {t('已载入 {count} 条', { count: formatNumber(report.entries.length) })}
            {report.nextCursor ? t(' · 还有更早记录') : t(' · 已载入全部')}
          </p>
        </div>
        <span className="usage-timezone">{t('北京时间')}</span>
      </div>
      {report.entries.length ? (
        <div className="usage-table-scroll">
          <table className="usage-table">
            <caption className="usage-sr-only">
              {t('用量明细，所选期间的结算流水；展开记录可查看完整任务与账本标识。')}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t('时间 / 成员')}</th>
                <th scope="col">{t('流水 / 用途')}</th>
                <th scope="col">{t('服务点')}</th>
                <th scope="col">
                  <span className="usage-sr-only">{t('记录详情')}</span>
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
                            {t(usageLabels[entry.kind] ?? entry.kind)}
                          </span>
                          <strong>
                            {entry.operation
                              ? usageOperationName(entry.operation)
                              : entry.reason ||
                                t(usageSourceLabels[entry.sourceKind ?? ''] || '额度变动')}
                          </strong>
                        </div>
                        <small>
                          {entry.modelId
                            ? usageModelName(quotes, entry.modelId, entry.operation)
                            : t(usageSourceLabels[entry.sourceKind ?? ''] || '来源未记录')}
                        </small>
                      </td>
                      <td className="usage-row-amount">
                        <strong>
                          {amount !== null && entry.kind === 'adjusted' && amount > 0 ? '+' : ''}
                          {pointText(amount)}
                        </strong>
                        {amount !== null && <span> {t('点')}</span>}
                        {!entry.movementComplete && <small>{t('分摊不完整')}</small>}
                      </td>
                      <td className="usage-row-toggle">
                        <button
                          type="button"
                          className="usage-detail-button"
                          aria-expanded={open}
                          aria-controls={detailId}
                          aria-label={t('{v0}记录 {v1}', {
                            v0: open ? t('收起') : t('展开'),
                            v1: entry.id,
                          })}
                          onClick={() => {
                            setExpanded(open ? null : entry.id);
                            setCopied(null);
                          }}
                        >
                          <span>{t('详情')}</span>
                          <CaretDown size={16} aria-hidden />
                        </button>
                      </td>
                    </tr>
                    <UsageDetailRow open={open} id={detailId}>
                      <dl className="usage-detail-grid">
                        <div>
                          <dt>{t('记录时间')}</dt>
                          <dd>
                            {timeText(entry.createdAt, true)} {t('· 北京时间')}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('账本状态')}</dt>
                          <dd>
                            {t(usageLabels[entry.kind])}
                            {amount === null ? t(' · 金额未记录') : ''}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('模型')}</dt>
                          <dd>
                            {entry.modelId ? (
                              <>
                                <span>
                                  {usageModelName(quotes, entry.modelId, entry.operation)}
                                </span>
                                <code>{entry.modelId}</code>
                              </>
                            ) : (
                              t('未记录')
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('用途')}</dt>
                          <dd>
                            {usageOperationName(entry.operation)}
                            {entry.operation && <code>{entry.operation}</code>}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('空间')}</dt>
                          <dd>
                            {spaces.find((space) => space.id === entry.spaceId)?.name || t('空间')}
                            <code>{entry.spaceId}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>{t('成员')}</dt>
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
                                    {t('查看任务调用与费用')}
                                  </button>
                                )}
                                <button
                                  className="text-button"
                                  type="button"
                                  onClick={() => void copyTask(entry)}
                                  aria-label={t('复制{v0} ID', { v0: taskFamily(entry.operation) })}
                                >
                                  <Copy size={15} aria-hidden /> {t('复制 ID')}
                                </button>
                              </div>
                            ) : (
                              t('未关联任务')
                            )}
                            {copied?.id === entry.id && (
                              <span role="status" className="usage-copy-status">
                                {t(copied.message)}
                              </span>
                            )}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('权益来源')}</dt>
                          <dd>
                            {t(usageSourceLabels[entry.sourceKind ?? ''] ?? '未记录')}
                            {entry.lotId && <code>{entry.lotId}</code>}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('预占标识')}</dt>
                          <dd>{entry.holdId ? <code>{entry.holdId}</code> : t('未关联预占')}</dd>
                        </div>
                        <div>
                          <dt>{t('流水标识')}</dt>
                          <dd>
                            <code>{entry.id}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>{t('备注')}</dt>
                          <dd>{entry.reason || t('无')}</dd>
                        </div>
                        <div className="usage-detail-wide">
                          <dt>{t('服务点变动')}</dt>
                          <dd className="usage-movements">
                            {usageKinds
                              .filter((kind) => entry.movement[kind] !== undefined)
                              .map((kind) => (
                                <span key={kind}>
                                  {t(usageLabels[kind])}{' '}
                                  <strong>{pointText(entry.movement[kind])}</strong>
                                </span>
                              ))}
                            {!Object.keys(entry.movement).length && t('未记录分摊')}
                            {!entry.movementComplete && (
                              <small>{t('这条记录的分摊不完整。')}</small>
                            )}
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
          <h3>{t('这个范围还没有记录')}</h3>
          <p>{t('试试其他日期或成员范围。')}</p>
        </div>
      )}
      {error && (
        <p className="usage-page-error" role="alert">
          {t(error)} {t('已载入的明细仍保留。')}
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
            {more ? <Busy label={t('读取中')} /> : error ? t('重试更多明细') : t('更多明细')}
          </button>
        </div>
      )}
    </section>
  );
}
