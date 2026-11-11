import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { formatNumber, t, useLocale } from '../i18n';
import { pointText, shanghaiDate, usageLabels, type UsageKind, type UsageReport } from './model';
import { nearestUsagePoint, usageTrendGeometry } from './trend-model';
import { usageExperienceCopy } from './experience-copy';

export function UsageTrend({ report, kind }: { report: UsageReport; kind: UsageKind }) {
  const c = usageExperienceCopy(useLocale());
  const id = useId();
  const geometry = useMemo(() => usageTrendGeometry(report, kind), [report, kind]);
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const selected = geometry.points.findIndex((point) => point.label === selectedBucket);
  const index = selected < 0 ? geometry.points.length - 1 : selected;
  const point = geometry.points[index];
  const first = shanghaiDate(new Date(report.range.from));
  const last = shanghaiDate(new Date(Date.parse(report.range.to) - 1));
  if (!point) return null;
  const valueText = t('{v0}：{v1} 点', { v0: point.label, v1: pointText(point.value) });
  const choose = (next: number) =>
    setSelectedBucket(
      geometry.points[Math.max(0, Math.min(geometry.points.length - 1, next))]!.label,
    );
  const inspect = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width > 0)
      choose(
        nearestUsagePoint(
          geometry.points,
          ((event.clientX - bounds.left) / bounds.width) * geometry.width,
        ),
      );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? geometry.points.length - 1
          : ['ArrowRight', 'ArrowUp'].includes(event.key)
            ? index + 1
            : ['ArrowLeft', 'ArrowDown'].includes(event.key)
              ? index - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      choose(next);
    }
  };
  return (
    <div className="usage-trend-interactive">
      <div className="usage-trend-readout">
        <div>
          <span>{point.label}</span>
          <strong>
            {pointText(point.value)}
            <small> {t('点')}</small>
          </strong>
        </div>
        <div className="usage-trend-navigation">
          <span>
            {point.value === null ? c.noValue : selectedBucket === null ? c.latest : c.recorded}
          </span>
          <button
            type="button"
            aria-label={c.previous}
            disabled={index <= 0}
            onClick={() => choose(index - 1)}
          >
            <CaretLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            aria-label={c.next}
            disabled={index >= geometry.points.length - 1}
            onClick={() => choose(index + 1)}
          >
            <CaretRight size={16} aria-hidden />
          </button>
        </div>
      </div>
      <div className="usage-trend-canvas">
        <div className="usage-trend-axis" aria-hidden="true">
          {geometry.ticks.map((tick, tickIndex) => (
            <span key={tickIndex} style={{ top: `${(tick.y / geometry.height) * 100}%` }}>
              {formatNumber(tick.value, { notation: 'compact', maximumFractionDigits: 1 })}
            </span>
          ))}
        </div>
        <div
          className="usage-trend-plot"
          tabIndex={0}
          role="slider"
          aria-label={`${t(usageLabels[kind])} · ${c.inspect}`}
          aria-valuemin={1}
          aria-valuemax={geometry.points.length}
          aria-valuenow={index + 1}
          aria-valuetext={valueText}
          aria-describedby={`${id}-hint`}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            inspect(event);
          }}
          onPointerMove={(event) => {
            if (event.pointerType === 'mouse' || event.buttons !== 0) inspect(event);
          }}
        >
          <svg
            viewBox={`0 0 ${geometry.width} ${geometry.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={`${id}-wash`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity=".13" />
                <stop offset="100%" stopColor="currentColor" stopOpacity=".015" />
              </linearGradient>
            </defs>
            {geometry.ticks.map((tick, tickIndex) => (
              <line
                key={tickIndex}
                x1="0"
                x2={geometry.width}
                y1={tick.y}
                y2={tick.y}
                className="usage-trend-gridline"
              />
            ))}
            <line
              x1="0"
              x2={geometry.width}
              y1={geometry.baseline}
              y2={geometry.baseline}
              className="usage-zero-line"
            />
            {geometry.paths.map((path, pathIndex) => (
              <g key={pathIndex}>
                <path d={path.area} fill={`url(#${id}-wash)`} />
                <path d={path.line} className="usage-trend-line" />
              </g>
            ))}
            {geometry.points.map((sample) => (
              <path
                key={sample.label}
                d={
                  sample.value === null
                    ? `M${sample.x},${geometry.baseline - 3} v6`
                    : `M${sample.x},${sample.y} l0,0`
                }
                className={sample.value === null ? 'usage-unknown-dot' : 'usage-trend-point'}
                data-negative={sample.value !== null && sample.value < 0}
              />
            ))}
            <line x1={point.x} x2={point.x} y1="4" y2="190" className="usage-trend-cursor" />
          </svg>
          <span
            className="usage-trend-selected"
            aria-hidden="true"
            data-unknown={point.value === null}
            style={{
              left: `${(point.x / geometry.width) * 100}%`,
              top: `${((point.y ?? geometry.baseline) / geometry.height) * 100}%`,
            }}
          />
        </div>
      </div>
      <div className="usage-trend-dates" aria-hidden="true">
        <span>{first}</span>
        <span>{last}</span>
      </div>
      <p id={`${id}-hint`} className="usage-trend-hint">
        {c.hint}
      </p>
    </div>
  );
}
