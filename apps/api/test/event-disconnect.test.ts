import assert from 'node:assert/strict';
import { get } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test('closing a workspace event poll stops database reads before shutdown', { skip: !databaseUrl }, async (t) => {
  const fixture = await collaborationFixture(databaseUrl!);
  let stopped = false;
  t.after(async () => { if (!stopped) await fixture.close(); });
  const query = t.mock.method(fixture.db, 'query');
  const origin = await fixture.app.listen({ host: '127.0.0.1', port: 0 });
  const closed = new Promise<void>((resolve) =>
    fixture.app.server.once('request', (_req, reply) => reply.once('close', resolve)));
  const req = get(origin + '/v1/events?spaceId=' + fixture.teamId +
    '&after=9007199254740991&waitMs=15000', { headers: { cookie: fixture.actors.owner.cookie } });
  req.on('error', () => {}); // Destroying a pending GET resets the client's socket.
  t.after(() => { req.destroy(); });
  const deadline = Date.now() + 4000;
  const eventRead = () => query.mock.calls.find((call) =>
    String(call.arguments[0]).includes('FROM events WHERE space_id='));
  while (!eventRead() && Date.now() < deadline) await delay(5);
  const firstRead = eventRead();
  assert.ok(firstRead, 'the request reached the authorized database poll');
  await firstRead.result;
  req.destroy();
  await closed;
  const readsAtDisconnect = query.mock.callCount();
  await fixture.close();
  stopped = true;
  await delay(600); // The previous poll interval was 500 ms.
  assert.equal(query.mock.callCount(), readsAtDisconnect);
});
