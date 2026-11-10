import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  transaction,
  adjustUnits,
  reserveUnits,
  settleHold,
  releaseHold,
  getEntitlements,
} from '@ai-xiutu/db';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'resource memories, membership lifecycle and credit reports are authorized and persistent',
  { skip: !databaseUrl },
  async (t) => {
    const f = await collaborationFixture(databaseUrl!);
    const memory = {
      expectedVersion: 0,
      remembered: true,
      title: '雨天的人像',
      tags: ['人像', '雨夜'],
      note: '我喜欢保留自然肤色，不自动发给AI',
    };
    const usage = `/v1/usage?scope=space&spaceId=${f.teamId}`;
    const reserve = async (units: number) =>
      transaction(f.db, (tx) =>
        reserveUnits(tx, {
          spaceId: f.teamId,
          userId: f.actors.owner.id,
          units,
          idempotencyKey: randomUUID(),
          requestHash: randomUUID(),
        }),
      );
    let rememberedVersion = 1;
    try {
      await t.test(
        'cross-space resources search includes only current grants or memberships, never operator privilege',
        async () => {
          const own = await f.call('GET', '/v1/resources');
          assert.equal(own.statusCode, 200, own.body);
          assert.deepEqual(
            new Set(own.json().resources.map((r: any) => r.asset.id)),
            new Set([f.assetId, f.privateAssetId]),
          );
          const teammate = await f.call('GET', '/v1/resources', undefined, 'editor');
          assert.deepEqual(
            teammate.json().resources.map((r: any) => r.asset.id),
            [f.assetId],
          );
          assert.equal(
            (await f.call('GET', '/v1/resources', undefined, 'operator')).json().resources.length,
            0,
          );
          assert.equal(
            (
              await f.call(
                'GET',
                `/v1/resources?projectId=${f.privateProjectId}`,
                undefined,
                'editor',
              )
            ).json().resources.length,
            0,
          );
          assert.equal(
            (await f.call('GET', '/v1/resources?scope=personal')).json().resources[0].asset.id,
            f.privateAssetId,
          );
          const first = (await f.call('GET', '/v1/resources?limit=1')).json();
          assert.ok(first.nextCursor);
          const next = (
            await f.call(
              'GET',
              `/v1/resources?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
            )
          ).json();
          assert.equal(next.resources.length, 1);
          assert.notEqual(next.resources[0].asset.id, first.resources[0].asset.id);
          const wrong = await f.call(
            'GET',
            `/v1/resources?limit=1&scope=team&cursor=${encodeURIComponent(first.nextCursor)}`,
          );
          assert.equal(wrong.statusCode, 400);
          assert.equal(wrong.json().error.code, 'CURSOR_SCOPE_MISMATCH');
        },
      );
      await t.test(
        'long-term opt-in labels are private, searchable, versioned, and never written into shared asset metadata',
        async () => {
          const created = await f.call('PUT', `/v1/assets/${f.assetId}/memory`, memory, 'editor');
          assert.equal(created.statusCode, 200, created.body);
          assert.equal(created.json().memory.version, 1);
          assert.equal(
            (await f.call('PUT', `/v1/assets/${f.assetId}/memory`, memory, 'editor')).statusCode,
            409,
          );
          const own = (
            await f.call('GET', '/v1/resources?query=自然肤色&remembered=true', undefined, 'editor')
          ).json();
          assert.equal(own.resources.length, 1);
          assert.equal(own.resources[0].memory.title, memory.title);
          assert.equal(
            (await f.call('GET', '/v1/resources?query=自然肤色')).json().resources.length,
            0,
          );
          assert.equal((await f.call('GET', `/v1/assets/${f.assetId}/memory`)).json().memory, null);
          const row = (await f.db.query('SELECT annotations FROM assets WHERE id=$1', [f.assetId]))
            .rows[0]!;
          assert.equal(JSON.stringify(row).includes('自然肤色'), false);
          const audit = (
            await f.db.query(
              "SELECT detail::text FROM audit_entries WHERE action='resource.memory.update' AND target_id=$1",
              [f.assetId],
            )
          ).rows;
          assert.equal(JSON.stringify(audit).includes('自然肤色'), false);
          assert.equal(
            (await f.call('PUT', `/v1/assets/${f.privateAssetId}/memory`, memory, 'editor'))
              .statusCode,
            404,
          );
          const changed = await f.call(
            'PUT',
            `/v1/assets/${f.assetId}/memory`,
            { ...memory, expectedVersion: 1, remembered: false },
            'editor',
          );
          rememberedVersion = changed.json().memory.version;
          assert.equal(
            (await f.call('GET', '/v1/resources?remembered=true', undefined, 'editor')).json()
              .resources.length,
            0,
          );
        },
      );
      await t.test(
        'ledger reports distinguish issued, held, consumed, released, expired and signed adjustments',
        async () => {
          await transaction(f.db, (tx) =>
            adjustUnits(tx, {
              spaceId: f.teamId,
              actorId: f.actors.operator.id,
              units: 100,
              idempotencyKey: randomUUID(),
              requestHash: randomUUID(),
              reason: '=IMPORTXML("https://example.invalid")',
            }),
          );
          const spent = await reserve(40);
          const imageJob = (
            await f.db.query(
              `INSERT INTO ai_jobs(project_id,actor_id,model_id,input_hash,state,operation,input,output,idempotency_key,hold_id)
        VALUES($1,$2,'fixture-image', $3,'completed','generate-image','{}','{}',$4,$5) RETURNING id`,
              [f.projectId, f.actors.owner.id, 'a'.repeat(64), randomUUID(), spent.id],
            )
          ).rows[0]!.id;
          await transaction(f.db, (tx) => settleHold(tx, spent.id));
          const released = await reserve(10);
          await transaction(f.db, (tx) => releaseHold(tx, released.id));
          const expiringLot = await transaction(f.db, async (tx) => {
            const lot = (
              await tx.query(
                `INSERT INTO quota_lots(space_id,kind,source_key,total_units,available,expires_at)
          VALUES($1,'free',$2,30,30,clock_timestamp()+interval '1 hour') RETURNING id`,
                [f.teamId, randomUUID()],
              )
            ).rows[0]!.id;
            await tx.query(
              "INSERT INTO ledger_entries(space_id,lot_id,kind,units,event_key,actor_id,reason) VALUES($1,$2,'grant',30,$3,$4,'fixture period')",
              [f.teamId, lot, randomUUID(), f.actors.owner.id],
            );
            return lot;
          });
          const expiryHold = await reserve(20);
          await f.db.query(
            "UPDATE quota_lots SET expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1",
            [expiringLot],
          );
          await transaction(f.db, (tx) => getEntitlements(tx, f.teamId));
          await transaction(f.db, (tx) => releaseHold(tx, expiryHold.id));
          await transaction(f.db, (tx) =>
            adjustUnits(tx, {
              spaceId: f.teamId,
              actorId: f.actors.operator.id,
              units: -5,
              idempotencyKey: randomUUID(),
              requestHash: randomUUID(),
              reason: 'operator negative adjustment',
            }),
          );
          const report = await f.call('GET', usage);
          assert.equal(report.statusCode, 200, report.body);
          assert.deepEqual(report.json().totals, {
            issued: 30,
            held: 70,
            consumed: 40,
            released: 30,
            expired: 30,
            adjusted: 95,
          });
          assert.deepEqual(report.json().balance, {
            available: 55,
            held: 0,
            consumed: 40,
            expired: 30,
            revoked: 5,
          });
          assert.equal(report.json().unit, 'credit');
          assert.equal(report.json().unknownAmountEntries, 0);
          const consumed = report.json().entries.find((r: any) => r.kind === 'consumed');
          assert.equal(consumed.units, 40);
          assert.equal(consumed.jobId, imageJob);
          assert.equal(consumed.modelId, 'fixture-image');
          const expiredRelease = report
            .json()
            .entries.find((r: any) => r.holdId === expiryHold.id && r.kind === 'released');
          assert.deepEqual(expiredRelease.movement, {
            issued: 0,
            held: 0,
            consumed: 0,
            released: 20,
            expired: 20,
            adjusted: 0,
          });
          const before = report.json().totals;
          await transaction(f.db, (tx) => releaseHold(tx, expiryHold.id));
          assert.deepEqual(
            (await f.call('GET', usage)).json().totals,
            before,
            'repeated settlement never changes accounting',
          );
        },
      );
      await t.test(
        'assistant and live voice consumption appear alongside image jobs, without reading their private prompts',
        async () => {
          const voiceHold = await reserve(5);
          const voice = (
            await f.db.query(
              `INSERT INTO voice_sessions(project_id,actor_id,model_id,backend_model_id,idempotency_key,request_hash,hold_id,state,config,scope,connection_hash,connect_expires_at)
        VALUES($1,$2,'fixture-voice','fixture-backend',$3,$4,$5,'closed','{}','{}',$6,clock_timestamp()) RETURNING id`,
              [
                f.projectId,
                f.actors.owner.id,
                randomUUID(),
                'b'.repeat(64),
                voiceHold.id,
                'c'.repeat(64),
              ],
            )
          ).rows[0]!.id;
          await transaction(f.db, (tx) => settleHold(tx, voiceHold.id));
          const agentHold = await reserve(7);
          const turn = (
            await f.db.query(
              `INSERT INTO assistant_turns(project_id,actor_id,model_id,idempotency_key,request_hash,state,prompt,hold_id)
        VALUES($1,$2,'fixture-agent',$3,$4,'failed','private prompt must not appear in report',$5) RETURNING id`,
              [f.projectId, f.actors.owner.id, randomUUID(), 'd'.repeat(64), agentHold.id],
            )
          ).rows[0]!.id;
          await transaction(f.db, (tx) => releaseHold(tx, agentHold.id));
          const report = (await f.call('GET', usage)).json();
          assert.equal(
            report.entries.find((e: any) => e.jobId === voice && e.kind === 'consumed').operation,
            'realtime-voice',
          );
          assert.equal(
            report.entries.find((e: any) => e.jobId === turn && e.kind === 'released').operation,
            'assistant-turn',
          );
          assert.equal(JSON.stringify(report).includes('private prompt'), false);
          assert.equal(report.totals.consumed, 45);
          assert.equal(report.totals.released, 37);
        },
      );
      await t.test(
        'personal, team and operator scopes are distinct and automatic monthly rights remain idempotent',
        async () => {
          assert.equal((await f.call('GET', usage, undefined, 'outsider')).statusCode, 403);
          assert.equal((await f.call('GET', '/v1/ops/usage')).statusCode, 403);
          assert.equal(
            (await f.call('GET', `/v1/usage?scope=personal&spaceId=${f.actors.editor.spaceId}`))
              .statusCode,
            403,
          );
          assert.equal(
            (await f.call('GET', `/v1/usage?actorId=${f.actors.editor.id}`)).statusCode,
            400,
          );
          const initial = (await f.call('GET', '/v1/usage')).json();
          const repeated = (await f.call('GET', '/v1/usage')).json();
          assert.equal(initial.totals.issued, repeated.totals.issued);
          assert.equal(
            (
              await f.db.query('SELECT count(*) FROM quota_grants WHERE subject_id=$1', [
                f.actors.owner.id,
              ])
            ).rows[0]!.count,
            '1',
          );
          assert.equal((await f.call('GET', usage, undefined, 'viewer')).statusCode, 200);
          const ops = await f.call(
            'GET',
            `/v1/ops/usage?spaceId=${f.teamId}&bucket=month`,
            undefined,
            'operator',
          );
          assert.equal(ops.statusCode, 200, ops.body);
          assert.equal(ops.json().scope, 'operator');
          assert.ok(ops.json().series.every((s: any) => s.bucket.endsWith('-01')));
        },
      );
      await t.test(
        'history pagination is stable, CSV is bounded and old unquantified expiry stays explicitly unknown',
        async () => {
          const first = (await f.call('GET', `${usage}&limit=2`)).json();
          assert.ok(first.nextCursor);
          const second = (
            await f.call('GET', `${usage}&limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)
          ).json();
          assert.equal(second.entries.length, 2);
          assert.ok(
            !second.entries.some((e: any) => first.entries.some((p: any) => p.id === e.id)),
          );
          assert.deepEqual(second.totals, first.totals);
          const wrong = await f.call(
            'GET',
            `${usage}&bucket=month&cursor=${encodeURIComponent(first.nextCursor)}`,
          );
          assert.equal(wrong.statusCode, 400);
          const csv = await f.call('GET', `${usage}&format=csv&limit=500`);
          assert.equal(csv.statusCode, 200, csv.body);
          assert.match(String(csv.headers['content-type']), /text\/csv/);
          assert.ok(csv.body.includes("'=IMPORTXML("));
          assert.ok(!csv.body.includes('private prompt'));
          await f.db.query(
            "INSERT INTO ledger_entries(space_id,kind,units,event_key,reason) VALUES($1,'expire',0,$2,'historic expiry amount unavailable')",
            [f.teamId, randomUUID()],
          );
          const report = (await f.call('GET', usage)).json();
          assert.equal(report.unknownAmountEntries, 1);
          const unknown = report.entries.find(
            (e: any) => e.reason === 'historic expiry amount unavailable',
          );
          assert.equal(unknown.units, null);
          assert.equal(unknown.amountKnown, false);
          assert.equal(report.totals.expired, 30);
          assert.equal(
            (await f.call('GET', `${usage}&from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z`))
              .statusCode,
            400,
          );
        },
      );
      await t.test(
        'ownership transfer is atomic, last owner cannot be removed, team resources survive departure',
        async () => {
          assert.equal(
            (await f.call('DELETE', `/v1/spaces/${f.teamId}/members/${f.actors.owner.id}`))
              .statusCode,
            403,
          );
          const denied = await f.call('POST', `/v1/spaces/${f.teamId}/transfer-owner`, {
            targetUserId: f.actors.outsider.id,
            expectedOwnerId: f.actors.owner.id,
          });
          assert.equal(denied.statusCode, 400);
          const transfer = await f.call('POST', `/v1/spaces/${f.teamId}/transfer-owner`, {
            targetUserId: f.actors.editor.id,
            expectedOwnerId: f.actors.owner.id,
          });
          assert.equal(transfer.statusCode, 200, transfer.body);
          assert.equal(
            (
              await f.db.query(
                "SELECT count(*) FROM memberships WHERE space_id=$1 AND role='owner'",
                [f.teamId],
              )
            ).rows[0]!.count,
            '1',
          );
          assert.equal(
            (await f.db.query('SELECT owner_id FROM spaces WHERE id=$1', [f.teamId])).rows[0]!
              .owner_id,
            f.actors.editor.id,
          );
          assert.equal(
            (
              await f.call(
                'DELETE',
                `/v1/spaces/${f.teamId}/members/${f.actors.editor.id}`,
                undefined,
                'editor',
              )
            ).statusCode,
            403,
          );
          const activity = (
            await f.call('GET', `/v1/spaces/${f.teamId}/activity?limit=1`, undefined, 'editor')
          ).json();
          assert.equal(activity.activities[0].kind, 'owner-transferred');
          assert.ok(activity.nextCursor);
          const left = await f.call(
            'DELETE',
            `/v1/spaces/${f.teamId}/members/${f.actors.owner.id}`,
          );
          assert.equal(left.statusCode, 200, left.body);
          assert.equal(
            (await f.call('GET', `/v1/artworks/${f.artwork.artwork.id}`)).statusCode,
            404,
          );
          assert.equal(
            (await f.call('GET', `/v1/artworks/${f.artwork.artwork.id}`, undefined, 'editor'))
              .statusCode,
            200,
          );
          assert.equal((await f.call('GET', usage)).statusCode, 403);
        },
      );
      await t.test(
        'private memory can be erased after access ends without exposing or deleting its underlying resource',
        async () => {
          // The original editor is now owner; create the leaving viewer's own private mark.
          assert.equal(
            (await f.call('PUT', `/v1/assets/${f.assetId}/memory`, memory, 'viewer')).statusCode,
            200,
          );
          await f.call(
            'DELETE',
            `/v1/spaces/${f.teamId}/members/${f.actors.viewer.id}`,
            undefined,
            'editor',
          );
          assert.equal(
            (await f.call('GET', `/v1/assets/${f.assetId}/memory`, undefined, 'viewer')).statusCode,
            404,
          );
          assert.equal(
            (
              await f.call(
                'DELETE',
                `/v1/assets/${f.assetId}/memory`,
                { expectedVersion: 1 },
                'viewer',
              )
            ).statusCode,
            200,
          );
          assert.equal(
            (
              await f.db.query(
                'SELECT count(*) FROM resource_memories WHERE user_id=$1 AND asset_id=$2',
                [f.actors.viewer.id, f.assetId],
              )
            ).rows[0]!.count,
            '0',
          );
          assert.equal(
            (
              await f.call(
                'DELETE',
                `/v1/assets/${f.assetId}/memory`,
                { expectedVersion: rememberedVersion },
                'editor',
              )
            ).statusCode,
            200,
          );
          assert.equal(
            (await f.db.query('SELECT deleted_at FROM assets WHERE id=$1', [f.assetId])).rows[0]!
              .deleted_at,
            null,
          );
        },
      );
    } finally {
      await f.close();
    }
  },
);
