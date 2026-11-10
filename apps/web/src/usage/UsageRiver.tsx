import { useId, useMemo } from 'react';
import { ChartLineUp } from '@phosphor-icons/react';
import type { UsageResponse } from '@ai-xiutu/contracts';
import { MotionDetails } from '../motion/Presence';
import { pointText, usageLabels } from './model';
import { riverKinds, usageRiverLanes } from './riverModel';

export function UsageRiver({ series }: { series: UsageResponse['series'] }) {
  const id = useId();
  const lanes = useMemo(() => usageRiverLanes(series), [series]);
  if (!series.length) return null;
  return (
    <section className="usage-card usage-river" aria-labelledby={`${id}-title`}>
      <div className="usage-section-heading">
        <div>
          <h2 id={`${id}-title`}>
            <ChartLineUp size={18} aria-hidden /> 预占与结算变化
          </h2>
          <p>独立流水 · 同一数值比例</p>
        </div>
        <span>服务点</span>
      </div>
      <div className="usage-river-lanes">
        {lanes.map((lane) => (
          <figure key={lane.kind} data-kind={lane.kind}>
            <figcaption>
              <span>{usageLabels[lane.kind]}</span>
              <strong>{pointText(lane.knownTotal)}</strong>
            </figcaption>
            <svg
              viewBox={`0 0 ${lane.width} ${lane.height}`}
              role="img"
              aria-label={`${usageLabels[lane.kind]}变化，已记录合计 ${pointText(lane.knownTotal)} 点${lane.missing ? `，${lane.missing} 个日期数值未知` : ''}`}
            >
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
              {lane.points.map((point) =>
                point.x === null ? null : point.value === null ? (
                  <circle
                    key={point.label}
                    cx={point.x}
                    cy={lane.baseline}
                    r="3"
                    className="usage-unknown-dot"
                  >
                    <title>{`${point.label}：未知`}</title>
                  </circle>
                ) : (
                  <g key={point.label}>
                    <title>{`${point.label}：${pointText(point.value)} 点`}</title>
                  </g>
                ),
              )}
            </svg>
            <div className="usage-river-dates">
              <span>{series[0]!.bucket}</span>
              {series.length > 1 && <span>{series.at(-1)!.bucket}</span>}
            </div>
          </figure>
        ))}
      </div>
      <p className="usage-footnote">
        预占、结算、释放与到期分别计量，不能相加作为余额。金额不完整的记录不补零。
      </p>
      <MotionDetails className="usage-small-details">
        <summary>查看各类流水数值</summary>
        <div className="usage-values-scroll" role="region" aria-label="各类流水数值" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">日期</th>
                {riverKinds.map((kind) => (
                  <th key={kind} scope="col">
                    {usageLabels[kind]}
                  </th>
                ))}
                <th scope="col">待核对</th>
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
