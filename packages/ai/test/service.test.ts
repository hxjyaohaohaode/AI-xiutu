import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createDatabase, migrate, transaction, getEntitlements } from '@ai-xiutu/db';
import { createRecipe } from '@ai-xiutu/editor';
import { ProviderError } from '@ai-xiutu/providers';
import { createAiService, DispatchJournal, digest, type PlanProvider } from '../src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test('database integration is explicitly required by CI', () => {
  if (process.env.REQUIRE_DB_TESTS === '1') assert.ok(databaseUrl, 'TEST_DATABASE_URL required');
});
test(
  'AI transaction, moderation, idempotency, unknown and restore invariants',
  { skip: !databaseUrl },
  async (t) => {
    const db = createDatabase(databaseUrl!);
    await migrate(db);
    const directory = await mkdtemp(`${tmpdir()}/xiutu-ai-test-`);
    let externalCalls = 0;
    let decision: 'passed' | 'blocked' = 'passed';
    let transportFailure = false;
    const provider: PlanProvider = {
      configured: true,
      async complete() {
        externalCalls++;
        if (transportFailure) throw new ProviderError('TEST_NETWORK_UNKNOWN', 'unknown');
        return {
          value: { summary: '减弱对比度，并保留原有曝光', adjustments: { contrast: -25 } },
          requestId: 'test-vendor-receipt',
        };
      },
    };
    const service = createAiService(
      db,
      { AI_PLAN_ENABLED: 'true', QWEN_PLAN_MODEL: 'test-plan-model', AI_DAILY_JOB_LIMIT: '1000' },
      {
        provider,
        moderator: {
          configured: true,
          async check(text) {
            return { decision, inputHash: digest(text), requestId: 'test-review' };
          },
        },
        journal: new DispatchJournal(directory),
      },
    );
    const actorId = randomUUID(),
      spaceId = randomUUID(),
      projectId = randomUUID(),
      artworkId = randomUUID(),
      assetId = randomUUID();
    await transaction(db, async (tx) => {
      await tx.query(
        "INSERT INTO users(id,phone,display_name,phone_verified_at) VALUES($1,$2,'AI integration actor',now())",
        [actorId, `test-${actorId}`],
      );
      await tx.query(
        "INSERT INTO spaces(id,name,kind,owner_id) VALUES($1,'AI isolated test','personal',$2)",
        [spaceId, actorId],
      );
      await tx.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'owner')", [
        spaceId,
        actorId,
      ]);
      await tx.query(
        "INSERT INTO projects(id,space_id,title,created_by) VALUES($1,$2,'AI test',$3)",
        [projectId, spaceId, actorId],
      );
      await tx.query(
        "INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by) VALUES($1,$2,'test.png','test-only','image/png',2,2,16,'test-hash',$3)",
        [assetId, projectId, actorId],
      );
      await tx.query("INSERT INTO artworks(id,project_id,asset_id,title) VALUES($1,$2,$3,'test')", [
        artworkId,
        projectId,
        assetId,
      ]);
      await tx.query(
        "INSERT INTO model_configs(id,config) VALUES('test-plan-model',$1) ON CONFLICT(id) DO UPDATE SET config=excluded.config",
        [JSON.stringify({ enabled: true, unitCost: 2 })],
      );
    });
    const body = () => ({
      prompt: '请降低对比度',
      modelId: 'test-plan-model',
      idempotencyKey: randomUUID(),
      artworkId,
      expectedVersion: 1,
      recipe: createRecipe({ adjustments: { exposure: 0.5 } }),
    });
    try {
      await t.test(
        'one submission reserves once; completed candidate never modifies the artwork',
        async () => {
          const input = body();
          const a = await service.submit({ actorId, projectId, spaceId, body: input });
          const b = await service.submit({ actorId, projectId, spaceId, body: input });
          assert.equal(a.job.id, b.job.id);
          await assert.rejects(
            () =>
              service.submit({
                actorId,
                projectId,
                spaceId,
                body: { ...input, prompt: '另一请求' },
              }),
            { code: 'IDEMPOTENCY_CONFLICT' },
          );
          assert.equal(externalCalls, 0);
          assert.equal(await service.runOnce(), true);
          assert.equal(externalCalls, 1);
          const jobs = await service.list({ actorId, projectId });
          const job = jobs.jobs.find((j) => j.id === a.job.id)!;
          assert.equal(job.state, 'completed');
          assert.equal(job.artworkId, artworkId);
          assert.equal(
            (job.output as { recipe: { adjustments: { contrast: number } } }).recipe.adjustments
              .contrast,
            -25,
          );
          assert.equal(
            (await db.query('SELECT head_version FROM artworks WHERE id=$1', [artworkId])).rows[0]!
              .head_version,
            1,
          );
          const balance = await transaction(db, (tx) => getEntitlements(tx, spaceId));
          assert.equal(balance.held, 0);
          assert.equal(balance.usage.spent, 2);
        },
      );
      await t.test(
        'input rejection never calls the model and releases the original lot',
        async () => {
          decision = 'blocked';
          const before = externalCalls;
          const job = await service.submit({ actorId, projectId, spaceId, body: body() });
          await service.runOnce();
          assert.equal(externalCalls, before);
          assert.equal(
            (await service.list({ actorId, projectId })).jobs.find((j) => j.id === job.job.id)!
              .state,
            'failed',
          );
          assert.equal((await transaction(db, (tx) => getEntitlements(tx, spaceId))).held, 0);
          decision = 'passed';
        },
      );
      await t.test(
        'ambiguous external result holds points and is never automatically retried',
        async () => {
          transportFailure = true;
          const before = externalCalls;
          const job = await service.submit({ actorId, projectId, spaceId, body: body() });
          await service.runOnce();
          assert.equal(
            (await service.list({ actorId, projectId })).jobs.find((j) => j.id === job.job.id)!
              .state,
            'unknown',
          );
          await service.runOnce();
          assert.equal(externalCalls, before + 1);
          assert.equal((await transaction(db, (tx) => getEntitlements(tx, spaceId))).held, 2);
          await assert.rejects(
            () =>
              service.resolve({
                actorId,
                jobId: job.job.id,
                body: {
                  resolution: 'release',
                  reason: '测试核验确认未交付内容',
                  evidenceRef: 'test-receipt',
                },
              }),
            { code: 'FORBIDDEN' },
          );
          await db.query('INSERT INTO operator_users(user_id) VALUES($1)', [actorId]);
          const resolved = await service.resolve({
            actorId,
            jobId: job.job.id,
            body: {
              resolution: 'release',
              reason: '测试核验确认未交付内容',
              evidenceRef: 'test-receipt',
            },
          });
          assert.equal(resolved.resolution, 'release');
          assert.equal((await transaction(db, (tx) => getEntitlements(tx, spaceId))).held, 0);
          transportFailure = false;
        },
      );
      await t.test(
        'existing dispatch evidence prevents re-execution of a restored queued row',
        async () => {
          const job = await service.submit({ actorId, projectId, spaceId, body: body() });
          await new DispatchJournal(directory).start(job.job.id, job.job.inputHash);
          const before = externalCalls;
          await service.runOnce();
          assert.equal(externalCalls, before);
          assert.equal(
            (await service.list({ actorId, projectId })).jobs.find((j) => j.id === job.job.id)!
              .state,
            'unknown',
          );
        },
      );
      await t.test('changed head and revoked membership reject new paid requests', async () => {
        await assert.rejects(
          () =>
            service.submit({
              actorId,
              projectId,
              spaceId,
              body: { ...body(), expectedVersion: 2 },
            }),
          { code: 'VERSION_CONFLICT' },
        );
        await db.query("UPDATE memberships SET role='viewer' WHERE space_id=$1 AND user_id=$2", [
          spaceId,
          actorId,
        ]);
        await assert.rejects(() => service.submit({ actorId, projectId, spaceId, body: body() }), {
          code: 'FORBIDDEN',
        });
      });
      await t.test(
        'journal record missing from restored DB stops all future dispatch',
        async () => {
          await new DispatchJournal(directory).start(randomUUID(), 'unmatched-test-hash');
          await assert.rejects(() => service.runOnce(), /AI_RECOVERY_REQUIRED/);
        },
      );
    } finally {
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
