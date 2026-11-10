import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import {
  publicPricingSnapshot,
  type ProviderStage,
  type PublishedRate,
  type UsageJobDetail,
  type UsageResponse,
} from '@ai-xiutu/contracts';
import { renderTestMarkup } from './support/render.ts';
import {
  assertPublishedPrices,
  assertUsageJobScope,
  groupProviderStages,
  publicPriceSource,
  publishedRateText,
  summarizeProviderStages,
  usageJobEndpoint,
  usdText,
  type UsageJobReference,
} from '../src/usage/providerBilling.ts';
import { usageRiverLanes } from '../src/usage/riverModel.ts';
import { UsageJobContent, UsagePublicPrices } from '../src/usage/UsageJob.tsx';
import { UsageRiver } from '../src/usage/UsageRiver.tsx';

const reference: UsageJobReference = {
  jobId: 'job-a',
  spaceId: 'space-a',
  actorId: 'actor-a',
  holdId: 'hold-a',
  modelId: 'gpt-5.4-mini',
  operation: 'assistant-turn',
};
const pricing = publicPricingSnapshot('gpt-5.4-mini', 'openai')!;
function stage(overrides: Partial<ProviderStage> = {}): ProviderStage {
  return {
    stageId: 'stage-a',
    branchId: null,
    purpose: 'conversation',
    modelId: pricing.modelId,
    dispatchedAt: '2026-11-10T12:00:00Z',
    receivedAt: '2026-11-10T12:00:01Z',
    status: 'received',
    pricing,
    totals: { input: 100, output: 20, total: 120 },
    meters: [
      { meter: 'input', quantity: 75, rate: pricing.meters.input!, estimatedNanoUsd: '56250' },
      {
        meter: 'cached-input',
        quantity: 25,
        rate: pricing.meters['cached-input']!,
        estimatedNanoUsd: '1875',
      },
      { meter: 'output', quantity: 15, rate: pricing.meters.output!, estimatedNanoUsd: '67500' },
      {
        meter: 'reasoning',
        quantity: 5,
        rate: pricing.meters.reasoning!,
        estimatedNanoUsd: '22500',
      },
    ],
    estimatedNanoUsd: '148125',
    estimateComplete: true,
    ...overrides,
  };
}
function detail(overrides: Partial<UsageJobDetail> = {}): UsageJobDetail {
  return {
    ...reference,
    actorId: reference.actorId!,
    holdId: reference.holdId!,
    modelId: reference.modelId!,
    operation: reference.operation!,
    state: 'completed',
    holdState: 'settled',
    units: 30,
    stages: [stage()],
    movements: [],
    ...overrides,
  };
}
function series(
  overrides: Partial<UsageResponse['series'][number]> = {},
): UsageResponse['series'][number] {
  return {
    bucket: '2026-11-10',
    issued: 0,
    held: 30,
    consumed: 20,
    released: 10,
    expired: 0,
    adjusted: 0,
    unknownAmountEntries: 0,
    ...overrides,
  };
}

test('provider details are bound to the ledger job, actor, space, hold, operation and model', () => {
  assert.doesNotThrow(() => assertUsageJobScope(detail(), reference));
  for (const field of ['jobId', 'spaceId', 'actorId', 'holdId', 'operation', 'modelId'] as const)
    assert.throws(() => assertUsageJobScope(detail({ [field]: 'other' }), reference), /所选账本/);
  assert.throws(() => assertUsageJobScope(detail({ stages: [stage(), stage()] }), reference));
  assert.equal(usageJobEndpoint({ kind: 'job', reference }, false), '/usage/jobs/job-a');
  assert.equal(usageJobEndpoint({ kind: 'job', reference }, true), '/ops/usage/jobs/job-a');
  assert.equal(usageJobEndpoint({ kind: 'prices' }, true), '/usage/model-prices');
});

test('receipt totals are not doubled by cached or reasoning breakdown meters', () => {
  const value = summarizeProviderStages([stage()]);
  assert.equal(value.knownTokens, 120);
  assert.equal(value.estimatedNanoUsd, '148125');
  assert.equal(value.tokenComplete, true);
  assert.equal(value.estimateComplete, true);
});

test('missing or contradictory token totals stay incomplete even when some cost is known', () => {
  const pending = stage({
    stageId: 'pending',
    status: 'unknown',
    totals: { input: null, output: null, total: null },
    meters: [],
    estimatedNanoUsd: null,
    estimateComplete: false,
  });
  const value = summarizeProviderStages([stage(), pending]);
  assert.equal(value.knownTokens, 120);
  assert.equal(value.missingTokenStages, 1);
  assert.equal(value.tokenComplete, false);
  assert.equal(value.estimateComplete, false);
  assert.equal(value.estimatedNanoUsd, '148125');
  const unknown = summarizeProviderStages([pending]);
  assert.equal(unknown.knownTokens, null);
  assert.equal(unknown.estimatedNanoUsd, null);
  assert.equal(
    summarizeProviderStages([stage({ totals: { input: 100, output: 20, total: 999 } })])
      .tokenComplete,
    false,
  );
});

test('zero is a recorded receipt value while duration stages do not invent token counts', () => {
  const zero = summarizeProviderStages([
    stage({ totals: { input: 0, output: 0, total: 0 }, meters: [], estimatedNanoUsd: '0' }),
  ]);
  assert.equal(zero.knownTokens, 0);
  assert.equal(zero.tokenComplete, true);
  assert.equal(zero.estimatedNanoUsd, '0');
  const duration = summarizeProviderStages([
    stage({
      purpose: 'live-duration',
      totals: { input: null, output: null, total: null },
      meters: [],
      estimatedNanoUsd: '50000000',
    }),
  ]);
  assert.equal(duration.tokenStages, 0);
  assert.equal(duration.knownTokens, null);
  assert.equal(duration.estimateComplete, true);
});

test('a partial zero-dollar estimate cannot become a complete or free task', () => {
  const value = summarizeProviderStages([
    stage({ estimatedNanoUsd: '0', estimateComplete: false }),
  ]);
  assert.equal(value.estimatedNanoUsd, '0');
  assert.equal(value.estimateComplete, false);
  assert.equal(summarizeProviderStages([]).estimatedNanoUsd, null);
  assert.equal(summarizeProviderStages([]).estimateComplete, false);
});

test('nano USD values retain all precision without rendering unknown data as zero', () => {
  assert.equal(usdText('1'), '$0.000000001');
  assert.equal(usdText('0'), '$0');
  assert.equal(usdText('900719925474099312345'), '$900719925474.099312345');
  for (const value of [null, undefined, '1.1', '-1', 'NaN', Number.NaN, '1e9', ''])
    assert.equal(usdText(value), '未知');
});

test('public unit rates honor quantity and duration without floating-point conversion', () => {
  assert.equal(publishedRateText(pricing.meters.input), '$0.75 / 百万 token');
  const live = publicPricingSnapshot('gpt-live-1', 'openai')!;
  assert.equal(publishedRateText(live.meters['voice-seconds']), '$0.05 / 60 秒');
  assert.equal(
    publishedRateText({ nanoUsd: '10000000', quantity: 10, unit: 'call' }),
    '$0.01 / 10 次',
  );
  assert.equal(
    publishedRateText({ nanoUsd: '10', quantity: 2, unit: 'token' }),
    '$0.005 / 百万 token',
  );
  assert.equal(
    publishedRateText({ nanoUsd: '1', quantity: 3, unit: 'token' }),
    '$0.000000001 / 3 token',
  );
  for (const rate of [
    null,
    { nanoUsd: 'bad', quantity: 1, unit: 'token' },
    { nanoUsd: '1', quantity: 0, unit: 'token' },
    { nanoUsd: '1', quantity: 1.5, unit: 'token' },
  ])
    assert.equal(publishedRateText(rate as PublishedRate), '费率未提供');
});

test('rate source links and response basis are validated independently of displayed estimates', () => {
  assert.doesNotThrow(() =>
    assertPublishedPrices({ currency: 'USD', basis: 'published-estimate', prices: [pricing] }),
  );
  assert.throws(() =>
    assertPublishedPrices({
      currency: 'CNY',
      basis: 'published-estimate',
      prices: [pricing],
    } as never),
  );
  assert.equal(publicPriceSource(pricing.source), pricing.source);
  assert.equal(publicPriceSource('javascript:alert(1)'), undefined);
  assert.equal(publicPriceSource('https://developers.openai.com.attacker.invalid/'), undefined);
});

test('branch totals group real provider IDs and retain an unpriced branch without invented graph nodes', () => {
  const groups = groupProviderStages([
    stage(),
    stage({ stageId: 'web-a', branchId: 'web-1', purpose: 'web-search' }),
    stage({ stageId: 'web-b', branchId: 'web-1', purpose: 'web-search' }),
    stage({
      stageId: 'merge',
      branchId: 'merge-1',
      purpose: 'research-merge',
      totals: { input: null, output: null, total: null },
      estimatedNanoUsd: null,
      estimateComplete: false,
    }),
  ]);
  assert.deepEqual(
    groups.map((group) => group.branchId),
    [null, 'web-1', 'merge-1'],
  );
  assert.equal(groups[1]!.summary.knownTokens, 240);
  assert.equal(groups[2]!.summary.knownTokens, null);
  assert.equal(groups[2]!.summary.estimateComplete, false);
});

test('separate movement lanes preserve negative values and date distances', () => {
  const lanes = usageRiverLanes([
    series({ bucket: '2026-11-01', held: 30 }),
    series({ bucket: '2026-11-02', held: -10 }),
    series({ bucket: '2026-11-10', held: 0 }),
  ]);
  const held = lanes[0]!;
  assert.equal(held.knownTotal, 20);
  assert.equal(held.points[1]!.value, -10);
  assert.ok(held.points[1]!.y! > held.baseline, 'negative changes stay below zero');
  assert.ok(held.points[1]!.x! < held.width / 2, 'calendar gaps retain their relative spacing');
  assert.equal(lanes[1]!.knownTotal, 60, 'settled movements do not inherit or subtract holds');
});

test('unknown amounts split chart paths, while explicitly recorded zero is retained', () => {
  const held = usageRiverLanes([
    series({ bucket: '2026-11-01', held: 0 }),
    series({ bucket: '2026-11-02', held: null as never }),
    series({ bucket: '2026-11-03', held: 30 }),
  ])[0]!;
  assert.equal(held.missing, 1);
  assert.equal(held.points[0]!.value, 0);
  assert.equal(held.knownTotal, 30);
  assert.equal(held.paths.length, 2, 'missing receipt data cannot be interpolated as zero');
  assert.equal(usageRiverLanes([series({ held: null as never })])[0]!.knownTotal, null);
});

test('job markup separates service credits, frozen USD estimates, missing tokens and receipt identifiers', () => {
  const html = renderTestMarkup(
    createElement(UsageJobContent, {
      detail: detail({
        state: 'unknown',
        holdState: 'unknown',
        stages: [
          stage({
            status: 'unknown',
            totals: { input: null, output: null, total: null },
            meters: [],
            estimatedNanoUsd: null,
            estimateComplete: false,
          }),
        ],
      }),
    }),
  );
  assert.match(html, /任务预占额度/);
  assert.match(html, /结果待核验/);
  assert.match(html, /token 未记录/);
  assert.match(html, /费用未知/);
  assert.doesNotMatch(html, /\$0/);
  assert.match(html, /调用标识/);
  assert.match(html, /未知/);
});

test('public pricing keeps accessible model cells and original quantities in narrow-screen markup', () => {
  const html = renderTestMarkup(
    createElement(UsagePublicPrices, {
      prices: [pricing, publicPricingSnapshot('gpt-live-1', 'openai')!],
    }),
  );
  assert.match(html, /<td class="usage-rate-model" rowSpan="\d+">gpt-5.4-mini<\/td>/);
  assert.match(html, /\$0.05 \/ 60 秒/);
  assert.match(html, /缓存输入/);
  assert.match(html, /推理输出/);
  assert.match(html, /公开费率模型/);
});

test('movement comparison exposes accessible exact values and never describes their sum as a balance', () => {
  const html = renderTestMarkup(
    createElement(UsageRiver, { series: [series({ held: 30, consumed: 20, released: 10 })] }),
  );
  assert.match(html, /不能相加作为余额/);
  assert.match(html, /各类流水数值/);
  assert.match(html, /已记录合计 30 点/);
  assert.match(html, /已记录合计 20 点/);
});
