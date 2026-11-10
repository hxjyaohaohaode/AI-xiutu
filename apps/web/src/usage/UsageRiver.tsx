import type { UsageResponse } from '@ai-xiutu/contracts';

const stages = [
  { key: 'held', name: '预占', color: '#57759b' },
  { key: 'consumed', name: '结算', color: '#597044' },
  { key: 'released', name: '释放', color: '#a08039' },
  { key: 'expired', name: '过期', color: '#976c62' },
] as const;

export function UsageRiver({ series }: { series: UsageResponse['series'] }) {
  const [width, height] = [620, 132];
  const points = series.length === 1 ? [series[0]!, series[0]!] : series;
  const total = points.map((point) =>
    stages.reduce((sum, stage) => sum + Math.max(0, point[stage.key]), 0),
  );
  const peak = Math.max(0, ...total);
  if (!peak) return null;
  const bases = points.map((_, index) => (height - (total[index]! / peak) * height) / 2);
  const x = (index: number) => (index * width) / (points.length - 1);
  const paths = stages.map((stage) => {
    const top = points.map((_, index) => `${x(index)},${bases[index]}`);
    const bottom = points.map((point, index) => {
      bases[index]! += (Math.max(0, point[stage.key]) / peak) * height;
      return `${x(index)},${bases[index]}`;
    });
    return `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`;
  });
  return (
    <figure className="usage-job-flow">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="预占、结算、释放和到期的时序河流图"
      >
        {stages.map((stage, index) => (
          <path key={stage.key} d={paths[index]} fill={stage.color}>
            <title>{stage.name}</title>
          </path>
        ))}
      </svg>
      <figcaption>
        {stages.map((stage) => (
          <span key={stage.key}>
            <i style={{ background: stage.color }} />
            {stage.name}
          </span>
        ))}
        <small>按日期呈现各类变动量</small>
      </figcaption>
    </figure>
  );
}
