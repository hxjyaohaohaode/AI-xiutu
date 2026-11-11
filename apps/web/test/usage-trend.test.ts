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
