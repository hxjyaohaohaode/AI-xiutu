import { t, formatNumber } from '../i18n';
import type {
  Meter,
  PricingSnapshot,
  ProviderStage,
  PublishedRate,
  UsageJobDetail,
} from '@ai-xiutu/contracts';
import type { UsageEntry } from './model';

export const meterLabels: Record<Meter, string> = {
  input: '输入',
  'cached-input': '缓存输入',
  output: '输出',
  reasoning: '推理输出',
  'text-input': '文本输入',
  'text-cached': '文本缓存',
  'text-output': '文本输出',
  'image-input': '图片输入',
  'image-cached': '图片缓存',
  'image-output': '图片输出',
  'audio-input': '音频输入',
  'audio-cached': '音频缓存',
  'audio-output': '音频输出',
  'web-search': '公开检索',
  'voice-seconds': '通话计费时长',
};
export const stagePurposeLabels: Record<string, string> = {
  conversation: '编辑对话',
  'web-search': '公开检索',
  'research-merge': '合并研究证据',
  'edit-plan': '参数建议',
  'generate-image': '图像生成',
  'live-duration': '实时通话时长',
  'realtime-response': '实时语音回应',
  'voice-delegation': '通话委派',
  'generate-text': '文字创作',
  transcribe: '语音转文字',
};
export const stageStatusLabels: Record<ProviderStage['status'], string> = {
  pending: '等待回执',
  unknown: '待核验',
  received: '已收到回执',
  'no-receipt': '未记录回执',
};
export const holdStatusLabels: Record<string, string> = {
  held: '预占中',
  unknown: '待核验',
  settled: '已结算',
  released: '已释放',
};
export const jobStatusLabels: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  prepared: '已准备',
  connecting: '连接中',
  active: '通话中',
  closing: '正在结束',
  closed: '已结束',
  completed: '已完成',
  succeeded: '已完成',
  failed: '未完成',
  canceled: '已取消',
  cancelled: '已取消',
  unknown: '结果待核验',
};

export type UsageJobReference = Pick<
  UsageEntry,
  'spaceId' | 'actorId' | 'holdId' | 'modelId' | 'operation'
> & { jobId: string };
export type UsageJobTarget = { kind: 'prices' } | { kind: 'job'; reference: UsageJobReference };
export type PublishedPrices = {
  currency: 'USD';
  basis: 'published-estimate';
  prices: PricingSnapshot[];
};

/** Bind details to the exact ledger row that opened them, including operator lookups. */
export function usageJobReference(entry: UsageEntry): UsageJobReference | null {
  return entry.jobId
    ? {
        jobId: entry.jobId,
        spaceId: entry.spaceId,
        actorId: entry.actorId,
        holdId: entry.holdId,
        modelId: entry.modelId,
        operation: entry.operation,
      }
    : null;
}
export function assertUsageJobScope(detail: UsageJobDetail, expected: UsageJobReference): void {
  if (
    !detail ||
    detail.jobId !== expected.jobId ||
    detail.spaceId !== expected.spaceId ||
    (expected.actorId !== null && detail.actorId !== expected.actorId) ||
    (expected.holdId !== null && detail.holdId !== expected.holdId) ||
    (expected.modelId !== null && detail.modelId !== expected.modelId) ||
    (expected.operation !== null && detail.operation !== expected.operation) ||
    !Array.isArray(detail.stages) ||
    !Array.isArray(detail.movements) ||
    new Set(detail.stages.map((stage) => stage.stageId)).size !== detail.stages.length ||
    new Set(detail.movements.map((movement) => movement.id)).size !== detail.movements.length
  )
    throw new Error('任务明细与所选账本记录不一致，请关闭后刷新账本。');
}
export function assertPublishedPrices(value: PublishedPrices): void {
  if (
    !value ||
    value.currency !== 'USD' ||
    value.basis !== 'published-estimate' ||
    !Array.isArray(value.prices)
  )
    throw new Error('模型费率的币种或计价口径无法确认，请重新读取。');
}
export function usageJobEndpoint(target: UsageJobTarget, operator: boolean): string {
  return target.kind === 'prices'
    ? '/usage/model-prices'
    : `${operator ? '/ops' : ''}/usage/jobs/${encodeURIComponent(target.reference.jobId)}`;
}

export const recordedCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
export function nanoAmount(value: unknown): bigint | null {
  return typeof value === 'string' && /^\d{1,40}$/.test(value) ? BigInt(value) : null;
}
/** Keep nano USD exact; neither floating-point rounding nor a missing value becomes $0. */
export function usdText(value: unknown): string {
  const amount = nanoAmount(value);
  if (amount === null) return t('未知');
  const decimal = (amount % 1_000_000_000n).toString().padStart(9, '0').replace(/0+$/, '');
  return `$${amount / 1_000_000_000n}${decimal ? `.${decimal}` : ''}`;
}
export function meterUnit(meter: Meter): string {
  return meter === 'voice-seconds' ? t('秒') : meter === 'web-search' ? t('次') : 'token';
}
/** Normalize tokens to a million only when that conversion stays exact. */
export function publishedRateText(rate: PublishedRate | null | undefined): string {
  const amount = nanoAmount(rate?.nanoUsd);
  const quantity = recordedCount(rate?.quantity);
  if (amount === null || !quantity || !rate || !['token', 'call', 'second'].includes(rate.unit))
    return t('费率未提供');
  if (rate.unit === 'token' && (amount * 1_000_000n) % BigInt(quantity) === 0n)
    return `${usdText(((amount * 1_000_000n) / BigInt(quantity)).toString())} / ${t('百万 token')}`;
  return `${usdText(rate.nanoUsd)} / ${formatNumber(quantity)} ${rate.unit === 'call' ? t('次') : rate.unit === 'second' ? t('秒') : 'token'}`;
}
export function publicPriceSource(source: string): string | undefined {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && url.hostname === 'developers.openai.com'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** Do not add cached/reasoning subset meters to provider token totals a second time. */
export function summarizeProviderStages(stages: readonly ProviderStage[]) {
  const tokenStages = stages.filter((stage) => stage.purpose !== 'live-duration');
  const counted = tokenStages.filter((stage) => recordedCount(stage.totals.total) !== null);
  const total = counted.reduce((sum, stage) => sum + stage.totals.total!, 0);
  const knownTokens = counted.length && Number.isSafeInteger(total) ? total : null;
  const estimates = stages.flatMap((stage) => {
    const amount = nanoAmount(stage.estimatedNanoUsd);
    return amount === null ? [] : [amount];
  });
  return {
    tokenStages: tokenStages.length,
    recordedTokenStages: counted.length,
    missingTokenStages: tokenStages.length - counted.length,
    knownTokens,
    tokenComplete:
      tokenStages.length > 0 &&
      knownTokens !== null &&
      tokenStages.every(
        (stage) =>
          stage.status === 'received' &&
          recordedCount(stage.totals.input) !== null &&
          recordedCount(stage.totals.output) !== null &&
          recordedCount(stage.totals.total) !== null &&
          stage.totals.input! + stage.totals.output! === stage.totals.total,
      ),
    estimatedNanoUsd: estimates.length
      ? estimates.reduce((sum, amount) => sum + amount, 0n).toString()
      : null,
    estimateComplete:
      stages.length > 0 &&
      estimates.length === stages.length &&
      stages.every((stage) => stage.status === 'received' && stage.estimateComplete),
    branches: new Set(stages.flatMap((stage) => (stage.branchId ? [stage.branchId] : []))).size,
  };
}
export function groupProviderStages(stages: readonly ProviderStage[]) {
  const groups = new Map<string | null, ProviderStage[]>();
  for (const stage of stages) {
    const branch = stage.branchId ?? null;
    const existing = groups.get(branch) ?? [];
    existing.push(stage);
    groups.set(branch, existing);
  }
  return [...groups].map(([branchId, rows]) => ({
    branchId,
    stages: rows,
    summary: summarizeProviderStages(rows),
  }));
}
