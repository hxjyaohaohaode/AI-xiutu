import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  usageEndpoint,
  usageChartValues,
  type UsageFilter,
  type UsageReport,
} from '../src/usage/model.ts';
import { collectUsageCsv } from '../src/usage/export.ts';
import { resourceQuery } from '../src/resources/model.ts';

const filter: UsageFilter = {
  scope: 'space',
  spaceId: 'team-one',
  from: '2026-11-01',
  to: '2026-11-10',
  bucket: 'day',
};
test('usage date selection uses Shanghai inclusive days without mixing personal, space and operator filters', () => {
  const q = new URL(usageEndpoint(filter), 'https://local.test').searchParams;
  assert.equal(q.get('from'), '2026-10-31T16:00:00.000Z');
  assert.equal(q.get('to'), '2026-11-10T16:00:00.000Z');
  assert.equal(q.get('spaceId'), 'team-one');
  const personal = new URL(
    usageEndpoint({ ...filter, scope: 'personal', actorId: 'other' }),
    'https://local.test',
  );
  assert.equal(personal.pathname, '/usage');
  assert.equal(personal.searchParams.has('spaceId'), false);
  assert.equal(personal.searchParams.has('actorId'), false);
  const operator = new URL(
    usageEndpoint({ ...filter, scope: 'operator', actorId: 'operator-selected' }, 'cursor'),
    'https://local.test',
  );
  assert.equal(operator.pathname, '/ops/usage');
  assert.equal(operator.searchParams.get('actorId'), 'operator-selected');
  assert.equal(operator.searchParams.has('scope'), false);
});

test('chart preserves negative adjustments and empty reports rather than manufacturing usage', () => {
  const report = {
    series: [
      { bucket: 'a', adjusted: -50 },
      { bucket: 'b', adjusted: 100 },
      { bucket: 'c', adjusted: 0 },
    ],
  } as UsageReport;
  assert.deepEqual(usageChartValues(report, 'adjusted'), [
    { label: 'a', value: -50, fraction: 0.5 },
    { label: 'b', value: 100, fraction: 1 },
    { label: 'c', value: 0, fraction: 0 },
  ]);
  assert.deepEqual(usageChartValues({ series: [] } as unknown as UsageReport, 'consumed'), []);
});

test('CSV export follows the snapshot cursor, preserves quoted newlines, and emits one header', async () => {
  const paths: URL[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'https://local.test');
    paths.push(url);
    assert.equal(init?.credentials, 'include');
    assert.equal(url.searchParams.get('limit'), '500');
    return paths.length === 1
      ? new Response('\uFEFFid,reason\r\n1,"two\r\nlines"\r\n', {
          headers: { 'content-type': 'text/csv', 'x-next-cursor': 'fixed-snapshot-cursor' },
        })
      : new Response('\uFEFFid,reason\r\n2,done\r\n', { headers: { 'content-type': 'text/csv' } });
  };
  const blob = await collectUsageCsv(filter, fetcher as typeof fetch);
  assert.equal(await blob.text(), 'id,reason\r\n1,"two\r\nlines"\r\n2,done\r\n');
  assert.equal(paths[1]!.searchParams.get('cursor'), 'fixed-snapshot-cursor');
  assert.equal(paths[0]!.searchParams.get('from'), paths[1]!.searchParams.get('from'));
});

test('CSV export rejects partial failures and repeated cursors before offering a file', async () => {
  let count = 0;
  await assert.rejects(
    collectUsageCsv(filter, (async () =>
      ++count === 1
        ? new Response('id\r\n1\r\n', {
            headers: { 'content-type': 'text/csv', 'x-next-cursor': 'next' },
          })
        : new Response(JSON.stringify({ error: { message: '权限已撤销' } }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })) as typeof fetch),
    /权限已撤销/,
  );
  await assert.rejects(
    collectUsageCsv(
      filter,
      (async () =>
        new Response('id\r\n1\r\n', {
          headers: { 'content-type': 'text/csv', 'x-next-cursor': 'loop' },
        })) as typeof fetch,
    ),
    /分页没有继续/,
  );
  await assert.rejects(
    collectUsageCsv(
      filter,
      (async () =>
        new Response('{}', { headers: { 'content-type': 'application/json' } })) as typeof fetch,
    ),
    /没有返回 CSV/,
  );
});

test('resource filters encode user text and do not imply permission or automatic AI sharing', () => {
  const url = new URL(
    resourceQuery({
      scope: 'team',
      spaceId: 'team-one',
      query: ' 蓝色& source=generated ',
      remembered: true,
      source: 'upload',
      cursor: 'page/+',
    }),
    'https://local.test',
  );
  assert.equal(url.searchParams.get('query'), '蓝色& source=generated');
  assert.equal(url.searchParams.get('source'), 'upload');
  assert.equal(url.searchParams.get('remembered'), 'true');
  assert.equal(url.searchParams.get('cursor'), 'page/+');
  assert.equal(url.searchParams.has('includePrivate'), false);
});
