export const usageKinds = [
  'issued',
  'held',
  'consumed',
  'released',
  'expired',
  'adjusted',
] as const;
export type UsageKind = (typeof usageKinds)[number];
export type UsageValues = Record<UsageKind, number | null>;
export const usageLabels: Record<UsageKind, string> = {
  issued: '发放',
  held: '预占',
  consumed: '已消耗',
  released: '已释放',
  expired: '已到期',
  adjusted: '运营调整',
};
export type { UsageEntry } from '@ai-xiutu/contracts';
export type UsageReport = import('@ai-xiutu/contracts').UsageResponse;
export type UsageFilter = {
  scope: 'personal' | 'space' | 'operator';
  spaceId?: string;
  actorId?: string;
  from: string;
  to: string;
  bucket: 'day' | 'month';
};
export function usageEndpoint(
  filter: UsageFilter,
  cursor?: string,
  format: 'json' | 'csv' = 'json',
) {
  const p = new URLSearchParams({ bucket: filter.bucket, limit: '50', format });
  if (filter.scope !== 'operator') p.set('scope', filter.scope);
  if (filter.spaceId && filter.scope !== 'personal') p.set('spaceId', filter.spaceId);
  if (filter.actorId && filter.scope === 'operator') p.set('actorId', filter.actorId);
  if (filter.from) p.set('from', new Date(`${filter.from}T00:00:00+08:00`).toISOString());
  // End date is inclusive in the UI; the API's to bound is exclusive.
  if (filter.to)
    p.set(
      'to',
      new Date(new Date(`${filter.to}T00:00:00+08:00`).getTime() + 86_400_000).toISOString(),
    );
  if (cursor) p.set('cursor', cursor);
  return (filter.scope === 'operator' ? '/ops/usage' : '/usage') + '?' + p;
}
export function usageChartValues(report: UsageReport, kind: UsageKind) {
  const max = Math.max(1, ...report.series.map((row) => Math.abs(row[kind] ?? 0)));
  return report.series.map((row) => ({
    label: row.bucket,
    value: row[kind],
    fraction: row[kind] === null ? null : Math.abs(row[kind]) / max,
  }));
}
