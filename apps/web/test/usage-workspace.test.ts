import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderTestMarkup } from './support/render.ts';
import {
  appendUsagePage,
  assertUsageScope,
  byteText,
  entryAmount,
  pointText,
  storageUsage,
  usageAllocations,
  usageDateError,
  usageEndpoint,
  type StorageAccountSummary,
  type UsageEntry,
  type UsageFilter,
  type UsageReport,
} from '../src/usage/model.ts';
import {
  usageModelName,
  usageQuotes,
  type UsageAssistantCatalog,
  type UsageModelCatalog,
} from '../src/usage/catalog.ts';
import { collectUsageCsv } from '../src/usage/export.ts';
import { UsageLedger } from '../src/usage/UsageLedger.tsx';
import { UsageInsights } from '../src/usage/UsageInsights.tsx';

const spaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const otherActor = '33333333-3333-4333-8333-333333333333';
const filter: UsageFilter = {
  scope: 'space',
  spaceId,
  memberId: actorId,
  from: '2026-11-01',
  to: '2026-11-10',
  bucket: 'day',
};
const counters = { issued: 0, held: 0, consumed: 100, released: 0, expired: 0, adjusted: 0 };
function entry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    id: '1',
    kind: 'consumed',
    units: 100,
    movement: { consumed: 100 },
    spaceId,
    actorId,
    lotId: null,
    holdId: 'hold-one',
    jobId: 'turn-one',
    modelId: 'text-model',
    operation: 'assistant-turn',
    sourceKind: 'free',
    createdAt: '2026-11-10T00:30:00.000Z',
    reason: '',
    amountKnown: true,
    movementComplete: true,
    ...overrides,
  };
}
function report(overrides: Partial<UsageReport> = {}): UsageReport {
  return {
    unit: 'credit',
    timezone: 'Asia/Shanghai',
    scope: 'space',
    filterActorId: actorId,
    range: { from: '2026-10-31T16:00:00.000Z', to: '2026-11-10T16:00:00.000Z', bucket: 'day' },
    totals: { ...counters },
    unknownAmountEntries: 0,
    series: [{ ...counters, bucket: '2026-11-10', unknownAmountEntries: 0 }],
    entries: [entry()],
    nextCursor: null,
    balance: { available: 500, held: 40, consumed: 900, expired: 0, revoked: 0 },
    ...overrides,
  };
}

test('space member filters and operator actor filters never cross endpoint families', () => {
  const url = (value: UsageFilter) => new URL(usageEndpoint(value), 'https://local.test');
  assert.equal(url({ ...filter, actorId: otherActor }).searchParams.get('memberId'), actorId);
  assert.equal(url({ ...filter, actorId: otherActor }).searchParams.has('actorId'), false);
  assert.equal(url({ ...filter, scope: 'personal' }).searchParams.has('memberId'), false);
  assert.equal(url({ ...filter, scope: 'personal' }).searchParams.has('spaceId'), false);
  const operator = url({ ...filter, scope: 'operator', actorId: otherActor });
  assert.equal(operator.pathname, '/ops/usage');
  assert.equal(operator.searchParams.has('memberId'), false);
  assert.equal(operator.searchParams.get('actorId'), otherActor);
});

test('date bounds reject impossible dates and honor the actual inclusive 732-day limit', () => {
  assert.equal(usageDateError('2024-02-29', '2024-02-29'), null);
  assert.equal(usageDateError('2024-01-01', '2026-01-01'), null);
  assert.match(usageDateError('2024-01-01', '2026-01-02')!, /732/);
  assert.match(usageDateError('2026-02-29', '2026-03-01')!, /有效/);
  assert.match(usageDateError('', '2026-11-01')!, /有效/);
  assert.match(usageDateError('2026-11-10', '2026-11-01')!, /不能早于/);
});

test('usage receipts must match the requested member, space, date and aggregation', () => {
  assert.doesNotThrow(() => assertUsageScope(report(), filter));
  for (const wrong of [
    report({ filterActorId: otherActor }),
    report({ filterActorId: undefined }),
    report({ scope: 'personal' }),
    report({ entries: [entry({ spaceId: 'other-space' })] }),
    report({ entries: [entry({ actorId: otherActor })] }),
    report({ range: { ...report().range, from: '2026-11-01T00:00:00Z' } }),
    report({ range: { ...report().range, bucket: 'month' } }),
  ])
    assert.throws(() => assertUsageScope(wrong, filter), /范围/);
});

test('paging keeps the frozen period totals while refreshing the live whole-wallet balance', () => {
  const first = report({
    entries: [entry({ id: '2', units: 40, movement: { consumed: 40 } })],
    nextCursor: 'next-page',
  });
  const next = report({
    entries: [entry({ id: '1', units: 60, movement: { consumed: 60 } })],
    balance: { ...report().balance, available: 999, held: 0 },
  });
  const merged = appendUsagePage(first, next, 'next-page', filter);
  assert.deepEqual(
    merged.entries.map((item) => item.id),
    ['2', '1'],
  );
  assert.deepEqual(merged.totals, counters);
  assert.equal(merged.balance.available, 999);
  assert.equal(merged.balance.held, 0);
  assert.equal(first.balance.available, 500);
  assert.equal(first.entries.length, 1);
});

test('changed snapshots, repeated cursors and contradictory immutable rows do not replace loaded records', () => {
  const first = report({ nextCursor: 'next-page' });
  for (const bad of [
    report({ nextCursor: 'next-page' }),
    report({ totals: { ...counters, consumed: 101 } }),
    report({ unknownAmountEntries: 1 }),
    report({
      series: [{ ...counters, consumed: 101, bucket: '2026-11-10', unknownAmountEntries: 0 }],
    }),
    report({ entries: [entry({ units: 99 })] }),
    report({ entries: [], nextCursor: 'empty-next-page' }),
  ])
    assert.throws(() => appendUsagePage(first, bad, 'next-page', filter));
  assert.equal(first.entries[0]!.units, 100);
  assert.equal(first.nextCursor, 'next-page');
});

test('allocation counts settled consumption exactly once and excludes hold/release/adjustment movements', () => {
  const rows = [
    entry({ id: '1', kind: 'held', units: 100, movement: { held: 100 } }),
    entry({ id: '2', units: 40, movement: { consumed: 40 } }),
    entry({ id: '3', kind: 'released', units: 60, movement: { released: 60, expired: 20 } }),
    entry({ id: '4', kind: 'adjusted', units: -25, movement: { adjusted: -25 } }),
    entry({ id: '2', units: 40, movement: { consumed: 40 } }),
  ];
  const value = usageAllocations(report({ entries: rows, totals: { ...counters, consumed: 40 } }));
  assert.equal(value.total, 40);
  assert.equal(value.rows[0]!.records, 1);
  assert.equal(value.complete, true);
});

test('unknown amounts, incomplete pages and negative consumption cannot produce a complete distribution', () => {
  const missing = entry({ id: '2', units: 0, amountKnown: false });
  assert.equal(entryAmount(missing), null);
  assert.equal(pointText(entryAmount(missing)), '未知');
  assert.equal(pointText(Number.NaN), '未知');
  assert.equal(pointText('0'), '未知');
  assert.equal(pointText(0), '0');
  const unknown = usageAllocations(report({ entries: [entry(), missing] }));
  assert.equal(unknown.total, 100);
  assert.equal(unknown.unknown, 1);
  assert.equal(unknown.complete, false);
  assert.equal(usageAllocations(report({ nextCursor: 'more' })).complete, false);
  assert.equal(
    usageAllocations(report({ totals: { ...counters, consumed: 101 } })).complete,
    false,
  );
  assert.equal(usageAllocations(report({ entries: [entry({ units: -1 })] })).unsupported, 1);
});

test('missing model or purpose stays a named unknown category without losing known service points', () => {
  const value = usageAllocations(report({ entries: [entry({ modelId: null, operation: null })] }));
  assert.equal(value.rows[0]!.modelId, null);
  assert.equal(value.rows[0]!.operation, null);
  assert.equal(value.rows[0]!.units, 100);
  assert.equal(value.complete, true);
  assert.equal(usageModelName([], null), '未记录模型');
});

test('CSV member export freezes the selected filter across all signed cursor pages', async () => {
  const selected = { ...filter };
  const calls: URL[] = [];
  const result = await collectUsageCsv(selected, (async (input, init) => {
    const url = new URL(String(input), 'https://local.test');
    calls.push(url);
    assert.equal(init?.credentials, 'include');
    assert.equal(url.searchParams.get('memberId'), actorId);
    assert.equal(url.searchParams.get('spaceId'), spaceId);
    assert.equal(url.searchParams.get('from'), '2026-10-31T16:00:00.000Z');
    selected.memberId = otherActor;
    selected.from = '2026-01-01';
    return new Response('id,units\r\n1,100\r\n', {
      headers: {
        'content-type': 'text/csv',
        ...(calls.length === 1 ? { 'x-next-cursor': 'same-snapshot' } : {}),
      },
    });
  }) as typeof fetch);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.searchParams.get('cursor'), 'same-snapshot');
  assert.match(await result.text(), /1,100/);
});

test('cancelling an export between pages yields no partial file or additional request', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    collectUsageCsv(
      filter,
      (async () => {
        calls++;
        controller.abort();
        return new Response('id,units\r\n1,100\r\n', {
          headers: { 'content-type': 'text/csv', 'x-next-cursor': 'next' },
        });
      }) as typeof fetch,
      controller.signal,
    ),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
});

test('capacity accounts for retained and reserved bytes without treating absent reservations as zero', () => {
  const storage: StorageAccountSummary = {
    spaceId,
    version: 1,
    maxBytes: 100,
    retainedBytes: 80,
    reservedMediaBytes: 30,
    maxAssets: 10,
    retainedAssets: 11,
    accounting: 'retained-logical-assets',
    softDeleteReclaimsCapacity: false,
  };
  assert.equal(storageUsage(storage).used, 110);
  assert.equal(storageUsage(storage).overBy, 10);
  assert.equal(storageUsage(storage).fraction, 1);
  assert.equal(storageUsage(storage).remaining, 0);
  assert.equal(storageUsage({ ...storage, reservedMediaBytes: undefined }).used, null);
  assert.equal(storageUsage({ ...storage, reservedMediaBytes: undefined }).fraction, null);
  assert.equal(byteText(null), '未知');
  assert.equal(byteText(0), '0 B');
  const zero = storageUsage({ ...storage, retainedBytes: 0, reservedMediaBytes: 0, maxBytes: 0 });
  assert.equal(zero.maximum, 0);
  assert.equal(zero.remaining, 0);
  assert.equal(zero.fraction, 0);
});

const legacy: UsageModelCatalog = {
  executionEnabled: true,
  availableOperations: ['generate-image'],
  models: [
    {
      id: 'image-model',
      label: '图片模型',
      enabled: true,
      operations: ['generate-image', 'edit-plan'],
      runtimeAvailable: true,
      runtimeOperations: ['generate-image'],
      pointsPerPlan: 7,
      pricing: {
        unit: 'service-point',
        per: 'image',
        defaultPerImage: 50,
        qualityPerImage: { low: 20, high: 100 },
      },
      parameterCapabilities: { quality: { supported: true, values: ['high'] } },
    },
  ],
};
const assistant: UsageAssistantCatalog = {
  ready: true,
  voiceReady: false,
  reason: '语音未配置',
  models: [
    {
      id: 'text-model',
      label: '智能体模型',
      unitCost: 30,
      operations: ['assistant-turn', 'realtime-voice'],
      maxSeconds: 120,
    },
  ],
};

test('current quote catalogs preserve execution family, per-image quality tiers and voice session units', () => {
  const quotes = usageQuotes(legacy, assistant);
  const image = quotes.find((row) => row.operation === 'generate-image')!;
  assert.equal(image.points, 50);
  assert.equal(image.per, '张');
  assert.deepEqual(image.qualities, [{ name: 'high', points: 100 }]);
  assert.equal(image.available, true);
  assert.equal(quotes.find((row) => row.operation === 'edit-plan')!.available, false);
  const voice = quotes.find((row) => row.operation === 'realtime-voice')!;
  assert.equal(voice.points, 30);
  assert.equal(voice.per, '次通话');
  assert.equal(voice.maxSeconds, 120);
  assert.equal(voice.available, false);
  assert.equal(usageModelName(quotes, 'text-model', 'assistant-turn'), '智能体模型');
  assert.equal(usageModelName(quotes, 'text-model', 'unrelated-operation'), 'text-model');
});

test('an absent or invalid price remains unknown, and configured rows do not bypass runtime availability', () => {
  const rows = usageQuotes(
    {
      ...legacy,
      executionEnabled: false,
      models: [{ ...legacy.models[0]!, pricing: undefined, pointsPerPlan: undefined }],
    },
    { ...assistant, models: [{ ...assistant.models[0]!, unitCost: 1.5 }] },
  );
  assert.equal(rows.find((row) => row.operation === 'generate-image')!.points, null);
  assert.equal(rows.find((row) => row.operation === 'generate-image')!.available, false);
  assert.equal(rows.find((row) => row.operation === 'assistant-turn')!.points, null);
});

test('ledger uses Shanghai time, explicit unknown amounts and real expandable table semantics', () => {
  const html = renderTestMarkup(
    createElement(UsageLedger, {
      report: report({
        entries: [entry({ amountKnown: false, units: 0, movementComplete: false })],
      }),
      quotes: usageQuotes(legacy, assistant),
      members: [{ userId: actorId, displayName: '测试成员', role: 'editor' }],
      spaces: [],
      currentUserId: actorId,
      more: false,
      error: null,
      onMore: () => {},
    }),
  );
  assert.match(html, /08:30/);
  assert.match(html, /测试成员/);
  assert.match(html, /usage-row-amount[^]*?<strong>未知<\/strong>/);
  assert.match(html, /分摊不完整/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="展开记录 1"/);
  assert.match(html, /<table class="usage-table"/);
  assert.doesNotMatch(html, /任务已完成|供应商费用.*0/);
});

test('distribution markup identifies a partial ledger and retains negative trend values', () => {
  const data = report({
    nextCursor: 'more',
    series: [{ ...counters, adjusted: -25, bucket: '2026-11-10', unknownAmountEntries: 0 }],
  });
  const html = renderTestMarkup(
    createElement(UsageInsights, {
      report: data,
      quotes: [],
      kind: 'adjusted',
      bucket: 'day',
      onBucket: () => {},
    }),
  );
  assert.match(html, /基于已载入的 1 条明细/);
  assert.match(html, /data-negative="true"/);
  assert.match(html, /-25/);
  assert.doesNotMatch(html, /本期完整明细/);
});
