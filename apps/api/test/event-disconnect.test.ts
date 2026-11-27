import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get, type ClientRequest } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test('closing a workspace event poll stops database reads before shutdown',
  { skip: !databaseUrl, timeout: 20_000 }, async (t) => {
    const fixture = await collaborationFixture(databaseUrl!);
    let stopped = false;
    let req: ClientRequest | undefined;
    t.after(async () => {
      req?.destroy();
      if (!stopped) {
        fixture.app.server.closeAllConnections();
        await fixture.close();
      }
    });

    const created = await fixture.call('POST', '/v1/projects/' + fixture.projectId + '/documents', {
      title: 'Historical event', body: 'Already seen by the workspace client.',
    });
    assert.equal(created.statusCode, 201);
    const { rows: [cursor] } = await fixture.db.query<{ seq: string }>(
      'SELECT max(seq)::text AS seq FROM events WHERE space_id=$1', [fixture.teamId]);
    assert.ok(cursor?.seq && BigInt(cursor.seq) > 0n);

    const origin = await fixture.app.listen({ host: '127.0.0.1', port: 0 });
    const accepted = once(fixture.app.server, 'request', { signal: AbortSignal.timeout(5000) });
    const query = t.mock.method(fixture.db, 'query');
    req = get(origin + '/v1/events?spaceId=' + fixture.teamId + '&after=' + cursor.seq + '&waitMs=15000',
      { headers: { cookie: fixture.actors.owner.cookie }, agent: false, signal: t.signal });
    req.on('error', () => {}); // Destroying a pending GET resets the client's socket.
    const [, reply] = await accepted;

    const eventRead = () => query.mock.calls.find((call) =>
      String(call.arguments[0]).includes('FROM events WHERE space_id='));
    const deadline = Date.now() + 5000;
    while (!eventRead() && Date.now() < deadline) await delay(5);
    const firstRead = eventRead();
    assert.ok(firstRead, 'the server reached the database poll after the historical cursor');
    const empty: unknown = await Promise.race([firstRead.result,
      delay(5000, undefined, { ref: false }).then(() => { throw new Error('event query timed out'); })]);
    assert.ok(empty && typeof empty === 'object' && 'rows' in empty);
    assert.deepEqual(empty.rows, []);

    const readsForThisSpace = () => query.mock.calls.filter((call) => {
      const values = call.arguments[1];
      return Array.isArray(values) && values[0] === fixture.teamId;
    }).length;
    const readsAtDisconnect = readsForThisSpace();
    assert.ok(!reply.destroyed, 'the empty poll is still waiting for future events');
    const closed = once(reply, 'close', { signal: AbortSignal.timeout(5000) });
    req.destroy();
    await closed;
    await fixture.close();
    stopped = true;
    await delay(600); // Wait past the 500 ms SQL polling interval.
    assert.equal(readsForThisSpace(), readsAtDisconnect);
  });
