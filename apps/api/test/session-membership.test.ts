import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { hash } from '../src/core.js';
import { collaborationFixture } from './collaboration-fixture.js';

const database = process.env.TEST_DATABASE_URL;

test(
  'the account can end its other sessions and keep the current login and other accounts',
  { skip: !database },
  async () => {
    const f = await collaborationFixture(database!);
    try {
      const other = randomBytes(32).toString('base64url');
      await f.db.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [hash(other), f.actors.owner.id],
      );
      const summary = await f.call('GET', '/v1/auth/sessions');
      assert.equal(summary.statusCode, 200, summary.body);
      assert.equal(summary.json().otherSessions, 1);
      assert.deepEqual(Object.keys(summary.json()).sort(), [
        'createdAt',
        'expiresAt',
        'otherSessions',
      ]);
      const endpoint = '/v1/auth/logout-others';
      assert.equal(
        (await f.call('POST', endpoint, { expectedUserId: f.actors.editor.id })).statusCode,
        409,
      );
      const body = { expectedUserId: f.actors.owner.id };
      const results = await Promise.all([
        f.call('POST', endpoint, body),
        f.call('POST', endpoint, body),
      ]);
      assert.deepEqual(results.map((r) => r.json().revoked).sort(), [0, 1]);
      assert.equal((await f.call('GET', '/v1/auth/sessions')).json().otherSessions, 0);
      assert.equal(
        (
          await f.app.inject({
            url: '/v1/auth/sessions',
            headers: { cookie: 'xiutu_session=' + other },
          })
        ).statusCode,
        401,
      );
      assert.equal((await f.call('GET', '/v1/auth/sessions', undefined, 'editor')).statusCode, 200);
    } finally {
      await f.close();
    }
  },
);

test(
  'team managers can inspect and revoke pending invitations, with fresh invitations after leaving',
  { skip: !database },
  async () => {
    const f = await collaborationFixture(database!);
    try {
      const path = '/v1/spaces/' + f.teamId + '/invitations';
      const invite = async (role: string) => {
        const reply = await f.call('POST', path, { role, maxUses: 3 });
        assert.equal(reply.statusCode, 201, reply.body);
        return reply.json().invitation;
      };
      const reader = await invite('viewer');
      const admin = await invite('admin');
      assert.equal((await f.call('GET', path, undefined, 'viewer')).statusCode, 403);
      await f.db.query("UPDATE memberships SET role='admin' WHERE space_id=$1 AND user_id=$2", [
        f.teamId,
        f.actors.editor.id,
      ]);
      const page = await f.call('GET', path, undefined, 'editor');
      assert.deepEqual(
        page.json().invitations.map((i: { id: string }) => i.id),
        [reader.id],
      );
      assert.ok(!page.body.includes(reader.code));
      assert.equal(
        (await f.call('DELETE', path + '/' + admin.id, undefined, 'editor')).statusCode,
        403,
      );
      const join = () =>
        f.call('POST', '/v1/invitations/accept', { code: reader.code }, 'outsider');
      assert.equal((await join()).statusCode, 200);
      assert.equal((await join()).statusCode, 200);
      assert.equal(
        (await f.call('DELETE', '/v1/spaces/' + f.teamId + '/members/' + f.actors.outsider.id))
          .statusCode,
        200,
      );
      const used = await join();
      assert.equal(used.statusCode, 400, used.body);
      assert.equal(used.json().error.code, 'INVITE_INVALID');
      assert.equal(
        (await f.call('DELETE', path + '/' + reader.id, undefined, 'editor')).statusCode,
        200,
      );
      assert.equal(
        (await f.call('DELETE', path + '/' + reader.id, undefined, 'editor')).statusCode,
        200,
      );
      assert.deepEqual(
        (await f.call('GET', path)).json().invitations.map((i: { id: string }) => i.id),
        [admin.id],
      );
      const fresh = await invite('viewer');
      assert.equal(
        (await f.call('POST', '/v1/invitations/accept', { code: fresh.code }, 'outsider'))
          .statusCode,
        200,
      );
    } finally {
      await f.close();
    }
  },
);
