export type Meter =
  | 'input'
  | 'cached-input'
  | 'cache-write-30m'
  | 'cache-write-12h'
  | 'output'
  | 'reasoning'
  | 'text-input'
  | 'text-cached'
  | 'text-output'
  | 'image-input'
  | 'image-cached'
  | 'image-output'
  | 'audio-input'
  | 'audio-cached'
  | 'audio-output'
  | 'web-search'
  | 'voice-seconds';
export type PublishedRate = {
  nanoUsd: string;
  quantity: number;
  unit: 'token' | 'call' | 'second';
};
export interface PricingSnapshot {
  version: string;
  modelId: string;
  provider: 'openai';
  tier: 'standard';
  source: string;
  meters: Partial<Record<Meter, PublishedRate>>;
}
export interface BilledMeter {
  meter: Meter;
  quantity: number;
  rate: PublishedRate | null;
  estimatedNanoUsd: string | null;
}
export interface ProviderStage {
  stageId: string;
  branchId: string | null;
  purpose: string;
  modelId: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  status: 'pending' | 'unknown' | 'received' | 'no-receipt';
  pricing: PricingSnapshot | null;
  totals: { input: number | null; output: number | null; total: number | null };
  meters: BilledMeter[];
  estimatedNanoUsd: string | null;
  estimateComplete: boolean;
}
export interface UsageJobDetail {
  jobId: string;
  actorId: string;
  spaceId: string;
  holdId: string;
  modelId: string;
  operation: string;
  state: string;
  holdState: string;
  units: number;
  stages: ProviderStage[];
  movements: { id: string; lotId: string | null; kind: string; units: number; createdAt: string }[];
}

const source = 'https://developers.openai.com/api/docs/pricing';
// Integer nano-dollars per token. The source expresses USD per 1,000,000 tokens.
const token = (value: number): PublishedRate => ({
  nanoUsd: String(value),
  quantity: 1,
  unit: 'token',
});
const text = (input: number, cached: number, output: number, cacheWrites = false) => ({
  input: token(input),
  'cached-input': token(cached),
  ...(cacheWrites
    ? { 'cache-write-30m': token(input * 1.25), 'cache-write-12h': token(input * 2.5) }
    : {}),
  output: token(output),
  reasoning: token(output),
});
const image = (
  textRate: number,
  textCached: number,
  input: number,
  cached: number,
  output: number,
) => ({
  'text-input': token(textRate),
  'text-cached': token(textCached),
  'image-input': token(input),
  'image-cached': token(cached),
  'image-output': token(output),
});
const realtime = (
  textInput: number,
  textCached: number,
  textOutput: number,
  audio: number,
  audioCached: number,
  audioOutput: number,
  imageInput: number,
  imageCached: number,
) => ({
  'text-input': token(textInput),
  'text-cached': token(textCached),
  'text-output': token(textOutput),
  'audio-input': token(audio),
  'audio-cached': token(audioCached),
  'audio-output': token(audioOutput),
  'image-input': token(imageInput),
  'image-cached': token(imageCached),
});
const pricing = new Map<string, PricingSnapshot['meters']>([
  ['gpt-5.4-mini', text(750, 75, 4500)],
  ['gpt-5.4-mini-2026-03-17', text(750, 75, 4500)],
  ['gpt-6.1-sol', text(2000, 100, 10000, true)],
  ['gpt-6.1-terra', text(1000, 50, 5000, true)],
  ['gpt-6-luna', text(100, 10, 500, true)],
  ['gpt-image-2', image(2500, 625, 4000, 1000, 15000)],
  ['gpt-image-2-2026-04-21', image(2500, 625, 4000, 1000, 15000)],
  ['gpt-image-2.6-flare', image(5000, 1250, 8000, 2000, 30000)],
  ['gpt-image-2.6-sunburst', image(5000, 1250, 8000, 2000, 30000)],
  ['gpt-realtime-2.1', realtime(4000, 400, 24000, 32000, 400, 64000, 5000, 500)],
  ['gpt-realtime-2.1-mini', realtime(600, 60, 2400, 10000, 300, 20000, 800, 80)],
  ['gpt-live-1', { 'voice-seconds': { nanoUsd: '50000000', quantity: 60, unit: 'second' } }],
]);
export function publicPricingSnapshot(modelId: string, provider: string): PricingSnapshot | null {
  if (provider !== 'openai') return null;
  const meters = pricing.get(modelId);
  if (!meters) return null;
  return {
    version: 'openai-standard-2026-11-13',
    provider,
    modelId,
    tier: 'standard',
    source: modelId.startsWith('gpt-5.4-mini')
      ? 'https://developers.openai.com/api/docs/models/gpt-5.4-mini'
      : source,
    meters: {
      ...meters,
      ...(meters.input ? { 'web-search': { nanoUsd: '10000000', quantity: 1, unit: 'call' } } : {}),
    },
  };
}
export function publishedModelPrices() {
  return [...pricing.keys()].map((model) => publicPricingSnapshot(model, 'openai')!);
}
