import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createDatabase } from '@ai-xiutu/db';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hash } from '../src/core.js';
import {
  withDatabaseFaults,
  type DatabaseFaults,
} from '../../../packages/db/test/fault-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'authorized source copies, retained capacity and durable replay use actual SQL',
  { skip: !databaseUrl },
  async (t) => {
    const db = createDatabase(databaseUrl!);
    const dir = await mkdtemp(join(tmpdir(), 'xiutu-asset-copy-'));
    const origin = 'http://localhost:5173';
    const faults: DatabaseFaults = {};
    const app = await buildApp({
      db: withDatabaseFaults(db, faults),
      config: loadConfig({
        ...process.env,
        DATABASE_URL: databaseUrl!,
        SESSION_SECRET: 'asset-copy-isolated-test-session-secret-2026',
        APP_ORIGIN: origin,
        STORAGE_DIR: dir,
      }),
      sms: {
        configured: false,
        async send() {
          throw new Error('not configured');
        },
      },
    });
    await app.ready();
    const call = (method: any, url: string, body?: unknown, cookie?: string, headers = {}) =>
      app.inject({
        method,
        url,
        remoteAddress: '127.0.2.7',
        headers: { origin, ...(cookie ? { cookie } : {}), ...headers },
        ...(body === undefined ? {} : { payload: body as any }),
      });
    async function actor(name: string, operator = false) {
      const phone = `+861${String(BigInt('0x' + randomBytes(6).toString('hex')) % 10_000_000_000n).padStart(10, '0')}`;
      const user = (
        await db.query(
          'INSERT INTO users(phone,display_name,phone_verified_at) VALUES($1,$2,now()) RETURNING id',
          [phone, name],
        )
      ).rows[0]!;
      const space = (
        await db.query(
          "INSERT INTO spaces(name,kind,owner_id) VALUES($1,'personal',$2) RETURNING id",
          [name, user.id],
        )
      ).rows[0]!;
      await db.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'owner')", [
        space.id,
        user.id,
      ]);
      const token = randomBytes(32).toString('base64url');
      await db.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [hash(token), user.id],
      );
      if (operator) await db.query('INSERT INTO operator_users(user_id) VALUES($1)', [user.id]);
      return {
        id: user.id as string,
        spaceId: space.id as string,
        phone,
        cookie: `xiutu_session=${token}`,
      };
    }
    const owner = await actor('Copy owner'),
      visitor = await actor('Copy visitor'),
      operator = await actor('Copy operator', true),
      viewer = await actor('Copy viewer');
    async function project(spaceId: string, cookie = owner.cookie) {
      const response = await call(
        'POST',
        '/v1/projects',
        { spaceId, title: 'Source copy fixture' },
        cookie,
      );
      assert.equal(response.statusCode, 201, response.body);
      return response.json().project;
    }
    async function team() {
      const response = await call('POST', '/v1/spaces', { name: 'Capacity target' }, owner.cookie);
      assert.equal(response.statusCode, 201, response.body);
      return response.json().space;
    }
    async function upload(projectId: string, color: string, cookie = owner.cookie) {
      const bytes = await sharp({ create: { width: 8, height: 6, channels: 4, background: color } })
        .png()
        .toBuffer();
      const boundary = `copy-${randomUUID()}`;
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="original.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      return call('POST', `/v1/projects/${projectId}/assets`, payload, cookie, {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      });
    }
    async function policy(allowCopy: boolean, maxCopyAssets = 20) {
      const response = await call(
        'PUT',
        `/v1/spaces/${owner.spaceId}/sharing-policy`,
        { allowReference: true, allowCopy, maxActiveGrants: 20, maxCopyAssets },
        owner.cookie,
      );
      assert.equal(response.statusCode, 200, response.body);
    }
    async function limits(spaceId: string, maxAssets: number, maxBytes = 1_073_741_824) {
      const current = await call(
        'GET',
        `/v1/ops/spaces/${spaceId}/storage`,
        undefined,
        operator.cookie,
      );
      assert.equal(current.statusCode, 200, current.body);
      const response = await call(
        'PUT',
        `/v1/ops/spaces/${spaceId}/storage`,
        {
          expectedVersion: current.json().storage.version,
          maxAssets,
          maxBytes,
          reason: 'Isolated capacity test',
        },
        operator.cookie,
      );
      assert.equal(response.statusCode, 200, response.body);
      return response.json().storage;
    }
    const copy = (
      assetId: string,
      targetProjectId: string,
      key: string = randomUUID(),
      cookie = owner.cookie,
    ) =>
      call('POST', `/v1/assets/${assetId}/copy`, { targetProjectId, idempotencyKey: key }, cookie);
    let source: any,
      target: any,
      firstAsset: any,
      secondAsset: any,
      originalCopy: any,
      originalKey = '';
    try {
      await t.test(
        'real private fixtures and disabled copy policies do not silently reupload',
        async () => {
          source = await project(owner.spaceId);
          target = await project((await team()).id);
          const first = await upload(source.id, '#335577'),
            second = await upload(source.id, '#995522');
          assert.equal(first.statusCode, 201, first.body);
          assert.equal(second.statusCode, 201, second.body);
          firstAsset = first.json().asset;
          secondAsset = second.json().asset;
          const denied = await copy(firstAsset.id, target.id);
          assert.equal(denied.statusCode, 403, denied.body);
          assert.equal(denied.json().error.code, 'COPY_DISABLED');
          await policy(true);
          const noSession = await call('POST', `/v1/assets/${firstAsset.id}/copy`, {
            targetProjectId: target.id,
            idempotencyKey: randomUUID(),
          });
          assert.equal(noSession.statusCode, 401);
          assert.equal(
            (await copy(firstAsset.id, target.id, randomUUID(), visitor.cookie)).statusCode,
            404,
          );
          assert.equal(
            (await copy(firstAsset.id, target.id, randomUUID(), operator.cookie)).statusCode,
            404,
          );
          await db.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'viewer')", [
            owner.spaceId,
            viewer.id,
          ]);
          assert.equal(
            (await copy(firstAsset.id, target.id, randomUUID(), viewer.cookie)).statusCode,
            403,
          );
          const foreignTarget = await project(visitor.spaceId, visitor.cookie);
          assert.equal((await copy(firstAsset.id, foreignTarget.id)).statusCode, 404);
          assert.equal((await copy(firstAsset.id, source.id)).statusCode, 400);
        },
      );
      await t.test(
        'concurrent identical and independently keyed copies share one immutable source and one capacity charge',
        async () => {
          await db.query('UPDATE assets SET annotations=$2 WHERE id=$1', [
            firstAsset.id,
            JSON.stringify({
              title: 'Declared source',
              tags: ['retained'],
              capturedAt: '2026-06-07T10:00:00Z',
              location: null,
            }),
          ]);
          originalKey = randomUUID();
          const simultaneous = await Promise.all([
            copy(firstAsset.id, target.id, originalKey),
            copy(firstAsset.id, target.id, originalKey),
          ]);
          assert.deepEqual(simultaneous.map((r) => r.statusCode).sort(), [200, 201]);
          originalCopy = simultaneous[0]!.json();
          assert.equal(originalCopy.asset.id, simultaneous[1]!.json().asset.id);
          assert.equal(originalCopy.asset.provenance.kind, 'uploaded');
          assert.equal(originalCopy.asset.provenance.copiedFrom.assetId, firstAsset.id);
          assert.equal(originalCopy.asset.annotations.title, 'Declared source');
          const otherKeys = await Promise.all([
            copy(firstAsset.id, target.id),
            copy(firstAsset.id, target.id),
          ]);
          assert.ok(
            otherKeys.every(
              (r) => r.statusCode === 200 && r.json().asset.id === originalCopy.asset.id,
            ),
          );
          const usage = (
            await call('GET', `/v1/spaces/${target.spaceId}/storage`, undefined, owner.cookie)
          ).json().storage;
          assert.equal(usage.retainedAssets, 1);
          assert.equal(usage.retainedBytes, firstAsset.bytes);
          const rows = (
            await db.query('SELECT storage_key,content_hash FROM assets WHERE id=ANY($1::uuid[])', [
              [firstAsset.id, originalCopy.asset.id],
            ])
          ).rows;
          assert.equal(rows[0]!.storage_key, rows[1]!.storage_key);
          assert.equal(rows[0]!.content_hash, rows[1]!.content_hash);
          const originalBytes = await call('GET', firstAsset.url, undefined, owner.cookie),
            copiedBytes = await call('GET', originalCopy.asset.url, undefined, owner.cookie);
          assert.deepEqual(copiedBytes.rawPayload, originalBytes.rawPayload);
          assert.equal((await copy(secondAsset.id, target.id, originalKey)).statusCode, 409);
          await assert.rejects(
            db.query('UPDATE asset_copies SET source_hash=$2 WHERE id=$1', [
              originalCopy.copy.id,
              'tampered',
            ]),
            /immutable/,
          );
          await assert.rejects(
            db.query('UPDATE assets SET bytes=bytes+1 WHERE id=$1', [firstAsset.id]),
            /immutable/,
          );
        },
      );
      await t.test(
        'lost commit response can be retried without a second asset or capacity reservation',
        async () => {
          const destination = await project((await team()).id),
            key = randomUUID();
          faults.afterCommitMatching = 'INSERT INTO asset_copy_requests';
          const uncertain = await copy(firstAsset.id, destination.id, key);
          assert.equal(uncertain.statusCode, 500, uncertain.body);
          const recovered = await copy(firstAsset.id, destination.id, key);
          assert.equal(recovered.statusCode, 200, recovered.body);
          assert.equal(recovered.json().replayed, true);
          const usage = (
            await call('GET', `/v1/spaces/${destination.spaceId}/storage`, undefined, owner.cookie)
          ).json().storage;
          assert.equal(usage.retainedAssets, 1);
          assert.equal(usage.retainedBytes, firstAsset.bytes);
        },
      );
      await t.test(
        'one capacity row covers concurrent copies to different projects in the same space',
        async () => {
          const space = await team(),
            one = await project(space.id),
            two = await project(space.id);
          await limits(space.id, 1);
          const results = await Promise.all([
            copy(firstAsset.id, one.id),
            copy(secondAsset.id, two.id),
          ]);
          assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
          const rejected = results.find((r) => r.statusCode === 409)!;
          assert.equal(rejected.json().error.code, 'SPACE_STORAGE_LIMIT');
          const usage = (
            await call('GET', `/v1/spaces/${space.id}/storage`, undefined, owner.cookie)
          ).json().storage;
          assert.equal(usage.retainedAssets, 1);
          assert.equal(
            Number(
              (
                await db.query(
                  'SELECT count(*) AS n FROM assets a JOIN projects p ON p.id=a.project_id WHERE p.space_id=$1',
                  [space.id],
                )
              ).rows[0]!.n,
            ),
            1,
          );
          assert.equal(
            Number(
              (
                await db.query(
                  'SELECT count(*) AS n FROM asset_copies c JOIN projects p ON p.id=c.target_project_id WHERE p.space_id=$1',
                  [space.id],
                )
              ).rows[0]!.n,
            ),
            1,
          );
          const uploaded = await upload(one.id, '#abcdef');
          assert.equal(uploaded.statusCode, 409, uploaded.body);
          assert.equal(uploaded.json().error.code, 'SPACE_STORAGE_LIMIT');
          const retained = results.find((r) => r.statusCode === 201)!.json().asset;
          assert.equal(
            (await call('DELETE', `/v1/assets/${retained.id}`, undefined, owner.cookie)).statusCode,
            200,
          );
          const after = (
            await call('GET', `/v1/spaces/${space.id}/storage`, undefined, owner.cookie)
          ).json().storage;
          assert.equal(after.retainedAssets, 1);
          assert.equal(after.softDeleteReclaimsCapacity, false);
        },
      );
      await t.test(
        'byte capacity and a partial full-project copy roll back all rows and counters',
        async () => {
          const byteSpace = await team(),
            destination = await project(byteSpace.id);
          await limits(byteSpace.id, 100, Math.max(0, firstAsset.bytes - 1));
          const denied = await copy(firstAsset.id, destination.id);
          assert.equal(denied.statusCode, 409, denied.body);
          assert.equal(
            (
              await call('GET', `/v1/spaces/${byteSpace.id}/storage`, undefined, owner.cookie)
            ).json().storage.retainedAssets,
            0,
          );
          const fullSpace = await team();
          await limits(fullSpace.id, 1);
          const failed = await call(
            'POST',
            `/v1/projects/${source.id}/copy`,
            { targetSpaceId: fullSpace.id, idempotencyKey: randomUUID() },
            owner.cookie,
          );
          assert.equal(failed.statusCode, 409, failed.body);
          assert.equal(failed.json().error.code, 'SPACE_STORAGE_LIMIT');
          assert.equal(
            Number(
              (
                await db.query('SELECT count(*) AS n FROM projects WHERE space_id=$1', [
                  fullSpace.id,
                ])
              ).rows[0]!.n,
            ),
            0,
          );
          assert.equal(
            (
              await call('GET', `/v1/spaces/${fullSpace.id}/storage`, undefined, owner.cookie)
            ).json().storage.retainedAssets,
            0,
          );
        },
      );
      await t.test(
        'operators configure capacity with CAS but do not acquire private image access',
        async () => {
          const current = await call(
            'GET',
            `/v1/ops/spaces/${target.spaceId}/storage`,
            undefined,
            operator.cookie,
          );
          const body = {
            expectedVersion: current.json().storage.version,
            maxAssets: 0,
            maxBytes: 0,
            reason: 'Retain existing data while denying additional storage',
          };
          assert.equal(
            (await call('PUT', `/v1/ops/spaces/${target.spaceId}/storage`, body, owner.cookie))
              .statusCode,
            403,
          );
          assert.equal(
            (await call('PUT', `/v1/ops/spaces/${target.spaceId}/storage`, body, operator.cookie))
              .statusCode,
            200,
          );
          assert.equal(
            (await call('PUT', `/v1/ops/spaces/${target.spaceId}/storage`, body, operator.cookie))
              .statusCode,
            409,
          );
          assert.equal(
            (await call('GET', originalCopy.asset.url, undefined, owner.cookie)).statusCode,
            200,
          );
          assert.equal(
            (await call('GET', originalCopy.asset.url, undefined, operator.cookie)).statusCode,
            404,
          );
          // Reusing a retained active copy consumes no new capacity, even at zero remaining quota.
          assert.equal((await copy(firstAsset.id, target.id)).statusCode, 200);
          await limits(target.spaceId, 1000);
        },
      );
      await t.test(
        'revoking copy policy denies new decisions but a committed same-key retry reads only its independent destination',
        async () => {
          await policy(false);
          assert.equal((await copy(firstAsset.id, target.id)).statusCode, 403);
          const replay = await copy(firstAsset.id, target.id, originalKey);
          assert.equal(replay.statusCode, 200, replay.body);
          assert.equal(replay.json().replayed, true);
          assert.equal(
            (await call('GET', originalCopy.asset.url, undefined, owner.cookie)).statusCode,
            200,
          );
          await policy(true);
        },
      );
      await t.test(
        'a non-owner copy grant binds one destination and cannot be reused as a full project grant',
        async () => {
          const destination = await project(visitor.spaceId, visitor.cookie),
            other = await project(visitor.spaceId, visitor.cookie);
          const granted = await call(
            'POST',
            `/v1/projects/${source.id}/grants`,
            { targetPhone: visitor.phone, mode: 'copy' },
            owner.cookie,
          );
          assert.equal(granted.statusCode, 201, granted.body);
          const key = randomUUID(),
            first = await copy(firstAsset.id, destination.id, key, visitor.cookie);
          assert.equal(first.statusCode, 201, first.body);
          const again = await copy(secondAsset.id, destination.id, randomUUID(), visitor.cookie);
          assert.equal(again.statusCode, 201, again.body);
          const elsewhere = await copy(firstAsset.id, other.id, randomUUID(), visitor.cookie);
          assert.equal(elsewhere.statusCode, 409, elsewhere.body);
          assert.equal(elsewhere.json().error.code, 'COPY_ALREADY_USED');
          const full = await call(
            'POST',
            `/v1/projects/${source.id}/copy`,
            { targetSpaceId: visitor.spaceId, idempotencyKey: randomUUID() },
            visitor.cookie,
          );
          assert.equal(full.statusCode, 409, full.body);
          assert.equal(
            (
              await call(
                'DELETE',
                `/v1/projects/${source.id}/grants/${granted.json().grant.id}`,
                undefined,
                owner.cookie,
              )
            ).statusCode,
            200,
          );
          assert.equal(
            (await copy(firstAsset.id, destination.id, randomUUID(), visitor.cookie)).statusCode,
            404,
          );
          assert.equal(
            (await copy(firstAsset.id, destination.id, key, visitor.cookie)).statusCode,
            200,
          );
          assert.equal(
            (await call('GET', first.json().asset.url, undefined, visitor.cookie)).statusCode,
            200,
          );
          await db.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
            visitor.spaceId,
            visitor.id,
          ]);
          assert.equal(
            (await copy(firstAsset.id, destination.id, key, visitor.cookie)).statusCode,
            404,
          );
        },
      );
      await t.test(
        'grant expiry at the final publication boundary rolls back the copy, request and capacity together',
        async () => {
          const recipient = await actor('Expiry recipient');
          const destination = await project(recipient.spaceId, recipient.cookie);
          const granted = await call(
            'POST',
            `/v1/projects/${source.id}/grants`,
            {
              targetPhone: recipient.phone,
              mode: 'copy',
            },
            owner.cookie,
          );
          assert.equal(granted.statusCode, 201, granted.body);
          // Test-only SQL fault at the actual copy publication boundary. No wait
          // or race timing assumption is needed to enter the late-expiry path.
          await db.query(`CREATE FUNCTION test_expire_asset_copy_grant() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
              UPDATE share_grants SET expires_at=clock_timestamp()-interval '1 second' WHERE id=NEW.grant_id;
              RETURN NEW;
            END $$`);
          await db.query(
            'CREATE TRIGGER test_expire_copy_grant AFTER INSERT ON asset_copies FOR EACH ROW EXECUTE FUNCTION test_expire_asset_copy_grant()',
          );
          const key = randomUUID();
          try {
            const blocked = await copy(firstAsset.id, destination.id, key, recipient.cookie);
            assert.equal(blocked.statusCode, 403, blocked.body);
            assert.equal(blocked.json().error.code, 'COPY_GRANT_REQUIRED');
            assert.equal(
              Number(
                (
                  await db.query('SELECT count(*) AS n FROM assets WHERE project_id=$1', [
                    destination.id,
                  ])
                ).rows[0]!.n,
              ),
              0,
            );
            assert.equal(
              Number(
                (
                  await db.query(
                    'SELECT count(*) AS n FROM asset_copy_requests WHERE actor_id=$1 AND idempotency_key=$2',
                    [recipient.id, key],
                  )
                ).rows[0]!.n,
              ),
              0,
            );
            const storage = await call(
              'GET',
              `/v1/spaces/${recipient.spaceId}/storage`,
              undefined,
              recipient.cookie,
            );
            assert.equal(storage.json().storage.retainedAssets, 0);
            assert.equal(storage.json().storage.retainedBytes, 0);
          } finally {
            await db.query('DROP TRIGGER test_expire_copy_grant ON asset_copies');
            await db.query('DROP FUNCTION test_expire_asset_copy_grant()');
          }
          // The rejected transaction did not poison the original operation key.
          assert.equal(
            (await copy(firstAsset.id, destination.id, key, recipient.cookie)).statusCode,
            201,
          );
        },
      );
      await t.test(
        'source copy cap applies across distinct idempotency keys and concurrent source assets',
        async () => {
          await policy(true, 1);
          const destination = await project((await team()).id);
          const responses = await Promise.all([
            copy(firstAsset.id, destination.id),
            copy(secondAsset.id, destination.id),
          ]);
          assert.deepEqual(responses.map((r) => r.statusCode).sort(), [201, 409]);
          assert.equal(
            responses.find((r) => r.statusCode === 409)!.json().error.code,
            'COPY_CAP_REACHED',
          );
          assert.equal(
            Number(
              (
                await db.query(
                  'SELECT count(*) AS n FROM asset_copies WHERE target_project_id=$1',
                  [destination.id],
                )
              ).rows[0]!.n,
            ),
            1,
          );
        },
      );
    } finally {
      await app.close();
      await db.end();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
