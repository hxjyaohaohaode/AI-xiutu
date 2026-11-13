import { t, formatNumber } from '../i18n';
import { specialistTaskLabels } from '../ai/SpecialistOptions';
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
import type { StorageAccountSummary, UsageEntry } from '@ai-xiutu/contracts';
export type { UsageEntry, StorageAccountSummary } from '@ai-xiutu/contracts';
export type UsageReport = import('@ai-xiutu/contracts').UsageResponse;
export type UsageFilter = {
  scope: 'personal' | 'space' | 'operator';
  spaceId?: string;
  actorId?: string;
  /** Member filtering is a space-report capability, distinct from the operator actor filter. */
  memberId?: string;
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
  if (filter.memberId && filter.scope === 'space') p.set('memberId', filter.memberId);
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
  const max = Math.max(1, ...report.series.map((row) => Math.abs(knownNumber(row[kind]) ?? 0)));
  return report.series.map((row) => ({
    label: row.bucket,
    value: knownNumber(row[kind]),
    fraction: knownNumber(row[kind]) === null ? null : Math.abs(row[kind]) / max,
  }));
}

export const usageOperationLabels: Record<string, string> = {
  ...specialistTaskLabels,
  'edit-plan': '参数建议',
  'generate-image': '图像生成',
  'generate-text': '文字创作',
  transcribe: '语音转文字',
  'assistant-turn': '智能体对话',
  'realtime-voice': '实时语音',
};
export const usageSourceLabels: Record<string, string> = {
  free: '免费权益',
  gift: '赠送权益',
  purchased: '购买权益',
};
export const usageKindDescriptions: Record<UsageKind, string> = {
  issued: '所选期间发放的服务点',
  held: '所选期间累计预占，不是当前占用余额',
  consumed: '所选期间已结算的消耗',
  released: '所选期间释放的预占，过期部分可能同时计入到期',
  expired: '所选期间到期的服务点',
  adjusted: '所选期间的额度调整，保留正负方向',
};
export const usageOperationName = (operation: string | null | undefined) =>
  operation ? t(usageOperationLabels[operation] ?? operation) : t('未记录用途');
export const knownNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
export const pointText = (value: unknown) =>
  knownNumber(value) === null ? t('未知') : formatNumber(knownNumber(value)!);
export const entryAmount = (entry: UsageEntry) =>
  entry.amountKnown ? knownNumber(entry.units) : null;
export const usageUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const shanghaiDate = (date: Date) =>
  new Date(date.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
export function usageDateError(from: string, to: string): string | null {
  const valid = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const value = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
  };
  if (!valid(from) || !valid(to)) return '请选择有效的开始与结束日期。';
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days <= 0) return '结束日期不能早于开始日期。';
  if (days > 732) return '每次可查询最多 732 天，请缩小日期范围。';
  return null;
}

/** Reject stale/mis-scoped receipts before combining names, balances or private ledger rows. */
export function assertUsageScope(report: UsageReport, filter: UsageFilter): void {
  const expectedActor =
    filter.scope === 'operator'
      ? filter.actorId
      : filter.scope === 'space'
        ? filter.memberId
        : undefined;
  const expected = new URLSearchParams(usageEndpoint(filter).split('?')[1]);
  if (
    !report ||
    report.unit !== 'credit' ||
    report.timezone !== 'Asia/Shanghai' ||
    report.scope !== filter.scope ||
    (report.filterActorId ?? '') !== (expectedActor ?? '') ||
    report.range?.bucket !== filter.bucket ||
    Date.parse(report.range.from) !== Date.parse(expected.get('from')!) ||
    Date.parse(report.range.to) !== Date.parse(expected.get('to')!) ||
    !Array.isArray(report.entries) ||
    !Array.isArray(report.series) ||
    report.entries.some(
      (entry) =>
        (filter.spaceId && entry.spaceId !== filter.spaceId) ||
        (expectedActor && entry.actorId !== expectedActor),
    )
  )
    throw new Error('账本范围与当前筛选不一致，请刷新后重试。');
}

/** Ledger pages share a frozen snapshot; only the complete wallet balance is deliberately live. */
export function appendUsagePage(
  current: UsageReport,
  next: UsageReport,
  cursor: string,
  filter: UsageFilter,
): UsageReport {
  assertUsageScope(current, filter);
  assertUsageScope(next, filter);
  if (next.nextCursor === cursor || current.nextCursor !== cursor)
    throw new Error('账本分页没有继续前进，请刷新后重试。');
  if (
    current.unknownAmountEntries !== next.unknownAmountEntries ||
    usageKinds.some((kind) => current.totals[kind] !== next.totals[kind]) ||
    JSON.stringify(current.series) !== JSON.stringify(next.series)
  )
    throw new Error('账本快照已经变化，请刷新后重新读取。');
  const old = new Map(current.entries.map((entry) => [entry.id, entry]));
  const additions: UsageEntry[] = [];
  for (const entry of next.entries) {
    const duplicate = old.get(entry.id);
    if (duplicate && JSON.stringify(duplicate) !== JSON.stringify(entry))
      throw new Error('同一条账本记录返回了不同内容，请刷新后重试。');
    if (!duplicate) {
      old.set(entry.id, entry);
      additions.push(entry);
    }
  }
  if (!additions.length && next.nextCursor)
    throw new Error('账本分页没有返回新的记录，请刷新后重试。');
  return {
    ...current,
    entries: [...current.entries, ...additions],
    nextCursor: next.nextCursor,
    balance: next.balance,
  };
}

export type UsageAllocation = {
  modelId: string | null;
  operation: string | null;
  units: number;
  records: number;
};
/** One settled row contributes once. Reservations, releases and issuance are not consumption. */
export function usageAllocations(report: UsageReport) {
  const grouped = new Map<string, UsageAllocation>();
  const seen = new Set<string>();
  let total = 0,
    unknown = 0,
    unsupported = 0;
  for (const entry of report.entries) {
    if (entry.kind !== 'consumed' || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const amount = entryAmount(entry);
    if (amount === null) {
      unknown++;
      continue;
    }
    if (amount < 0) {
      unsupported++;
      continue;
    }
    if (!amount) continue;
    const key = JSON.stringify([entry.modelId, entry.operation]);
    const item = grouped.get(key) ?? {
      modelId: entry.modelId,
      operation: entry.operation,
      units: 0,
      records: 0,
    };
    item.units += amount;
    item.records++;
    grouped.set(key, item);
    total += amount;
  }
  return {
    rows: [...grouped.values()].sort(
      (a, b) => b.units - a.units || String(a.modelId).localeCompare(String(b.modelId)),
    ),
    total,
    unknown,
    unsupported,
    complete: !report.nextCursor && !unknown && !unsupported && total === report.totals.consumed,
  };
}

export function storageUsage(storage: StorageAccountSummary) {
  const quantity = (value: unknown) => {
    const number = knownNumber(value);
    return number !== null && number >= 0 ? number : null;
  };
  const retained = quantity(storage.retainedBytes),
    reserved = quantity(storage.reservedMediaBytes);
  const maximum = quantity(storage.maxBytes);
  const used = retained !== null && reserved !== null ? retained + reserved : null;
  return {
    retained,
    reserved,
    maximum,
    used,
    remaining: maximum !== null && used !== null ? Math.max(0, maximum - used) : null,
    overBy: maximum !== null && used !== null ? Math.max(0, used - maximum) : null,
    fraction:
      maximum !== null && used !== null
        ? maximum
          ? Math.min(1, used / maximum)
          : used
            ? 1
            : 0
        : null,
    assets: quantity(storage.retainedAssets),
    maxAssets: quantity(storage.maxAssets),
  };
}
export function byteText(value: number | null) {
  if (value === null) return t('未知');
  if (!value) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const power = Math.min(
    units.length - 1,
    Math.max(0, Math.floor(Math.log(value) / Math.log(1024))),
  );
  return `${formatNumber(value / 1024 ** power, { maximumFractionDigits: power ? 1 : 0 })} ${units[power]}`;
}
