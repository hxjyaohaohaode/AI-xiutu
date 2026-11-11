import { knownNumber, shanghaiDate, type UsageKind, type UsageReport } from './model';

export function usageBucketPosition(bucket: string, range: UsageReport['range']) {
  const first = shanghaiDate(new Date(range.from));
  const last = shanghaiDate(new Date(Date.parse(range.to) - 1));
  const month = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  const day = (value: string) => Date.parse(`${value}T00:00:00Z`) / 86_400_000;
  const index = range.bucket === 'month' ? month : day;
  const count = index(last) - index(first) + 1;
  const ordinal = index(bucket) - index(first);
  return { fraction: (ordinal + 0.5) / count, ordinal, count };
}

/** Real calendar spacing and straight segments keep unknown or absent buckets visible. */
export function usageTrendGeometry(report: Pick<UsageReport, 'series' | 'range'>, kind: UsageKind) {
  const width = 760,
    height = 200,
    top = 12,
    bottom = 184;
  const values = report.series
    .map((row) => ({
      label: row.bucket,
      value: knownNumber(row[kind]),
      ...usageBucketPosition(row.bucket, report.range),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.fraction) && point.ordinal >= 0 && point.ordinal < point.count,
    )
    .sort((left, right) => left.ordinal - right.ordinal);
  const highest = Math.max(0, ...values.map((point) => point.value ?? 0));
  const lowest = Math.min(0, ...values.map((point) => point.value ?? 0));
  const high = highest === 0 && lowest === 0 ? 1 : highest;
  const span = high - lowest;
  const y = (value: number) => top + ((high - value) / span) * (bottom - top);
  const baseline = y(0);
  const points = values.map((point) => ({
    ...point,
    x: point.fraction * width,
    y: point.value === null ? null : y(point.value),
  }));
  const segments: (typeof points)[] = [];
  let current: typeof points = [];
  for (const point of points) {
    if (point.value === null || (current.length && point.ordinal !== current.at(-1)!.ordinal + 1)) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (point.value !== null) current.push(point);
  }
  if (current.length) segments.push(current);
  return {
    width,
    height,
    baseline,
    points,
    ticks: [high, (high + lowest) / 2, lowest].map((value) => ({ value, y: y(value) })),
    paths: segments.map((segment) => ({
      line: `M${segment.map((point) => `${point.x},${point.y}`).join(' L')}`,
      area: `M${segment[0]!.x},${baseline} L${segment.map((point) => `${point.x},${point.y}`).join(' L')} L${segment.at(-1)!.x},${baseline} Z`,
    })),
  };
}

export function nearestUsagePoint(points: readonly { x: number }[], x: number): number {
  if (!points.length) return -1;
  let nearest = 0;
  for (let index = 1; index < points.length; index++)
    if (Math.abs(points[index]!.x - x) < Math.abs(points[nearest]!.x - x)) nearest = index;
  return nearest;
}
