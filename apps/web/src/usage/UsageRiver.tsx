import { t, useLocale } from '../i18n';
import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChartLineUp } from '@phosphor-icons/react';
import type { UsageResponse } from '@ai-xiutu/contracts';
import { MotionDetails } from '../motion/Presence';
import { pointText, shanghaiDate, usageLabels } from './model';
import { riverKinds, usageRiverLanes } from './riverModel';
import { UsageNumber } from './UsageNumber';
import { usageExperienceCopy } from './experience-copy';
import { nearestUsagePoint } from './trend-model';

export function UsageRiver({
  series,
  range,
}: {
  series: UsageResponse['series'];
  range?: UsageResponse['range'];
}) {
  const c = usageExperienceCopy(useLocale());
  const id = useId();
  const lanes = useMemo(() => usageRiverLanes(series, range), [series, range]);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const points = lanes[0]!.points.filter((point) => point.x !== null);
  const selected = points.findIndex((point) => point.label === selectedBucket);
  const index = selected < 0 ? points.length - 1 : selected;
  const point = points[index];
  if (!point) return null;
  const first = range
    ? shanghaiDate(new Date(range.from)).slice(0, range.bucket === 'month' ? 7 : 10)
    : points[0]!.label;
  const last = range
    ? shanghaiDate(new Date(Date.parse(range.to) - 1)).slice(0, range.bucket === 'month' ? 7 : 10)
    : points.at(-1)!.label;
  const choose = (next: number) =>
    setSelectedBucket(points[Math.max(0, Math.min(points.length - 1, next))]!.label);
  const inspect = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width > 0)
      choose(
        nearestUsagePoint(
          points.map((point) => ({ x: point.x! })),
          ((event.clientX - bounds.left) / bounds.width) * lanes[0]!.width,
        ),
      );
  };
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? points.length - 1
          : ['ArrowRight', 'ArrowUp'].includes(event.key)
            ? index + 1
            : ['ArrowLeft', 'ArrowDown'].includes(event.key)
              ? index - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      choose(next);
    }
    if (event.key === 'Escape') setSelectedBucket(null);
  };
  return (
    <section className="usage-card usage-river" aria-labelledby={`${id}-title`}>
      <div className="usage-section-heading">
        <div>
          <h2 id={`${id}-title`}>
            <ChartLineUp size={18} aria-hidden /> {t('预占与结算变化')}
          </h2>
          <p>{t('独立流水 · 同一数值比例')}</p>
        </div>
        <span>{t('服务点')}</span>
      </div>
      <div className="usage-river-inspection">
        <span>
          {c.selectedDate} <strong>{point.label}</strong>
        </span>
        <button
          type="button"
          className="text-button"
          disabled={index === points.length - 1}
          onClick={() => setSelectedBucket(null)}
        >
          {c.returnLatest}
        </button>
      </div>
      <div className="usage-river-lanes">
        {lanes.map((lane) => {
          const reading = lane.points.find((sample) => sample.label === point.label)!;
          return (
            <figure
              key={lane.kind}
              data-kind={lane.kind}
              aria-label={t('{v0}变化，已记录合计 {v1} 点{v2}', {
                v0: t(usageLabels[lane.kind]),
                v1: pointText(lane.knownTotal),
                v2: lane.missing ? t('，{v0} 个日期数值未知', { v0: lane.missing }) : '',
              })}
            >
              <figcaption>
                <span>{t(usageLabels[lane.kind])}</span>
                <strong>
                  <UsageNumber value={lane.knownTotal} />
                </strong>
                <small>{lane.missing ? c.incomplete : c.knownTotal}</small>
              </figcaption>
              <div
                className="usage-river-plot"
                tabIndex={0}
                role="slider"
                aria-label={`${t(usageLabels[lane.kind])} · ${c.selectedDate}`}
                aria-valuemin={1}
                aria-valuemax={points.length}
                aria-valuenow={index + 1}
                aria-valuetext={t('{v0}：{v1} 点', {
                  v0: point.label,
                  v1: pointText(reading.value),
                })}
                onKeyDown={navigate}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  inspect(event);
                }}
                onPointerMove={(event) => {
                  if (event.pointerType === 'mouse' || event.buttons !== 0) inspect(event);
                }}
              >
                <svg viewBox={`0 0 ${lane.width} ${lane.height}`} aria-hidden="true">
                  <line
                    x1="0"
                    x2={lane.width}
                    y1={lane.baseline}
                    y2={lane.baseline}
                    className="usage-river-baseline"
                  />
                  {lane.paths.map((path, index) => (
                    <path key={index} d={path} className="usage-river-area" />
                  ))}
                  <line
                    x1={reading.x!}
                    x2={reading.x!}
                    y1="2"
                    y2={lane.height - 2}
                    className="usage-trend-cursor"
                  />
                  <circle
                    cx={reading.x!}
                    cy={reading.y ?? lane.baseline}
                    r="3"
                    className="usage-river-selection"
                    data-unknown={reading.value === null}
                  />
                  {lane.points.map((point) =>
                    point.x === null ? null : point.value === null ? (
                      <circle
                        key={point.label}
                        cx={point.x}
                        cy={lane.baseline}
                        r="3"
                        className="usage-unknown-dot"
                      >
                        <title>{t('{v0}：未知', { v0: point.label })}</title>
                      </circle>
                    ) : (
                      <g key={point.label}>
                        <title>
                          {t('{v0}：{v1} 点', { v0: point.label, v1: pointText(point.value) })}
                        </title>
                      </g>
                    ),
                  )}
                </svg>
              </div>
              <div className="usage-river-reading">
                <span>{t(usageLabels[lane.kind])}</span>
                <strong>
                  {pointText(reading.value)} <small>{t('点')}</small>
                </strong>
              </div>
              <div className="usage-river-dates">
                <span>{first}</span>
                {first !== last && <span>{last}</span>}
              </div>
            </figure>
          );
        })}
      </div>
      <p className="usage-footnote">
        {t('预占、结算、释放与到期分别计量，不能相加作为余额。金额不完整的记录不补零。')}
      </p>
      <MotionDetails className="usage-small-details">
        <summary>{t('查看各类流水数值')}</summary>
        <div
          className="usage-values-scroll"
          role="region"
          aria-label={t('各类流水数值')}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{t('日期')}</th>
                {riverKinds.map((kind) => (
                  <th key={kind} scope="col">
                    {t(usageLabels[kind])}
                  </th>
                ))}
                <th scope="col">{t('待核对')}</th>
              </tr>
            </thead>
            <tbody>
              {series.map((row) => (
                <tr key={row.bucket}>
                  <th scope="row">{row.bucket}</th>
                  {riverKinds.map((kind) => (
                    <td key={kind}>{pointText(row[kind])}</td>
                  ))}
                  <td>{pointText(row.unknownAmountEntries)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </MotionDetails>
    </section>
  );
}
