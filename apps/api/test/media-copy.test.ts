import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { transaction } from '@ai-xiutu/db';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'retained media follows explicit authorized copies, never matching proxy hashes',
  { skip: !databaseUrl },
  async (t) => {
    const f = await collaborationFixture(databaseUrl!);
    async function attachOriginal(assetId: string, projectId: string, retainedBytes: number) {
      const objectId = randomUUID();
      await transaction(f.db, async (tx) => {
        await tx.query(
          `INSERT INTO media_import_jobs(id,project_id,actor_id,idempotency_key,request_hash,name,expected_bytes,uploaded_bytes,state,asset_id)
        VALUES($1,$2,$3,$4,$5,'isolated original.tiff',4,4,'ready',$6)`,
          [objectId, projectId, f.actors.owner.id, randomUUID(), 'a'.repeat(64), assetId],
        );
        await tx.query('INSERT INTO media_objects(id,descriptor,retained_bytes) VALUES($1,$2,$3)', [
          objectId,
          JSON.stringify({
            sourceSha256: objectId,
            original: { width: 256, height: 192, bitDepth: 16 },
            tiles: null,
          }),
          retainedBytes,
        ]);
        await tx.query(
          'INSERT INTO media_sources(asset_id,object_id,retained_bytes) VALUES($1,$2,$3)',
          [assetId, objectId, retainedBytes],
        );
      });
      return objectId;
    }
    async function duplicateProxy(projectId: string, creator: string) {
      return (
        await f.db.query(
          `INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by)
      SELECT $1,'same proxy.png',storage_key,mime,width,height,bytes,content_hash,$3 FROM assets WHERE id=$2 RETURNING *`,
          [projectId, f.assetId, creator],
        )
      ).rows[0]!;
    }
    const mediaBytes = 4096;
    try {
      const originalObject = await attachOriginal(f.assetId, f.projectId, mediaBytes);
      await f.db.query('UPDATE spaces SET sharing_policy=$2 WHERE id=$1', [
        f.teamId,
        JSON.stringify({
          allowReference: true,
          allowCopy: true,
          maxActiveGrants: 10,
          maxCopyAssets: 100,
        }),
      ]);
      const ownAsset = (await f.db.query('SELECT bytes FROM assets WHERE id=$1', [f.assetId]))
        .rows[0]!;
      const proxyBytes = Number(ownAsset.bytes);
      const outsiderProject = (
        await f.call(
          'POST',
          '/v1/projects',
          { spaceId: f.actors.outsider.spaceId, title: 'Independent identical image' },
          'outsider',
        )
      ).json().project;
      assert.ok(outsiderProject?.id);
      await t.test(
        'ordinary same-hash uploads cannot discover or inherit another private original',
        async () => {
          const independent = await duplicateProxy(outsiderProject.id, f.actors.outsider.id);
          assert.equal(
            (await f.db.query('SELECT 1 FROM media_sources WHERE asset_id=$1', [independent.id]))
              .rowCount,
            0,
          );
          const forbiddenOriginal = await f.call(
            'GET',
            `/v1/assets/${independent.id}/media`,
            undefined,
            'outsider',
          );
          assert.equal(forbiddenOriginal.statusCode, 404, forbiddenOriginal.body);
          assert.equal(
            (await f.call('GET', `/v1/assets/${f.assetId}/media`, undefined, 'outsider'))
              .statusCode,
            404,
          );
        },
      );
      await t.test(
        'two distinct originals with identical proxy bytes retain separate identities',
        async () => {
          const sameProxy = await duplicateProxy(f.privateProjectId, f.actors.owner.id);
          const otherObject = await attachOriginal(sameProxy.id, f.privateProjectId, 8192);
          assert.notEqual(originalObject, otherObject);
          assert.equal(
            (await f.call('GET', `/v1/assets/${sameProxy.id}/media`)).json().descriptor
              .sourceSha256,
            otherObject,
          );
          assert.equal(
            (await f.call('GET', `/v1/assets/${f.assetId}/media`)).json().descriptor.sourceSha256,
            originalObject,
          );
        },
      );
      await t.test(
        'authorized single-asset copies retain originals and charge proxy plus original exactly once',
        async () => {
          const before = (
            await f.call('GET', `/v1/spaces/${f.actors.owner.spaceId}/storage`)
          ).json().storage;
          const key = randomUUID(),
            body = { targetProjectId: f.privateProjectId, idempotencyKey: key };
          const first = await f.call('POST', `/v1/assets/${f.assetId}/copy`, body);
          assert.equal(first.statusCode, 201, first.body);
          const target = first.json().asset;
          assert.equal(
            (await f.call('GET', `/v1/assets/${target.id}/media`)).json().descriptor.sourceSha256,
            originalObject,
          );
          const repeated = await Promise.all([
            f.call('POST', `/v1/assets/${f.assetId}/copy`, body),
            f.call('POST', `/v1/assets/${f.assetId}/copy`, {
              ...body,
              idempotencyKey: randomUUID(),
            }),
          ]);
          for (const response of repeated) {
            assert.equal(response.statusCode, 200, response.body);
            assert.equal(response.json().asset.id, target.id);
          }
          const after = (await f.call('GET', `/v1/spaces/${f.actors.owner.spaceId}/storage`)).json()
            .storage;
          assert.equal(after.retainedBytes - before.retainedBytes, mediaBytes + proxyBytes);
          assert.equal(after.retainedAssets - before.retainedAssets, 1);
        },
      );
      await t.test(
        'full-project copy explicitly remaps originals and media capacity failure rolls back everything',
        async () => {
          const copy = await f.call('POST', `/v1/projects/${f.projectId}/copy`, {
            targetSpaceId: f.actors.owner.spaceId,
            idempotencyKey: randomUUID(),
          });
          assert.equal(copy.statusCode, 201, copy.body);
          const copied = (
            await f.db.query('SELECT id FROM assets WHERE project_id=$1', [copy.json().project.id])
          ).rows[0]!;
          assert.equal(
            (await f.call('GET', `/v1/assets/${copied.id}/media`)).json().descriptor.sourceSha256,
            originalObject,
          );
          const targetSpace = (
            await f.call('POST', '/v1/spaces', { name: 'Capacity-limited copy' })
          ).json().space;
          assert.ok(targetSpace?.id);
          await f.db.query(
            'INSERT INTO space_storage_accounts(space_id,max_bytes) VALUES($1,$2) ON CONFLICT(space_id) DO UPDATE SET max_bytes=$2',
            [targetSpace.id, mediaBytes + proxyBytes - 1],
          );
          const failed = await f.call('POST', `/v1/projects/${f.projectId}/copy`, {
            targetSpaceId: targetSpace.id,
            idempotencyKey: randomUUID(),
          });
          assert.equal(failed.statusCode, 409, failed.body);
          assert.equal(failed.json().error.code, 'SPACE_STORAGE_LIMIT');
          assert.equal(
            (await f.db.query('SELECT id FROM projects WHERE space_id=$1', [targetSpace.id]))
              .rowCount,
            0,
          );
          assert.equal(
            (await f.call('GET', `/v1/spaces/${targetSpace.id}/storage`)).json().storage
              .retainedBytes,
            0,
          );
        },
      );
      await t.test(
        'a committed authorized copy keeps its original after grant revocation; new copies are refused',
        async () => {
          const grant = (
            await f.db.query(
              "INSERT INTO share_grants(project_id,target_user_id,mode,expires_at,created_by) VALUES($1,$2,'copy',clock_timestamp()+interval '1 hour',$3) RETURNING id",
              [f.projectId, f.actors.outsider.id, f.actors.owner.id],
            )
          ).rows[0]!;
          const body = { targetProjectId: outsiderProject.id, idempotencyKey: randomUUID() };
          const copied = await f.call('POST', `/v1/assets/${f.assetId}/copy`, body, 'outsider');
          assert.equal(copied.statusCode, 201, copied.body);
          assert.equal(
            (await f.call('DELETE', `/v1/projects/${f.projectId}/grants/${grant.id}`)).statusCode,
            200,
          );
          assert.equal(
            (
              await f.call(
                'POST',
                `/v1/assets/${f.assetId}/copy`,
                { ...body, idempotencyKey: randomUUID() },
                'outsider',
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (await f.call('POST', `/v1/assets/${f.assetId}/copy`, body, 'outsider')).statusCode,
            200,
          );
          assert.equal(
            (
              await f.call(
                'GET',
                `/v1/assets/${copied.json().asset.id}/media`,
                undefined,
                'outsider',
              )
            ).json().descriptor.sourceSha256,
            originalObject,
          );
          const audit = await f.db.query(
            "SELECT detail FROM audit_entries WHERE action='asset.media_copy' AND target_id=$1",
            [copied.json().asset.id],
          );
          assert.equal(audit.rowCount, 1);
        },
      );
    } finally {
      await f.close();
    }
  },
);
