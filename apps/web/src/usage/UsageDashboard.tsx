import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, DownloadSimple, ChartBar } from '@phosphor-icons/react';
import { api, downloadBlob, errorMessage, formatDate } from '../lib/api';
import type { Space } from '../lib/types';
import { Busy, EmptyState, InlineError } from '../components/Ui';
import {
  usageChartValues,
  usageEndpoint,
  usageKinds,
  usageLabels,
  type UsageFilter,
  type UsageKind,
  type UsageReport,
} from './model';
import { collectUsageCsv } from './export';
import { UsageJob } from './UsageJob';
import { UsageRiver } from './UsageRiver';
import './usage.css';

function shanghaiDate(date: Date) {
  return new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}
export function UsageDashboard({
  space,
  operator = false,
  refreshToken = 0,
}: {
  space?: Space | null;
  operator?: boolean;
  refreshToken?: number;
}) {
  const [scope, setScope] = useState<UsageFilter['scope']>(
    operator ? 'operator' : space?.kind === 'team' ? 'space' : 'personal',
  );
  const [from, setFrom] = useState(() => shanghaiDate(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(() => shanghaiDate(new Date()));
  const [bucket, setBucket] = useState<'day' | 'month'>('day');
  const [spaceFilter, setSpaceFilter] = useState(''),
    [actorFilter, setActorFilter] = useState('');
  const [filter, setFilter] = useState({ spaceId: '', actorId: '' });
  const [kind, setKind] = useState<UsageKind>('consumed');
  const [jobDetail, setJobDetail] = useState<string | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null),
    [busy, setBusy] = useState(false),
    [more, setMore] = useState(false),
    [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0);
  const generation = useRef(0),
    moreLock = useRef(false);
  const exportController = useRef<AbortController | null>(null);
  useEffect(() => () => exportController.current?.abort(), []);
  const query = useMemo<UsageFilter>(
    () => ({
      scope: operator ? 'operator' : scope,
      spaceId: operator ? filter.spaceId : space?.id,
      actorId: operator ? filter.actorId : undefined,
      from,
      to,
      bucket,
    }),
    [scope, operator, space?.id, filter, from, to, bucket],
  );
  const validDates = !!from && !!to && from <= to;
  const endpoint = validDates ? usageEndpoint(query) : null;
  useEffect(() => {
    const id = ++generation.current,
      controller = new AbortController();
    setReport(null);
    setError(null);
    setMore(false);
    moreLock.current = false;
    if (!endpoint) {
      setBusy(false);
      return;
    }
    setBusy(true);
    api<UsageReport>(endpoint, { signal: controller.signal })
      .then((value) => {
        if (id === generation.current) setReport(value);
      })
      .catch((e) => {
        if (id === generation.current && e.name !== 'AbortError') setError(errorMessage(e));
      })
      .finally(() => {
        if (id === generation.current) setBusy(false);
      });
    return () => controller.abort();
  }, [endpoint, refresh, refreshToken]);
  async function loadMore() {
    if (!report?.nextCursor || moreLock.current) return;
    const id = generation.current;
    moreLock.current = true;
    setMore(true);
    setError(null);
    try {
      const result = await api<UsageReport>(usageEndpoint(query, report.nextCursor));
      if (id === generation.current)
        setReport((old) =>
          old
            ? {
                ...old,
                entries: [
                  ...old.entries,
                  ...result.entries.filter(
                    (entry) => !old.entries.some((item) => item.id === entry.id),
                  ),
                ],
                nextCursor: result.nextCursor,
              }
            : result,
        );
    } catch (e) {
      if (id === generation.current) setError(errorMessage(e));
    } finally {
      if (id === generation.current) {
        setMore(false);
        moreLock.current = false;
      }
    }
  }
  async function exportCsv() {
    if (exporting || !endpoint) return;
    setExporting(true);
    setError(null);
    const controller = new AbortController();
    exportController.current = controller;
    try {
      const blob = await collectUsageCsv(query, fetch, controller.signal);
      downloadBlob(blob, `usage-${from}-${to}.csv`);
    } catch (e) {
      if (!controller.signal.aborted) setError(errorMessage(e));
    } finally {
      if (exportController.current === controller) exportController.current = null;
      setExporting(false);
    }
  }
  const chart = report ? usageChartValues(report, kind) : [];
  return (
    <section className="usage-dashboard" aria-label="用量与额度历史">
      <header className="view-heading" data-motion="usage-heading">
        <div>
          <h1>用量与额度</h1>
          <p>
            {operator
              ? '按实际账本查看各空间与成员的使用记录。'
              : '每一次预占、消耗和释放都有来处。服务点不是现金余额。'}
          </p>
        </div>
        <div className="view-actions">
          <button className="text-button" onClick={() => setRefresh((n) => n + 1)} disabled={busy}>
            <ArrowClockwise size={17} />
            刷新
          </button>
          <button
            className="button button-secondary"
            onClick={() => void exportCsv()}
            disabled={!report || exporting}
          >
            {exporting ? (
              <Busy label="导出中" />
            ) : (
              <>
                <DownloadSimple size={17} />
                导出CSV
              </>
            )}
          </button>
        </div>
      </header>
      <div className="usage-filters" data-motion="usage-filters">
        {!operator && (
          <label>
            范围
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as UsageFilter['scope'])}
            >
              <option value="personal">我的个人用量</option>
              {space && <option value="space">{space.name} · 空间用量</option>}
            </select>
          </label>
        )}
        <label>
          开始日期
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          结束日期
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label>
          趋势粒度
          <select value={bucket} onChange={(e) => setBucket(e.target.value as 'day' | 'month')}>
            <option value="day">按日</option>
            <option value="month">按月</option>
          </select>
        </label>
        {operator && (
          <form
            className="usage-operator-filter"
            onSubmit={(e) => {
              e.preventDefault();
              setFilter({ spaceId: spaceFilter.trim(), actorId: actorFilter.trim() });
            }}
          >
            <label>
              空间ID
              <input
                value={spaceFilter}
                maxLength={80}
                onChange={(e) => setSpaceFilter(e.target.value)}
                placeholder="全部空间"
              />
            </label>
            <label>
              成员ID
              <input
                value={actorFilter}
                maxLength={80}
                onChange={(e) => setActorFilter(e.target.value)}
                placeholder="全部成员"
              />
            </label>
            <button className="button button-secondary">筛选</button>
          </form>
        )}
      </div>
      {!validDates && <InlineError message="请选择有效的起止日期。" />}
      <InlineError message={error} />
      {busy && <Busy label="正在核对用量账本" />}
      {report && (
        <>
          <div className="usage-totals" data-motion="usage-totals">
            {usageKinds.map((key) => (
              <button
                type="button"
                key={key}
                aria-pressed={kind === key}
                onClick={() => setKind(key)}
              >
                <span>{usageLabels[key]}</span>
                <strong>
                  {report.totals[key] === null
                    ? '未记录'
                    : report.totals[key].toLocaleString('zh-CN')}
                </strong>
                <small>{key === 'held' ? '累计预占点' : '服务点变动'}</small>
              </button>
            ))}
          </div>
          <section
            className="usage-chart"
            data-motion="usage-chart"
            aria-label={`${usageLabels[kind]}趋势，${report.timezone}`}
          >
            <div className="section-heading">
              <h2>{usageLabels[kind]}趋势</h2>
              <span>{report.timezone}</span>
            </div>
            {chart.length ? (
              <div
                className="usage-bars"
                role="img"
                aria-label={chart
                  .map((point) => `${point.label}：${point.value ?? '未记录'}`)
                  .join('；')}
              >
                {chart.map((point, i) => (
                  <div className="usage-bar-column" key={point.label}>
                    <span className="usage-bar-value">
                      {point.value === null ? '—' : point.value}
                    </span>
                    <div className="usage-bar-track">
                      <i
                        style={{ height: `${(point.fraction ?? 0) * 100}%` }}
                        title={`${point.label}：${point.value ?? '未记录'}`}
                        data-negative={point.value !== null && point.value < 0 ? 'true' : undefined}
                      />
                    </div>
                    <span className="usage-bar-label">
                      {chart.length < 13 ||
                      i === 0 ||
                      i === chart.length - 1 ||
                      i % Math.ceil(chart.length / 8) === 0
                        ? point.label.slice(bucket === 'day' ? 5 : 0)
                        : ''}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<ChartBar size={24} />}
                title="所选日期没有汇总记录"
                description="没有数据时不补造消耗或发放曲线。"
              />
            )}
          </section>
          <UsageRiver series={report.series} />
          <p className="control-note">
            上方为所选日期内的账本变动，预占为累计发起量，不是当前冻结余额；各项不能相加当余额。当前钱包：可用{' '}
            {report.balance.available.toLocaleString('zh-CN')} 点，预占{' '}
            {report.balance.held.toLocaleString('zh-CN')} 点。
          </p>
          {report.unknownAmountEntries > 0 && (
            <p className="control-note" role="status">
              其中 {report.unknownAmountEntries}{' '}
              条旧记录没有完整的金额或到期分摊；汇总仅包含能够确认的数值，未知值未当作 0。
            </p>
          )}
          <button className="text-button" onClick={() => setJobDetail('prices')}>查看模型公开费率</button>
          <div
            className="usage-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="用量明细，可横向滚动"
            data-motion="usage-ledger"
          >
            <table className="usage-table">
              <caption>用量明细 · 当前已加载 {report.entries.length} 条</caption>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>服务点</th>
                  <th>模型 / 操作</th>
                  <th>空间 / 成员</th>
                  <th>来源与备注</th>
                </tr>
              </thead>
              <tbody>
                {report.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                    </td>
                    <td>{usageLabels[entry.kind as UsageKind] ?? entry.kind}</td>
                    <td className="usage-number">
                      {!entry.amountKnown || entry.units === null
                        ? '未记录'
                        : entry.units.toLocaleString('zh-CN')}
                      {!entry.movementComplete && <small>分摊明细不完整</small>}
                    </td>
                    <td>
                      {entry.modelId || '—'}
                      <small>{entry.operation ?? ''}</small>
                    </td>
                    <td>
                      <span title={entry.spaceId}>{entry.spaceId.slice(0, 8)}</span>
                      <small title={entry.actorId ?? ''}>
                        {entry.actorId?.slice(0, 8) ?? '系统'}
                      </small>
                    </td>
                    <td>
                      {entry.reason || entry.sourceKind || '—'}
                      {entry.jobId && (
                        <small><button className="text-button" title={entry.jobId} onClick={() => setJobDetail(entry.jobId)}>任务 {entry.jobId.slice(0, 8)}</button></small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!report.entries.length && <p className="quiet-copy">这个范围没有明细记录。</p>}
          </div>
          {report.nextCursor && (
            <button
              className="button button-secondary usage-load-more"
              disabled={more}
              onClick={() => void loadMore()}
            >
              {more ? <Busy label="读取中" /> : '更多明细'}
            </button>
          )}
        </>
      )}
      {jobDetail && <UsageJob key={jobDetail} id={jobDetail} operator={operator} onClose={() => setJobDetail(null)} />}
    </section>
  );
}
