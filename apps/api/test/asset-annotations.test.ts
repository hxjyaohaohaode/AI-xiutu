import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createDatabase, migrate, transaction } from '@ai-xiutu/db';
import { createRecipeV2, createAdjustmentRegionV2 } from '@ai-xiutu/editor';
import { LocalPrivateStorage } from '@ai-xiutu/storage';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hash } from '../src/core.js';
import {
  withDatabaseFaults,
  type DatabaseFaults,
} from '../../../packages/db/test/fault-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'asset annotations, authorized organization and v2 revision persistence',
  { skip: !databaseUrl },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'asset-annotations-'));
    const db = createDatabase(databaseUrl!);
    const faults: DatabaseFaults = {};
    const config = loadConfig({
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: randomBytes(32).toString('hex'),
      STORAGE_DIR: root,
      APP_ORIGIN: 'http://metadata.test',
      NODE_ENV: 'test',
    });
    const app = await buildApp({
      db: withDatabaseFaults(db, faults),
      config,
      sms: {
        configured: false,
        async send() {
          throw new Error('not used');
        },
      },
    });
    const storage = new LocalPrivateStorage(config);
    await storage.initialize();
    const png = await sharp({
      create: { width: 96, height: 96, channels: 3, background: '#102030' },
    })
      .png()
      .toBuffer();
    const file = await storage.storeGenerated(png);
    const owner = randomUUID(),
      viewer = randomUUID(),
      outsider = randomUUID(),
      operator = randomUUID();
    const spaceId = randomUUID(),
      foreignSpaceId = randomUUID(),
      projectId = randomUUID(),
      foreignProjectId = randomUUID();
    const assetIds = Array.from({ length: 6 }, () => randomUUID());
    const cookies = new Map<string, string>();
    await transaction(db, async (tx) => {
      for (const user of [owner, viewer, outsider, operator]) {
        const token = randomBytes(32).toString('hex');
        cookies.set(user, `xiutu_session=${token}`);
        await tx.query(
          "INSERT INTO users(id,phone,display_name,phone_verified_at) VALUES($1,$2,'Metadata test',now())",
          [user, `test-${user}`],
        );
        await tx.query(
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
          [hash(token), user],
        );
      }
      await tx.query('INSERT INTO operator_users(user_id) VALUES($1)', [operator]);
      for (const [id, user] of [
        [spaceId, owner],
        [foreignSpaceId, outsider],
      ]) {
        await tx.query(
          "INSERT INTO spaces(id,name,kind,owner_id) VALUES($1,'Metadata space','personal',$2)",
          [id, user],
        );
        await tx.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'owner')", [
          id,
          user,
        ]);
      }
      await tx.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'viewer')", [
        spaceId,
        viewer,
      ]);
      for (const [id, scope, user] of [
        [projectId, spaceId, owner],
        [foreignProjectId, foreignSpaceId, outsider],
      ])
        await tx.query(
          "INSERT INTO projects(id,space_id,title,created_by) VALUES($1,$2,'Metadata project',$3)",
          [id, scope, user],
        );
      for (let i = 0; i < assetIds.length; i++) {
        const provenance =
          i === 1
            ? { kind: 'ai-generated' }
            : i === 2
              ? { kind: 'uploaded', declaredSource: 'sketch' }
              : i === 3
                ? {}
                : { kind: 'uploaded', declaredSource: 'upload' };
        await tx.query(
          'INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by,provenance,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
          [
            assetIds[i],
            projectId,
            `asset-${i}.png`,
            file.key,
            file.mime,
            file.width,
            file.height,
            file.bytes,
            file.hash,
            owner,
            JSON.stringify(provenance),
            `2026-10-01T12:00:00.00000${i}Z`,
          ],
        );
      }
    });
    const call = (method: 'GET' | 'PATCH' | 'POST', url: string, user = owner, payload?: unknown) =>
      app.inject({
        method,
        url,
        headers: { cookie: cookies.get(user)!, origin: 'http://metadata.test' },
        ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
      });
    const upload = (name: string) => {
      const boundary = `fixture-${randomUUID()}`;
      return app.inject({
        method: 'POST',
        url: `/v1/projects/${projectId}/assets`,
        headers: {
          cookie: cookies.get(owner)!,
          origin: 'http://metadata.test',
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`,
          ),
          png,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
    };
    try {
      await t.test(
        'additive migration is repeatable and user declarations preserve timezone without changing image bytes',
        async () => {
          await migrate(db);
          assert.equal(
            (await db.query('SELECT version FROM schema_migrations WHERE version=3')).rowCount,
            1,
          );
          const result = await call('PATCH', `/v1/assets/${assetIds[0]}/annotations`, owner, {
            expectedVersion: 1,
            title: '海边清晨',
            tags: ['旅行', '蓝色'],
            capturedAt: '2026-10-01T20:00:00+08:00',
            location: { label: '用户手工声明的海边' },
          });
          assert.equal(result.statusCode, 200, result.body);
          const asset = result.json().asset;
          assert.equal(asset.annotationVersion, 2);
          assert.equal(asset.annotations.capturedAt, '2026-10-01T20:00:00+08:00');
          assert.deepEqual(asset.annotations.location, { label: '用户手工声明的海边' });
          assert.notEqual(asset.createdAt, asset.annotations.capturedAt);
          const stored = (
            await db.query('SELECT content_hash,storage_key FROM assets WHERE id=$1', [assetIds[0]])
          ).rows[0]!;
          assert.equal(stored.content_hash, file.hash);
          assert.equal(stored.storage_key, file.key);
          const meta = await sharp(await storage.readBytes(file.key, 7_000_000)).metadata();
          assert.equal(meta.exif, undefined);
          const audit = (
            await db.query(
              "SELECT detail FROM audit_entries WHERE target_id=$1 AND action='asset.annotations'",
              [assetIds[0]],
            )
          ).rows[0]!.detail;
          assert.deepEqual(audit.changedFields.sort(), ['capturedAt', 'location', 'tags', 'title']);
          assert.equal(JSON.stringify(audit).includes('海边'), false);
          assert.equal(
            (
              await call('PATCH', `/v1/assets/${assetIds[0]}/annotations`, owner, {
                expectedVersion: 1,
                title: '过期覆盖',
              })
            ).statusCode,
            409,
          );
        },
      );

      await t.test(
        'viewer and platform operator cannot edit or inspect unauthorized private annotations',
        async () => {
          assert.equal(
            (
              await call('PATCH', `/v1/assets/${assetIds[0]}/annotations`, viewer, {
                expectedVersion: 2,
                title: '未经授权',
              })
            ).statusCode,
            403,
          );
          for (const user of [outsider, operator])
            assert.equal(
              (
                await call('PATCH', `/v1/assets/${assetIds[0]}/annotations`, user, {
                  expectedVersion: 2,
                  title: '未经授权',
                })
              ).statusCode,
              404,
            );
          assert.equal(
            (await call('GET', `/v1/projects/${projectId}/assets`, viewer)).statusCode,
            200,
          );
          for (const user of [outsider, operator]) {
            assert.equal(
              (await call('GET', `/v1/projects/${projectId}/assets`, user)).statusCode,
              404,
            );
            assert.equal(
              (await call('GET', `/v1/assets?spaceId=${spaceId}`, user)).statusCode,
              403,
            );
          }
          assert.equal((await call('GET', `/v1/assets?spaceId=${foreignSpaceId}`)).statusCode, 403);
        },
      );

      await t.test(
        'annotation validation rejects implicit timezones, unexpected GPS/export flags and malformed tags',
        async () => {
          for (const patch of [
            { capturedAt: '2026-10-01T12:00:00' },
            { capturedAt: '2026-02-31T12:00:00Z' },
            { location: { label: '手工地点', gps: [1, 2] } },
            { exportGps: true },
            { tags: ['重复', '重复'] },
            { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
            {},
          ]) {
            const result = await call('PATCH', `/v1/assets/${assetIds[0]}/annotations`, owner, {
              expectedVersion: 2,
              ...patch,
            });
            assert.equal(result.statusCode, 400, result.body);
          }
        },
      );

      await t.test(
        'real project/space filters and exact microsecond cursors do not lose same-millisecond assets',
        async () => {
          let cursor: string | null = null;
          const seen: string[] = [];
          do {
            const result = await call(
              'GET',
              `/v1/projects/${projectId}/assets?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
            );
            assert.equal(result.statusCode, 200, result.body);
            const data = result.json();
            seen.push(...data.assets.map((asset: { id: string }) => asset.id));
            cursor = data.nextCursor;
          } while (cursor);
          assert.equal(seen.length, 6);
          assert.equal(new Set(seen).size, 6);
          assert.deepEqual(new Set(seen), new Set(assetIds));
          const searched = await call(
            'GET',
            `/v1/assets?spaceId=${spaceId}&query=${encodeURIComponent('旅行')}&createdFrom=2026-10-01T00:00:00Z&createdTo=2026-10-02T00:00:00Z`,
          );
          assert.deepEqual(
            searched.json().assets.map((asset: { id: string }) => asset.id),
            [assetIds[0]],
          );
          const generated = await call('GET', `/v1/projects/${projectId}/assets?source=generated`);
          assert.deepEqual(
            generated.json().assets.map((asset: { id: string }) => asset.id),
            [assetIds[1]],
          );
          assert.equal(generated.json().assets[0].annotations.capturedAt, null);
          const unknown = await call('GET', `/v1/projects/${projectId}/assets?source=unknown`);
          assert.deepEqual(
            unknown.json().assets.map((asset: { id: string }) => asset.id),
            [assetIds[3]],
          );
          const first = await call('GET', `/v1/projects/${projectId}/assets?limit=1`);
          assert.equal(
            (
              await call(
                'GET',
                `/v1/projects/${projectId}/assets?query=changed&cursor=${encodeURIComponent(first.json().nextCursor)}`,
              )
            ).statusCode,
            400,
          );
        },
      );

      await t.test(
        'expired or revoked reference grant cannot query metadata; old cursor does not preserve access',
        async () => {
          const grant = randomUUID();
          await db.query(
            "INSERT INTO share_grants(id,project_id,target_user_id,mode,expires_at,created_by) VALUES($1,$2,$3,'reference',clock_timestamp()+interval '1 day',$4)",
            [grant, projectId, outsider, owner],
          );
          const initial = await call('GET', `/v1/projects/${projectId}/assets?limit=1`, outsider);
          assert.equal(initial.statusCode, 200);
          await db.query('UPDATE share_grants SET revoked_at=clock_timestamp() WHERE id=$1', [
            grant,
          ]);
          assert.equal(
            (
              await call(
                'GET',
                `/v1/projects/${projectId}/assets?limit=1&cursor=${encodeURIComponent(initial.json().nextCursor)}`,
                outsider,
              )
            ).statusCode,
            404,
          );
        },
      );

      await t.test(
        'actual upload origin is recorded explicitly; a suggestive filename never implies AI provenance',
        async () => {
          const boundary = `boundary${randomUUID()}`;
          const payload = Buffer.concat([
            Buffer.from(
              `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="AI-generated.png"\r\nContent-Type: image/png\r\n\r\n`,
            ),
            png,
            Buffer.from(`\r\n--${boundary}--\r\n`),
          ]);
          for (const source of ['upload', 'sketch']) {
            const result = await app.inject({
              method: 'POST',
              url: `/v1/projects/${projectId}/assets?source=${source}`,
              headers: {
                cookie: cookies.get(owner)!,
                origin: 'http://metadata.test',
                'content-type': `multipart/form-data; boundary=${boundary}`,
              },
              payload,
            });
            assert.equal(result.statusCode, 201, result.body);
            assert.equal(result.json().asset.source, source);
            assert.equal(result.json().asset.annotations.location, null);
            assert.equal(result.json().asset.annotations.capturedAt, null);
          }
        },
      );

      await t.test(
        'full v2 recipes and region data persist through ordinary artwork/revision CAS',
        async () => {
          const recipe = createRecipeV2({
            levels: { gamma: 1.2 },
            regions: [
              createAdjustmentRegionV2({ name: '局部测试', adjustments: { exposure: 0.3 } }),
            ],
          });
          const first = await call('POST', `/v1/projects/${projectId}/artworks`, owner, {
            assetId: assetIds[0],
            title: '完整v2作品',
            recipe,
          });
          assert.equal(first.statusCode, 201, first.body);
          assert.deepEqual(first.json().revision.recipe, recipe);
          const artwork = first.json().artwork;
          const updated = structuredClone(recipe);
          updated.hsl.blue.saturation = 20;
          const second = await call('POST', `/v1/artworks/${artwork.id}/revisions`, owner, {
            expectedVersion: 1,
            recipe: updated,
            label: '只改蓝色',
          });
          assert.equal(second.statusCode, 201, second.body);
          assert.deepEqual(second.json().revision.recipe, updated);
          const reload = await call('GET', `/v1/artworks/${artwork.id}`);
          assert.deepEqual(reload.json().revision.recipe, updated);
          assert.equal(
            (
              await call('POST', `/v1/artworks/${artwork.id}/revisions`, owner, {
                expectedVersion: 1,
                recipe,
              })
            ).statusCode,
            409,
          );
        },
      );
      await t.test(
        'a lost upload COMMIT acknowledgement never deletes an already committed private asset',
        async () => {
          faults.afterCommitMatching = 'INSERT INTO assets(project_id';
          const result = await upload('commit-ack-lost.png');
          assert.equal(result.statusCode, 500);
          assert.equal(faults.commitFailures, 1);
          const committed = (
            await db.query('SELECT * FROM assets WHERE project_id=$1 AND name=$2', [
              projectId,
              'commit-ack-lost.png',
            ])
          ).rows;
          assert.equal(committed.length, 1);
          assert.ok((await storage.readBytes(committed[0]!.storage_key, 7_000_000)).length > 0);
          const response = await call('GET', `/v1/assets/${committed[0]!.id}/file`);
          assert.equal(response.statusCode, 200);
        },
      );
      await t.test(
        'an unavailable authoritative cleanup query preserves an unconfirmed private upload',
        async () => {
          const before = new Set(await readdir(root));
          faults.beforeStatementMatching = 'INSERT INTO assets(project_id';
          faults.failPublicationCheck = true;
          try {
            assert.equal((await upload('rollback-check-unavailable.png')).statusCode, 500);
            assert.equal(
              (
                await db.query('SELECT id FROM assets WHERE project_id=$1 AND name=$2', [
                  projectId,
                  'rollback-check-unavailable.png',
                ])
              ).rowCount,
              0,
            );
            const retained = (await readdir(root)).filter((name) => !before.has(name));
            assert.equal(retained.length, 1);
            assert.ok((await storage.readBytes(retained[0]!, 7_000_000)).length > 0);
          } finally {
            faults.failPublicationCheck = false;
          }
        },
      );
    } finally {
      await app.close();
      await db.end();
      await rm(root, { recursive: true, force: true });
    }
  },
);
