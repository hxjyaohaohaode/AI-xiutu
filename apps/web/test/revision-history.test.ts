import assert from 'node:assert/strict';
import test from 'node:test';
import { appendRevisionHistoryPage } from '../src/lib/revisionHistory.ts';
import type { RevisionSummary } from '../src/lib/types.ts';

function revision(version: number, artworkId = 'work'): RevisionSummary {
  return {
    id: `revision-${version}`,
    artworkId,
    assetId: `source-${version}`,
    version,
    createdAt: '2026-11-10T00:00:00Z',
  };
}

test('bounded history pages reach old versions and retain each frozen source', () => {
  const first = appendRevisionHistoryPage(
    [],
    {
      revisions: [revision(105), revision(104)],
      page: { headVersion: 105, nextBeforeVersion: 104 },
    },
    'work',
  );
  const next = appendRevisionHistoryPage(
    first.revisions,
    {
      revisions: [revision(103), revision(1)],
      page: { headVersion: 106, nextBeforeVersion: null },
    },
    'work',
    first.nextBeforeVersion!,
  );
  assert.deepEqual(
    next.revisions.map((item) => item.version),
    [105, 104, 103, 1],
  );
  assert.equal(next.revisions.at(-1)?.assetId, 'source-1');
  assert.equal(next.headVersion, 106, 'a newer cloud head is observable without dropping history');
  assert.equal(next.nextBeforeVersion, null);
});

test('repeated page merges do not duplicate immutable revisions', () => {
  const item = revision(2);
  const result = appendRevisionHistoryPage([item], { revisions: [item] }, 'work');
  assert.equal(result.revisions.length, 1);
  assert.equal(result.nextBeforeVersion, null, 'older responses without page metadata still work');
});

test('foreign artwork history and incompatible immutable versions are rejected', () => {
  assert.throws(() => appendRevisionHistoryPage([], { revisions: [revision(2, 'other')] }, 'work'));
  assert.throws(() =>
    appendRevisionHistoryPage(
      [revision(2)],
      { revisions: [{ ...revision(2), id: 'another' }] },
      'work',
    ),
  );
  assert.throws(() =>
    appendRevisionHistoryPage(
      [revision(2)],
      { revisions: [{ ...revision(3), id: 'revision-2' }] },
      'work',
    ),
  );
  assert.throws(() =>
    appendRevisionHistoryPage(
      [revision(2)],
      { revisions: [{ ...revision(2), assetId: 'changed-source' }] },
      'work',
    ),
  );
});

test('exclusive cursors cannot repeat pages or skip past the returned oldest revision', () => {
  for (const nextBeforeVersion of [5, 3, 0, 4.5]) {
    assert.throws(() =>
      appendRevisionHistoryPage(
        [revision(5)],
        { revisions: [revision(4)], page: { headVersion: 5, nextBeforeVersion } },
        'work',
        5,
      ),
    );
  }
  assert.throws(() => appendRevisionHistoryPage([], { revisions: [revision(5)] }, 'work', 5));
  assert.throws(() =>
    appendRevisionHistoryPage(
      [],
      { revisions: [], page: { headVersion: 5, nextBeforeVersion: 4 } },
      'work',
    ),
  );
});

test('a reported head cannot precede a revision returned in that page', () => {
  assert.throws(() =>
    appendRevisionHistoryPage(
      [],
      { revisions: [revision(5)], page: { headVersion: 4, nextBeforeVersion: null } },
      'work',
    ),
  );
});
