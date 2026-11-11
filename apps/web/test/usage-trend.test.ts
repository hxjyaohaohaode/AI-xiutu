import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import {
  usageBucketPosition,
  usageTrendGeometry,
  nearestUsagePoint,
} from '../src/usage/trend-model.ts';
import { UsageTrend } from '../src/usage/UsageTrend.tsx';
import { UsageSkeleton } from '../src/usage/UsageSkeleton.tsx';
import { UsageNumber } from '../src/usage/UsageNumber.tsx';
import { usageRiverLanes } from '../src/usage/riverModel.ts';
import { UsageRiver } from '../src/usage/UsageRiver.tsx';
import type { UsageReport } from '../src/usage/model.ts';
import { renderTestMarkup } from './support/render.ts';

const range: UsageReport['range'] = {
  from: '2026-10-31T16:00:00.000Z',
  to: '2026-11-05T16:00:00.000Z',
  bucket: 'day',
};
const row = (bucket: string, adjusted: number) => ({
  bucket,
  issued: 0,
  held: 0,
  consumed: 0,
  released: 0,
  expired: 0,
  adjusted,
  unknownAmountEntries: 0,
});

test('trend spacing uses the inclusive Shanghai calendar period, with an exclusive API end', () => {
  assert.deepEqual(usageBucketPosition('2026-11-01', range), {
    fraction: 0.1,
    ordinal: 0,
    count: 5,
  });
  assert.deepEqual(usageBucketPosition('2026-11-05', range), {
    fraction: 0.9,
    ordinal: 4,
    count: 5,
  });
  assert.deepEqual(
    usageBucketPosition('2026-12', {
      from: '2026-10-31T16:00:00Z',
      to: '2026-12-31T16:00:00Z',
      bucket: 'month',
    }),
    { fraction: 0.75, ordinal: 1, count: 2 },
  );
});

test('chart lines stop at unknown values and unreported dates without filling zeros', () => {
  const chart = usageTrendGeometry(
    {
      range,
      series: [
        row('2026-11-01', 10),
        row('2026-11-02', Number.NaN),
        row('2026-11-03', -5),
        row('2026-11-05', 20),
      ],
    },
    'adjusted',
  );
  assert.equal(chart.points[1]!.value, null);
  assert.equal(chart.points[1]!.y, null);
  assert.equal(chart.paths.length, 3);
  assert.ok(chart.points[2]!.y! > chart.baseline);
  assert.ok(chart.points[0]!.y! < chart.baseline);
  assert.equal(chart.points[3]!.x - chart.points[2]!.x, 304);
  assert.ok(chart.paths.every((path) => !/NaN|undefined/.test(path.line + path.area)));
});

test('pointer inspection selects by true date distance, not by equal record spacing', () => {
  const chart = usageTrendGeometry(
    { range, series: [row('2026-11-01', 10), row('2026-11-02', -5), row('2026-11-05', 20)] },
    'adjusted',
  );
  assert.equal(nearestUsagePoint(chart.points, 370), 1);
  assert.equal(nearestUsagePoint(chart.points, 700), 2);
  assert.equal(nearestUsagePoint(chart.points, -20), 0);
  assert.equal(nearestUsagePoint([], 20), -1);
});

test('zero and negative-only series have finite geometry and retain signed adjustments', () => {
  for (const amounts of [
    [0, 0],
    [-5, -30],
  ]) {
    const chart = usageTrendGeometry(
      { range, series: amounts.map((value, index) => row(`2026-11-0${index + 1}`, value)) },
      'adjusted',
    );
    assert.ok(chart.points.every((point) => Number.isFinite(point.y)));
    assert.deepEqual(
      chart.points.map((point) => point.value),
      amounts,
    );
    assert.ok(Number.isFinite(chart.baseline));
  }
});

test('movement lanes do not bridge absent dates and keep the full selected calendar range', () => {
  const input = [row('2026-11-05', 10), row('2026-11-01', -5), row('2026-10-31', 100)];
  const held = usageRiverLanes(input, range)[0]!;
  assert.deepEqual(
    held.points.map((point) => point.label),
    ['2026-11-01', '2026-11-05'],
  );
  assert.equal(held.points[0]!.x, held.width * 0.1);
  assert.equal(held.points[1]!.x, held.width * 0.9);
  assert.equal(held.paths.length, 2, 'an unreported date is not an interpolated movement');
  assert.equal(input[0]!.bucket, '2026-11-05', 'formatting does not reorder the API result');
  const monthly = usageRiverLanes([row('2026-01', 0), row('2026-02', 0), row('2026-04', 0)])[0]!;
  assert.equal(monthly.paths.length, 2, 'adjacent months connect despite different day counts');
});

test('movement lanes expose linked keyboard date inspectors without converting unknown into zero', () => {
  const input = [
    { ...row('2026-11-01', 0), held: 25 },
    { ...row('2026-11-05', 0), held: Number.NaN },
  ];
  const html = renderTestMarkup(createElement(UsageRiver, { series: input, range }));
  assert.equal((html.match(/role="slider"/g) ?? []).length, 4);
  assert.match(html, /aria-label="预占 · 所选日期"/);
  assert.match(html, /aria-valuetext="2026-11-05：未知 点"/);
  assert.match(html, /含待核对数值/);
  assert.match(html, /2026-11-01/);
});

test('interactive chart exposes a keyboard date slider and the exact selected signed amount', () => {
  const report = { range, series: [row('2026-11-01', 10), row('2026-11-03', -25)] } as UsageReport;
  const html = renderTestMarkup(createElement(UsageTrend, { report, kind: 'adjusted' }));
  assert.match(html, /role="slider"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-valuemax="2"/);
  assert.match(html, /aria-valuenow="2"/);
  assert.match(html, /aria-valuetext="2026-11-03：-25 点"/);
  assert.match(html, /aria-label="上一条趋势记录"/);
  assert.match(html, /data-negative="true"/);
});

test('financial digit animation contains only the actual amount and loading has no demo figures', () => {
  const html = renderTestMarkup(createElement(UsageNumber, { value: -1042 }));
  assert.match(html, /class="sr-only">-1,042/);
  assert.match(html, /aria-hidden="true"/);
  const loading = renderTestMarkup(createElement(UsageSkeleton, {}));
  assert.match(loading, /aria-label="读取用量账本"/);
  assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /usage-number|<svg|服务点/);
});
