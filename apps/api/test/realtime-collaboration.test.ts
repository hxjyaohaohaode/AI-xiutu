import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createRecipeV3 } from '@ai-xiutu/editor';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'authoritative collaborative editing, leases, replay and revocation use real SQL',
  { skip: !databaseUrl },
  async (t) => {
    const f = await collaborationFixture(databaseUrl!);
    const roomId = f.artwork.artwork.id,
      route = `/v1/artworks/${roomId}/collaboration`;
    const join = async (actor: 'owner' | 'editor' | 'viewer') => {
      const r = await f.call('POST', `${route}/sessions`, { clientId: randomUUID() }, actor);
      assert.equal(r.statusCode, 201, r.body);
      return r.json().session;
    };
    const acquire = async (
      session: any,
      target: any,
      actor: 'owner' | 'editor' | 'viewer' = 'owner',
    ) => {
      const r = await f.call('POST', `${route}/leases`, { sessionId: session.id, target }, actor);
      assert.equal(r.statusCode, 201, r.body);
      return r.json().lease;
    };
    const release = async (lease: any, actor: 'owner' | 'editor' = 'owner') => {
      const r = await f.call(
        'DELETE',
        `${route}/leases/${lease.id}`,
        { sessionId: lease.sessionId, fence: lease.fence },
        actor,
      );
      assert.equal(r.statusCode, 200, r.body);
    };
    const command = (lease: any, baseVersion: number, operation: any) => ({
      protocolVersion: 1,
      idempotencyKey: randomUUID(),
      sessionId: lease.sessionId,
      leaseId: lease.id,
      fence: lease.fence,
      baseVersion,
      operation,
    });
    const parameter = (path: string, value: number) => ({ type: 'set-parameter', path, value });
    let owner: any,
      editor: any,
      viewer: any,
      a: any,
      b: any,
      firstCommand: any,
      head = 1;
    try {
      await t.test(
        'membership and role gates apply to read, join and lease acquisition',
        async () => {
          assert.equal((await f.call('GET', route, undefined, 'outsider')).statusCode, 403);
          owner = await join('owner');
          editor = await join('editor');
          viewer = await join('viewer');
          const denied = await f.call(
            'POST',
            `${route}/leases`,
            { sessionId: viewer.id, target: { kind: 'document' } },
            'viewer',
          );
          assert.equal(denied.statusCode, 403);
          assert.equal((await f.call('GET', `${route}?after=9999999999999999999`)).statusCode, 400);
        },
      );
      await t.test(
        'long-poll admission bounds concurrent subscriptions and releases slots after response',
        async () => {
          const cursor = (await f.call('GET', route)).json().cursor;
          const requests = Array.from({ length: 9 }, () =>
            f.call('GET', `${route}?after=${cursor}&waitMs=5000&knownVersion=1`),
          );
          const first = await Promise.race(requests);
          assert.equal(first.statusCode, 429, first.body);
          assert.equal(first.json().error.code, 'COLLABORATION_POLL_LIMIT');
          await f.db.query(
            'SELECT collaboration_emit($1,\'presence.changed\',$2,\'{"reason":"bounded-poll-test"}\'::jsonb)',
            [roomId, f.actors.owner.id],
          );
          const settled = await Promise.all(requests);
          assert.deepEqual(
            settled.map((response) => response.statusCode).sort(),
            [200, 200, 200, 200, 200, 200, 200, 200, 429],
          );
          assert.equal((await f.call('GET', route)).statusCode, 200);
        },
      );
      await t.test(
        'same target conflicts but distinct tools get independent fenced leases',
        async () => {
          a = await acquire(owner, { kind: 'parameter', id: 'adjustments.exposure' });
          const blocked = await f.call(
            'POST',
            `${route}/leases`,
            { sessionId: editor.id, target: { kind: 'parameter', id: 'adjustments.exposure' } },
            'editor',
          );
          assert.equal(blocked.statusCode, 409, blocked.body);
          assert.equal(blocked.json().error.code, 'LEASE_CONFLICT');
          assert.equal(blocked.json().error.details.leases[0].userId, f.actors.owner.id);
          b = await acquire(editor, { kind: 'parameter', id: 'adjustments.contrast' }, 'editor');
          assert.equal(typeof a.fence, 'string');
          assert.notEqual(a.fence, b.fence);
          const repeat = await f.call('POST', `${route}/leases`, {
            sessionId: owner.id,
            target: a.target,
          });
          assert.equal(repeat.statusCode, 200);
          assert.equal(repeat.json().lease.id, a.id);
        },
      );
      await t.test(
        'simultaneous claims on the same tool grant exactly one editing right',
        async () => {
          const target = { kind: 'parameter', id: 'adjustments.tint' };
          const responses = await Promise.all([
            f.call('POST', `${route}/leases`, { sessionId: owner.id, target }),
            f.call('POST', `${route}/leases`, { sessionId: editor.id, target }, 'editor'),
          ]);
          assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409]);
          const winner = responses.findIndex((r) => r.statusCode === 201);
          await release(responses[winner]!.json().lease, winner === 0 ? 'owner' : 'editor');
        },
      );
      await t.test(
        'temporary previews and cursor heartbeats do not create persistent revisions',
        async () => {
          const preview = await f.call('POST', `${route}/previews`, {
            sessionId: owner.id,
            leaseId: a.id,
            fence: a.fence,
            baseVersion: 1,
            sequence: 1,
            operation: parameter('adjustments.exposure', -1.25),
          });
          assert.equal(preview.statusCode, 200, preview.body);
          assert.equal(preview.json().accepted, true);
          const beat = await f.call('PATCH', `${route}/sessions/${owner.id}`, {
            sequence: 1,
            cursor: { x: 0.2, y: 0.3 },
            tool: 'exposure',
            selection: a.target,
          });
          assert.equal(beat.statusCode, 200, beat.body);
          const stale = await f.call('PATCH', `${route}/sessions/${owner.id}`, {
            sequence: 0,
            cursor: { x: 0.9, y: 0.9 },
          });
          assert.equal(stale.json().reason, 'STALE_SEQUENCE');
          const state = (
            await f.call('GET', `${route}?knownVersion=1`, undefined, 'editor')
          ).json();
          assert.equal(state.snapshot.revision, null);
          assert.equal(state.snapshot.artwork.headVersion, 1);
          assert.equal(state.snapshot.previews.length, 1);
          assert.equal(state.snapshot.previews[0].operation.value, -1.25);
          assert.deepEqual(state.snapshot.presences.find((p: any) => p.id === owner.id).cursor, {
            x: 0.2,
            y: 0.3,
          });
          assert.equal(
            Number(
              (await f.db.query('SELECT count(*) FROM revisions WHERE artwork_id=$1', [roomId]))
                .rows[0]!.count,
            ),
            1,
          );
        },
      );
      await t.test(
        'disjoint concurrent edits from the same base merge targeted fields and preserve origin',
        async () => {
          firstCommand = command(a, 1, parameter('adjustments.exposure', 0.75));
          const [left, right] = await Promise.all([
            f.call('POST', `${route}/commands`, firstCommand),
            f.call(
              'POST',
              `${route}/commands`,
              command(b, 1, parameter('adjustments.contrast', -32.5)),
              'editor',
            ),
          ]);
          assert.equal(left.statusCode, 201, left.body);
          assert.equal(right.statusCode, 201, right.body);
          assert.equal([left.json().rebased, right.json().rebased].filter(Boolean).length, 1);
          const current = (await f.call('GET', `/v1/artworks/${roomId}`)).json();
          head = current.artwork.headVersion;
          assert.equal(head, 3);
          assert.equal(current.revision.recipe.adjustments.exposure, 0.75);
          assert.equal(current.revision.recipe.adjustments.contrast, -32.5);
          assert.equal(current.revision.assetId, f.assetId);
          assert.equal((await f.call('GET', route)).json().snapshot.previews.length, 0);
        },
      );
      await t.test(
        'legacy saves, title changes, restores and direct source changes cannot bypass leases',
        async () => {
          for (const r of [
            await f.call('POST', `/v1/artworks/${roomId}/revisions`, {
              expectedVersion: head,
              recipe: createRecipeV3(),
            }),
            await f.call('PATCH', `/v1/artworks/${roomId}`, {
              expectedVersion: head,
              title: 'overwrite attempt',
            }),
            await f.call('POST', `/v1/artworks/${roomId}/restore`, {
              expectedVersion: head,
              revisionId: f.artwork.revision.id,
            }),
          ]) {
            assert.equal(r.statusCode, 409, r.body);
            assert.equal(r.json().error.code, 'COLLABORATION_LOCKED');
          }
          await assert.rejects(
            f.db.query('UPDATE artworks SET asset_id=$2 WHERE id=$1', [roomId, f.privateAssetId]),
            /COLLABORATION_LOCKED/,
          );
          assert.equal(
            (await f.call('GET', `/v1/artworks/${roomId}`)).json().artwork.headVersion,
            head,
          );
        },
      );
      await t.test(
        'receipt replay is durable after lease release and body changes reject without duplicate revisions',
        async () => {
          await release(a);
          await release(a);
          await release(b, 'editor');
          const replay = await f.call('POST', `${route}/commands`, firstCommand);
          assert.equal(replay.statusCode, 200, replay.body);
          assert.equal(replay.json().replayed, true);
          assert.equal(
            (await f.call('GET', `/v1/artworks/${roomId}`)).json().artwork.headVersion,
            head,
          );
          const mismatch = await f.call('POST', `${route}/commands`, {
            ...firstCommand,
            operation: parameter('adjustments.exposure', 0.5),
          });
          assert.equal(mismatch.statusCode, 409);
          assert.equal(mismatch.json().error.code, 'IDEMPOTENCY_CONFLICT');
          const l = await acquire(owner, { kind: 'parameter', id: 'adjustments.exposure' });
          const conflict = await f.call(
            'POST',
            `${route}/commands`,
            command(l, 1, parameter('adjustments.exposure', 1)),
          );
          assert.equal(conflict.statusCode, 409);
          assert.equal(conflict.json().error.code, 'VERSION_CONFLICT');
          await release(l);
        },
      );
      await t.test(
        'overlapping mask ranges reject, distinct regions work and growing bounds are revalidated',
        async () => {
          const left = await acquire(owner, {
            kind: 'region',
            collection: 'regionEdits',
            id: 'left',
          });
          const right = await acquire(
            editor,
            { kind: 'region', collection: 'regionEdits', id: 'right' },
            'editor',
          );
          const region = structuredClone(f.recipe.regionEdits[0]!);
          region.mask = {
            type: 'radial',
            centerX: 0.5,
            centerY: 0.5,
            radiusX: 0.49,
            radiusY: 0.4,
            feather: 0,
            invert: false,
          };
          const blocked = await f.call(
            'POST',
            `${route}/commands`,
            command(left, head, {
              type: 'replace-node',
              collection: 'regionEdits',
              id: 'left',
              value: region,
            }),
          );
          assert.equal(blocked.statusCode, 409, blocked.body);
          assert.equal(blocked.json().error.code, 'LEASE_CONFLICT');
          const document = await f.call('POST', `${route}/leases`, {
            sessionId: owner.id,
            target: { kind: 'document' },
          });
          assert.equal(document.statusCode, 409);
          await release(left);
          await release(right, 'editor');
        },
      );
      await t.test(
        'expired fencing cannot write even after the same user reacquires an identical target',
        async () => {
          const old = await acquire(owner, { kind: 'parameter', id: 'adjustments.brightness' });
          await f.db.query(
            "UPDATE collaboration_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [old.id],
          );
          const fresh = await acquire(owner, old.target);
          assert.notEqual(old.fence, fresh.fence);
          const stale = await f.call(
            'POST',
            `${route}/commands`,
            command(old, head, parameter('adjustments.brightness', 25)),
          );
          assert.equal(stale.statusCode, 409);
          assert.equal(stale.json().error.code, 'LEASE_EXPIRED');
          const wrongActor = await f.call(
            'POST',
            `${route}/commands`,
            command(fresh, head, parameter('adjustments.brightness', 25)),
            'editor',
          );
          assert.equal(wrongActor.statusCode, 409);
          await release(fresh);
        },
      );
      await t.test(
        'full-document replacement validates every image source and never silently changes source ownership',
        async () => {
          const l = await acquire(owner, { kind: 'document' });
          const candidate = createRecipeV3({
            imageLayers: [
              {
                id: 'stolen',
                name: 'foreign',
                sourceId: f.privateAssetId,
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                rotationDegrees: 0,
                flipX: false,
                flipY: false,
                enabled: false,
                opacity: 1,
                blendMode: 'normal',
                mask: null,
              },
            ],
          });
          const denied = await f.call(
            'POST',
            `${route}/commands`,
            command(l, head, { type: 'replace-recipe', recipe: candidate }),
          );
          assert.equal(denied.statusCode, 400, denied.body);
          await release(l);
        },
      );
      await t.test(
        'long poll wakes for changes promptly and does not wait for the entire timeout',
        async () => {
          const startState = (await f.call('GET', `${route}?knownVersion=${head}`)).json();
          const at = Date.now();
          const waiting = f.call(
            'GET',
            `${route}?after=${startState.cursor}&knownVersion=${head}&waitMs=5000`,
            undefined,
            'editor',
          );
          await delay(35);
          const l = await acquire(owner, { kind: 'parameter', id: 'adjustments.shadows' });
          const response = await waiting;
          assert.equal(response.statusCode, 200, response.body);
          assert.ok(Date.now() - at < 2500, 'event should wake before 5 seconds');
          assert.ok(response.json().events.some((e: any) => e.type === 'lease.changed'));
          assert.equal(response.json().snapshot.revision, null);
          await release(l);
        },
      );
      await t.test(
        'reconnect past bounded event history returns an authoritative reset',
        async () => {
          await f.db.query("SELECT collaboration_emit($1,'presence.changed',$2,'{}')", [
            roomId,
            f.actors.owner.id,
          ]);
          await f.db.query(
            'DELETE FROM collaboration_events WHERE artwork_id=$1 AND seq<(SELECT collaboration_cursor FROM artworks WHERE id=$1)',
            [roomId],
          );
          const response = await f.call('GET', `${route}?after=0&knownVersion=${head}`);
          assert.equal(response.json().resetRequired, true);
          assert.equal(response.json().snapshot.revision.version, head);
        },
      );
      await t.test(
        'membership removal revokes active sessions, leases, previews and pending poll while preserving team resources',
        async () => {
          const l = await acquire(
            editor,
            { kind: 'parameter', id: 'adjustments.whites' },
            'editor',
          );
          assert.equal(
            (
              await f.call(
                'POST',
                `${route}/previews`,
                {
                  sessionId: editor.id,
                  leaseId: l.id,
                  fence: l.fence,
                  baseVersion: head,
                  sequence: 1,
                  operation: parameter('adjustments.whites', 20),
                },
                'editor',
              )
            ).statusCode,
            200,
          );
          const state = (await f.call('GET', route, undefined, 'editor')).json();
          const pending = f.call(
            'GET',
            `${route}?after=${state.cursor}&knownVersion=${head}&waitMs=5000`,
            undefined,
            'editor',
          );
          await delay(30);
          const removed = await f.call(
            'DELETE',
            `/v1/spaces/${f.teamId}/members/${f.actors.editor.id}`,
          );
          assert.equal(removed.statusCode, 200, removed.body);
          const denied = await pending;
          assert.equal(denied.statusCode, 403, denied.body);
          assert.equal(
            (await f.call('GET', `/v1/artworks/${roomId}`, undefined, 'editor')).statusCode,
            404,
          );
          assert.equal(
            (
              await f.db.query(
                'SELECT count(*) FROM collaboration_sessions WHERE user_id=$1 AND artwork_id=$2',
                [f.actors.editor.id, roomId],
              )
            ).rows[0]!.count,
            '0',
          );
          assert.equal(
            (await f.call('GET', `/v1/artworks/${roomId}`)).json().artwork.assetId,
            f.assetId,
          );
          assert.equal(
            (await f.call('POST', `${route}/commands`, firstCommand, 'editor')).statusCode,
            403,
          );
          assert.ok(
            (await f.call('GET', `/v1/spaces/${f.teamId}/activity`))
              .json()
              .activities.some(
                (a: any) => a.kind === 'removed' && a.targetUserId === f.actors.editor.id,
              ),
          );
        },
      );
      await t.test(
        'legacy revision writes remain compatible when no lease exists and emit room history',
        async () => {
          const before = (await f.call('GET', route)).json().cursor;
          const saved = await f.call('POST', `/v1/artworks/${roomId}/revisions`, {
            expectedVersion: head,
            recipe: createRecipeV3(),
          });
          assert.equal(saved.statusCode, 201, saved.body);
          head++;
          const room = (await f.call('GET', `${route}?after=${before}`)).json();
          assert.equal(room.snapshot.revision.version, head);
          assert.ok(
            room.events.some(
              (e: any) => e.type === 'revision.committed' && e.payload.version === head,
            ),
          );
        },
      );
    } finally {
      await f.close();
    }
  },
);
