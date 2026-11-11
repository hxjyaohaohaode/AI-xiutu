import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  createDatabase,
  transaction,
  ensureMonthlyGrant,
  reserveUnits,
  settleHold,
} from '@ai-xiutu/db';
import { createRecipe, createRecipeV3 } from '@ai-xiutu/editor';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hash } from '../src/core.js';
import { schemaSql, schemaV2Sql } from '../../../packages/db/src/schema.js';
import { schemaV3Sql } from '../../../packages/db/src/schema-v3.js';
import { schemaV4Sql } from '../../../packages/db/src/schema-v4.js';
import { schemaV5Sql } from '../../../packages/db/src/schema-v5.js';
import { schemaV6Sql } from '../../../packages/db/src/schema-v6.js';
import { schemaV7Sql } from '../../../packages/db/src/schema-v7.js';
import {
  withDatabaseFaults,
  type DatabaseFaults,
} from '../../../packages/db/test/fault-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'AI result decisions, immutable source history and composition ACL',
  { skip: !databaseUrl },
  async (t) => {
    const db = createDatabase(databaseUrl!);
    const directory = await mkdtemp(join(tmpdir(), 'xiutu-decision-'));
    const origin = 'http://localhost:5173';
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: databaseUrl!,
      SESSION_SECRET: 'test-only-result-decision-secret-2026',
      APP_ORIGIN: origin,
      STORAGE_DIR: directory,
      TRUST_PROXY_HOPS: '0',
    });
    const faults: DatabaseFaults = {};
    const app = await buildApp({
      db: withDatabaseFaults(db, faults),
      config,
      sms: {
        configured: false,
        async send() {
          throw new Error('must not send');
        },
      },
    });
    await app.ready();
    const call = (method: any, url: string, body?: unknown, cookie?: string, headers = {}) =>
      app.inject({
        method,
        url,
        headers: { origin, ...(cookie ? { cookie } : {}), ...headers },
        ...(body === undefined ? {} : { payload: body as any }),
      });
    async function actor(name: string, operator = false) {
      const user = (
        await db.query(
          "INSERT INTO users(phone,display_name,status,phone_verified_at) VALUES($1,$2,'active',now()) RETURNING id",
          [
            `+861${String(BigInt('0x' + randomBytes(6).toString('hex')) % 10_000_000_000n).padStart(10, '0')}`,
            name,
          ],
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
        cookie: `xiutu_session=${token}`,
      };
    }
    const owner = await actor('Result owner');
    const outsider = await actor('Result outsider');
    const operator = await actor('Operations only', true);
    const viewer = await actor('View only');
    let projectId = '';
    let foreignProject = '';
    let sourceId = '';
    let generatedId = '';
    let layerId = '';
    let artworkId = '';
    let revisionId = '';
    let imageJobId = '';
    let textJobId = '';
    let planJobId = '';
    const decisionBody = (action: string, extra: object = {}) => ({
      protocolVersion: 1,
      idempotencyKey: randomUUID(),
      action,
      ...extra,
    });
    async function upload(project: string, cookie: string, color: string, width = 10, height = 8) {
      const bytes = await sharp({
        create: { width, height, channels: 4, background: color },
      })
        .png()
        .toBuffer();
      const boundary = `test-${randomUUID()}`;
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="fixture.png"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const response = await call('POST', `/v1/projects/${project}/assets`, payload, cookie, {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().asset.id as string;
    }
    async function completed(operation: string, output: unknown, input: unknown = {}) {
      return (
        await db.query(
          "INSERT INTO ai_jobs(project_id,actor_id,model_id,input_hash,state,operation,input,output,idempotency_key) VALUES($1,$2,'test-fixture-only',$3,'completed',$4,$5,$6,$7) RETURNING id",
          [
            projectId,
            owner.id,
            'a'.repeat(64),
            operation,
            JSON.stringify(input),
            JSON.stringify(output),
            randomUUID(),
          ],
        )
      ).rows[0]!.id as string;
    }
    try {
      await t.test(
        'forward migration preserves existing history and backfills retained storage without double counting',
        async () => {
          const tx = await db.connect();
          const namespace = `migration_fixture_${randomUUID().replaceAll('-', '')}`;
          try {
            await tx.query('BEGIN');
            await tx.query(`CREATE SCHEMA "${namespace}"`);
            await tx.query(`SET LOCAL search_path TO "${namespace}",public`);
            await tx.query(schemaSql);
            await tx.query(schemaV2Sql);
            await tx.query(schemaV3Sql);
            const user = (
              await tx.query(
                "INSERT INTO users(phone,display_name) VALUES('+8613900000000','Migration fixture') RETURNING id",
              )
            ).rows[0]!.id;
            const space = (
              await tx.query(
                "INSERT INTO spaces(name,kind,owner_id) VALUES('Migration','personal',$1) RETURNING id",
                [user],
              )
            ).rows[0]!.id;
            const project = (
              await tx.query(
                "INSERT INTO projects(space_id,title,created_by) VALUES($1,'Migration',$2) RETURNING id",
                [space, user],
              )
            ).rows[0]!.id;
            const asset = (
              await tx.query(
                "INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by) VALUES($1,'test.png','fixture','image/png',1,1,4,'fixture-hash',$2) RETURNING id",
                [project, user],
              )
            ).rows[0]!.id;
            const artwork = (
              await tx.query(
                "INSERT INTO artworks(project_id,asset_id,title) VALUES($1,$2,'Migration') RETURNING id",
                [project, asset],
              )
            ).rows[0]!.id;
            const revision = (
              await tx.query(
                'INSERT INTO revisions(artwork_id,version,recipe,author_id) VALUES($1,1,$2,$3) RETURNING *',
                [artwork, JSON.stringify(createRecipe()), user],
              )
            ).rows[0]!;
            await tx.query(
              "INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by,deleted_at) VALUES($1,'retained.png','retained-fixture','image/png',1,1,6,'retained-hash',$2,now())",
              [project, user],
            );
            await tx.query(schemaV4Sql);
            await tx.query(schemaV5Sql);
            await tx.query(schemaV5Sql);
            await tx.query(schemaV6Sql);
            await tx.query(schemaV6Sql);
            await tx.query(schemaV7Sql);
            await tx.query(schemaV7Sql);
            const storage = (
              await tx.query('SELECT * FROM space_storage_accounts WHERE space_id=$1', [space])
            ).rows[0]!;
            assert.equal(Number(storage.retained_bytes), 10);
            assert.equal(Number(storage.retained_assets), 2);
            assert.equal(Number(storage.max_bytes), 1073741824);
            assert.equal(storage.max_assets, 1000);
            // Lowering a limit does not rewrite or remove existing retained data.
            await tx.query(
              'UPDATE space_storage_accounts SET max_bytes=0,max_assets=0 WHERE space_id=$1',
              [space],
            );
            await tx.query('SAVEPOINT blocked_capacity');
            await assert.rejects(
              tx.query(
                "INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by) VALUES($1,'blocked.png','blocked-fixture','image/png',1,1,1,'blocked-hash',$2)",
                [project, user],
              ),
              /SPACE_STORAGE_LIMIT/,
            );
            await tx.query('ROLLBACK TO SAVEPOINT blocked_capacity');
            const retained = (
              await tx.query(
                'SELECT retained_bytes,retained_assets FROM space_storage_accounts WHERE space_id=$1',
                [space],
              )
            ).rows[0]!;
            assert.equal(Number(retained.retained_bytes), 10);
            assert.equal(Number(retained.retained_assets), 2);
            const after = (await tx.query('SELECT * FROM revisions WHERE id=$1', [revision.id]))
              .rows[0];
            assert.deepEqual(after, revision);
            assert.equal(
              (
                await tx.query('SELECT asset_id FROM revision_sources WHERE revision_id=$1', [
                  revision.id,
                ])
              ).rows[0]!.asset_id,
              asset,
            );
            const second = (
              await tx.query(
                'INSERT INTO revisions(artwork_id,version,parent_id,recipe,author_id) VALUES($1,2,$2,$3,$4) RETURNING id',
                [artwork, revision.id, JSON.stringify(createRecipeV3()), user],
              )
            ).rows[0]!.id;
            assert.equal(
              (
                await tx.query('SELECT asset_id FROM revision_sources WHERE revision_id=$1', [
                  second,
                ])
              ).rows[0]!.asset_id,
              asset,
            );
            await assert.rejects(
              tx.query('DELETE FROM revision_sources WHERE revision_id=$1', [revision.id]),
              /immutable/,
            );
          } finally {
            await tx.query('ROLLBACK');
            tx.release();
          }
        },
      );
      await t.test(
        'public discovery resolves unconfigured adapters honestly and exposes no credentials',
        async () => {
          const result = await call('GET', '/v1/modules');
          assert.equal(result.statusCode, 200);
          assert.equal(result.json().protocolVersion, 1);
          const caps = result.json().modules.flatMap((m: any) => m.capabilities);
          assert.equal(caps.find((c: any) => c.id === 'ai.image').runtime, 'unconfigured');
          assert.equal(caps.find((c: any) => c.id === 'operations.payment').runtime, 'unsupported');
          assert.equal(caps.find((c: any) => c.id === 'history.restore').runtime, 'available');
          assert.ok(!result.body.includes(config.sessionSecret));
          const editor = await call('GET', '/v1/editor-contract');
          assert.equal(editor.statusCode, 200, editor.body);
          assert.equal(editor.json().preferredRecipeVersion, 4);
          const angle = editor
            .json()
            .parameters.find((p: any) => p.path === 'transform.rotationDegrees');
          assert.equal(angle.step, 0.01);
          assert.equal(angle.aiWritable, false);
          const hsl = editor.json().parameters.find((p: any) => p.path === 'hsl.red.hue');
          assert.equal(hsl.scopeMinimumVersion.global, 2);
          assert.equal(hsl.scopeMinimumVersion.region, 3);
        },
      );
      await t.test(
        'fixtures create real immutable uploads, source snapshots and completed candidates',
        async () => {
          const project = await call(
            'POST',
            '/v1/projects',
            { spaceId: owner.spaceId, title: 'Result decisions' },
            owner.cookie,
          );
          assert.equal(project.statusCode, 201);
          projectId = project.json().project.id;
          const other = await call(
            'POST',
            '/v1/projects',
            { spaceId: outsider.spaceId, title: 'Foreign result' },
            outsider.cookie,
          );
          foreignProject = other.json().project.id;
          await db.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'viewer')", [
            owner.spaceId,
            viewer.id,
          ]);
          sourceId = await upload(projectId, owner.cookie, '#224466');
          generatedId = await upload(projectId, owner.cookie, '#668822');
          layerId = await upload(projectId, owner.cookie, '#ff8844');
          const created = await call(
            'POST',
            `/v1/projects/${projectId}/artworks`,
            { assetId: sourceId, title: 'Original image', recipe: createRecipe() },
            owner.cookie,
          );
          assert.equal(created.statusCode, 201, created.body);
          artworkId = created.json().artwork.id;
          revisionId = created.json().revision.id;
          assert.equal(created.json().revision.assetId, sourceId);
          imageJobId = await completed('generate-image', {
            kind: 'image',
            assetId: generatedId,
            images: [{ index: 0, assetId: generatedId, width: 10, height: 8 }],
          });
          await db.query('UPDATE assets SET provenance=$2 WHERE id=$1', [
            generatedId,
            JSON.stringify({ kind: 'ai-generated', jobId: imageJobId, inputHash: 'a'.repeat(64) }),
          ]);
          planJobId = await completed('edit-plan', {
            kind: 'edit-plan',
            artworkId,
            baseVersion: 1,
            inputHash: 'a'.repeat(64),
            recipe: createRecipe({ adjustments: { contrast: -25 } }),
            summary: 'Test-only proposal',
          });
          textJobId = await completed('generate-text', {
            kind: 'text',
            title: 'Candidate document',
            body: 'A real saved candidate body',
            summary: 'Candidate',
          });
        },
      );
      await t.test(
        'missing session, outsider, viewer and platform operations do not gain adoption privileges',
        async () => {
          for (const [cookie, expected] of [
            [undefined, 401],
            [outsider.cookie, 404],
            [viewer.cookie, 403],
            [operator.cookie, 404],
          ] as const) {
            const result = await call(
              'POST',
              `/v1/ai-jobs/${imageJobId}/decisions`,
              decisionBody('fork'),
              cookie,
            );
            assert.equal(result.statusCode, expected, result.body);
          }
          assert.equal(
            (await call('GET', `/v1/ai-jobs/${imageJobId}/decisions`, undefined, outsider.cookie))
              .statusCode,
            404,
          );
        },
      );
      await t.test(
        'manual source replacement is a replay-safe new version with optional global color',
        async () => {
          const created = await call(
            'POST',
            `/v1/projects/${projectId}/artworks`,
            {
              title: 'Source switch',
              assetId: sourceId,
              recipe: createRecipe({
                adjustments: { exposure: -0.65, sharpness: 20 },
                geometry: { rotation: 90 },
              }),
            },
            owner.cookie,
          );
          assert.equal(created.statusCode, 201, created.body);
          const initial = created.json();
          const url = `/v1/artworks/${initial.artwork.id}/source`;
          const request = { assetId: layerId, expectedVersion: 1, mode: 'carry-color' };
          assert.equal((await call('POST', url, request, viewer.cookie)).statusCode, 403);
          assert.equal((await call('POST', url, request, operator.cookie)).statusCode, 404);
          const foreign = await upload(foreignProject, outsider.cookie, '#006688');
          assert.equal(
            (await call('POST', url, { ...request, assetId: foreign }, owner.cookie)).statusCode,
            409,
          );
          const changed = await call('POST', url, request, owner.cookie);
          assert.equal(changed.statusCode, 201, changed.body);
          const result = changed.json();
          assert.equal(result.revision.recipe.schemaVersion, 4);
          assert.equal(result.revision.recipe.geometry.rotation, 0);
          assert.equal(result.revision.recipe.adjustments.exposure, -0.65);
          assert.equal(result.revision.recipe.adjustments.sharpness, 0);
          assert.equal(result.artwork.assetId, layerId);
          assert.equal(result.revision.assetId, layerId);
          const replay = await call('POST', url, request, owner.cookie);
          assert.equal(replay.statusCode, 200, replay.body);
          assert.equal(replay.json().revision.id, result.revision.id);
          assert.equal(
            (await call('POST', url, { ...request, assetId: generatedId }, owner.cookie))
              .statusCode,
            409,
          );
          const restore = await call(
            'POST',
            `/v1/artworks/${initial.artwork.id}/restore`,
            {
              revisionId: initial.revision.id,
              expectedVersion: 2,
            },
            owner.cookie,
          );
          assert.equal(restore.statusCode, 201, restore.body);
          assert.equal(restore.json().asset.id, sourceId);
          assert.equal(restore.json().revision.recipe.geometry.rotation, 90);
        },
      );
      await t.test(
        'rejection records an immutable decision without changing already settled points',
        async () => {
          let holdId = '';
          await transaction(db, async (tx) => {
            await ensureMonthlyGrant(tx, owner.id);
            const hold = await reserveUnits(tx, {
              spaceId: owner.spaceId,
              userId: owner.id,
              idempotencyKey: randomUUID(),
              requestHash: 'b'.repeat(64),
              units: 3,
            });
            holdId = hold.id;
            await settleHold(tx, hold.id);
            await tx.query('UPDATE ai_jobs SET hold_id=$2 WHERE id=$1', [imageJobId, hold.id]);
          });
          const before = (
            await db.query('SELECT count(*)::int AS n FROM ledger_entries WHERE space_id=$1', [
              owner.spaceId,
            ])
          ).rows[0]!.n;
          const body = decisionBody('reject', { outputIndex: 0, reason: '构图暂不合适' });
          const first = await call(
            'POST',
            `/v1/ai-jobs/${imageJobId}/decisions`,
            body,
            owner.cookie,
          );
          assert.equal(first.statusCode, 201, first.body);
          const replay = await call(
            'POST',
            `/v1/ai-jobs/${imageJobId}/decisions`,
            body,
            owner.cookie,
          );
          assert.equal(replay.statusCode, 200);
          assert.equal(replay.json().decision.id, first.json().decision.id);
          assert.equal(replay.json().replayed, true);
          assert.equal(
            (await db.query('SELECT state FROM quota_holds WHERE id=$1', [holdId])).rows[0]!.state,
            'settled',
          );
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM ledger_entries WHERE space_id=$1', [
                owner.spaceId,
              ])
            ).rows[0]!.n,
            before,
          );
          await assert.rejects(
            db.query("UPDATE ai_result_decisions SET reason='changed' WHERE id=$1", [
              first.json().decision.id,
            ]),
            /immutable/,
          );
          assert.equal(
            (await db.query('SELECT state FROM ai_jobs WHERE id=$1', [imageJobId])).rows[0]!.state,
            'completed',
          );
          assert.equal(
            (
              await call(
                'POST',
                `/v1/ai-jobs/${imageJobId}/decisions`,
                { ...body, action: 'fork', reason: undefined },
                owner.cookie,
              )
            ).statusCode,
            409,
          );
        },
      );
      await t.test(
        'concurrent identical forks create one branch and changing a reused key fails',
        async () => {
          const before = (
            await db.query('SELECT count(*)::int AS n FROM artworks WHERE project_id=$1', [
              projectId,
            ])
          ).rows[0]!.n;
          const body = decisionBody('fork', { outputIndex: 0, title: 'Chosen branch' });
          const results = await Promise.all([
            call('POST', `/v1/ai-jobs/${imageJobId}/decisions`, body, owner.cookie),
            call('POST', `/v1/ai-jobs/${imageJobId}/decisions`, body, owner.cookie),
          ]);
          assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 201]);
          assert.equal(results[0]!.json().artwork.id, results[1]!.json().artwork.id);
          assert.equal(results[0]!.json().revision.recipe.schemaVersion, 4);
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM artworks WHERE project_id=$1', [
                projectId,
              ])
            ).rows[0]!.n,
            before + 1,
          );
          assert.equal(
            (
              await call(
                'POST',
                `/v1/ai-jobs/${imageJobId}/decisions`,
                { ...body, title: 'Changed' },
                owner.cookie,
              )
            ).statusCode,
            409,
          );
        },
      );
      await t.test(
        'lost adoption COMMIT acknowledgement replays the committed branch without duplicating it or settling again',
        async () => {
          const before = (
            await db.query('SELECT count(*)::int AS n FROM artworks WHERE project_id=$1', [
              projectId,
            ])
          ).rows[0]!.n;
          const ledgerBefore = (
            await db.query('SELECT count(*)::int AS n FROM ledger_entries WHERE space_id=$1', [
              owner.spaceId,
            ])
          ).rows[0]!.n;
          const body = decisionBody('fork', { title: 'Lost response branch' });
          faults.afterCommitMatching = 'INSERT INTO ai_result_decisions';
          const uncertain = await call(
            'POST',
            `/v1/ai-jobs/${imageJobId}/decisions`,
            body,
            owner.cookie,
          );
          assert.equal(uncertain.statusCode, 500);
          assert.equal(faults.commitFailures, 1);
          const replay = await call(
            'POST',
            `/v1/ai-jobs/${imageJobId}/decisions`,
            body,
            owner.cookie,
          );
          assert.equal(replay.statusCode, 200, replay.body);
          assert.equal(replay.json().replayed, true);
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM artworks WHERE project_id=$1', [
                projectId,
              ])
            ).rows[0]!.n,
            before + 1,
          );
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM ledger_entries WHERE space_id=$1', [
                owner.spaceId,
              ])
            ).rows[0]!.n,
            ledgerBefore,
          );
          assert.equal(
            (await call('GET', replay.json().asset.url, undefined, owner.cookie)).statusCode,
            200,
          );
        },
      );
      await t.test(
        'failed decision persistence rolls back its artwork and source snapshot in the same transaction',
        async () => {
          const before = (
            await db.query('SELECT count(*)::int AS n FROM artworks WHERE project_id=$1', [
              projectId,
            ])
          ).rows[0]!.n;
          const body = decisionBody('fork', { title: 'Rollback fixture' });
          faults.beforeStatementMatching = 'INSERT INTO ai_result_decisions';
          const failure = await call(
            'POST',
            `/v1/ai-jobs/${imageJobId}/decisions`,
            body,
            owner.cookie,
          );
          assert.equal(failure.statusCode, 500);
          assert.equal(
            (
              await db.query('SELECT count(*)::int AS n FROM artworks WHERE project_id=$1', [
                projectId,
              ])
            ).rows[0]!.n,
            before,
          );
          assert.equal(
            (
              await db.query(
                'SELECT id FROM ai_result_decisions WHERE actor_id=$1 AND idempotency_key=$2',
                [owner.id, body.idempotencyKey],
              )
            ).rowCount,
            0,
          );
        },
      );
      await t.test(
        'adopting an image as a layer preserves its base, parameters, contain placement and immutable source history',
        async () => {
          const candidateId = await upload(projectId, owner.cookie, '#883355', 4, 8);
          const jobId = await completed('generate-image', {
            kind: 'image',
            images: [{ index: 0, assetId: candidateId, width: 4, height: 8 }],
          });
          await db.query('UPDATE assets SET provenance=$2 WHERE id=$1', [
            candidateId,
            JSON.stringify({ kind: 'ai-generated', jobId }),
          ]);
          const original = await call(
            'POST',
            `/v1/projects/${projectId}/artworks`,
            {
              assetId: sourceId,
              title: 'Layer target',
              recipe: createRecipe({ adjustments: { exposure: -0.4 } }),
            },
            owner.cookie,
          );
          assert.equal(original.statusCode, 201, original.body);
          const targetId = original.json().artwork.id;
          const key = decisionBody('layer', { targetArtworkId: targetId, expectedVersion: 1 });
          const ledgerBefore = (await db.query('SELECT count(*)::int AS n FROM ledger_entries'))
            .rows[0]!.n;
          const result = await call('POST', `/v1/ai-jobs/${jobId}/decisions`, key, owner.cookie);
          assert.equal(result.statusCode, 201, result.body);
          const value = result.json();
          assert.equal(value.asset.id, sourceId);
          assert.equal(value.artwork.assetId, sourceId);
          assert.equal(value.artwork.headVersion, 2);
          assert.equal(value.revision.recipe.schemaVersion, 3);
          assert.equal(value.revision.recipe.adjustments.exposure, -0.4);
          const layer = value.revision.recipe.imageLayers[0];
          assert.equal(layer.sourceId, candidateId);
          assert.equal(layer.x, 0.3);
          assert.equal(layer.y, 0);
          assert.equal(layer.width, 0.4);
          assert.equal(layer.height, 1);
          assert.equal(layer.opacity, 1);
          assert.equal(layer.blendMode, 'normal');
          assert.equal(layer.origin.instanceId, jobId);
          assert.equal(value.decision.action, 'layer');
          assert.equal(value.decision.revisionId, value.revision.id);
          assert.equal(
            (
              await db.query('SELECT asset_id FROM revision_sources WHERE revision_id=$1', [
                value.revision.id,
              ])
            ).rows[0]!.asset_id,
            sourceId,
          );
          assert.equal(
            (
              await db.query('SELECT asset_id FROM revision_image_layers WHERE revision_id=$1', [
                value.revision.id,
              ])
            ).rows[0]!.asset_id,
            candidateId,
          );
          assert.equal(
            (await db.query('SELECT count(*)::int AS n FROM ledger_entries')).rows[0]!.n,
            ledgerBefore,
          );
          const replay = await call('POST', `/v1/ai-jobs/${jobId}/decisions`, key, owner.cookie);
          assert.equal(replay.statusCode, 200, replay.body);
          assert.equal(replay.json().revision.id, value.revision.id);
          assert.equal(
            (
              await call(
                'POST',
                `/v1/ai-jobs/${jobId}/decisions`,
                decisionBody('layer', { targetArtworkId: targetId, expectedVersion: 1 }),
                owner.cookie,
              )
            ).statusCode,
            409,
          );
          assert.equal(
            (
              await call(
                'POST',
                `/v1/ai-jobs/${jobId}/decisions`,
                decisionBody('layer', { targetArtworkId: targetId, expectedVersion: 2 }),
                viewer.cookie,
              )
            ).statusCode,
            403,
          );
          const old = await call(
            'GET',
            `/v1/artworks/${targetId}/revisions/${original.json().revision.id}`,
            undefined,
            owner.cookie,
          );
          assert.equal(old.json().asset.id, sourceId);
          assert.equal(old.json().revision.recipe.schemaVersion, 1);
          const removed = await call(
            'POST',
            `/v1/artworks/${targetId}/revisions`,
            { expectedVersion: 2, recipe: createRecipeV3() },
            owner.cookie,
          );
          assert.equal(removed.statusCode, 201, removed.body);
          assert.equal(
            (await call('DELETE', `/v1/assets/${candidateId}`, undefined, owner.cookie)).statusCode,
            409,
          );
        },
      );
      await t.test(
        'AI layer adoption checks capacity, output provenance and project ownership before appending',
        async () => {
          const full = createRecipeV3();
          for (let index = 0; index < 8; index++)
            full.imageLayers.push({
              id: randomUUID(),
              name: `Layer ${index}`,
              sourceId: layerId,
              enabled: true,
              opacity: 1,
              blendMode: 'normal',
              x: 0,
              y: 0,
              width: 1,
              height: 1,
              rotationDegrees: 0,
              flipX: false,
              flipY: false,
              mask: null,
            });
          const target = await call(
            'POST',
            `/v1/projects/${projectId}/artworks`,
            { assetId: sourceId, title: 'Full stack', recipe: full },
            owner.cookie,
          );
          assert.equal(target.statusCode, 201, target.body);
          const body = decisionBody('layer', {
            targetArtworkId: target.json().artwork.id,
            expectedVersion: 1,
          });
          const rejected = await call(
            'POST',
            `/v1/ai-jobs/${imageJobId}/decisions`,
            body,
            owner.cookie,
          );
          assert.equal(rejected.statusCode, 409, rejected.body);
          assert.equal(rejected.json().error.code, 'LAYER_LIMIT');
          const forged = await completed('generate-image', { kind: 'image', assetId: generatedId });
          const mismatch = await call(
            'POST',
            `/v1/ai-jobs/${forged}/decisions`,
            decisionBody('layer', { targetArtworkId: artworkId, expectedVersion: 1 }),
            owner.cookie,
          );
          assert.equal(mismatch.statusCode, 409, mismatch.body);
          assert.equal(mismatch.json().error.code, 'RESULT_SOURCE_MISMATCH');
          const foreign = await call(
            'POST',
            `/v1/ai-jobs/${imageJobId}/decisions`,
            decisionBody('layer', { targetArtworkId: randomUUID(), expectedVersion: 1 }),
            owner.cookie,
          );
          assert.equal(foreign.statusCode, 404, foreign.body);
          assert.equal(
            (
              await db.query('SELECT id FROM ai_result_decisions WHERE idempotency_key=$1', [
                body.idempotencyKey,
              ])
            ).rowCount,
            0,
          );
          assert.equal(
            (
              await call('GET', `/v1/artworks/${target.json().artwork.id}`, undefined, owner.cookie)
            ).json().artwork.headVersion,
            1,
          );
        },
      );
      await t.test(
        'replace atomically changes current source, preserves old source and rejects stale proposals',
        async () => {
          const body = decisionBody('replace', {
            outputIndex: 0,
            targetArtworkId: artworkId,
            expectedVersion: 1,
          });
          const result = await call(
            'POST',
            `/v1/ai-jobs/${imageJobId}/decisions`,
            body,
            owner.cookie,
          );
          assert.equal(result.statusCode, 201, result.body);
          assert.equal(result.json().artwork.assetId, generatedId);
          assert.equal(result.json().artwork.headVersion, 2);
          assert.equal(result.json().revision.assetId, generatedId);
          const old = await call(
            'GET',
            `/v1/artworks/${artworkId}/revisions/${revisionId}`,
            undefined,
            owner.cookie,
          );
          assert.equal(old.statusCode, 200);
          assert.equal(old.json().asset.id, sourceId);
          assert.equal(old.json().revision.recipe.schemaVersion, 1);
          assert.equal(
            (await call('DELETE', `/v1/assets/${sourceId}`, undefined, owner.cookie)).statusCode,
            409,
          );
          const stale = await call(
            'POST',
            `/v1/ai-jobs/${planJobId}/decisions`,
            decisionBody('apply-plan', { targetArtworkId: artworkId, expectedVersion: 1 }),
            owner.cookie,
          );
          assert.equal(stale.statusCode, 409, stale.body);
          assert.equal(
            (
              await call(
                'POST',
                `/v1/ai-jobs/${imageJobId}/decisions`,
                decisionBody('replace', { targetArtworkId: artworkId, expectedVersion: 1 }),
                owner.cookie,
              )
            ).statusCode,
            409,
          );
          await assert.rejects(
            db.query('UPDATE revision_sources SET asset_id=$2 WHERE revision_id=$1', [
              revisionId,
              generatedId,
            ]),
            /immutable/,
          );
        },
      );
      await t.test(
        'restoring history appends source plus recipe together and uses CAS',
        async () => {
          const restored = await call(
            'POST',
            `/v1/artworks/${artworkId}/restore`,
            { revisionId, expectedVersion: 2 },
            owner.cookie,
          );
          assert.equal(restored.statusCode, 201, restored.body);
          assert.equal(restored.json().asset.id, sourceId);
          assert.equal(restored.json().artwork.headVersion, 3);
          assert.equal(restored.json().revision.recipe.schemaVersion, 1);
          const replay = await call(
            'POST',
            `/v1/artworks/${artworkId}/restore`,
            { revisionId, expectedVersion: 2 },
            owner.cookie,
          );
          assert.equal(replay.statusCode, 200, replay.body);
          assert.equal(replay.json().revision.id, restored.json().revision.id);
          assert.equal(replay.json().replayed, true);
          assert.equal(
            (
              await call(
                'POST',
                `/v1/artworks/${artworkId}/restore`,
                { revisionId: restored.json().revision.parentId, expectedVersion: 2 },
                owner.cookie,
              )
            ).statusCode,
            409,
          );
          assert.equal(
            (
              await call(
                'POST',
                `/v1/artworks/${artworkId}/restore`,
                { revisionId: randomUUID(), expectedVersion: 3 },
                owner.cookie,
              )
            ).statusCode,
            404,
          );
          const versions = await call(
            'GET',
            `/v1/artworks/${artworkId}/revisions`,
            undefined,
            owner.cookie,
          );
          assert.deepEqual(
            versions.json().revisions.map((r: any) => r.assetId),
            [sourceId, generatedId, sourceId],
          );
        },
      );
      await t.test(
        'outdated parameter proposal may be preserved as a branch from its original source',
        async () => {
          const result = await call(
            'POST',
            `/v1/ai-jobs/${planJobId}/decisions`,
            decisionBody('fork', { title: 'Keep old suggestion' }),
            owner.cookie,
          );
          assert.equal(result.statusCode, 201, result.body);
          assert.equal(result.json().asset.id, sourceId);
          assert.equal(result.json().revision.recipe.adjustments.contrast, -25);
          const current = await call('GET', `/v1/artworks/${artworkId}`, undefined, owner.cookie);
          assert.equal(current.json().artwork.headVersion, 3);
        },
      );
      await t.test(
        'matching parameter suggestion applies exactly once and records a new revision',
        async () => {
          const fresh = await completed('edit-plan', {
            kind: 'edit-plan',
            artworkId,
            baseVersion: 3,
            inputHash: 'a'.repeat(64),
            recipe: createRecipe({ adjustments: { exposure: -0.75 } }),
          });
          const body = decisionBody('apply-plan', {
            targetArtworkId: artworkId,
            expectedVersion: 3,
          });
          const applied = await call('POST', `/v1/ai-jobs/${fresh}/decisions`, body, owner.cookie);
          assert.equal(applied.statusCode, 201, applied.body);
          assert.equal(applied.json().artwork.headVersion, 4);
          assert.equal(applied.json().revision.recipe.adjustments.exposure, -0.75);
          const replay = await call('POST', `/v1/ai-jobs/${fresh}/decisions`, body, owner.cookie);
          assert.equal(replay.statusCode, 200);
          assert.equal(replay.json().artwork.headVersion, 4);
        },
      );
      await t.test(
        'text adoption creates document snapshots and prevents stale replacement',
        async () => {
          const created = await call(
            'POST',
            `/v1/ai-jobs/${textJobId}/decisions`,
            decisionBody('save-text'),
            owner.cookie,
          );
          assert.equal(created.statusCode, 201, created.body);
          const document = created.json().document;
          assert.equal(document.body, 'A real saved candidate body');
          assert.equal(created.json().decision.contentEdited, false);
          const body = decisionBody('save-text', {
            targetDocumentId: document.id,
            expectedDocumentVersion: 1,
            title: 'Confirmed text',
            body: 'User revised this candidate',
          });
          const saved = await call(
            'POST',
            `/v1/ai-jobs/${textJobId}/decisions`,
            body,
            owner.cookie,
          );
          assert.equal(saved.statusCode, 201, saved.body);
          assert.equal(saved.json().document.version, 2);
          assert.equal(saved.json().document.body, 'User revised this candidate');
          assert.equal(saved.json().decision.contentEdited, true);
          assert.equal(
            (await db.query('SELECT output FROM ai_jobs WHERE id=$1', [textJobId])).rows[0]!.output
              .body,
            'A real saved candidate body',
          );
          const stale = await call(
            'POST',
            `/v1/ai-jobs/${textJobId}/decisions`,
            { ...body, idempotencyKey: randomUUID() },
            owner.cookie,
          );
          assert.equal(stale.statusCode, 409);
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM document_versions WHERE document_id=$1',
                [document.id],
              )
            ).rows[0]!.n,
            2,
          );
        },
      );
      await t.test(
        'wrong output type/index, unfinished jobs and attempted automatic refund fail closed',
        async () => {
          const pending = await completed('generate-text', null);
          await db.query("UPDATE ai_jobs SET state='queued' WHERE id=$1", [pending]);
          const requests = [
            [imageJobId, decisionBody('fork', { outputIndex: 8 }), 400],
            [
              textJobId,
              decisionBody('replace', { targetArtworkId: artworkId, expectedVersion: 4 }),
              400,
            ],
            [imageJobId, decisionBody('save-text'), 400],
            [
              textJobId,
              decisionBody('layer', { targetArtworkId: artworkId, expectedVersion: 4 }),
              400,
            ],
            [pending, decisionBody('reject'), 409],
            [imageJobId, { ...decisionBody('reject'), refund: true }, 400],
          ] as const;
          for (const [jobId, body, status] of requests) {
            const result = await call('POST', `/v1/ai-jobs/${jobId}/decisions`, body, owner.cookie);
            assert.equal(result.statusCode, status, result.body);
          }
          await db.query("UPDATE ai_jobs SET state='cancelled' WHERE id=$1", [pending]);
        },
      );
      await t.test(
        'composition saves enforce same-project image dependencies and block deletion from history',
        async () => {
          const recipe = createRecipeV3();
          recipe.imageLayers.push({
            id: 'layer-one',
            name: 'Layer one',
            enabled: true,
            opacity: 1,
            blendMode: 'soft-light',
            sourceId: layerId,
            x: 0.1,
            y: 0.1,
            width: 0.6,
            height: 0.6,
            rotationDegrees: 12.5,
            flipX: false,
            flipY: false,
            mask: null,
          });
          const saved = await call(
            'POST',
            `/v1/artworks/${artworkId}/revisions`,
            { expectedVersion: 4, recipe },
            owner.cookie,
          );
          assert.equal(saved.statusCode, 201, saved.body);
          assert.equal(
            (
              await db.query('SELECT asset_id FROM revision_image_layers WHERE revision_id=$1', [
                saved.json().revision.id,
              ])
            ).rows[0]!.asset_id,
            layerId,
          );
          assert.equal(
            (await call('DELETE', `/v1/assets/${layerId}`, undefined, owner.cookie)).statusCode,
            409,
          );
          for (const invalidSource of [
            'local:1',
            'https://private.invalid/file',
            await upload(foreignProject, outsider.cookie, '#112233'),
          ]) {
            recipe.imageLayers[0]!.sourceId = invalidSource;
            const result = await call(
              'POST',
              `/v1/artworks/${artworkId}/revisions`,
              { expectedVersion: 5, recipe },
              owner.cookie,
            );
            assert.equal(result.statusCode, 400, result.body);
          }
          assert.equal(
            (await call('GET', `/v1/artworks/${artworkId}`, undefined, owner.cookie)).json().artwork
              .headVersion,
            5,
          );
        },
      );
      await t.test(
        'cross-space copy remaps all composition source IDs to independently authorized assets',
        async () => {
          await db.query(
            "UPDATE spaces SET sharing_policy=jsonb_set(sharing_policy,'{allowCopy}','true') WHERE id=$1",
            [owner.spaceId],
          );
          const team = await call('POST', '/v1/spaces', { name: 'Composition team' }, owner.cookie);
          assert.equal(team.statusCode, 201, team.body);
          const copied = await call(
            'POST',
            `/v1/projects/${projectId}/copy`,
            {
              targetSpaceId: team.json().space.id,
              title: 'Independent composite',
              idempotencyKey: randomUUID(),
            },
            owner.cookie,
          );
          assert.equal(copied.statusCode, 201, copied.body);
          const copyProject = copied.json().project.id;
          const result = await db.query(
            "SELECT r.recipe FROM artworks a JOIN revisions r ON r.id=a.head_revision_id WHERE a.project_id=$1 AND r.recipe->>'schemaVersion'='3'",
            [copyProject],
          );
          const composite = result.rows.find((row) => row.recipe.imageLayers?.length);
          assert.ok(composite);
          const mapped = composite.recipe.imageLayers[0].sourceId;
          assert.notEqual(mapped, layerId);
          assert.equal(
            (await db.query('SELECT project_id FROM assets WHERE id=$1', [mapped])).rows[0]!
              .project_id,
            copyProject,
          );
          assert.equal(
            (await call('GET', `/v1/assets/${mapped}/file`, undefined, outsider.cookie)).statusCode,
            404,
          );
        },
      );
      await t.test(
        'user decision history stays project scoped after membership revocation',
        async () => {
          const readable = await call(
            'GET',
            `/v1/ai-jobs/${imageJobId}/decisions`,
            undefined,
            viewer.cookie,
          );
          assert.equal(readable.statusCode, 200);
          assert.ok(readable.json().decisions.length >= 3);
          await db.query('DELETE FROM memberships WHERE space_id=$1 AND user_id=$2', [
            owner.spaceId,
            viewer.id,
          ]);
          assert.equal(
            (await call('GET', `/v1/ai-jobs/${imageJobId}/decisions`, undefined, viewer.cookie))
              .statusCode,
            404,
          );
        },
      );
    } finally {
      await app.close();
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
