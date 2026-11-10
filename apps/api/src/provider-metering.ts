import type { BilledMeter, Meter, PricingSnapshot, ProviderStage } from '@ai-xiutu/contracts';

const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000
    ? value
    : null;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
type Format = 'responses' | 'image' | 'realtime' | 'duration';
type StageInfo = Omit<ProviderStage, 'totals' | 'meters' | 'estimatedNanoUsd' | 'estimateComplete'>;

export function meterStage(
  stage: StageInfo,
  receipt: unknown,
  format: Format,
  toolCalls: number | null = null,
): ProviderStage {
  const usage = record(receipt);
  const totals = {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    total: count(usage.total_tokens),
  };
  const input = record(usage.input_tokens_details ?? usage.input_token_details);
  const output = record(usage.output_tokens_details ?? usage.output_token_details);
  const meters: BilledMeter[] = [];
  let full = stage.status === 'received' && !!stage.pricing;
  function add(meter: Meter, quantity: number | null) {
    if (quantity === null) {
      full = false;
      return;
    }
    if (quantity === 0) return;
    const rate = stage.pricing?.meters[meter] ?? null;
    if (
      !rate ||
      !/^\d{1,16}$/.test(rate.nanoUsd) ||
      !Number.isSafeInteger(rate.quantity) ||
      rate.quantity <= 0
    ) {
      meters.push({ meter, quantity, rate: null, estimatedNanoUsd: null });
      full = false;
      return;
    }
    const divisor = BigInt(rate.quantity);
    const estimate = (BigInt(rate.nanoUsd) * BigInt(quantity) + divisor / 2n) / divisor;
    meters.push({ meter, quantity, rate, estimatedNanoUsd: estimate.toString() });
  }
  const mismatch = (total: number | null, parts: (number | null)[]) =>
    total === null ||
    parts.some((part) => part === null) ||
    parts.reduce<number>((sum, part) => sum + (part ?? 0), 0) !== total;
  if (format === 'duration') add('voice-seconds', count(usage.seconds));
  else {
    if (mismatch(totals.total, [totals.input, totals.output])) full = false;
    if (format === 'responses') {
      const cached = count(input.cached_tokens);
      const reasoning = count(output.reasoning_tokens) ?? 0;
      if (
        totals.input === 0 ||
        (totals.input !== null && cached !== null && cached <= totals.input)
      ) {
        add('input', (totals.input ?? 0) - (cached ?? 0));
        add('cached-input', cached ?? 0);
      } else {
        if (totals.input !== null)
          meters.push({
            meter: 'input',
            quantity: totals.input,
            rate: null,
            estimatedNanoUsd: null,
          });
        full = false;
      }
      if (totals.output !== null && reasoning <= totals.output) {
        add('output', totals.output - reasoning);
        add('reasoning', reasoning);
      } else full = false;
      if (stage.purpose === 'web-search') add('web-search', toolCalls);
    } else {
      const modalities =
        format === 'image' ? (['text', 'image'] as const) : (['text', 'audio', 'image'] as const);
      const cache = record(input.cached_tokens_details);
      const cachedTotal = count(input.cached_tokens);
      const modalityTokens = modalities.map(
        (kind) => count(input[`${kind}_tokens`]) ?? (totals.input === 0 ? 0 : null),
      );
      const cachedTokens = modalities.map(
        (kind, index) =>
          count(cache[`${kind}_tokens`]) ??
          (cachedTotal === 0 || modalityTokens[index] === 0 ? 0 : null),
      );
      if (
        mismatch(totals.input, modalityTokens) ||
        (totals.input !== 0 && mismatch(cachedTotal, cachedTokens))
      )
        full = false;
      for (const [index, kind] of modalities.entries()) {
        const tokens = modalityTokens[index] ?? null,
          cached = cachedTokens[index] ?? null;
        if (tokens !== null && cached !== null && cached <= tokens) {
          add(`${kind}-input`, tokens - cached);
          add(`${kind}-cached`, cached);
        } else if (tokens !== null && tokens > 0) {
          meters.push({
            meter: `${kind}-input`,
            quantity: tokens,
            rate: null,
            estimatedNanoUsd: null,
          });
          full = false;
        }
      }
      const outputTokens = modalities.map(
        (kind) =>
          count(output[`${kind}_tokens`]) ??
          (format === 'image' && !Object.keys(output).length
            ? kind === 'image'
              ? totals.output
              : 0
            : null),
      );
      if (mismatch(totals.output, outputTokens)) full = false;
      for (const [index, kind] of modalities.entries()) {
        const tokens = outputTokens[index] ?? null;
        if (tokens !== null && tokens > 0) add(`${kind}-output`, tokens);
      }
    }
  }
  const estimated = meters.filter((meter) => meter.estimatedNanoUsd !== null);
  const estimatedNanoUsd =
    full || estimated.length
      ? estimated.reduce((sum, meter) => sum + BigInt(meter.estimatedNanoUsd!), 0n).toString()
      : null;
  return { ...stage, totals, meters, estimatedNanoUsd, estimateComplete: full };
}

export function recordedPricing(value: unknown, modelId: string): PricingSnapshot | null {
  const price = record(value);
  return price.provider === 'openai' &&
    price.modelId === modelId &&
    price.tier === 'standard' &&
    typeof price.version === 'string' &&
    typeof price.source === 'string' &&
    price.source.startsWith('https://developers.openai.com/') &&
    price.meters &&
    typeof price.meters === 'object'
    ? (value as PricingSnapshot)
    : null;
}
