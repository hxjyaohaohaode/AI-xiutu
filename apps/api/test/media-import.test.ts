import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const chunkSize = 4 * 1024 * 1024;
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
test(
  'media HTTP workflow uses real isolated decoding, resumable bytes, retained originals and ACL',
  { skip: !databaseUrl || process.platform !== 'linux' },
  async (t) => {
    const originalEnabled = process.env.MEDIA_ADVANCED_ENABLED;
    process.env.MEDIA_ADVANCED_ENABLED = 'true';
    const f = await collaborationFixture(databaseUrl!);
    const put = (
      jobId: string,
      offset: number,
      bytes: Buffer,
      actor: 'owner' | 'editor' | 'outsider' = 'owner',
    ) =>
      f.app.inject({
        method: 'PUT',
        url: `/v1/media-imports/${jobId}/chunk?offset=${offset}`,
        headers: {
          origin: f.origin,
          cookie: f.actors[actor].cookie,
          'content-type': 'application/octet-stream',
        },
        payload: bytes,
      });
    const start = (size: number, idempotencyKey = randomUUID(), name = 'high precision.png') =>
      f.call('POST', `/v1/projects/${f.projectId}/media-imports`, {
        size,
        name,
        idempotencyKey,
        generateTiles: true,
      });
    async function waitDone(jobId: string) {
      const until = Date.now() + 30000;
      while (Date.now() < until) {
        const response = await f.call('GET', `/v1/media-imports/${jobId}`);
        assert.equal(response.statusCode, 200, response.body);
        const result = response.json();
        if (result.job.state !== 'processing') return result;
        await delay(40);
      }
      throw new Error('Media processing exceeded the local verification deadline');
    }
    try {
      const available = await f.call('GET', '/v1/media-capabilities');
      assert.equal(available.statusCode, 200, available.body);
      assert.equal(available.json().available, true);
      // Real PNG16 fixture, deliberately uncompressed and larger than one chunk.
      const raw = Buffer.alloc(1024 * 768 * 4);
      for (let p = 0; p < raw.length; p += 4) {
        raw[p] = (p / 4) % 251;
        raw[p + 1] = (p / 4096) % 241;
        raw[p + 2] = (p / 64) % 239;
        raw[p + 3] = 255;
      }
      const original = await sharp(raw, { raw: { width: 1024, height: 768, channels: 4 } })
        .toColourspace('rgb16')
        .png({ compressionLevel: 0 })
        .toBuffer();
      assert.equal((await sharp(original).metadata()).depth, 'ushort');
      assert.ok(original.length > chunkSize);
      let jobId = '',
        importedAsset = '',
        descriptor: any;
      const baseline = (await f.call('GET', `/v1/spaces/${f.teamId}/storage`)).json().storage;
      await t.test(
        'start binds idempotency and reserves bytes; chunk retry verifies exact content and offsets',
        async () => {
          const key = randomUUID(),
            created = await start(original.length, key);
          assert.equal(created.statusCode, 201, created.body);
          jobId = created.json().job.id;
          assert.equal((await start(original.length, key)).json().job.id, jobId);
          assert.equal((await start(original.length, key, 'different.png')).statusCode, 409);
          const budget = (await f.call('GET', `/v1/spaces/${f.teamId}/storage`)).json().storage;
          assert.equal(budget.reservedMediaBytes, original.length);
          assert.equal(
            (await f.call('GET', `/v1/media-imports/${jobId}`, undefined, 'outsider')).statusCode,
            404,
          );
          assert.equal(
            (await put(jobId, 0, original.subarray(0, chunkSize), 'editor')).statusCode,
            404,
          );
          assert.equal((await put(jobId, 1, original.subarray(0, 32))).statusCode, 409);
          assert.equal((await put(jobId, 0, Buffer.alloc(chunkSize + 1))).statusCode, 413);
          const first = await put(jobId, 0, original.subarray(0, chunkSize));
          assert.equal(first.statusCode, 200, first.body);
          assert.equal(first.json().uploadedBytes, chunkSize);
          assert.equal((await put(jobId, 0, original.subarray(0, chunkSize))).statusCode, 200);
          const changed = Buffer.from(original.subarray(0, 32));
          changed[0] = changed[0]! ^ 1;
          assert.equal((await put(jobId, 0, changed)).json().error.code, 'CHUNK_MISMATCH');
          assert.equal(
            (await put(jobId, chunkSize - 10, original.subarray(0, 20))).json().error.code,
            'CHUNK_OVERLAP',
          );
          assert.equal(
            (await f.call('POST', `/v1/media-imports/${jobId}/complete`)).statusCode,
            409,
          );
          const second = await put(jobId, chunkSize, original.subarray(chunkSize));
          assert.equal(second.statusCode, 200, second.body);
          assert.equal(second.json().uploadedBytes, original.length);
        },
      );
      await t.test(
        'complete publishes only the actual normalized proxy and retains original, 16-bit master and DZI tiles',
        async () => {
          const first = await f.call('POST', `/v1/media-imports/${jobId}/complete`);
          assert.equal(first.statusCode, 202, first.body);
          assert.equal(
            (await f.call('POST', `/v1/media-imports/${jobId}/complete`)).statusCode,
            202,
          );
          const result = await waitDone(jobId);
          assert.equal(result.job.state, 'ready', JSON.stringify(result.job));
          importedAsset = result.asset.id;
          const metadata = await f.call('GET', `/v1/assets/${importedAsset}/media`);
          assert.equal(metadata.statusCode, 200, metadata.body);
          descriptor = metadata.json().descriptor;
          assert.equal(descriptor.original.bitDepth, 16);
          assert.equal(descriptor.master.bitDepth, 16);
          assert.equal(descriptor.proxy.bitDepth, 8);
          assert.equal(metadata.json().editor.masterExportIncludesRecipe, false);
          assert.equal(descriptor.original.width, 1024);
          assert.equal(descriptor.original.height, 768);
          const downloaded = await f.call('GET', metadata.json().downloads.original);
          assert.equal(downloaded.statusCode, 200);
          assert.equal(sha(downloaded.rawPayload), sha(original));
          const master = await f.call('GET', metadata.json().downloads.master);
          assert.equal(master.statusCode, 200);
          assert.equal((await sharp(master.rawPayload).metadata()).depth, 'ushort');
          const dzi = await f.call('GET', metadata.json().downloads.tiles);
          assert.equal(dzi.statusCode, 200);
          assert.match(dzi.body, /<Image/);
          const tile = await f.call(
            'GET',
            `/v1/assets/${importedAsset}/media/tiles_files/${descriptor.tiles.levels - 1}/0_0.${descriptor.tiles.format}`,
          );
          assert.equal(tile.statusCode, 200);
          assert.equal((await sharp(tile.rawPayload).metadata()).format, 'jpeg');
          const budget = (await f.call('GET', `/v1/spaces/${f.teamId}/storage`)).json().storage;
          const retained = Number(
            (
              await f.db.query('SELECT retained_bytes FROM media_sources WHERE asset_id=$1', [
                importedAsset,
              ])
            ).rows[0]!.retained_bytes,
          );
          assert.equal(budget.reservedMediaBytes, 0);
          assert.equal(
            budget.retainedBytes - baseline.retainedBytes,
            retained + result.asset.bytes,
          );
          assert.equal(budget.retainedAssets - baseline.retainedAssets, 1);
        },
      );
      await t.test(
        'download, tile and export authorization is checked separately; master export is explicit',
        async () => {
          for (const path of [
            'media',
            'media/original',
            'media/master',
            'media/tiles.dzi',
            'media/tiles_files/0/0_0.jpeg',
          ]) {
            const r = await f.call(
              'GET',
              `/v1/assets/${importedAsset}/${path}`,
              undefined,
              'outsider',
            );
            assert.equal(r.statusCode, 404, `${path}: ${r.body}`);
          }
          assert.equal(
            (
              await f.call(
                'POST',
                `/v1/assets/${importedAsset}/media/export`,
                { format: 'png16' },
                'outsider',
              )
            ).statusCode,
            404,
          );
          const converted = await f.call('POST', `/v1/assets/${importedAsset}/media/export`, {
            format: 'png16',
            quality: 100,
          });
          assert.equal(converted.statusCode, 200, converted.body.slice(0, 100));
          assert.equal(converted.headers['x-editor-recipe-included'], 'false');
          assert.equal((await sharp(converted.rawPayload).metadata()).depth, 'ushort');
          const edit = {
            algorithm: 'scene-linear-v1',
            exposure: -0.73,
            temperature: 0,
            tint: 0,
            contrast: 0,
            saturation: 0,
            shadows: 0,
            highlights: 0,
            toneMap: 'none',
          };
          const exportPath = `/v1/assets/${importedAsset}/media/export`;
          assert.equal(
            (await f.call('POST', exportPath, { format: 'png16', precisionEdit: edit })).statusCode,
            409,
          );
          assert.equal(
            (
              await f.call('POST', exportPath, {
                format: 'png16',
                precisionEdit: edit,
                expectedSourceSha256: 'f'.repeat(64),
              })
            ).statusCode,
            409,
          );
          const graded = await f.call('POST', exportPath, {
            format: 'png16',
            precisionEdit: edit,
            expectedSourceSha256: descriptor.sourceSha256,
          });
          assert.equal(graded.statusCode, 200, graded.body.slice(0, 100));
          assert.match(String(graded.headers['x-precision-edit-sha256']), /^[a-f0-9]{64}$/);
          assert.equal((await sharp(graded.rawPayload).metadata()).depth, 'ushort');
          assert.notEqual(sha(graded.rawPayload), sha(converted.rawPayload));
          assert.equal(
            (
              await f.call('POST', exportPath, {
                format: 'exr32',
                expectedSourceSha256: descriptor.sourceSha256,
              })
            ).statusCode,
            422,
          );
        },
      );
      await t.test('prepared master downloads stay private, single-use and byte-exact', async () => {
        const path = `/v1/assets/${importedAsset}/media`;
        const direct = await f.call('POST', path + '/export', { format: 'png16' });
        assert.equal(direct.statusCode, 200);
        const payload = { format: 'png16', delivery: 'attachment' };
        const prepared = await f.call('POST', path + '/export', payload);
        assert.equal(prepared.statusCode, 201, prepared.body);
        const { downloadId, expiresAt } = prepared.json();
        assert.ok(Date.parse(expiresAt) > Date.now());
        const url = `${path}/exports/${downloadId}`;
        assert.equal((await f.call('POST', path + '/export', payload)).statusCode, 429);
        const preview = await f.call('POST', path + '/preview', {
          expectedSourceSha256: descriptor.sourceSha256,
          precisionInput: 'master16',
          maxEdge: 128,
          region: { left: 0, top: 0, width: 16, height: 16 },
        });
        assert.equal(preview.statusCode, 200);
        assert.equal((await f.call('HEAD', url)).statusCode, 404);
        assert.equal((await f.app.inject({ method: 'GET', url })).statusCode, 401);
        for (const actor of ['outsider', 'editor', 'operator'] as const)
          assert.equal((await f.call('GET', url, undefined, actor)).statusCode, 404);
        assert.equal((await f.call('GET', url.replace(importedAsset, f.assetId))).statusCode, 404);
        const secondToken = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
        const secondHash = sha(Buffer.from(secondToken));
        await f.db.query(
          "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 hour')",
          [secondHash, f.actors.owner.id],
        );
        assert.equal(
          (await f.app.inject({ method: 'GET', url, cookies: { xiutu_session: secondToken } })).statusCode,
          404,
        );
        assert.equal((await readdir(join(f.directory, 'media-v1'))).filter((file) => file.endsWith('.export')).length, 0);
        const downloads = await Promise.all([f.call('GET', url), f.call('GET', url)]);
        assert.deepEqual(downloads.map(({ statusCode }) => statusCode).sort(), [200, 404]);
        const downloaded = downloads.find(({ statusCode }) => statusCode === 200)!;
        assert.equal(sha(downloaded.rawPayload), sha(direct.rawPayload));
        assert.equal(downloaded.headers['content-disposition'], direct.headers['content-disposition']);
        assert.equal(downloaded.headers['cache-control'], 'private, no-store');
        assert.equal(downloaded.headers['x-editor-recipe-included'], 'false');
        const viewer = await f.call('POST', path + '/export', payload, 'viewer');
        assert.equal(viewer.statusCode, 201, viewer.body);
        const revokedUrl = `${path}/exports/${viewer.json().downloadId}`;
        await f.db.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [f.teamId, f.actors.viewer.id]);
        assert.equal((await f.call('GET', revokedUrl, undefined, 'viewer')).statusCode, 404);
        await f.db.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'viewer')", [f.teamId, f.actors.viewer.id]);
        assert.equal((await f.call('GET', revokedUrl, undefined, 'viewer')).statusCode, 404);
        const available = await f.call('POST', path + '/export', payload, 'viewer');
        assert.equal(available.statusCode, 201, available.body);
        const deletedSessionUrl = `${path}/exports/${available.json().downloadId}`;
        const tokenHash = f.actors.viewer.tokenHash;
        await f.db.query("UPDATE sessions SET expires_at=clock_timestamp() WHERE token_hash=$1", [tokenHash]);
        assert.equal((await f.call('GET', deletedSessionUrl, undefined, 'viewer')).statusCode, 401);
        await f.db.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '1 hour' WHERE token_hash=$1", [tokenHash]);
        assert.equal((await f.call('GET', deletedSessionUrl, undefined, 'viewer')).statusCode, 200);
      });
      await t.test(
        'master previews, saved grades and history use the same immutable source and exact samples',
        async () => {
          const path = `/v1/assets/${importedAsset}/media`;
          const recipe = {
            expectedSourceSha256: descriptor.sourceSha256,
            precisionInput: 'master16',
            precisionEdit: {
              algorithm: 'scene-linear-v1',
              exposure: -0.47,
              temperature: 8,
              tint: -3,
              contrast: 11,
              saturation: -4,
              shadows: 5,
              highlights: -7,
              toneMap: 'none',
            },
          };
          assert.equal(
            (await f.call('GET', path + '/grades', undefined, 'outsider')).statusCode,
            404,
          );
          assert.equal(
            (await f.call('POST', path + '/grades', { ...recipe, expectedVersion: 0 }, 'viewer'))
              .statusCode,
            403,
          );
          const race = await Promise.all([
            f.call('POST', path + '/grades', { ...recipe, expectedVersion: 0 }),
            f.call('POST', path + '/grades', { ...recipe, expectedVersion: 0 }, 'editor'),
          ]);
          assert.deepEqual(race.map((r) => r.statusCode).sort(), [201, 409]);
          const first = race.find((r) => r.statusCode === 201)!.json().grade;
          assert.equal(first.version, 1);
          assert.deepEqual(first.edit, recipe.precisionEdit);
          await assert.rejects(
            f.db.query('UPDATE media_grade_revisions SET version=9 WHERE asset_id=$1', [
              importedAsset,
            ]),
            /revisions are immutable/,
          );
          const region = { left: 453, top: 227, width: 133, height: 59 };
          assert.equal(
            (
              await f.call('POST', path + '/preview', {
                ...recipe,
                maxEdge: 256,
                region: { ...region, left: 1020 },
              })
            ).json().error.code,
            'MEDIA_PREVIEW_WINDOW',
          );
          assert.equal(
            (
              await f.call(
                'POST',
                path + '/preview',
                {
                  ...recipe,
                  maxEdge: 256,
                  region,
                },
                'outsider',
              )
            ).statusCode,
            404,
          );
          const preview = await f.call(
            'POST',
            path + '/preview',
            { ...recipe, maxEdge: 256, region },
            'viewer',
          );
          assert.equal(preview.statusCode, 200, preview.body.slice(0, 160));
          const save = await f.call('POST', path + '/grades', {
            ...recipe,
            expectedVersion: 1,
            precisionEdit: { ...recipe.precisionEdit, exposure: 0.87 },
          });
          assert.equal(save.statusCode, 201);
          const listed = await f.call('GET', path + '/grades?beforeVersion=2');
          assert.deepEqual(listed.json().grades, [first]);
          const current = (await f.call('GET', path)).json().editor.precisionEditing.currentGrade;
          assert.equal(current.version, 2);
          const originalGrade = await f.call('POST', path + '/export', {
            format: 'png16',
            gradeVersion: 1,
            expectedSourceSha256: descriptor.sourceSha256,
          });
          assert.equal(originalGrade.statusCode, 200);
          assert.equal(
            originalGrade.headers['x-precision-edit-sha256'],
            preview.headers['x-precision-edit-sha256'],
          );
          const pixels = (image: Sharp) =>
            image.toColourspace('rgb16').raw({ depth: 'ushort' }).toBuffer();
          assert.deepEqual(
            await pixels(sharp(preview.rawPayload, { ignoreIcc: true })),
            await pixels(sharp(originalGrade.rawPayload, { ignoreIcc: true }).extract(region)),
          );
        },
      );
      await t.test(
        'cancelling incomplete upload releases only its reservation and does not alter existing assets',
        async () => {
          const created = await start(1000);
          assert.equal(created.statusCode, 201, created.body);
          const cancelId = created.json().job.id;
          assert.equal((await put(cancelId, 0, Buffer.from('incomplete'))).statusCode, 200);
          assert.equal(
            (await f.call('POST', `/v1/media-imports/${cancelId}/cancel`)).statusCode,
            200,
          );
          assert.equal(
            (await f.call('POST', `/v1/media-imports/${cancelId}/cancel`)).statusCode,
            200,
          );
          const state = (await f.call('GET', `/v1/media-imports/${cancelId}`)).json();
          assert.equal(state.job.state, 'cancelled');
          assert.equal(
            (await f.call('GET', `/v1/spaces/${f.teamId}/storage`)).json().storage
              .reservedMediaBytes,
            0,
          );
          assert.equal(
            (await f.call('GET', `/v1/assets/${importedAsset}/media`)).json().descriptor
              .sourceSha256,
            descriptor.sourceSha256,
          );
          assert.equal((await f.call('POST', `/v1/media-imports/${jobId}/cancel`)).statusCode, 409);
        },
      );
      await t.test(
        're-importing identical pixels produces a separate original object, with no hash-based private link',
        async () => {
          const compact = await sharp(original).png({ compressionLevel: 9 }).toBuffer();
          assert.notEqual(sha(compact), sha(original));
          const created = await start(
            compact.length,
            randomUUID(),
            'same pixels another encoding.png',
          );
          assert.equal(created.statusCode, 201, created.body);
          const anotherId = created.json().job.id;
          for (let offset = 0; offset < compact.length; offset += chunkSize)
            assert.equal(
              (await put(anotherId, offset, compact.subarray(offset, offset + chunkSize)))
                .statusCode,
              200,
            );
          assert.equal(
            (await f.call('POST', `/v1/media-imports/${anotherId}/complete`)).statusCode,
            202,
          );
          const result = await waitDone(anotherId);
          assert.equal(result.job.state, 'ready', JSON.stringify(result.job));
          const another = (await f.call('GET', `/v1/assets/${result.asset.id}/media`)).json()
            .descriptor;
          assert.equal(another.sourceSha256, sha(compact));
          assert.notEqual(another.sourceSha256, descriptor.sourceSha256);
          const objects = (
            await f.db.query('SELECT object_id FROM media_sources WHERE asset_id=ANY($1::uuid[])', [
              [importedAsset, result.asset.id],
            ])
          ).rows;
          assert.equal(new Set(objects.map((row) => row.object_id)).size, 2);
          assert.equal(
            (await f.call('GET', `/v1/spaces/${f.teamId}/storage`)).json().storage
              .reservedMediaBytes,
            0,
          );
        },
      );
      await t.test(
        'repeated cancellation of a durable remote-processing fixture does not release or delete in-flight resources',
        async () => {
          const created = await start(4096);
          assert.equal(created.statusCode, 201, created.body);
          const remoteId = created.json().job.id;
          // Explicit fault fixture: another process owns this durable processing
          // record. The local API must not infer that its empty active Map means idle.
          await f.db.query("UPDATE media_import_jobs SET state='processing' WHERE id=$1", [
            remoteId,
          ]);
          const directory = join(f.directory, 'media-v1', remoteId),
            marker = join(directory, 'decoder-active');
          await mkdir(directory, { recursive: true });
          await writeFile(marker, 'owned by the simulated remote processor');
          try {
            const first = await f.call('POST', `/v1/media-imports/${remoteId}/cancel`);
            const changedAt = (
              await f.db.query('SELECT updated_at FROM media_import_jobs WHERE id=$1', [remoteId])
            ).rows[0]!.updated_at;
            const repeat = await f.call('POST', `/v1/media-imports/${remoteId}/cancel`);
            for (const response of [first, repeat]) {
              assert.equal(response.statusCode, 200, response.body);
              assert.equal(response.json().cleanupPending, true);
            }
            const row = (
              await f.db.query(
                'SELECT state,reservation_bytes,updated_at FROM media_import_jobs WHERE id=$1',
                [remoteId],
              )
            ).rows[0]!;
            assert.equal(row.state, 'cancelled');
            assert.equal(Number(row.reservation_bytes), 4096);
            assert.deepEqual(row.updated_at, changedAt);
            assert.equal(
              (await f.call('GET', `/v1/spaces/${f.teamId}/storage`)).json().storage
                .reservedMediaBytes,
              4096,
            );
            assert.equal(await readFile(marker, 'utf8'), 'owned by the simulated remote processor');
            assert.equal((await start(1024)).json().error.code, 'IMPORT_BUSY');
          } finally {
            // Remove only this artificial remote fixture. No live worker was started.
            await f.db.query(
              'UPDATE space_storage_accounts SET media_reserved_bytes=media_reserved_bytes-4096 WHERE space_id=$1',
              [f.teamId],
            );
            await f.db.query('UPDATE media_import_jobs SET reservation_bytes=0 WHERE id=$1', [
              remoteId,
            ]);
            await rm(directory, { recursive: true, force: true });
          }
        },
      );
    } finally {
      await f.close();
      if (originalEnabled === undefined) delete process.env.MEDIA_ADVANCED_ENABLED;
      else process.env.MEDIA_ADVANCED_ENABLED = originalEnabled;
    }
  },
);
