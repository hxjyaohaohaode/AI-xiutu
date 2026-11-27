import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, issueSession } from '../src/core.js';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('authorized document history is paged and a restored version uses the normal CAS save', {
  skip: !databaseUrl,
}, async (t) => {
  const f = await collaborationFixture(databaseUrl!);
  t.after(() => f.close());
  const base = { title: 'Plan', body: 'First draft', formatting: {
    version: 1, paragraphs: [{ line: 0, align: 'center' }],
  } };
  const created = await f.call('POST', '/v1/projects/' + f.projectId + '/documents', base);
  assert.equal(created.statusCode, 201, created.body);
  const route = '/v1/documents/' + created.json().document.id;
  assert.equal((await f.call('PATCH', route, { body: 'Second draft', expectedVersion: 1 })).statusCode, 200);
  const versions = await f.call('GET', route + '/versions?limit=1', undefined, 'editor');
  assert.equal(versions.statusCode, 200, versions.body);
  assert.equal(versions.json().nextBeforeVersion, 2);
  assert.deepEqual(versions.json().versions.map((entry: { version: number }) => entry.version), [2]);
  assert.equal(Object.hasOwn(versions.json().versions[0], 'body'), false);
  const previous = await f.call('GET', route + '/versions?beforeVersion=2&limit=1', undefined);
  assert.equal(previous.json().versions[0].version, 1);
  assert.equal(previous.json().nextBeforeVersion, null);
  for (const actor of ['viewer', 'outsider', 'operator'] as const) {
    const denied = await f.call('GET', route + '/versions/1', undefined, actor);
    assert.ok([403, 404].includes(denied.statusCode), denied.body);
    assert.doesNotMatch(denied.body, /First draft/);
  }
  const history = await f.call('GET', route + '/versions/1', undefined);
  assert.equal(history.statusCode, 200, history.body);
  assert.deepEqual(history.json().document.formatting, base.formatting);
  const restored = await f.call('PATCH', route, { ...base, expectedVersion: 2 });
  assert.equal(restored.statusCode, 200, restored.body);
  assert.equal(restored.json().document.version, 3);
  assert.equal((await f.call('GET', route + '/versions/2')).json().document.body, 'Second draft');
  assert.equal((await f.call('PATCH', route, { ...base, expectedVersion: 2 })).statusCode, 409);
});

test('changing a password rotates the requesting session and invalidates other devices', {
  skip: !databaseUrl,
}, async (t) => {
  const f = await collaborationFixture(databaseUrl!);
  t.after(() => f.close());
  const owner = f.actors.owner;
  const currentPassword = 'local-fixture-current';
  const newPassword = 'local-fixture-replacement';
  await f.db.query('UPDATE users SET password_hash=$2 WHERE id=$1', [
    owner.id, await hashPassword(currentPassword),
  ]);
  const other = 'xiutu_session=' + await issueSession(f.db, owner.id);
  const route = '/v1/auth/change-password';
  const change = (cookie: string, password: string) => f.app.inject({
    method: 'POST', url: route, headers: { origin: f.origin, cookie },
    payload: { expectedUserId: owner.id, currentPassword: password, newPassword },
  });
  assert.equal((await change(owner.cookie, 'incorrect-fixture-password')).statusCode, 400);
  const changes = await Promise.all([change(owner.cookie, currentPassword), change(other, currentPassword)]);
  const successes = changes.filter(item => item.statusCode === 200);
  assert.equal(successes.length, 1);
  const cookie = successes[0]!.cookies.find(item => item.name === 'xiutu_session');
  assert.ok(cookie?.value);
  const read = (cookie: string) => f.app.inject({
    method: 'GET', url: '/v1/auth/sessions', headers: { cookie },
  });
  assert.equal((await read(other)).statusCode, 401);
  assert.equal((await read(owner.cookie)).statusCode, 401);
  const live = await read('xiutu_session=' + cookie.value);
  assert.equal(live.statusCode, 200, live.body);
  assert.equal(live.json().otherSessions, 0);
});
