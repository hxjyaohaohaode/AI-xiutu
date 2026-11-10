import type { UsageResponse } from '@ai-xiutu/contracts';
import { knownNumber } from './model';

export const riverKinds = ['held', 'consumed', 'released', 'expired'] as const;
/** Separate common-scale lanes: these movements overlap and are not a conserved cash flow. */
export function usageRiverLanes(series: UsageResponse['series']) {
  const samples = series.map((row) => ({ row, time: Date.parse(row.bucket) }));
  const dates = samples.flatMap(({ time }) => (Number.isFinite(time) ? [time] : []));
  const first = Math.min(...dates),
    last = Math.max(...dates);
  const amounts = samples.flatMap(({ row }) =>
    riverKinds.flatMap((kind) => {
      const value = knownNumber(row[kind]);
      return value === null ? [] : [value];
    }),
  );
  const negative = amounts.some((value) => value < 0);
  const peak = Math.max(1, ...amounts.map(Math.abs));
  const width = 320,
    height = 88,
    baseline = negative ? 44 : 82;
  const scale = (negative ? 38 : 76) / peak;
  return riverKinds.map((kind) => {
    const points = samples.map(({ row, time }) => ({
      label: row.bucket,
      value: knownNumber(row[kind]),
      y: knownNumber(row[kind]) === null ? null : baseline - row[kind] * scale,
      x: Number.isFinite(time)
        ? first === last
          ? width / 2
          : 6 + ((time - first) * (width - 12)) / (last - first)
        : null,
    }));
    const segments: { x: number; y: number }[][] = [];
    let segment: { x: number; y: number }[] = [];
    for (const point of points) {
      if (point.value === null || point.x === null) {
        if (segment.length) segments.push(segment);
        segment = [];
      } else segment.push({ x: point.x, y: point.y! });
    }
    if (segment.length) segments.push(segment);
    const paths = segments.map((segment) => {
      if (segment.length === 1) {
        const point = segment[0]!;
        return `M${point.x - 2},${baseline} L${point.x - 2},${point.y} L${point.x + 2},${point.y} L${point.x + 2},${baseline} Z`;
      }
      return `M${segment[0]!.x},${baseline} L${segment.map((point) => `${point.x},${point.y}`).join(' L')} L${segment.at(-1)!.x},${baseline} Z`;
    });
    const recorded = points.filter((point) => point.value !== null);
    return {
      kind,
      width,
      height,
      baseline,
      points,
      paths,
      knownTotal: recorded.length ? recorded.reduce((sum, point) => sum + point.value!, 0) : null,
      missing: points.length - recorded.length,
    };
  });
}
