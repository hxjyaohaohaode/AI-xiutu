import { t, useLocale, formatNumber } from '../i18n';
import { useId, useMemo } from 'react';
import { ChartBar, ArrowsSplit } from '@phosphor-icons/react';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { MotionDetails } from '../motion/Presence';
import { usageModelName, type UsageQuote } from './catalog';
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

const compact = (value: number) =>
  formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 });
function bucketPosition(bucket: string, range: UsageReport['range']) {
  const first = shanghaiDate(new Date(range.from));
  const last = shanghaiDate(new Date(Date.parse(range.to) - 1));
  if (range.bucket === 'month') {
    const month = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
    const count = month(last) - month(first) + 1;
    return { fraction: (month(bucket) - month(first) + 0.5) / count, count };
  }
  const start = Date.parse(`${first}T00:00:00Z`);
  const count = (Date.parse(`${last}T00:00:00Z`) - start) / 86_400_000 + 1;
  return {
    fraction: ((Date.parse(`${bucket}T00:00:00Z`) - start) / 86_400_000 + 0.5) / count,
    count,
  };
}
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
  const highest = Math.max(0, ...chart.map((point) => point.value ?? 0));
  const lowest = Math.min(0, ...chart.map((point) => point.value ?? 0));
  const span = highest - lowest || 1;
  const zero = 18 + (highest > 0 || lowest < 0 ? highest / span : 1) * 142;
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
            <svg
              className="usage-trend-svg"
              viewBox="0 0 760 196"
              role="img"
              aria-labelledby={`${id}-chart-title ${id}-chart-description`}
            >
              <title id={`${id}-chart-title`}>
                {t('{v0}趋势，单位为服务点', { v0: t(usageLabels[kind]) })}
              </title>
              <desc id={`${id}-chart-description`}>
                {bucket === 'day'
                  ? t('已记录 {count} 个日期。展开下方表格查看数值。正值向上，负值向下。', {
                      count: chart.length,
                    })
                  : t('已记录 {count} 个月份。展开下方表格查看数值。正值向上，负值向下。', {
                      count: chart.length,
                    })}
              </desc>
              <line x1="48" x2="748" y1="18" y2="18" className="usage-gridline" />
              <line x1="48" x2="748" y1="89" y2="89" className="usage-gridline" />
              <line x1="48" x2="748" y1="160" y2="160" className="usage-gridline" />
              <line x1="48" x2="748" y1={zero} y2={zero} className="usage-zero-line" />
              <text x="38" y="22" textAnchor="end">
                {highest ? compact(highest) : '0'}
              </text>
              {lowest < 0 && (
                <text x="38" y="164" textAnchor="end">
                  {compact(lowest)}
                </text>
              )}
              {highest > 0 && lowest < 0 && (
                <text x="38" y={zero + 4} textAnchor="end">
                  0
                </text>
              )}
              {chart.map((point) => {
                const position = bucketPosition(point.label, report.range);
                if (!Number.isFinite(position.fraction)) return null;
                const width = Math.max(0.7, Math.min(28, (700 / position.count) * 0.64));
                const x = 48 + position.fraction * 700;
                const height = point.value === null ? 0 : (Math.abs(point.value) / span) * 142;
                return (
                  <g key={point.label}>
                    {point.value !== null ? (
                      <rect
                        x={x - width / 2}
                        y={point.value < 0 ? zero : zero - height}
                        width={width}
                        height={height}
                        rx={Math.min(2, width / 2)}
                        className="usage-trend-bar"
                        data-negative={point.value < 0}
                      >
                        <title>
                          {t('{v0}：{v1} 点', { v0: point.label, v1: pointText(point.value) })}
                        </title>
                      </rect>
                    ) : (
                      <circle cx={x} cy={zero} r="3" className="usage-unknown-dot">
                        <title>{t('{v0}：未知', { v0: point.label })}</title>
                      </circle>
                    )}
                  </g>
                );
              })}
              <text x="48" y="188">
                {first.slice(5)}
              </text>
              <text x="748" y="188" textAnchor="end">
                {last.slice(5)}
              </text>
            </svg>
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
            {pointText(allocation.total)}
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
