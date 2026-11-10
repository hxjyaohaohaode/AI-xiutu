import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  createDatabase,
  getEntitlements,
  migrate,
  releaseHold,
  transaction,
  type Database,
} from '@ai-xiutu/db';
import { createOpenAIImageProvider } from '@ai-xiutu/multimodal';
import { LocalPrivateStorage } from '@ai-xiutu/storage';
import type { TextModerator, ImageModerator } from '@ai-xiutu/providers';
import { createAiService, digest, DispatchJournal } from '../src/index.js';
import { withDatabaseFaults, type DatabaseFaults } from '../../db/test/fault-database.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const binaryHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const model = 'gpt-image-2.5-sunburst';
type Control = {
  textBlocked?: boolean;
  blockImageAt?: number;
  beforeOutput?: () => Promise<void>;
  interrupted?: boolean;
  missingImage?: boolean;
};
async function fixture(db: Database, png: Buffer, transparent: Buffer) {
  const actorId = randomUUID(),
    spaceId = randomUUID(),
    projectId = randomUUID(),
    otherProjectId = randomUUID();
  const root = await mkdtemp(join(tmpdir(), 'openai-jobs-'));
  const storage = new LocalPrivateStorage({
    storageDir: join(root, 'private'),
    maxPixels: 4_194_304,
    maxUploadBytes: 7_000_000,
  });
  await storage.initialize();
  const source = await storage.storeGenerated(png);
  const guide = await storage.storeGenerated(transparent);
  const assetId = randomUUID(),
    maskId = randomUUID(),
    foreignAssetId = randomUUID();
  const config = {
    enabled: true,
    provider: 'openai',
    operations: ['generate-image'],
    unitCost: 3,
    imageUnitCosts: { high: 7 },
    maxOutputs: 4,
    allowedQualities: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'],
    minWidth: 64,
    minHeight: 64,
    maxWidth: 3840,
    maxHeight: 3840,
  };
  await transaction(db, async (tx) => {
    await tx.query(
      "INSERT INTO users(id,phone,display_name,phone_verified_at) VALUES($1,$2,'OpenAI isolated fixture',now())",
      [actorId, `test-${actorId}`],
    );
    await tx.query(
      "INSERT INTO spaces(id,kind,name,owner_id) VALUES($1,'personal','OpenAI isolated fixture',$2)",
      [spaceId, actorId],
    );
    await tx.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'owner')", [
      spaceId,
      actorId,
    ]);
    for (const id of [projectId, otherProjectId])
      await tx.query(
        "INSERT INTO projects(id,space_id,title,created_by) VALUES($1,$2,'OpenAI fixture',$3)",
        [id, spaceId, actorId],
      );
    for (const [id, project, file] of [
      [assetId, projectId, source],
      [maskId, projectId, guide],
      [foreignAssetId, otherProjectId, source],
    ] as const)
      await tx.query(
        'INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          id,
          project,
          'input.png',
          file.key,
          file.mime,
          file.width,
          file.height,
          file.bytes,
          file.hash,
          actorId,
        ],
      );
    await tx.query(
      'INSERT INTO model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=excluded.config,version=model_configs.version+1',
      [model, JSON.stringify(config)],
    );
  });
  const controls: Control = {};
  const dbFaults: DatabaseFaults = {};
  const calls = { provider: 0, textReview: 0, imageReview: 0 };
  const requests: Record<string, unknown>[] = [];
  const provider = createOpenAIImageProvider(
    {
      OPENAI_IMAGE_ENABLED: 'true',
      OPENAI_API_KEY: 'only-an-injected-http-test-key',
      OPENAI_IMAGE_MODELS: model,
    },
    (async (_url, init) => {
      calls.provider++;
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      await controls.beforeOutput?.();
      if (controls.interrupted) throw new Error('transport interrupted');
      const count = controls.missingImage ? 1 : Number(body.n);
      return new Response(
        JSON.stringify({
          data: Array.from({ length: count }, () => ({ b64_json: png.toString('base64') })),
          usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
        }),
        { headers: { 'content-type': 'application/json', 'x-request-id': 'req-lifecycle-openai' } },
      );
    }) as typeof fetch,
  );
  const moderator: TextModerator = {
    configured: true,
    async check(text) {
      calls.textReview++;
      return {
        decision: controls.textBlocked ? 'blocked' : 'passed',
        inputHash: digest(text),
        requestId: 'text-review-test',
      };
    },
  };
  const imageModerator: ImageModerator = {
    configured: true,
    async check(bytes) {
      calls.imageReview++;
      return {
        decision: controls.blockImageAt === calls.imageReview ? 'review' : 'passed',
        inputHash: binaryHash(bytes),
        requestId: 'image-review-test',
      };
    },
  };
  const service = createAiService(
    withDatabaseFaults(db, dbFaults),
    { AI_IMAGE_ENABLED: 'true', AI_DAILY_JOB_LIMIT: '1000' },
    {
      openAIImageProvider: provider,
      moderator,
      imageModerator,
      storage,
      journal: new DispatchJournal(join(root, 'journal')),
    },
  );
  const body = () => ({
    operation: 'generate-image',
    modelId: model,
    prompt: '生成一幅蓝色陶瓷花瓶插画',
    idempotencyKey: randomUUID(),
    width: 1024,
    height: 1024,
  });
  const submit = (value: unknown) => service.submit({ actorId, projectId, spaceId, body: value });
  const row = async (id: string) =>
    (
      await db.query(
        'SELECT j.*,h.units AS held_units,h.state AS hold_state FROM ai_jobs j JOIN quota_holds h ON h.id=j.hold_id WHERE j.id=$1',
        [id],
      )
    ).rows[0]!;
  const generated = async () =>
    Number(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM assets WHERE project_id=$1 AND provenance->>'kind'='ai-generated'",
          [projectId],
        )
      ).rows[0]!.count,
    );
  return {
    actorId,
    projectId,
    spaceId,
    otherProjectId,
    assetId,
    maskId,
    foreignAssetId,
    root,
    config,
    body,
    submit,
    row,
    generated,
    service,
    controls,
    dbFaults,
    storage,
    calls,
    requests,
    entitlements: () => transaction(db, (tx) => getEntitlements(tx, spaceId)),
    async cleanup() {
      await transaction(db, async (tx) => {
        const jobs = await tx.query(
          "SELECT id,hold_id FROM ai_jobs WHERE project_id=$1 AND state IN ('queued','running') FOR UPDATE",
          [projectId],
        );
        for (const job of jobs.rows) {
          await releaseHold(tx, job.hold_id);
          await tx.query("UPDATE ai_jobs SET state='cancelled' WHERE id=$1", [job.id]);
        }
      });
      await rm(root, { recursive: true, force: true });
    },
  };
}

test(
  'OpenAI persistent batch lifecycle, accounting, references and real request lineage',
  { skip: !databaseUrl },
  async (t) => {
    const db = createDatabase(databaseUrl!);
    await migrate(db);
    const png = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: '#90a0c0' },
    })
      .png()
      .toBuffer();
    const transparent = await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();
    try {
      await t.test(
        'lost acknowledgement after a real batch COMMIT keeps every published image and settles once',
        async () => {
          const f = await fixture(db, png, transparent);
          try {
            const { job } = await f.submit({ ...f.body(), imageOptions: { n: 2 } });
            f.dbFaults.afterCommitMatching = "UPDATE ai_jobs SET state='completed'";
            await f.service.runOnce();
            assert.equal(f.dbFaults.commitFailures, 1);
            const row = await f.row(job.id);
            assert.equal(row.state, 'completed');
            assert.equal(row.hold_state, 'settled');
            assert.equal(row.output.images.length, 2);
            for (const image of row.output.images) {
              const asset = (
                await db.query('SELECT storage_key FROM assets WHERE id=$1', [image.assetId])
              ).rows[0]!;
              assert.ok((await f.storage.readBytes(asset.storage_key, 7_000_000)).length > 0);
            }
            assert.equal((await f.entitlements()).usage.spent, 6);
            assert.equal(f.calls.provider, 1);
            assert.equal(await f.service.runOnce(), false);
          } finally {
            await f.cleanup();
          }
        },
      );
      await t.test(
        'unknown output plus unavailable cleanup check retains private bytes without publishing them',
        async () => {
          const f = await fixture(db, png, transparent);
          try {
            const before = new Set(await readdir(join(f.root, 'private')));
            f.controls.blockImageAt = 1;
            f.dbFaults.failPublicationCheck = true;
            const { job } = await f.submit(f.body());
            await f.service.runOnce();
            assert.equal((await f.row(job.id)).state, 'unknown');
            assert.equal(await f.generated(), 0);
            const retained = (await readdir(join(f.root, 'private'))).filter(
              (name) => !before.has(name),
            );
            assert.equal(retained.length, 1);
            assert.ok((await f.storage.readBytes(retained[0]!, 7_000_000)).length > 0);
          } finally {
            f.dbFaults.failPublicationCheck = false;
            await f.cleanup();
          }
        },
      );
      await t.test(
        'n outputs reserve n times the selected quality price once; queued price does not change',
        async () => {
          const f = await fixture(db, png, transparent);
          try {
            const body = { ...f.body(), imageOptions: { quality: 'high', n: 2 } };
            const [first, second] = await Promise.all([f.submit(body), f.submit(body)]);
            assert.equal(first.job.id, second.job.id);
            assert.equal(first.job.reservedUnits, 14);
            assert.equal((await f.entitlements()).held, 14);
            await db.query('UPDATE model_configs SET config=$2,version=version+1 WHERE id=$1', [
              model,
              JSON.stringify({ ...f.config, unitCost: 99, imageUnitCosts: { high: 90 } }),
            ]);
            assert.equal(await f.service.runOnce(), true);
            const row = await f.row(first.job.id);
            assert.equal(row.state, 'completed');
            assert.equal(row.hold_state, 'settled');
            assert.equal(row.held_units, 14);
            assert.equal(row.output.images.length, 2);
            assert.notEqual(row.output.images[0].assetId, row.output.images[1].assetId);
            assert.equal(row.output.assetId, row.output.images[0].assetId);
            assert.equal(await f.generated(), 2);
            assert.equal(f.calls.provider, 1);
            assert.equal(f.calls.imageReview, 2);
            const amount = await f.entitlements();
            assert.equal(amount.held, 0);
            assert.equal(amount.usage.spent, 14);
            assert.equal(await f.service.runOnce(), false);
          } finally {
            await f.cleanup();
          }
        },
      );

      await t.test(
        'input denial releases the whole reservation and calls no image supplier',
        async () => {
          const f = await fixture(db, png, transparent);
          try {
            f.controls.textBlocked = true;
            const { job } = await f.submit({ ...f.body(), imageOptions: { n: 3 } });
            await f.service.runOnce();
            const row = await f.row(job.id);
            assert.equal(row.state, 'failed');
            assert.equal(row.hold_state, 'released');
            assert.equal(f.calls.provider, 0);
            assert.equal(await f.generated(), 0);
            assert.equal((await f.entitlements()).usage.spent, 0);
          } finally {
            await f.cleanup();
          }
        },
      );

      await t.test(
        'one rejected output leaves the entire batch unpublished, unknown and not retried',
        async () => {
          const f = await fixture(db, png, transparent);
          try {
            const before = await readdir(join(f.root, 'private'));
            f.controls.blockImageAt = 2;
            const { job } = await f.submit({ ...f.body(), imageOptions: { n: 2 } });
            await f.service.runOnce();
            const row = await f.row(job.id);
            assert.equal(row.state, 'unknown');
            assert.equal(row.hold_state, 'unknown');
            assert.equal(row.provider_request_id, 'req-lifecycle-openai');
            assert.equal(row.output, null);
            assert.equal(await f.generated(), 0);
            assert.deepEqual(await readdir(join(f.root, 'private')), before);
            assert.equal((await f.entitlements()).held, 6);
            assert.equal(await f.service.runOnce(), false);
            assert.equal(f.calls.provider, 1);
          } finally {
            await f.cleanup();
          }
        },
      );

      await t.test(
        'references and mask use exact hashed bytes; parent output is explicitly selected and persisted',
        async () => {
          const f = await fixture(db, png, transparent);
          try {
            const first = await f.submit({
              ...f.body(),
              referenceAssetIds: [f.assetId],
              maskAssetId: f.maskId,
            });
            await f.service.runOnce();
            const parent = await f.row(first.job.id);
            assert.equal(parent.state, 'completed');
            assert.equal(f.calls.imageReview, 3);
            assert.ok(f.requests[0]!.mask);
            assert.ok(parent.input.manifest.providerPayloadHash);
            const selected = parent.output.images[0].assetId;
            const second = await f.submit({
              ...f.body(),
              parentJobId: parent.id,
              referenceAssetIds: [selected],
              prompt: '保持主体，改为温暖背景',
            });
            await f.service.runOnce();
            const child = await f.row(second.job.id);
            assert.equal(child.state, 'completed');
            const list = await f.service.list({ actorId: f.actorId, projectId: f.projectId });
            const item = list.jobs.find((job) => job.id === child.id)!;
            assert.equal(item.parentJobId, parent.id);
            assert.equal(item.threadId, parent.id);
            assert.deepEqual(item.request.referenceAssetIds, [selected]);
            assert.equal(item.request.prompt, '保持主体，改为温暖背景');
            assert.equal('audioBase64' in item.request, false);
            await assert.rejects(
              f.submit({ ...f.body(), parentJobId: parent.id, referenceAssetIds: [f.assetId] }),
              /明确选用/,
            );
            await assert.rejects(
              f.submit({ ...f.body(), referenceAssetIds: [f.foreignAssetId] }),
              /参考图/,
            );
          } finally {
            await f.cleanup();
          }
        },
      );

      await t.test(
        'a reference revoked during supplier execution prevents all publication',
        async () => {
          const f = await fixture(db, png, transparent);
          try {
            f.controls.beforeOutput = async () => {
              await db.query('UPDATE assets SET deleted_at=clock_timestamp() WHERE id=$1', [
                f.assetId,
              ]);
            };
            const { job } = await f.submit({
              ...f.body(),
              referenceAssetIds: [f.assetId],
              imageOptions: { n: 2 },
            });
            await f.service.runOnce();
            const row = await f.row(job.id);
            assert.equal(row.state, 'unknown');
            assert.equal(row.error_code, 'REFERENCE_REVOKED');
            assert.equal(row.provider_request_id, 'req-lifecycle-openai');
            assert.equal(await f.generated(), 0);
          } finally {
            await f.cleanup();
          }
        },
      );
      await t.test(
        'generation grant revocation after dispatch preserves a real receipt and blocks the batch',
        async () => {
          const f = await fixture(db, png, transparent);
          try {
            const grantId = (
              await db.query(
                `INSERT INTO assistant_grants(actor_id,project_id,mode,unit_limit,step_limit,allowed_actions,model_ids,expires_at)
            VALUES($1,$2,'confirm',10,2,'["generate-image"]',$3,clock_timestamp()+interval '1 hour') RETURNING id`,
                [f.actorId, f.projectId, JSON.stringify([model])],
              )
            ).rows[0]!.id;
            f.controls.beforeOutput = async () => {
              await db.query(
                'UPDATE assistant_grants SET revoked_at=clock_timestamp() WHERE id=$1',
                [grantId],
              );
            };
            const { job } = await f.submit({
              ...f.body(),
              executionGrantId: grantId,
              imageOptions: { n: 2 },
            });
            await f.service.runOnce();
            const row = await f.row(job.id);
            assert.equal(f.calls.provider, 1);
            assert.equal(row.state, 'unknown');
            assert.equal(row.error_code, 'ASSISTANT_GRANT_EXPIRED');
            assert.equal(row.hold_state, 'unknown');
            assert.equal(row.held_units, 6);
            assert.equal(row.provider_request_id, 'req-lifecycle-openai');
            assert.equal(await f.generated(), 0);
            assert.equal(await f.service.runOnce(), false);
          } finally {
            await f.cleanup();
          }
        },
      );

      await t.test(
        'batch cardinality and transport uncertainty keep the complete hold; malformed options create none',
        async () => {
          for (const control of ['missingImage', 'interrupted'] as const) {
            const f = await fixture(db, png, transparent);
            try {
              f.controls[control] = true;
              const { job } = await f.submit({ ...f.body(), imageOptions: { n: 2 } });
              await f.service.runOnce();
              const row = await f.row(job.id);
              assert.equal(row.state, 'unknown');
              assert.equal(row.hold_state, 'unknown');
              assert.equal(row.held_units, 6);
              assert.equal(await f.generated(), 0);
              assert.equal(await f.service.runOnce(), false);
            } finally {
              await f.cleanup();
            }
          }
          const f = await fixture(db, png, transparent);
          try {
            await assert.rejects(f.submit({ ...f.body(), imageOptions: { n: 5 } }));
            await assert.rejects(f.submit({ ...f.body(), imageOptions: { partialImages: 1 } }));
            await assert.rejects(
              f.submit({
                ...f.body(),
                imageOptions: { outputFormat: 'jpeg', background: 'transparent' },
              }),
            );
            const count = (
              await db.query('SELECT count(*)::int AS count FROM ai_jobs WHERE project_id=$1', [
                f.projectId,
              ])
            ).rows[0]!.count;
            assert.equal(count, 0);
            assert.equal(f.calls.provider, 0);
          } finally {
            await f.cleanup();
          }
        },
      );

      await t.test(
        'editing queued parameters cannot replace the frozen payload or mint a cheaper multi-image job',
        async () => {
          const f = await fixture(db, png, transparent);
          try {
            const { job } = await f.submit({ ...f.body(), imageOptions: { n: 2 } });
            await db.query(
              "UPDATE ai_jobs SET input=jsonb_set(input,'{input,imageOptions,n}','3'::jsonb) WHERE id=$1",
              [job.id],
            );
            await f.service.runOnce();
            const row = await f.row(job.id);
            assert.equal(row.state, 'failed');
            assert.equal(row.error_code, 'INPUT_INTEGRITY_FAILED');
            assert.equal(row.hold_state, 'released');
            assert.equal(f.calls.provider, 0);
          } finally {
            await f.cleanup();
          }
        },
      );
    } finally {
      await db.end();
    }
  },
);
