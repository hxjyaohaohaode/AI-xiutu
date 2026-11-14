import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { hash, hashPassword } from '../src/core.js';
import { collaborationFixture } from './collaboration-fixture.js';

const database = process.env.TEST_DATABASE_URL;
const reason = 'Account lifecycle integration check';

test('account managers control operator access and close accounts without exposing projects', { skip: !database }, async () => {
  const f = await collaborationFixture(database!);
  const { operator, owner, editor, viewer } = f.actors;
  const endpoint = (target: string) => '/v1/ops/users/' + target;
  const role = (newRole: 'user' | 'operator') => ({
    role: newRole, expectedRole: newRole === 'operator' ? 'user' : 'operator', reason,
  });
  try {
    await f.db.query('UPDATE operator_users SET manages_accounts=true WHERE user_id=$1', [operator.id]);
    assert.equal((await f.call('GET', '/v1/ops/users', undefined, 'operator')).json().canManageAccounts, true);
    assert.equal((await f.call('PUT', endpoint(viewer.id) + '/role', role('operator'), 'editor')).statusCode, 403);
    assert.equal((await f.call('POST', endpoint(operator.id) + '/close', { reason }, 'operator')).statusCode, 403);
    assert.equal((await f.call('POST', endpoint(owner.id) + '/close', { reason }, 'operator')).json().error.code, 'ACCOUNT_OWNS_TEAMS');

    const phone = '+1555' + String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, '0');
    const password = randomBytes(24).toString('base64url');
    await f.db.query('UPDATE users SET phone=$1,password_hash=$2 WHERE id=$3', [
      phone, await hashPassword(password), editor.id,
    ]);
    const signIn = () => f.app.inject({
      method: 'POST', url: '/v1/auth/login', remoteAddress: '127.0.2.3',
      headers: { origin: f.origin }, payload: { phone, password },
    });
    const getCookie = (value: string | string[] | undefined) =>
      (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? '';
    const previous = await signIn();
    assert.equal(previous.statusCode, 200, previous.body);
    assert.equal(previous.json().user.isOperator, false);

    const assigned = await f.call('PUT', endpoint(editor.id) + '/role', role('operator'), 'operator');
    assert.equal(assigned.statusCode, 200, assigned.body);
    assert.equal((await f.call('GET', '/v1/ops/users', undefined, 'editor')).statusCode, 401);
    const signedIn = await signIn();
    assert.equal(signedIn.statusCode, 200);
    assert.equal(signedIn.json().user.isOperator, true);
    const cookie = getCookie(signedIn.headers['set-cookie']);
    const asEditor = (method: 'GET' | 'PUT' | 'POST', url: string, payload?: Record<string, unknown>) =>
      f.app.inject({ method, url, remoteAddress: '127.0.2.3', headers: { cookie, origin: f.origin }, payload });
    assert.equal((await asEditor('GET', '/v1/ops/users')).json().canManageAccounts, false);
    assert.equal((await asEditor('POST', endpoint(viewer.id) + '/close', { reason })).statusCode, 403);
    assert.equal((await asEditor('PUT', endpoint(viewer.id) + '/role', role('operator'))).statusCode, 403);
    assert.equal((await asEditor('GET', '/v1/projects/' + f.privateProjectId)).statusCode, 404);
    assert.equal((await f.call('POST', endpoint(editor.id) + '/close', { reason }, 'operator')).json().error.code, 'OPERATOR_PROTECTED');

    assert.equal((await f.call('PUT', endpoint(editor.id) + '/role', role('user'), 'operator')).statusCode, 200);
    assert.equal((await asEditor('GET', '/v1/ops/users')).statusCode, 401);
    const regular = await signIn();
    assert.equal(regular.json().user.isOperator, false);
    const originalCookie = getCookie(regular.headers['set-cookie']);
    await f.db.query(
      "INSERT INTO share_grants(project_id,target_user_id,mode,expires_at,created_by) VALUES($1,$2,'reference',now()+interval '1 day',$3)",
      [f.privateProjectId, editor.id, owner.id],
    );
    const closed = await f.call('POST', endpoint(editor.id) + '/close', { reason }, 'operator');
    assert.equal(closed.statusCode, 200, closed.body);
    assert.equal((await signIn()).statusCode, 401);
    assert.equal((await f.app.inject({ method: 'GET', url: '/v1/assistant/models', headers: { cookie: originalCookie } })).statusCode, 401);
    assert.equal((await f.call('PATCH', endpoint(editor.id), { status: 'active', reason }, 'operator')).json().error.code, 'ACCOUNT_CLOSED');
    assert.equal((await f.call('POST', endpoint(editor.id) + '/close', { reason }, 'operator')).statusCode, 200);
    const account = (await f.db.query(
      'SELECT status,phone<>$2 AS anonymized,password_hash IS NULL AS no_password,phone_verified_at IS NULL AS no_verified_phone FROM users WHERE id=$1',
      [editor.id, phone],
    )).rows[0];
    assert.deepEqual(account, { status: 'closed', anonymized: true, no_password: true, no_verified_phone: true });
    assert.equal((await f.db.query('SELECT 1 FROM sessions WHERE token_hash=$1', [hash(originalCookie.split('=')[1]!)])).rowCount, 0);
    assert.equal((await f.db.query('SELECT 1 FROM memberships WHERE space_id=$1 AND user_id=$2', [f.teamId, editor.id])).rowCount, 0);
    assert.equal((await f.db.query('SELECT 1 FROM share_grants WHERE target_user_id=$1 AND revoked_at IS NOT NULL', [editor.id])).rowCount, 1);
    assert.equal((await f.db.query("SELECT 1 FROM audit_entries WHERE target_id=$1 AND action='operator.user_close'", [editor.id])).rowCount, 1);
  } finally {
    await f.close();
  }
});
