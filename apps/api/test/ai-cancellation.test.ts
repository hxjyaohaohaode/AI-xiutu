import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, transaction, adjustUnits, getEntitlements } from '@ai-xiutu/db';
import { createAiService, DispatchJournal, digest, type PlanProvider } from '@ai-xiutu/ai';
import { createRecipe } from '@ai-xiutu/editor';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { hash } from '../src/core.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  'queued cancellation and disabled-provider recovery use actual SQL and API ACL',
  { skip: !databaseUrl },
  async (t) => {
    const db = createDatabase(databaseUrl!);
    const directory = await mkdtemp(join(tmpdir(), 'xiutu-lifecycle-'));
    const journal = new DispatchJournal(join(directory, 'journal'));
    let calls = 0;
    let afterDispatch: (() => Promise<void>) | undefined;
    const provider: PlanProvider = {
      configured: true,
      async complete() {
        calls++;
        await afterDispatch?.();
        return {
          requestId: 'lifecycle-provider-receipt',
          value: { summary: '降低对比度', adjustments: { contrast: -1 } },
        };
      },
    };
    const dependencies = {
      provider,
      moderator: {
        configured: true,
        async check(text: string) {
          return {
            decision: 'passed' as const,
            inputHash: digest(text),
            requestId: 'lifecycle-review',
          };
        },
      },
      journal,
    };
    const disabled = createAiService(db, {}, dependencies);
    const enabled = createAiService(
      db,
      { AI_PLAN_ENABLED: 'true', AI_DAILY_JOB_LIMIT: '1000' },
      dependencies,
    );
    const origin = 'http://localhost:5173';
    const app = await buildApp({
      db,
      config: loadConfig({
        DATABASE_URL: databaseUrl!,
        SESSION_SECRET: 'isolated-lifecycle-test-secret-2026',
        APP_ORIGIN: origin,
        STORAGE_DIR: join(directory, 'storage'),
      }),
      aiService: disabled,
      sms: {
        configured: false,
        async send() {
          throw new Error('not configured');
        },
      },
    });
    await app.ready();
    const call = (method: 'GET' | 'POST', url: string, cookie: string, body?: unknown) =>
      app.inject({
        method,
        url,
        remoteAddress: '127.0.2.11',
        headers: { origin, cookie },
        ...(body === undefined ? {} : { payload: body as any }),
      });
    async function user() {
      const id = randomUUID(),
        token = randomBytes(32).toString('base64url');
      await db.query(
        "INSERT INTO users(id,phone,display_name,phone_verified_at) VALUES($1,$2,'Lifecycle fixture',now())",
        [id, `lifecycle-${id}`],
      );
      await db.query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 day')",
        [hash(token), id],
      );
      return { id, cookie: `xiutu_session=${token}` };
    }
    async function fixture() {
      const owner = await user(),
        actor = await user(),
        other = await user(),
        viewer = await user(),
        operator = await user();
      await db.query('INSERT INTO operator_users(user_id) VALUES($1)', [operator.id]);
      const spaceId = randomUUID(),
        projectId = randomUUID(),
        assetId = randomUUID(),
        artworkId = randomUUID(),
        modelId = `lifecycle-${randomUUID()}`;
      await transaction(db, async (tx) => {
        await tx.query(
          "INSERT INTO spaces(id,name,kind,owner_id) VALUES($1,'Lifecycle team','team',$2)",
          [spaceId, owner.id],
        );
        for (const [memberId, role] of [
          [owner.id, 'owner'],
          [actor.id, 'editor'],
          [other.id, 'editor'],
          [viewer.id, 'viewer'],
        ])
          await tx.query('INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,$3)', [
            spaceId,
            memberId,
            role,
          ]);
        await tx.query(
          "INSERT INTO projects(id,space_id,title,created_by) VALUES($1,$2,'Lifecycle fixture',$3)",
          [projectId, spaceId, actor.id],
        );
        await tx.query(
          "INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by) VALUES($1,$2,'source.png',$3,'image/png',2,2,16,'lifecycle-hash',$4)",
          [assetId, projectId, `lifecycle-${assetId}`, actor.id],
        );
        await tx.query(
          "INSERT INTO artworks(id,project_id,asset_id,title) VALUES($1,$2,$3,'Lifecycle artwork')",
          [artworkId, projectId, assetId],
        );
        await tx.query('INSERT INTO model_configs(id,config) VALUES($1,$2)', [
          modelId,
          JSON.stringify({
            enabled: true,
            unitCost: 2,
            operations: ['edit-plan'],
            provider: 'qwen',
          }),
        ]);
        await adjustUnits(tx, {
          spaceId,
          actorId: owner.id,
          units: 1000,
          reason: 'Isolated lifecycle fixture grant',
          idempotencyKey: randomUUID(),
          requestHash: digest(`lifecycle-grant:${spaceId}`),
        });
      });
      const submit = () =>
        enabled.submit({
          actorId: actor.id,
          projectId,
          spaceId,
          body: {
            operation: 'edit-plan',
            prompt: '降低对比度',
            modelId,
            idempotencyKey: randomUUID(),
            artworkId,
            expectedVersion: 1,
            recipe: createRecipe(),
          },
        });
      const row = async (jobId: string) =>
        (
          await db.query(
            'SELECT j.*,h.state AS hold_state,h.units FROM ai_jobs j JOIN quota_holds h ON h.id=j.hold_id WHERE j.id=$1',
            [jobId],
          )
        ).rows[0]!;
      const cancel = (jobId: string, cookie = actor.cookie, body: unknown = {}) =>
        call('POST', `/v1/ai-jobs/${jobId}/cancel`, cookie, body);
      return {
        owner,
        actor,
        other,
        viewer,
        operator,
        spaceId,
        projectId,
        modelId,
        submit,
        row,
        cancel,
      };
    }
    try {
      await t.test(
        'disabled capabilities still expose authorized cancellation; concurrent retries release once',
        async () => {
          const f = await fixture();
          const created = await f.submit();
          assert.equal(disabled.configured, false);
          assert.deepEqual(disabled.availableOperations, []);
          await db.query(
            "UPDATE model_configs SET config=jsonb_set(config,'{enabled}','false'::jsonb) WHERE id=$1",
            [f.modelId],
          );
          for (const [member, eligible] of [
            [f.actor, true],
            [f.owner, true],
            [f.other, false],
            [f.viewer, false],
          ] as const) {
            const listed = await call('GET', `/v1/projects/${f.projectId}/ai-jobs`, member.cookie);
            assert.equal(listed.statusCode, 200, listed.body);
            assert.equal(
              listed.json().jobs.find((job: any) => job.id === created.job.id).canCancel,
              eligible,
            );
          }
          for (const member of [f.other, f.viewer, f.operator]) {
            const denied = await f.cancel(created.job.id, member.cookie);
            assert.equal(denied.statusCode, 403, denied.body);
          }
          const responses = await Promise.all([f.cancel(created.job.id), f.cancel(created.job.id)]);
          assert.deepEqual(
            responses.map((response) => response.statusCode),
            [200, 200],
          );
          assert.deepEqual(responses.map((response) => response.json().replayed).sort(), [
            false,
            true,
          ]);
          for (const response of responses) {
            assert.equal(response.json().job.state, 'cancelled');
            assert.equal(response.json().job.canCancel, false);
            assert.equal(response.json().quotaReleased, true);
          }
          assert.equal((await f.row(created.job.id)).hold_state, 'released');
          const ledger = await db.query(
            "SELECT count(*)::int AS n FROM ledger_entries WHERE event_key LIKE $1 AND kind='released'",
            [`released:${(await f.row(created.job.id)).hold_id}:%`],
          );
          assert.equal(ledger.rows[0]!.n, 1);
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int AS n FROM audit_entries WHERE action='ai.cancelled' AND target_id=$1",
                [created.job.id],
              )
            ).rows[0]!.n,
            1,
          );
          const before = calls;
          await enabled.runOnce();
          assert.equal(calls, before);
          assert.equal(
            (
              await db.query(
                "SELECT count(*)::int AS n FROM events WHERE type='ai.cancelled' AND entity_id=$1",
                [created.job.id],
              )
            ).rows[0]!.n,
            1,
          );
        },
      );

      await t.test(
        'revoked or suspended actor cannot cancel; owner can release queued work without private operator access',
        async () => {
          const f = await fixture();
          const created = await f.submit();
          await db.query("UPDATE memberships SET role='viewer' WHERE space_id=$1 AND user_id=$2", [
            f.spaceId,
            f.actor.id,
          ]);
          assert.equal((await f.cancel(created.job.id)).statusCode, 403);
          await db.query("UPDATE users SET status='banned' WHERE id=$1", [f.actor.id]);
          assert.ok([401, 403].includes((await f.cancel(created.job.id)).statusCode));
          assert.equal((await f.cancel(created.job.id, f.owner.cookie)).statusCode, 200);
          assert.equal((await f.row(created.job.id)).hold_state, 'released');
        },
      );

      await t.test(
        'cancel racing an already dispatched request never releases or resends it',
        async () => {
          const f = await fixture();
          const created = await f.submit();
          let entered!: () => void, finish!: () => void;
          const dispatched = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const release = new Promise<void>((resolve) => {
            finish = resolve;
          });
          afterDispatch = async () => {
            entered();
            await release;
          };
          const before = calls;
          const running = enabled.runOnce();
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              dispatched,
              new Promise<never>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new Error('Test worker did not dispatch the queued fixture')),
                  10_000,
                );
              }),
            ]);
            const response = await f.cancel(created.job.id);
            assert.equal(response.statusCode, 409, response.body);
            assert.equal(response.json().error.code, 'JOB_NOT_QUEUED');
            assert.equal((await f.row(created.job.id)).hold_state, 'held');
          } finally {
            clearTimeout(timeout);
            finish();
            await running;
            afterDispatch = undefined;
          }
          assert.equal((await f.row(created.job.id)).state, 'completed');
          assert.equal((await f.row(created.job.id)).hold_state, 'settled');
          assert.equal((await f.cancel(created.job.id)).statusCode, 409);
          await disabled.runOnce();
          assert.equal(calls, before + 1);
        },
      );

      await t.test(
        'restored queued rows with dispatch or unreadable evidence become unknown without refunds',
        async () => {
          for (const kind of ['journal', 'malformed', 'lease', 'receipt', 'hold'] as const) {
            const f = await fixture();
            const created = await f.submit();
            if (kind === 'journal') await journal.start(created.job.id, created.job.inputHash);
            if (kind === 'malformed')
              await writeFile(
                join(journal.directory, `${created.job.id}.json`),
                'incomplete-record',
                { mode: 0o600 },
              );
            if (kind === 'lease')
              await db.query('UPDATE ai_jobs SET lease_started_at=now() WHERE id=$1', [
                created.job.id,
              ]);
            if (kind === 'receipt')
              await db.query(
                "UPDATE ai_jobs SET provider_request_id='existing-receipt' WHERE id=$1",
                [created.job.id],
              );
            if (kind === 'hold')
              await db.query("UPDATE quota_holds SET state='unknown' WHERE id=$1", [
                (await f.row(created.job.id)).hold_id,
              ]);
            const response = await f.cancel(created.job.id);
            assert.equal(response.statusCode, 409, response.body);
            assert.equal(response.json().error.code, 'CANCELLATION_REQUIRES_RECONCILIATION');
            const row = await f.row(created.job.id);
            assert.equal(row.state, 'unknown');
            assert.equal(row.hold_state, 'unknown');
            assert.equal((await f.cancel(created.job.id)).statusCode, 409);
            assert.equal((await transaction(db, (tx) => getEntitlements(tx, f.spaceId))).held, 2);
            // Preserve all good evidence; repair only our deliberately malformed test artifact
            // so later unrelated fixtures can exercise the global journal consistency guard.
            if (kind === 'malformed')
              await writeFile(
                join(journal.directory, `${created.job.id}.json`),
                JSON.stringify({
                  version: 1,
                  jobId: created.job.id,
                  inputHash: created.job.inputHash,
                }),
                { mode: 0o600 },
              );
          }
        },
      );

      await t.test(
        'all adapters disabled still recover every stale operation once, redact audio and preserve receipts/holds',
        async () => {
          const jobs: { id: string; holdId: string; projectId: string }[] = [];
          for (const operation of ['edit-plan', 'generate-image', 'generate-text', 'transcribe']) {
            const f = await fixture();
            const created = await f.submit();
            await journal.start(created.job.id, created.job.inputHash);
            await db.query(
              "UPDATE ai_jobs SET operation=$2,state='running',lease_started_at=clock_timestamp()-interval '6 minutes',provider_request_id='retained-receipt',input=input||$3::jsonb WHERE id=$1",
              [
                created.job.id,
                operation,
                JSON.stringify({ audioBase64: 'private-audio-must-be-redacted' }),
              ],
            );
            jobs.push({
              id: created.job.id,
              holdId: (await f.row(created.job.id)).hold_id,
              projectId: f.projectId,
            });
          }
          const queued = await fixture(),
            queuedJob = await queued.submit();
          const recent = await fixture(),
            recentJob = await recent.submit();
          await db.query(
            "UPDATE ai_jobs SET state='running',lease_started_at=clock_timestamp() WHERE id=$1",
            [recentJob.job.id],
          );
          const before = calls;
          await Promise.all([disabled.runOnce(), disabled.runOnce()]);
          assert.equal(calls, before);
          for (const job of jobs) {
            const row = (
              await db.query(
                'SELECT j.*,h.state AS hold_state FROM ai_jobs j JOIN quota_holds h ON h.id=j.hold_id WHERE j.id=$1',
                [job.id],
              )
            ).rows[0]!;
            assert.equal(row.state, 'unknown');
            assert.equal(row.hold_state, 'unknown');
            assert.equal(row.provider_request_id, 'retained-receipt');
            assert.equal(row.input.audioBase64, undefined);
            assert.equal(
              (
                await db.query(
                  "SELECT count(*)::int AS n FROM audit_entries WHERE action='ai.worker_lost' AND target_id=$1",
                  [job.id],
                )
              ).rows[0]!.n,
              1,
            );
          }
          assert.equal((await queued.row(queuedJob.job.id)).state, 'queued');
          assert.equal((await recent.row(recentJob.job.id)).state, 'running');
          assert.equal((await queued.cancel(queuedJob.job.id)).statusCode, 200);
          assert.equal((await recent.cancel(recentJob.job.id)).statusCode, 409);
          // Finish the deliberately orphaned recent fixture using the maintenance path.
          await db.query(
            "UPDATE ai_jobs SET lease_started_at=clock_timestamp()-interval '6 minutes' WHERE id=$1",
            [recentJob.job.id],
          );
          await disabled.runOnce();
          assert.equal((await recent.row(recentJob.job.id)).state, 'unknown');
        },
      );

      await t.test(
        'missing backup evidence stops dispatch but never prevents conservative stale recovery',
        async () => {
          const f = await fixture();
          const created = await f.submit();
          await db.query(
            "UPDATE ai_jobs SET state='running',lease_started_at=clock_timestamp()-interval '6 minutes' WHERE id=$1",
            [created.job.id],
          );
          const orphan = randomUUID();
          await journal.start(orphan, digest('external dispatch missing from restored database'));
          const before = calls;
          try {
            await assert.rejects(() => disabled.runOnce(), /AI_RECOVERY_REQUIRED/);
            assert.equal((await f.row(created.job.id)).state, 'unknown');
            assert.equal((await f.row(created.job.id)).hold_state, 'unknown');
            assert.equal(calls, before);
          } finally {
            await rm(join(journal.directory, `${orphan}.json`));
          }
        },
      );
    } finally {
      await app.close();
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
