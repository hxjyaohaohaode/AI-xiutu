import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLibrarySearch } from '../src/resources/library-search';
import { initialLibraryFilters, libraryRequest } from '../src/resources/useLibraryCollection';

const now = new Date(2026, 10, 27, 14, 15);
const url = (path: string | null) => new URL(path!, 'https://local.test').searchParams;
test('album queries use the same server filters for matching assets, folders, and private memory', () => {
  for (const query of [
    '近7天 AI 生成 PNG 武汉',
    'last 7 days generated png 武汉',
    '近7天 ai生成 PNG 武汉',
  ]) {
    for (const tab of ['project', 'all', 'memory'] as const) {
      for (const groups of [false, true]) {
        const filters = { ...initialLibraryFilters('p'), query };
        const p = url(libraryRequest(tab, filters, 'team', groups, now));
        assert.equal(p.get('source'), 'generated');
        assert.equal(p.get('query'), '武汉');
        assert.equal(p.get('mime'), 'image/png');
        assert.equal(p.get('createdFrom'), new Date(2026, 10, 21).toISOString());
        assert.equal(p.get('groupBy'), groups ? 'date' : null);
        assert.equal(p.get('remembered'), tab === 'memory' ? 'true' : null);
      }
    }
  }
});

test('unusual filenames keep literal spaces, date boundaries and conflicting facets are explicit', () => {
  assert.equal(parseLibrarySearch('A  B.PnG', now).text, 'A  B.PnG');
  assert.equal(parseLibrarySearch('"today PNG"', now).text, 'today PNG');
  assert.equal(parseLibrarySearch('“昨天”', now).time, undefined);
  assert.equal(parseLibrarySearch('2026-02-29', now).text, '2026-02-29');
  assert.equal(
    parseLibrarySearch('toString proto.__proto__', now).text,
    'toString proto.__proto__',
  );
  const p = url(
    libraryRequest('all', { ...initialLibraryFilters(), query: '昨天 jpg' }, '', false, now),
  );
  assert.equal(p.get('createdFrom'), new Date(2026, 10, 26).toISOString());
  assert.equal(p.get('createdTo'), new Date(2026, 10, 27).toISOString());
  for (const query of ['PNG JPEG', '今天 昨天', '上传 generated']) {
    assert.equal(
      libraryRequest('memory', { ...initialLibraryFilters(), query }, '', true, now),
      null,
    );
  }
  const filters = {
    ...initialLibraryFilters('p'),
    query: 'jpg',
    groupBy: 'type' as const,
    folder: 'image/png',
  };
  assert.equal(libraryRequest('project', filters, 'team', false, now), null);
  assert.equal(
    url(libraryRequest('project', filters, 'team', true, now)).get('mime'),
    'image/jpeg',
  );
});
