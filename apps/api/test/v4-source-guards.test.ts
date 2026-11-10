import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRecipeV4 } from '@ai-xiutu/editor';
import { collaborationFixture } from './collaboration-fixture.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'v4 image layers keep immutable source guards across collaboration, adoption and project copies',
  { skip: !databaseUrl },
  async (t) => {
    const f = await collaborationFixture(databaseUrl!);
    const roomId = f.artwork.artwork.id,
      route = `/v1/artworks/${roomId}/collaboration`;
    const layer = (sourceId: string) => ({
      id: 'image-layer',
      sourceId,
      name: 'Reference layer',
      enabled: false,
      opacity: 1,
      blendMode: 'normal' as const,
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
      rotationDegrees: 0,
      flipX: false,
      flipY: false,
      mask: null,
    });
    const candidateId = (
      await f.db.query(
        `INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by)
    SELECT project_id,'candidate.png',storage_key,mime,width,height,bytes,content_hash,created_by FROM assets WHERE id=$1 RETURNING id`,
        [f.assetId],
      )
    ).rows[0]!.id;
    const jobId = randomUUID();
    const imageOutput = {
      kind: 'image',
      assetId: candidateId,
      images: [{ index: 0, assetId: candidateId, width: 64, height: 48 }],
    };
    await f.db.query(
      `INSERT INTO ai_jobs(id,project_id,actor_id,model_id,input_hash,state,operation,input,output,idempotency_key)
    VALUES($1,$2,$3,'fixture',$4,'completed','generate-image','{}',$5::jsonb,$6)`,
      [
        jobId,
        f.projectId,
        f.actors.owner.id,
        'a'.repeat(64),
        JSON.stringify(imageOutput),
        randomUUID(),
      ],
    );
    await f.db.query('UPDATE assets SET provenance=$2::jsonb WHERE id=$1', [
      candidateId,
      JSON.stringify({ kind: 'ai-generated', jobId, inputHash: 'a'.repeat(64) }),
    ]);
    let version = 1;
    try {
      await t.test(
        'v4 rejects foreign and local layers before saving, including disabled layers',
        async () => {
          for (const sourceId of [f.privateAssetId, 'local:photo']) {
            const response = await f.call('POST', `/v1/artworks/${roomId}/revisions`, {
              expectedVersion: version,
              recipe: createRecipeV4({ imageLayers: [layer(sourceId)] }),
            });
            assert.equal(response.statusCode, 400, response.body);
          }
          await assert.rejects(
            f.db.query(
              'INSERT INTO revisions(artwork_id,version,recipe,author_id) VALUES($1,2,$2::jsonb,$3)',
              [
                roomId,
                JSON.stringify(createRecipeV4({ imageLayers: [layer(f.privateAssetId)] })),
                f.actors.owner.id,
              ],
            ),
            /revision layer unavailable/,
          );
          assert.equal(
            (await f.call('GET', `/v1/artworks/${roomId}`)).json().artwork.headVersion,
            1,
          );
        },
      );
      await t.test(
        'valid v4 layer references are snapshotted and block deletion even while disabled',
        async () => {
          const recipe = createRecipeV4({ imageLayers: [layer(candidateId)] });
          recipe.projective.enabled = true;
          recipe.projective.corners[0].x = 0.04;
          const saved = await f.call('POST', `/v1/artworks/${roomId}/revisions`, {
            expectedVersion: version,
            recipe,
          });
          assert.equal(saved.statusCode, 201, saved.body);
          version++;
          const snapshot = (
            await f.db.query('SELECT asset_id FROM revision_image_layers WHERE revision_id=$1', [
              saved.json().revision.id,
            ])
          ).rows;
          assert.equal(snapshot.length, 1);
          assert.equal(snapshot[0]!.asset_id, candidateId);
          const deletion = await f.call('DELETE', `/v1/assets/${candidateId}`);
          assert.equal(deletion.statusCode, 409, deletion.body);
        },
      );
      await t.test(
        'AI replacement, new-layer adoption and safe parameter application all respect the same editing lease',
        async () => {
          const session = (
            await f.call('POST', `${route}/sessions`, { clientId: randomUUID() })
          ).json().session;
          const leaseResponse = await f.call('POST', `${route}/leases`, {
            sessionId: session.id,
            target: { kind: 'document' },
          });
          assert.equal(leaseResponse.statusCode, 201, leaseResponse.body);
          const lease = leaseResponse.json().lease;
          const planJob = randomUUID();
          const recipe = (await f.call('GET', `/v1/artworks/${roomId}`)).json().revision.recipe;
          await f.db.query(
            `INSERT INTO ai_jobs(id,project_id,actor_id,model_id,input_hash,state,operation,input,output,idempotency_key)
        VALUES($1,$2,$3,'fixture',$4,'completed','edit-plan','{}',$5::jsonb,$6)`,
            [
              planJob,
              f.projectId,
              f.actors.owner.id,
              'b'.repeat(64),
              JSON.stringify({
                kind: 'edit-plan',
                artworkId: roomId,
                baseVersion: version,
                inputHash: 'b'.repeat(64),
                recipe,
              }),
              randomUUID(),
            ],
          );
          for (const action of ['replace', 'layer', 'apply-plan']) {
            const result = await f.call(
              'POST',
              `/v1/ai-jobs/${action === 'apply-plan' ? planJob : jobId}/decisions`,
              {
                protocolVersion: 1,
                idempotencyKey: randomUUID(),
                action,
                targetArtworkId: roomId,
                expectedVersion: version,
                ...(action === 'layer' ? { outputIndex: 0 } : {}),
              },
            );
            assert.equal(result.statusCode, 409, result.body);
            assert.equal(result.json().error.code, 'COLLABORATION_LOCKED');
          }
          assert.equal(
            (
              await f.db.query('SELECT count(*) FROM ai_result_decisions WHERE project_id=$1', [
                f.projectId,
              ])
            ).rows[0]!.count,
            '0',
          );
          const done = await f.call('DELETE', `${route}/leases/${lease.id}`, {
            sessionId: session.id,
            fence: lease.fence,
          });
          assert.equal(done.statusCode, 200);
          const applied = await f.call('POST', `/v1/ai-jobs/${jobId}/decisions`, {
            protocolVersion: 1,
            idempotencyKey: randomUUID(),
            action: 'layer',
            targetArtworkId: roomId,
            expectedVersion: version,
            outputIndex: 0,
          });
          assert.equal(applied.statusCode, 201, applied.body);
          version++;
          assert.equal(applied.json().revision.recipe.schemaVersion, 4);
          assert.equal(applied.json().revision.recipe.projective.corners[0].x, 0.04);
          assert.equal(applied.json().revision.recipe.imageLayers.length, 2);
        },
      );
      await t.test(
        'authorized full-project copies remap every v4 layer and retain transformations',
        async () => {
          const policy = await f.call('PUT', `/v1/spaces/${f.teamId}/sharing-policy`, {
            allowReference: true,
            allowCopy: true,
            maxActiveGrants: 20,
            maxCopyAssets: 20,
          });
          assert.equal(policy.statusCode, 200, policy.body);
          const copied = await f.call('POST', `/v1/projects/${f.projectId}/copy`, {
            targetSpaceId: f.actors.owner.spaceId,
            title: 'Independent v4 copy',
            idempotencyKey: randomUUID(),
          });
          assert.equal(copied.statusCode, 201, copied.body);
          const projectId = copied.json().project.id;
          const rows = (
            await f.db.query(
              'SELECT r.recipe,r.id FROM artworks a JOIN revisions r ON r.id=a.head_revision_id WHERE a.project_id=$1',
              [projectId],
            )
          ).rows;
          assert.equal(rows.length, 1);
          assert.equal(rows[0]!.recipe.schemaVersion, 4);
          assert.equal(rows[0]!.recipe.projective.corners[0].x, 0.04);
          assert.ok(rows[0]!.recipe.imageLayers.every((l: any) => l.sourceId !== candidateId));
          const snapshots = (
            await f.db.query(
              'SELECT ril.asset_id,a.project_id FROM revision_image_layers ril JOIN assets a ON a.id=ril.asset_id WHERE ril.revision_id=$1',
              [rows[0]!.id],
            )
          ).rows;
          assert.equal(snapshots.length, 2);
          assert.ok(snapshots.every((s) => s.project_id === projectId));
        },
      );
    } finally {
      await f.close();
    }
  },
);
