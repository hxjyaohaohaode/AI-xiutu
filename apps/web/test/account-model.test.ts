import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accountPhone,
  accountDraftActionAllowed,
  accountScope,
  accountSpace,
  formatAccountPeriod,
  formatAccountUnits,
  nextAccountTab,
  readAccountEntitlements,
} from '../src/account/account-model.ts';
import { DocumentDraftStore } from '../src/account/document-drafts.ts';
import type { Session } from '../src/lib/types.ts';

const session: Session = {
  user: {
    id: 'actor-a',
    displayName: 'Lin',
    phoneMasked: '138****1234',
    status: 'active',
    isOperator: false,
  },
  spaces: [
    { id: 'team-a', name: 'Team', kind: 'team', role: 'editor' },
    { id: 'personal-a', name: 'Personal', kind: 'personal', role: 'owner' },
  ],
};
const receipt = {
  spaceId: 'team-a',
  available: 1200,
  held: 17,
  freeAvailable: 1000,
  purchasedAvailable: 200,
  periodEnd: '2026-11-30T16:00:00.000Z',
};

test('an inaccessible explicit team never falls back to the personal wallet', () => {
  assert.equal(accountSpace(session, 'team-a')?.kind, 'team');
  assert.equal(accountSpace(session, null)?.id, 'personal-a');
  assert.equal(accountSpace(session, 'removed-team'), null);
  assert.equal(accountSpace({ ...session, user: null }, 'team-a'), null);
  assert.equal(accountSpace({ ...session, spaces: [session.spaces[0]] }, null), null);
  assert.equal(accountSpace({ ...session, spaces: [] }, null), null);
});

test('receipt ownership separates shared spaces, actor switches, and ambiguous identifiers', () => {
  assert.notEqual(accountScope('actor-a', 'team-a'), accountScope('actor-b', 'team-a'));
  assert.notEqual(accountScope('actor:a', 'team'), accountScope('actor', 'a:team'));
  assert.equal(accountScope(undefined, 'team-a'), null);
  assert.equal(accountScope('actor-a', undefined), null);
  assert.throws(() => readAccountEntitlements(receipt, 'personal-a'));
  assert.throws(() => readAccountEntitlements({ ...receipt, spaceId: undefined }, 'team-a'));
});

test('malformed or rounded balances cannot become confirmed entitlement figures', () => {
  assert.deepEqual(readAccountEntitlements(receipt, 'team-a'), receipt);
  for (const value of [null, [], {}, '1200', { ...receipt, periodEnd: null }])
    assert.throws(() => readAccountEntitlements(value, 'team-a'));
  for (const field of ['available', 'held', 'freeAvailable', 'purchasedAvailable']) {
    for (const value of ['1000', null, -1, 0.25, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(
        () => readAccountEntitlements({ ...receipt, [field]: value }, 'team-a'),
        `${field} must reject ${String(value)}`,
      );
    }
  }
  assert.throws(() => readAccountEntitlements({ ...receipt, available: 1199 }, 'team-a'));
  assert.throws(() => readAccountEntitlements({ ...receipt, freeAvailable: 0 }, 'team-a'));
});

test('zero is a valid balance and large safe integers retain exact precision', () => {
  const zero = { ...receipt, available: 0, held: 0, freeAvailable: 0, purchasedAvailable: 0 };
  assert.deepEqual(readAccountEntitlements(zero, 'team-a'), zero);
  const large = {
    ...zero,
    available: Number.MAX_SAFE_INTEGER,
    purchasedAvailable: Number.MAX_SAFE_INTEGER,
  };
  assert.deepEqual(readAccountEntitlements(large, 'team-a'), large);
  assert.equal(formatAccountUnits(0), '0');
  assert.equal(formatAccountUnits(Number.MAX_SAFE_INTEGER), '9,007,199,254,740,991');
  assert.equal(formatAccountUnits(Infinity), '—');
  assert.equal(formatAccountUnits(1.5), '—');
});

test('period receipts reject normalized-invalid dates and render the server billing timezone', () => {
  for (const periodEnd of [
    '2026-12-01',
    '2026-12-01T00:00:00',
    '2026-02-30T00:00:00.000Z',
    '2026-02-29T00:00:00.000Z',
    '2026-13-01T00:00:00.000Z',
    '2026-12-01T24:00:00.000Z',
    '2026-12-01T00:00:60.000Z',
  ]) {
    assert.throws(() => readAccountEntitlements({ ...receipt, periodEnd }, 'team-a'), periodEnd);
  }
  assert.equal(
    readAccountEntitlements({ ...receipt, periodEnd: '2028-02-29T00:00:00+08:00' }, 'team-a')
      .periodEnd,
    '2028-02-29T00:00:00+08:00',
  );
  const displayed = formatAccountPeriod(receipt.periodEnd);
  assert.match(displayed, /2026年12月1日/);
  assert.match(displayed, /00:00/);
});

test('the account identity never repeats an accidentally unmasked phone', () => {
  assert.equal(accountPhone('138****1234'), '138****1234');
  assert.equal(accountPhone(' +86 138****1234 '), '+86 138****1234');
  assert.equal(accountPhone('+8613800131234'), '•••• 1234');
  assert.equal(accountPhone('not a phone'), '手机号已隐藏');
});

test('account tabs have bounded wrapping and Home/End destinations for both orientations', () => {
  assert.equal(nextAccountTab('overview', 'ArrowLeft'), 'data');
  assert.equal(nextAccountTab('data', 'ArrowRight'), 'overview');
  assert.equal(nextAccountTab('billing', 'ArrowUp'), 'security');
  assert.equal(nextAccountTab('security', 'ArrowDown'), 'billing');
  assert.equal(nextAccountTab('data', 'Home'), 'overview');
  assert.equal(nextAccountTab('overview', 'End'), 'data');
  assert.equal(nextAccountTab('overview', 'Tab'), null);
});

test('retained draft actions recheck the actor and exact snapshot while preserving export during saving', () => {
  const store = new DocumentDraftStore();
  const input = {
    actorId: 'actor-a',
    projectId: 'project-a',
    projectTitle: '不可访问的项目',
    base: null,
    title: '草稿',
    body: '保留的正文',
  };
  const write = store.put(input);
  assert.ok(write.ok);
  if (!write.ok) return;
  const captured = write.draft;
  assert.equal(accountDraftActionAllowed('actor-a', captured, captured, 'export'), true);
  assert.equal(accountDraftActionAllowed(null, captured, captured, 'export'), false);
  assert.equal(accountDraftActionAllowed('actor-b', captured, captured, 'export'), false);
  assert.equal(accountDraftActionAllowed('actor-a', null, captured, 'discard'), false);
  store.put({ ...input, body: '后续输入' });
  const changed = store.get('actor-a', 'project-a')!;
  assert.equal(accountDraftActionAllowed('actor-a', changed, captured, 'discard'), false);
  assert.equal(store.beginSave(changed), true);
  const saving = store.get('actor-a', 'project-a')!;
  assert.equal(accountDraftActionAllowed('actor-a', saving, saving, 'export'), true);
  assert.equal(accountDraftActionAllowed('actor-a', saving, saving, 'discard'), false);
  store.finishUnconfirmedSave(changed, false);
  const uncertain = store.get('actor-a', 'project-a')!;
  assert.equal(accountDraftActionAllowed('actor-a', uncertain, uncertain, 'export'), true);
  assert.equal(accountDraftActionAllowed('actor-a', uncertain, uncertain, 'discard'), true);
  assert.equal(store.get('actor-a', 'project-a')?.body, '后续输入');
});
