import { t, useLocale } from '../i18n';
import { useId, useMemo } from 'react';
import { ChartBar, ArrowsSplit } from '@phosphor-icons/react';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { MotionDetails } from '../motion/Presence';
import { usageModelName, type UsageQuote } from './catalog';
import { UsageTrend } from './UsageTrend';
import { UsageNumber } from './UsageNumber';
import {
  knownNumber,
  pointText,
  shanghaiDate,
  usageAllocations,
  usageChartValues,
  usageLabels,
  usageOperationName,
  type UsageKind,
  type UsageReport,
} from './model';

export function UsageInsights({
  report,
  kind,
  quotes,
  bucket,
  onBucket,
}: {
  report: UsageReport;
  kind: UsageKind;
  quotes: UsageQuote[];
  bucket: 'day' | 'month';
  onBucket: (value: 'day' | 'month') => void;
}) {
  useLocale();
  const id = useId();
  const chart = useMemo(() => usageChartValues(report, kind), [report, kind]);
  const allocation = useMemo(() => usageAllocations(report), [report]);
  const first = shanghaiDate(new Date(report.range.from));
  const last = shanghaiDate(new Date(Date.parse(report.range.to) - 1));
  return (
    <div className="usage-insights">
      <section
        className="usage-card usage-chart"
        aria-labelledby={`${id}-trend`}
        data-motion="usage-chart"
      >
        <div className="usage-section-heading">
          <div>
            <h2 id={`${id}-trend`}>
              <ChartBar size={18} aria-hidden /> {t('{kind}趋势', { kind: t(usageLabels[kind]) })}
            </h2>
            <p>
              {first} — {last}
            </p>
          </div>
          <ChoiceSelect<'day' | 'month'>
            className="usage-bucket"
            ariaLabel={t('趋势粒度')}
            value={bucket}
            onValueChange={onBucket}
            options={[
              { value: 'day', label: t('按日') },
              { value: 'month', label: t('按月') },
            ]}
          />
        </div>
        {chart.length ? (
          <>
            <UsageTrend report={report} kind={kind} />
            <MotionDetails className="usage-small-details usage-trend-values">
              <summary>{t('查看趋势数值')}</summary>
              <div className="usage-values-scroll">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">{bucket === 'day' ? t('日期') : t('月份')}</th>
                      <th scope="col">
                        {t(usageLabels[kind])} {t('/ 点')}
                      </th>
                      <th scope="col">{t('待核对记录')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.series.map((row) => (
                      <tr key={row.bucket}>
                        <td>{row.bucket}</td>
                        <td>{pointText(row[kind])}</td>
                        <td>{pointText(knownNumber(row.unknownAmountEntries))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </MotionDetails>
          </>
        ) : (
          <div className="usage-chart-empty">
            <ChartBar size={28} aria-hidden />
            <p>{t('这个期间没有{kind}记录', { kind: t(usageLabels[kind]) })}</p>
          </div>
        )}
      </section>
      <section className="usage-card usage-distribution" aria-labelledby={`${id}-distribution`}>
        <div className="usage-section-heading">
          <div>
            <h2 id={`${id}-distribution`}>
              <ArrowsSplit size={18} aria-hidden /> {t('消耗去向')}
            </h2>
            <p>
              {allocation.complete
                ? t('本期完整明细')
                : t('基于已载入的 {v0} 条明细', { v0: report.entries.length })}
            </p>
          </div>
          <strong className="usage-distribution-total">
            <UsageNumber value={allocation.total} />
            <small> {t('点')}</small>
          </strong>
        </div>
        {allocation.rows.length ? (
          <>
            <ol className="usage-distribution-list">
              {allocation.rows.slice(0, 5).map((row) => (
                <li key={JSON.stringify([row.modelId, row.operation])}>
                  <div>
                    <strong title={row.modelId ?? undefined}>
                      {usageModelName(quotes, row.modelId, row.operation)}
                    </strong>
                    <span>
                      {pointText(row.units)} {t('点')}
                    </span>
                  </div>
                  <small>{usageOperationName(row.operation)}</small>
                  <svg viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true">
                    <rect
                      x="0"
                      y="0"
                      width="100"
                      height="4"
                      rx="2"
                      className="usage-distribution-track"
                    />
                    <rect
                      x="0"
                      y="0"
                      width={(row.units / allocation.total) * 100}
                      height="4"
                      rx="2"
                      className="usage-distribution-value"
                    />
                  </svg>
                </li>
              ))}
            </ol>
            {allocation.rows.length > 5 && (
              <MotionDetails className="usage-small-details">
                <summary>{t('查看全部 {count} 项分配', { count: allocation.rows.length })}</summary>
                <ul className="usage-allocation-list">
                  {allocation.rows.map((row) => (
                    <li key={JSON.stringify([row.modelId, row.operation])}>
                      <span>
                        {usageModelName(quotes, row.modelId, row.operation)} ·{' '}
                        {usageOperationName(row.operation)}
                      </span>
                      <strong>
                        {pointText(row.units)} {t('点')}
                      </strong>
                    </li>
                  ))}
                </ul>
              </MotionDetails>
            )}
          </>
        ) : (
          <div className="usage-chart-empty">
            <ArrowsSplit size={28} aria-hidden />
            <p>{t('已载入明细中暂无可归属的消耗')}</p>
          </div>
        )}
        {report.nextCursor && (
          <p className="usage-footnote">{t('继续加载明细可补全分布；这里只计入已结算消耗。')}</p>
        )}
        {(allocation.unknown > 0 || allocation.unsupported > 0) && (
          <p className="usage-footnote">
            {t('{count} 条消耗尚不能归入数值分布。', {
              count: allocation.unknown + allocation.unsupported,
            })}
          </p>
        )}
        {!report.nextCursor &&
          !allocation.complete &&
          !allocation.unknown &&
          !allocation.unsupported && (
            <p className="usage-footnote">{t('明细合计与本期汇总尚未对齐，请刷新账本后核对。')}</p>
          )}
      </section>
    </div>
  );
}
