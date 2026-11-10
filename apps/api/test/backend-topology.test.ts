import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import sharp from 'sharp';
import {
  createRecipeV4,
  createAdjustmentRegionV3,
  parseEditorRecipe,
  renderEditorRecipeTiled,
} from '@ai-xiutu/editor';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

test(
  'mixed image editing preserves sources, pixel output and independent revision paths',
  { skip: !databaseUrl },
  async () => {
    const f = await collaborationFixture(databaseUrl!);
    const upload = async (width: number, height: number, phase: number) => {
      const data = Buffer.alloc(width * height * 4);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset = 4 * (y * width + x);
          data[offset] = (x * 17 + phase) % 256;
          data[offset + 1] = (y * 11 + x * 3) % 256;
          data[offset + 2] = (x * 9 + y * 13) % 256;
          data[offset + 3] = (x * 23 + y * 7 + phase) % 256;
        }
      }
      const png = await sharp(data, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
      const boundary = randomUUID();
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        png,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const response = await f.app.inject({
        method: 'POST',
        url: `/v1/projects/${f.projectId}/assets`,
        payload,
        headers: {
          origin: f.origin,
          cookie: f.actors.owner.cookie,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().asset.id as string;
    };
    const storedImage = async (assetId: string) => {
      const {
        rows: [asset],
      } = await f.db.query('SELECT storage_key FROM assets WHERE id=$1 AND project_id=$2', [
        assetId,
        f.projectId,
      ]);
      const { data, info } = await sharp(f.storage.path(asset.storage_key))
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
    };
    const compareRender = async (
      artworkPath: string,
      revisionId: string,
      expected: ReturnType<typeof renderEditorRecipeTiled>,
    ) => {
      const path = `${artworkPath}/revisions/${revisionId}`;
      const info = await f.call('GET', path + '/render-info');
      assert.equal(info.statusCode, 200, info.body);
      assert.equal(info.json().available, true);
      assert.deepEqual(info.json().output, { width: expected.width, height: expected.height });
      const png = await f.call('GET', path + '/render');
      assert.equal(png.statusCode, 200, png.statusCode === 200 ? undefined : png.body);
      assert.equal(png.headers['x-xiutu-revision'], revisionId);
      const rendered = await sharp(png.rawPayload).ensureAlpha().raw().toBuffer();
      assert.deepEqual(rendered, Buffer.from(expected.data));
      return png.rawPayload;
    };

    try {
      const sourceId = await upload(53, 37, 0);
      const overlayId = await upload(5, 163, 53);
      const create = await f.call('POST', `/v1/projects/${f.projectId}/artworks`, {
        assetId: sourceId,
        title: 'Mixed editing',
        recipe: createRecipeV4(),
      });
      assert.equal(create.statusCode, 201, create.body);
      const first = create.json().revision;
      const path = `/v1/artworks/${first.artworkId}`;
      const edited = createRecipeV4({
        geometry: {
          crop: { x: 0.04, y: 0.11, width: 0.93, height: 0.8 },
          rotation: 90,
          flipX: true,
        },
        adjustments: { exposure: 0.7, saturation: -25 },
        projective: {
          enabled: true,
          fit: 'crop',
          corners: [
            { x: 0.05, y: 0 },
            { x: 0.95, y: 0.07 },
            { x: 1, y: 0.95 },
            { x: 0, y: 1 },
          ],
        },
        regionEdits: [
          createAdjustmentRegionV3({
            id: 'local-light',
            color: { adjustments: { brightness: 26 } },
          }),
        ],
      });
      const save = { expectedVersion: 1, recipe: edited };
      const acknowledgements = await Promise.all([
        f.call('POST', path + '/revisions', save),
        f.call('POST', path + '/revisions', save),
      ]);
      assert.deepEqual(acknowledgements.map((r) => r.statusCode).sort(), [200, 201]);
      const second = acknowledgements[0]!.json().revision;
      assert.equal(acknowledgements[1]!.json().revision.id, second.id);
      assert.equal(second.origin.kind, 'manual');
      assert.equal(second.parentId, first.id);
      assert.equal(
        (await f.call('POST', path + '/revisions', { ...save, label: 'stale' })).statusCode,
        409,
      );

      const {
        rows: [job],
      } = await f.db.query(
        `INSERT INTO ai_jobs(project_id,actor_id,model_id,input_hash,state,operation,input,output,idempotency_key)
      VALUES($1,$2,'fixture-only',$3,'completed','generate-image','{}',$4,$5) RETURNING id`,
        [
          f.projectId,
          f.actors.owner.id,
          'b'.repeat(64),
          JSON.stringify({
            kind: 'image',
            assetId: overlayId,
            images: [{ index: 0, assetId: overlayId, width: 5, height: 163 }],
          }),
          randomUUID(),
        ],
      );
      await f.db.query('UPDATE assets SET provenance=$2 WHERE id=$1', [
        overlayId,
        JSON.stringify({ kind: 'ai-generated', jobId: job.id, inputHash: 'b'.repeat(64) }),
      ]);
      const adopt = await f.call('POST', `/v1/ai-jobs/${job.id}/decisions`, {
        protocolVersion: 1,
        idempotencyKey: randomUUID(),
        action: 'layer',
        targetArtworkId: first.artworkId,
        expectedVersion: 2,
      });
      assert.equal(adopt.statusCode, 201, adopt.body);
      const third = (await f.call('GET', path)).json().revision;
      assert.equal(third.origin.kind, 'ai-layer');
      assert.equal(third.recipe.schemaVersion, 4);
      assert.deepEqual(third.recipe.projective, edited.projective);
      assert.equal(third.recipe.imageLayers[0].sourceId, overlayId);
      const base = await storedImage(sourceId);
      const images = new Map([[overlayId, await storedImage(overlayId)]]);
      const expected = renderEditorRecipeTiled(base, parseEditorRecipe(third.recipe), {
        images,
        tileSize: 16,
      });
      const originalComposite = await compareRender(path, third.id, expected);
      assert.notDeepEqual(
        expected.data,
        renderEditorRecipeTiled(base, parseEditorRecipe(second.recipe), { tileSize: 16 }).data,
      );
      assert.ok(expected.data.some((byte, i) => i % 4 === 3 && byte > 0 && byte < 255));

      const collaboration = path + '/collaboration';
      const join = await f.call(
        'POST',
        collaboration + '/sessions',
        { clientId: randomUUID() },
        'editor',
      );
      assert.equal(join.statusCode, 201, join.body);
      const sessionId = join.json().session.id;
      const leaseResponse = await f.call(
        'POST',
        collaboration + '/leases',
        {
          sessionId,
          target: { kind: 'parameter', id: 'adjustments.contrast' },
        },
        'editor',
      );
      assert.equal(leaseResponse.statusCode, 201, leaseResponse.body);
      const lease = leaseResponse.json().lease;
      assert.equal(
        (
          await f.call('POST', path + '/restore', { expectedVersion: 3, revisionId: first.id })
        ).json().error.code,
        'COLLABORATION_LOCKED',
      );
      const command = {
        protocolVersion: 1,
        idempotencyKey: randomUUID(),
        sessionId,
        leaseId: lease.id,
        fence: lease.fence,
        baseVersion: 3,
        operation: { type: 'set-parameter', path: 'adjustments.contrast', value: 100 },
      };
      const commit = await f.call('POST', collaboration + '/commands', command, 'editor');
      assert.equal(commit.statusCode, 201, commit.body);
      assert.equal(
        (await f.call('POST', collaboration + '/commands', command, 'editor')).statusCode,
        200,
      );
      const released = await f.call(
        'DELETE',
        collaboration + '/leases/' + lease.id,
        {
          sessionId,
          fence: lease.fence,
        },
        'editor',
      );
      assert.equal(released.statusCode, 200, released.body);
      const fourth = (await f.call('GET', path)).json().revision;
      assert.equal(fourth.origin.kind, 'collaboration');
      assert.equal(fourth.recipe.adjustments.contrast, 100);
      assert.deepEqual(fourth.recipe.imageLayers, third.recipe.imageLayers);
      const fifthRecipe = createRecipeV4({
        ...fourth.recipe,
        adjustments: { ...fourth.recipe.adjustments, contrast: -100 },
      });
      assert.equal(
        (await f.call('POST', path + '/revisions', { expectedVersion: 4, recipe: fifthRecipe }))
          .statusCode,
        201,
      );

      const restore = await f.call('POST', path + '/restore', {
        expectedVersion: 5,
        revisionId: third.id,
      });
      assert.equal(restore.statusCode, 201, restore.body);
      const sixth = restore.json().revision;
      assert.deepEqual(sixth.origin, { kind: 'restore', sourceRevisionId: third.id });
      assert.deepEqual(await compareRender(path, sixth.id, expected), originalComposite);
      const forkBody = {
        revisionId: third.id,
        title: 'Independent branch',
        idempotencyKey: randomUUID(),
      };
      const fork = await f.call('POST', path + '/fork-revision', forkBody);
      assert.equal(fork.statusCode, 201, fork.body);
      const branch = fork.json().revision;
      const branchPath = `/v1/artworks/${branch.artworkId}`;
      assert.deepEqual(branch.origin, { kind: 'history-fork', sourceRevisionId: third.id });
      assert.equal(branch.parentId, null);
      assert.equal(
        (
          await f.call('POST', branchPath + '/revisions', {
            expectedVersion: 1,
            recipe: fifthRecipe,
          })
        ).statusCode,
        201,
      );
      const replay = await f.call('POST', path + '/fork-revision', forkBody);
      assert.equal(replay.statusCode, 200, replay.body);
      assert.equal(replay.json().revision.id, branch.id);
      assert.equal(replay.json().artwork.headVersion, 1);
      assert.equal((await f.call('GET', branchPath)).json().artwork.headVersion, 2);
      assert.equal((await f.call('GET', path)).json().revision.id, sixth.id);
      await assert.rejects(
        f.db.query('UPDATE artworks SET head_version=5 WHERE id=$1', [first.artworkId]),
        /artwork head must match/,
      );
      assert.equal(
        (await f.call('POST', path + '/fork-revision', { ...forkBody, title: 'changed' }))
          .statusCode,
        409,
      );
      assert.equal(
        (await f.call('POST', path + '/restore', { expectedVersion: 6, revisionId: branch.id }))
          .statusCode,
        404,
      );
      assert.equal(
        (
          await f.call(
            'POST',
            path + '/fork-revision',
            { ...forkBody, idempotencyKey: randomUUID() },
            'viewer',
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await f.call(
            'GET',
            path + '/revisions/' + third.id + '/render-info',
            undefined,
            'operator',
          )
        ).statusCode,
        404,
      );
      assert.equal(
        (await f.call('DELETE', `/v1/assets/${overlayId}`)).json().error.code,
        'ASSET_IN_USE',
      );

      const {
        rows: [overlay],
      } = await f.db.query('SELECT storage_key FROM assets WHERE id=$1', [overlayId]);
      const physical = f.storage.path(overlay.storage_key);
      const damaged = await readFile(physical);
      damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
      await writeFile(physical, damaged);
      const integrity = await f.call('GET', path + '/revisions/' + third.id + '/render');
      assert.equal(integrity.statusCode, 409, integrity.body);
      assert.equal(integrity.json().error.code, 'REVISION_SOURCE_CHANGED');
      assert.equal(
        (await f.call('GET', path + '/revisions/' + first.id + '/render')).statusCode,
        200,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  'history cursors visit every immutable revision across a concurrent append',
  { skip: !databaseUrl },
  async () => {
    const f = await collaborationFixture(databaseUrl!);
    const path = `/v1/artworks/${f.artwork.artwork.id}`;
    const append = (expectedVersion: number) =>
      f.call('POST', path + '/revisions', {
        expectedVersion,
        recipe: f.recipe,
        label: `revision ${expectedVersion + 1}`,
      });
    try {
      for (let version = 1; version <= 104; version++) {
        const next = await append(version);
        assert.equal(next.statusCode, 201, next.body);
      }
      const first = await f.call(
        'GET',
        path + '/revisions?summary=true&limit=23',
        undefined,
        'viewer',
      );
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().page.headVersion, 105);
      assert.equal((await append(105)).statusCode, 201);
      const versions = first.json().revisions.map((r: any) => r.version);
      assert.ok(first.json().revisions.every((r: any) => !Object.hasOwn(r, 'recipe')));
      let before = first.json().page.nextBeforeVersion;
      while (before !== null) {
        const next = await f.call(
          'GET',
          path + `/revisions?summary=true&limit=23&beforeVersion=${before}`,
          undefined,
          'viewer',
        );
        assert.equal(next.statusCode, 200, next.body);
        versions.push(...next.json().revisions.map((r: any) => r.version));
        before = next.json().page.nextBeforeVersion;
      }
      assert.deepEqual(
        versions,
        Array.from({ length: 105 }, (_, i) => 105 - i),
      );
      assert.equal(
        (await f.call('GET', path + '/revisions?limit=1')).json().revisions[0].version,
        106,
      );
      await f.db.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
        f.teamId,
        f.actors.viewer.id,
      ]);
      assert.equal((await f.call('GET', path + '/revisions', undefined, 'viewer')).statusCode, 404);
    } finally {
      await f.close();
    }
  },
);
