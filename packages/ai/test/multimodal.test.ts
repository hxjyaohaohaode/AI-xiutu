import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
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
import { createRecipe } from '@ai-xiutu/editor';
import { ProviderError, type ImageModerator, type TextModerator } from '@ai-xiutu/providers';
import { LocalPrivateStorage } from '@ai-xiutu/storage';
import {
  getArkImageModels,
  validateArkImageInput,
  validateWav,
  type ImageGenerationInput,
  type ImageProvider,
  type SpeechProvider,
} from '@ai-xiutu/multimodal';
import {
  canonical,
  createAiService,
  digest,
  DispatchJournal,
  type PlanProvider,
} from '../src/index.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const binaryHash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
type Decision = 'passed' | 'blocked' | 'review';
interface Controls {
  textDecision: Decision;
  imageDecision: Decision;
  textHashMismatch?: boolean;
  imageHashMismatch?: boolean;
  textReviewError?: Error;
  imageReviewError?: Error;
  imageError?: Error;
  textError?: Error;
  speechError?: Error;
  speechText?: string;
  imageOutput?: Uint8Array;
  beforeTextReview?: (text: string, call: number) => Promise<void>;
  beforeImageReview?: (bytes: Uint8Array, call: number) => Promise<void>;
  afterJournal?: () => Promise<void>;
}

function makeWav(samples = 1600): Buffer {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1)
    bytes.writeInt16LE(Math.round(Math.sin(i / 8) * 1024), 44 + i * 2);
  return bytes;
}

async function fixture(db: Database, parentDirectory: string, png: Buffer, referencePng: Buffer) {
  const actorId = randomUUID();
  const outsiderId = randomUUID();
  const spaceId = randomUUID();
  const projectId = randomUUID();
  const otherProjectId = randomUUID();
  const assetId = randomUUID();
  const foreignAssetId = randomUUID();
  const artworkId = randomUUID();
  const documentId = randomUUID();
  const revisionId = randomUUID();
  const modelIds = {
    image: `mm-image-${randomUUID()}`,
    otherImage: `mm-image-${randomUUID()}`,
    text: `mm-text-${randomUUID()}`,
    plan: `mm-plan-${randomUUID()}`,
    speech: 'qwen3-asr-flash',
  };
  const directory = await mkdtemp(join(parentDirectory, 'case-'));
  const storageDirectory = join(directory, 'private');
  const journalDirectory = join(directory, 'journal');
  const storage = new LocalPrivateStorage({
    storageDir: storageDirectory,
    maxPixels: 4_194_304,
    maxUploadBytes: 7_000_000,
  });
  await storage.initialize();
  const source = await storage.storeGenerated(referencePng);
  const controls: Controls = { textDecision: 'passed', imageDecision: 'passed' };
  const calls = { image: 0, text: 0, plan: 0, speech: 0, textReview: 0, imageReview: 0 };
  const sent = {
    images: [] as ImageGenerationInput[],
    texts: [] as Record<string, unknown>[],
    audio: [] as Uint8Array[],
  };
  const imageModels = getArkImageModels({
    ARK_IMAGE_MODELS_JSON: JSON.stringify([
      { id: modelIds.image, profile: 'seedream-5-flash' },
      { id: modelIds.otherImage, profile: 'seedream-5-flash' },
    ]),
  });
  const images: ImageProvider = {
    configured: true,
    models: imageModels,
    validate(input) {
      validateArkImageInput(input, imageModels);
    },
    async generate(input) {
      calls.image += 1;
      sent.images.push(structuredClone(input));
      if (controls.imageError) throw controls.imageError;
      return {
        bytes: controls.imageOutput ?? png,
        mime: 'image/png',
        requestId: 'injected-image-receipt',
      };
    },
  };
  const llm: PlanProvider = {
    configured: true,
    async complete(prepared) {
      const body = JSON.parse(prepared.body) as Record<string, unknown>;
      sent.texts.push(body);
      if (body.model === modelIds.plan) {
        calls.plan += 1;
        if (controls.textError) throw controls.textError;
        return {
          value: { summary: '降低对比度', adjustments: { contrast: -25 } },
          requestId: 'injected-plan-receipt',
        };
      }
      calls.text += 1;
      if (controls.textError) throw controls.textError;
      return {
        value: {
          title: '生成的标题',
          body: '这是供用户确认后插入的正文。',
          summary: '根据已冻结的上下文生成',
        },
        requestId: 'injected-text-receipt',
      };
    },
  };
  const speech: SpeechProvider = {
    configured: true,
    models: [modelIds.speech],
    async transcribe({ model, wav }) {
      assert.equal(model, modelIds.speech);
      validateWav(wav);
      calls.speech += 1;
      sent.audio.push(wav.slice());
      if (controls.speechError) throw controls.speechError;
      return {
        text: controls.speechText ?? '请稍微提高亮度。',
        requestId: 'injected-speech-receipt',
      };
    },
  };
  const moderator: TextModerator = {
    configured: true,
    async check(text) {
      calls.textReview += 1;
      await controls.beforeTextReview?.(text, calls.textReview);
      if (controls.textReviewError) throw controls.textReviewError;
      return {
        decision: controls.textDecision,
        inputHash: controls.textHashMismatch ? digest('a different string') : digest(text),
        requestId: 'injected-text-review',
      };
    },
  };
  const imageModerator: ImageModerator = {
    configured: true,
    async check(bytes) {
      calls.imageReview += 1;
      await controls.beforeImageReview?.(bytes, calls.imageReview);
      if (controls.imageReviewError) throw controls.imageReviewError;
      return {
        decision: controls.imageDecision,
        inputHash: controls.imageHashMismatch ? digest('different bytes') : binaryHash(bytes),
        requestId: 'injected-image-review',
      };
    },
  };
  class TestJournal extends DispatchJournal {
    override async start(jobId: string, inputHash: string): Promise<boolean> {
      const first = await super.start(jobId, inputHash);
      if (first) await controls.afterJournal?.();
      return first;
    }
  }
  const journal = new TestJournal(journalDirectory);
  const service = createAiService(
    db,
    {
      AI_PLAN_ENABLED: 'true',
      AI_IMAGE_ENABLED: 'true',
      AI_TEXT_ENABLED: 'true',
      AI_SPEECH_ENABLED: 'true',
      AI_DAILY_JOB_LIMIT: '1000',
    },
    {
      provider: llm,
      imageProvider: images,
      speechProvider: speech,
      moderator,
      imageModerator,
      journal,
      storage,
    },
  );
  await transaction(db, async (tx) => {
    for (const id of [actorId, outsiderId])
      await tx.query(
        "INSERT INTO users(id,phone,display_name,phone_verified_at) VALUES($1,$2,'Multimodal isolated fixture',now())",
        [id, `test-${id}`],
      );
    await tx.query(
      "INSERT INTO spaces(id,name,kind,owner_id) VALUES($1,'Multimodal isolated test','personal',$2)",
      [spaceId, actorId],
    );
    await tx.query("INSERT INTO memberships(space_id,user_id,role) VALUES($1,$2,'owner')", [
      spaceId,
      actorId,
    ]);
    for (const id of [projectId, otherProjectId])
      await tx.query(
        "INSERT INTO projects(id,space_id,title,created_by) VALUES($1,$2,'Multimodal fixture',$3)",
        [id, spaceId, actorId],
      );
    for (const [id, project] of [
      [assetId, projectId],
      [foreignAssetId, otherProjectId],
    ])
      await tx.query(
        `INSERT INTO assets(id,project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by)
      VALUES($1,$2,'reference.png',$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          project,
          source.key,
          source.mime,
          source.width,
          source.height,
          source.bytes,
          source.hash,
          actorId,
        ],
      );
    await tx.query(
      "INSERT INTO artworks(id,project_id,asset_id,title) VALUES($1,$2,$3,'Original artwork')",
      [artworkId, projectId, assetId],
    );
    await tx.query(
      'INSERT INTO revisions(id,artwork_id,version,recipe,author_id) VALUES($1,$2,1,$3,$4)',
      [revisionId, artworkId, JSON.stringify(createRecipe()), actorId],
    );
    await tx.query('UPDATE artworks SET head_revision_id=$2 WHERE id=$1', [artworkId, revisionId]);
    await tx.query(
      "INSERT INTO documents(id,project_id,title,body,author_id) VALUES($1,$2,'Source document','冻结的旧上下文',$3)",
      [documentId, projectId, actorId],
    );
    const settings = [
      [modelIds.image, 'ark', ['generate-image'], 3],
      [modelIds.otherImage, 'ark', ['generate-image'], 7],
      [modelIds.text, 'qwen', ['generate-text'], 2],
      [modelIds.plan, 'qwen', ['edit-plan'], 2],
      [modelIds.speech, 'qwen', ['transcribe'], 1],
    ] as const;
    for (const [id, provider, operations, unitCost] of settings)
      await tx.query(
        'INSERT INTO model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=excluded.config,version=model_configs.version+1',
        [
          id,
          JSON.stringify({
            enabled: true,
            provider,
            operations,
            unitCost,
            minWidth: 64,
            maxWidth: 4096,
            minHeight: 64,
            maxHeight: 4096,
          }),
        ],
      );
  });
  const imageBody = () => ({
    operation: 'generate-image' as const,
    modelId: modelIds.image,
    idempotencyKey: randomUUID(),
    prompt: '根据草图生成一幅蓝色海边小屋插画',
    width: 1024,
    height: 1024,
  });
  const textBody = () => ({
    operation: 'generate-text' as const,
    modelId: modelIds.text,
    idempotencyKey: randomUUID(),
    prompt: '为这个项目写一段简介',
  });
  const audioBody = () => ({
    operation: 'transcribe' as const,
    modelId: modelIds.speech,
    idempotencyKey: randomUUID(),
    audioBase64: makeWav().toString('base64'),
  });
  const planBody = () => ({
    operation: 'edit-plan' as const,
    modelId: modelIds.plan,
    idempotencyKey: randomUUID(),
    prompt: '降低对比度',
    artworkId,
    expectedVersion: 1,
    recipe: createRecipe({ adjustments: { exposure: 0.5 } }),
  });
  const submit = (body: unknown) => service.submit({ actorId, projectId, spaceId, body });
  const row = async (id: string) =>
    (
      await db.query(
        'SELECT j.*,h.state AS hold_state,h.units AS hold_units FROM ai_jobs j LEFT JOIN quota_holds h ON h.id=j.hold_id WHERE j.id=$1',
        [id],
      )
    ).rows[0]!;
  const entitlements = () => transaction(db, (tx) => getEntitlements(tx, spaceId));
  const generatedCount = async () =>
    Number(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM assets WHERE project_id=$1 AND provenance->>'kind'='ai-generated'",
          [projectId],
        )
      ).rows[0]!.n,
    );
  const clean = async () => {
    // Isolated fixture cleanup never touches other test projects or immutable ledgers.
    await transaction(db, async (tx) => {
      const pending = await tx.query(
        "SELECT id,hold_id FROM ai_jobs WHERE project_id=$1 AND state IN ('queued','running') FOR UPDATE",
        [projectId],
      );
      for (const job of pending.rows) {
        await releaseHold(tx, job.hold_id);
        await tx.query(
          "UPDATE ai_jobs SET state='cancelled',input=input-'audioBase64' WHERE id=$1",
          [job.id],
        );
      }
    });
    await rm(directory, { recursive: true, force: true });
  };
  return {
    actorId,
    outsiderId,
    spaceId,
    projectId,
    otherProjectId,
    assetId,
    foreignAssetId,
    artworkId,
    documentId,
    revisionId,
    modelIds,
    directory,
    storageDirectory,
    journalDirectory,
    storage,
    source,
    controls,
    calls,
    sent,
    service,
    journal,
    imageBody,
    textBody,
    audioBody,
    planBody,
    submit,
    row,
    entitlements,
    generatedCount,
    clean,
  };
}

test('multimodal SQL integration requires the explicit CI database when requested', () => {
  if (process.env.REQUIRE_DB_TESTS === '1')
    assert.ok(
      databaseUrl,
      'TEST_DATABASE_URL is required; do not count skipped SQL tests as a pass',
    );
});

test(
  'multimodal jobs use real SQL, private normalized images and injected supplier boundaries',
  { skip: !databaseUrl },
  async (t) => {
    const db = createDatabase(databaseUrl!);
    await migrate(db);
    const directory = await mkdtemp(join(tmpdir(), 'ai-xiutu-multimodal-'));
    const png = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: '#607fa1' },
    })
      .png()
      .toBuffer();
    const reference = await sharp({
      create: { width: 64, height: 64, channels: 3, background: '#d5dce5' },
    })
      .png()
      .toBuffer();
    type Fixture = Awaited<ReturnType<typeof fixture>>;
    const run = async (name: string, work: (f: Fixture) => Promise<void>) =>
      t.test(name, async () => {
        const f = await fixture(db, directory, png, reference);
        try {
          await work(f);
        } finally {
          await f.clean();
        }
      });
    try {
      await run(
        'image submit is idempotent, reserves once and exposes no generated asset until normalized-byte review passes',
        async (f) => {
          const body = { ...f.imageBody(), referenceAssetId: f.assetId };
          const [first, duplicate] = await Promise.all([f.submit(body), f.submit(body)]);
          assert.equal(first.job.id, duplicate.job.id);
          assert.equal(f.calls.image, 0);
          await assert.rejects(f.submit({ ...body, prompt: '另外一条请求' }), {
            code: 'IDEMPOTENCY_CONFLICT',
          });
          await assert.rejects(f.submit({ ...f.textBody(), idempotencyKey: body.idempotencyKey }), {
            code: 'IDEMPOTENCY_CONFLICT',
          });
          assert.equal(
            Number(
              (
                await db.query('SELECT count(*)::int AS n FROM quota_holds WHERE space_id=$1', [
                  f.spaceId,
                ])
              ).rows[0]!.n,
            ),
            1,
          );
          const pending = await f.row(first.job.id);
          assert.equal(pending.state, 'queued');
          assert.equal(pending.hold_state, 'held');
          assert.equal((await f.entitlements()).held, 3);
          assert.equal(pending.input_hash, digest(canonical(pending.input.manifest)));
          assert.equal(pending.input.manifest.referenceHash, f.source.hash);
          f.controls.beforeImageReview = async (bytes, call) => {
            if (call === 1) {
              assert.equal(binaryHash(bytes), f.source.hash);
              return;
            }
            assert.equal(call, 2);
            assert.equal((await f.row(first.job.id)).state, 'running');
            assert.equal((await f.row(first.job.id)).output, null);
            assert.equal(await f.generatedCount(), 0);
            const privateFiles = (await readdir(f.storageDirectory)).filter(
              (name) => name.endsWith('.png') && name !== f.source.key,
            );
            assert.equal(
              privateFiles.length,
              1,
              'normalized output remains an unreferenced private file during review',
            );
            assert.equal(
              (await stat(join(f.storageDirectory, privateFiles[0]!))).mode & 0o777,
              0o600,
            );
          };
          assert.equal(await f.service.runOnce(), true);
          assert.equal(f.calls.image, 1);
          assert.equal(f.calls.imageReview, 2);
          const done = await f.row(first.job.id);
          assert.equal(done.state, 'completed');
          assert.equal(done.hold_state, 'settled');
          assert.equal(done.output.kind, 'image');
          assert.equal(done.provider_request_id, 'injected-image-receipt');
          assert.equal(done.output.width, 1024);
          assert.equal(done.output.height, 1024);
          assert.equal(await f.generatedCount(), 1);
          assert.equal(done.output.url, `/v1/assets/${done.output.assetId}/file`);
          const asset = (await db.query('SELECT * FROM assets WHERE id=$1', [done.output.assetId]))
            .rows[0]!;
          assert.equal(asset.provenance.inputHash, done.input_hash);
          assert.equal(asset.provenance.jobId, done.id);
          assert.equal(
            binaryHash(await f.storage.readBytes(asset.storage_key, 7_000_000)),
            asset.content_hash,
          );
          const art = (
            await db.query('SELECT * FROM artworks WHERE id=$1', [done.output.artworkId])
          ).rows[0]!;
          const revision = (
            await db.query('SELECT * FROM revisions WHERE id=$1', [art.head_revision_id])
          ).rows[0]!;
          assert.equal(revision.version, 1);
          assert.deepEqual(revision.recipe, createRecipe());
          assert.equal((await f.entitlements()).held, 0);
          assert.equal((await f.entitlements()).usage.spent, 3);
          assert.equal((await f.submit(body)).job.id, done.id);
          assert.equal(await f.service.runOnce(), false);
          assert.equal(f.calls.image, 1);
        },
      );

      await run(
        'text generation freezes document context and returns a candidate without overwriting the live document',
        async (f) => {
          const body = {
            ...f.textBody(),
            contextDocumentId: f.documentId,
            expectedDocumentVersion: 1,
          };
          const job = await f.submit(body);
          await db.query("UPDATE documents SET body='入队后修改的新正文',version=2 WHERE id=$1", [
            f.documentId,
          ]);
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(done.state, 'completed');
          assert.equal(done.hold_state, 'settled');
          assert.equal(f.calls.text, 1);
          assert.equal(done.output.kind, 'text');
          assert.match(done.output.body, /确认后插入/);
          assert.match(canonical(f.sent.texts[0]), /冻结的旧上下文/);
          assert.doesNotMatch(canonical(f.sent.texts[0]), /入队后修改的新正文/);
          const live = (
            await db.query('SELECT body,version FROM documents WHERE id=$1', [f.documentId])
          ).rows[0]!;
          assert.equal(live.version, 2);
          assert.equal(live.body, '入队后修改的新正文');
          assert.equal((await f.entitlements()).usage.spent, 2);
          assert.equal((await f.submit(body)).job.id, done.id);
        },
      );

      await run(
        'speech success retains only the audio hash, omits raw audio from DTOs and does not execute edits',
        async (f) => {
          const body = f.audioBody();
          const job = await f.submit(body);
          const queued = await f.row(job.job.id);
          assert.equal(queued.input.audioBase64, body.audioBase64);
          assert.equal(queued.input.input.audioBase64, undefined);
          assert.equal(queued.input.manifest.audioHash, binaryHash(makeWav()));
          assert.equal(
            JSON.stringify(
              await f.service.list({ actorId: f.actorId, projectId: f.projectId }),
            ).includes(body.audioBase64),
            false,
          );
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(done.state, 'completed');
          assert.equal(done.hold_state, 'settled');
          assert.equal(done.input.audioBase64, undefined);
          assert.equal(done.input.input.audioBase64, undefined);
          assert.equal(done.input.manifest.audioHash, queued.input.manifest.audioHash);
          assert.equal(done.output.kind, 'transcript');
          assert.equal(done.output.text, '请稍微提高亮度。');
          assert.equal(f.calls.speech, 1);
          assert.equal(f.calls.image + f.calls.text + f.calls.plan, 0);
          assert.equal(
            (await db.query('SELECT head_revision_id FROM artworks WHERE id=$1', [f.artworkId]))
              .rows[0]!.head_revision_id,
            f.revisionId,
          );
          const journal = await readFile(join(f.journalDirectory, `${done.id}.json`), 'utf8');
          assert.equal(journal.includes(body.audioBase64), false);
          assert.equal((await f.submit(body)).job.id, done.id);
          assert.equal(await f.service.runOnce(), false);
          assert.equal((await f.entitlements()).usage.spent, 1);
        },
      );

      await run(
        'edit-plan still returns a complete frozen-recipe candidate without changing the artwork',
        async (f) => {
          const job = await f.submit(f.planBody());
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(done.state, 'completed');
          assert.equal(f.calls.plan, 1);
          assert.equal(done.output.recipe.adjustments.exposure, 0.5);
          assert.equal(done.output.recipe.adjustments.contrast, -25);
          assert.equal(done.output.recipe.geometry.rotation, 0);
          assert.equal(done.hold_state, 'settled');
          assert.equal(
            (await db.query('SELECT head_revision_id FROM artworks WHERE id=$1', [f.artworkId]))
              .rows[0]!.head_revision_id,
            f.revisionId,
          );
        },
      );

      await run(
        'successful empty ASR becomes an explicit no-speech result and settles once without fabricated text',
        async (f) => {
          f.controls.speechText = '';
          const job = await f.submit(f.audioBody());
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(done.state, 'completed');
          assert.equal(done.hold_state, 'settled');
          assert.equal(done.output.kind, 'transcript');
          assert.equal(done.output.text, '');
          assert.equal(done.output.noSpeech, true);
          assert.equal(done.input.audioBase64, undefined);
          assert.equal(f.calls.textReview, 0, 'there is no text to moderate or execute');
          assert.equal(f.calls.speech, 1);
          assert.equal((await f.entitlements()).held, 0);
          assert.equal((await f.entitlements()).usage.spent, 1);
          await f.service.runOnce();
          assert.equal(f.calls.speech, 1);
        },
      );

      await run(
        'input review rejection and review-hash mismatch do not call a billable image model',
        async (f) => {
          for (const mismatch of [false, true]) {
            f.controls.textDecision = mismatch ? 'passed' : 'blocked';
            f.controls.textHashMismatch = mismatch;
            const job = await f.submit(f.imageBody());
            await f.service.runOnce();
            const done = await f.row(job.job.id);
            assert.equal(done.state, 'failed');
            assert.equal(done.hold_state, 'released');
            assert.equal(done.output, null);
          }
          assert.equal(f.calls.image, 0);
          assert.equal(await f.generatedCount(), 0);
          assert.equal((await f.entitlements()).held, 0);
          assert.equal((await f.entitlements()).usage.spent, 0);
        },
      );

      await run(
        'reference-image block prevents generation and preserves the existing source',
        async (f) => {
          f.controls.imageDecision = 'blocked';
          const job = await f.submit({ ...f.imageBody(), referenceAssetId: f.assetId });
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(done.state, 'failed');
          assert.equal(done.hold_state, 'released');
          assert.equal(f.calls.image, 0);
          assert.equal(await f.generatedCount(), 0);
          assert.deepEqual((await readdir(f.storageDirectory)).sort(), [f.source.key]);
        },
      );

      await run(
        'blocked generated image is never attached or exposed, private bytes are removed and billing remains unknown',
        async (f) => {
          f.controls.imageDecision = 'blocked';
          const job = await f.submit(f.imageBody());
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(f.calls.image, 1);
          assert.equal(done.state, 'unknown');
          assert.equal(done.hold_state, 'unknown');
          assert.equal(done.output, null);
          assert.equal(
            done.provider_request_id,
            'injected-image-receipt',
            'retain the known vendor receipt for billing reconciliation even when image review blocks',
          );
          assert.equal(await f.generatedCount(), 0);
          assert.equal(
            Number(
              (
                await db.query('SELECT count(*)::int AS n FROM artworks WHERE project_id=$1', [
                  f.projectId,
                ])
              ).rows[0]!.n,
            ),
            1,
          );
          assert.deepEqual((await readdir(f.storageDirectory)).sort(), [f.source.key]);
          assert.equal((await f.entitlements()).held, 3);
          await f.service.runOnce();
          assert.equal(f.calls.image, 1);
        },
      );

      await run(
        'independent image adapter returning a wrong decoded size cannot bypass worker validation',
        async (f) => {
          f.controls.imageOutput = reference;
          const job = await f.submit(f.imageBody());
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(f.calls.image, 1);
          assert.equal(done.state, 'unknown');
          assert.equal(done.hold_state, 'unknown');
          assert.equal(done.output, null);
          assert.equal(await f.generatedCount(), 0);
          assert.deepEqual((await readdir(f.storageDirectory)).sort(), [f.source.key]);
        },
      );

      await run(
        'post-generation text moderation block preserves the source and never publishes the candidate',
        async (f) => {
          f.controls.beforeTextReview = async (_text, call) => {
            if (call === 2) f.controls.textDecision = 'blocked';
          };
          const job = await f.submit(f.textBody());
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(f.calls.text, 1);
          assert.equal(done.state, 'unknown');
          assert.equal(done.hold_state, 'unknown');
          assert.equal(done.output, null);
          assert.equal(done.provider_request_id, 'injected-text-receipt');
          assert.equal(
            (await db.query('SELECT body FROM documents WHERE id=$1', [f.documentId])).rows[0]!
              .body,
            '冻结的旧上下文',
          );
        },
      );

      await run(
        'unknown image outcome is not retried and only an operator can settle it idempotently',
        async (f) => {
          f.controls.imageError = new ProviderError('TEST_IMAGE_TRANSPORT_LOST', 'unknown');
          const body = f.imageBody();
          const job = await f.submit(body);
          await f.service.runOnce();
          assert.equal((await f.row(job.job.id)).state, 'unknown');
          assert.equal((await f.row(job.job.id)).hold_state, 'unknown');
          await f.service.runOnce();
          await f.submit(body);
          await f.service.runOnce();
          assert.equal(f.calls.image, 1);
          const resolution = {
            resolution: 'settle' as const,
            reason: '测试已核对供应商账单，确认此请求实际产生费用',
            evidenceRef: 'injected-vendor-statement-1',
          };
          await assert.rejects(
            f.service.resolve({ actorId: f.actorId, jobId: job.job.id, body: resolution }),
            { code: 'FORBIDDEN' },
          );
          await db.query('INSERT INTO operator_users(user_id) VALUES($1)', [f.actorId]);
          await f.service.resolve({ actorId: f.actorId, jobId: job.job.id, body: resolution });
          await f.service.resolve({ actorId: f.actorId, jobId: job.job.id, body: resolution });
          assert.equal((await f.row(job.job.id)).hold_state, 'settled');
          assert.equal((await f.entitlements()).usage.spent, 3);
          assert.equal((await f.entitlements()).held, 0);
          assert.equal(await f.generatedCount(), 0);
          assert.equal(f.calls.image, 1);
        },
      );

      await run(
        'a definitive model refusal releases the hold for all four operations without a retry',
        async (f) => {
          f.controls.imageError = new ProviderError('TEST_IMAGE_DEFINITIVE_REFUSAL', 'rejected');
          f.controls.textError = new ProviderError('TEST_LLM_DEFINITIVE_REFUSAL', 'rejected');
          f.controls.speechError = new ProviderError('TEST_ASR_DEFINITIVE_REFUSAL', 'rejected');
          for (const body of [f.imageBody(), f.textBody(), f.audioBody(), f.planBody()]) {
            const job = await f.submit(body);
            await f.service.runOnce();
            const done = await f.row(job.job.id);
            assert.equal(done.state, 'failed');
            assert.equal(done.hold_state, 'released');
            assert.equal(done.output, null);
            assert.equal(done.input.audioBase64, undefined);
          }
          assert.equal(f.calls.image, 1);
          assert.equal(f.calls.text, 1);
          assert.equal(f.calls.speech, 1);
          assert.equal(f.calls.plan, 1);
          assert.equal((await f.entitlements()).held, 0);
          assert.equal((await f.entitlements()).usage.spent, 0);
          await f.service.runOnce();
          assert.equal(f.calls.image + f.calls.text + f.calls.speech + f.calls.plan, 4);
        },
      );

      await run(
        'a definitive output-review error cannot release a hold after the model has already succeeded',
        async (f) => {
          f.controls.imageReviewError = new ProviderError(
            'TEST_IMS_DEFINITIVE_REFUSAL',
            'rejected',
          );
          const image = await f.submit(f.imageBody());
          await f.service.runOnce();
          const imageDone = await f.row(image.job.id);
          assert.equal(imageDone.state, 'unknown');
          assert.equal(imageDone.hold_state, 'unknown');
          assert.equal(imageDone.output, null);
          assert.equal(imageDone.provider_request_id, 'injected-image-receipt');
          assert.equal(await f.generatedCount(), 0);
          assert.deepEqual((await readdir(f.storageDirectory)).sort(), [f.source.key]);
          f.controls.imageReviewError = undefined;
          for (const body of [f.textBody(), f.planBody()]) {
            const base = f.calls.textReview;
            f.controls.beforeTextReview = async (_text, call) => {
              if (call === base + 2)
                f.controls.textReviewError = new ProviderError(
                  'TEST_TMS_DEFINITIVE_REFUSAL',
                  'rejected',
                );
            };
            const job = await f.submit(body);
            await f.service.runOnce();
            const done = await f.row(job.job.id);
            assert.equal(done.state, 'unknown');
            assert.equal(done.hold_state, 'unknown');
            assert.equal(done.output, null);
            assert.equal(
              done.provider_request_id,
              body.operation === 'edit-plan' ? 'injected-plan-receipt' : 'injected-text-receipt',
            );
            f.controls.textReviewError = undefined;
            f.controls.beforeTextReview = undefined;
          }
          assert.equal(f.calls.image, 1);
          assert.equal(f.calls.text, 1);
          assert.equal(f.calls.plan, 1);
          assert.equal((await f.entitlements()).held, 7);
          assert.equal((await f.entitlements()).usage.spent, 0);
        },
      );

      await run(
        'speech unknown, invalid frozen bytes and stale worker recovery all redact raw audio without retry',
        async (f) => {
          const networkBody = f.audioBody();
          f.controls.speechError = new ProviderError('TEST_ASR_LOST', 'unknown');
          const network = await f.submit(networkBody);
          await f.service.runOnce();
          assert.equal((await f.row(network.job.id)).state, 'unknown');
          assert.equal((await f.row(network.job.id)).input.audioBase64, undefined);
          f.controls.speechError = undefined;
          const tampered = await f.submit(f.audioBody());
          const changed = makeWav();
          changed[50] = changed[50]! ^ 1;
          await db.query(
            "UPDATE ai_jobs SET input=jsonb_set(input,'{audioBase64}',to_jsonb($2::text)) WHERE id=$1",
            [tampered.job.id, changed.toString('base64')],
          );
          await f.service.runOnce();
          const failed = await f.row(tampered.job.id);
          assert.equal(failed.state, 'failed');
          assert.equal(failed.hold_state, 'released');
          assert.equal(failed.input.audioBase64, undefined);
          const stale = await f.submit(f.audioBody());
          await db.query(
            "UPDATE ai_jobs SET state='running',lease_started_at=clock_timestamp()-interval '6 minutes' WHERE id=$1",
            [stale.job.id],
          );
          await f.service.runOnce();
          const recovered = await f.row(stale.job.id);
          assert.equal(recovered.state, 'unknown');
          assert.equal(recovered.error_code, 'WORKER_LOST');
          assert.equal(recovered.input.audioBase64, undefined);
          assert.equal(recovered.hold_state, 'unknown');
          await f.service.runOnce();
          assert.equal(f.calls.speech, 1);
          const audit = JSON.stringify(
            (await db.query('SELECT detail FROM audit_entries WHERE actor_id=$1', [f.actorId]))
              .rows,
          );
          assert.equal(audit.includes(networkBody.audioBase64), false);
        },
      );

      await run(
        'authorization and project scoping reject outsiders, wrong wallets and cross-project references before a hold',
        async (f) => {
          await assert.rejects(
            f.service.submit({
              actorId: f.outsiderId,
              projectId: f.projectId,
              spaceId: f.spaceId,
              body: f.imageBody(),
            }),
            { code: 'FORBIDDEN' },
          );
          await assert.rejects(f.service.list({ actorId: f.outsiderId, projectId: f.projectId }), {
            code: 'FORBIDDEN',
          });
          await assert.rejects(
            f.service.submit({
              actorId: f.actorId,
              projectId: f.projectId,
              spaceId: randomUUID(),
              body: f.imageBody(),
            }),
            { code: 'SCOPE_MISMATCH' },
          );
          await assert.rejects(f.submit({ ...f.imageBody(), referenceAssetId: f.foreignAssetId }), {
            code: 'REFERENCE_NOT_USABLE',
          });
          await assert.rejects(
            f.submit({
              ...f.textBody(),
              contextDocumentId: f.documentId,
              expectedDocumentVersion: 2,
            }),
            { code: 'VERSION_CONFLICT' },
          );
          await db.query("UPDATE memberships SET role='viewer' WHERE user_id=$1 AND space_id=$2", [
            f.actorId,
            f.spaceId,
          ]);
          await assert.rejects(f.submit(f.audioBody()), { code: 'FORBIDDEN' });
          assert.equal(
            Number(
              (
                await db.query('SELECT count(*)::int AS n FROM quota_holds WHERE space_id=$1', [
                  f.spaceId,
                ])
              ).rows[0]!.n,
            ),
            0,
          );
          assert.equal(f.calls.image + f.calls.text + f.calls.speech + f.calls.plan, 0);
        },
      );

      await run(
        'text permission revoked during asynchronous input review stops the billable call',
        async (f) => {
          const job = await f.submit({
            ...f.textBody(),
            contextDocumentId: f.documentId,
            expectedDocumentVersion: 1,
          });
          f.controls.beforeTextReview = async () => {
            await db.query(
              "UPDATE memberships SET role='viewer' WHERE user_id=$1 AND space_id=$2",
              [f.actorId, f.spaceId],
            );
          };
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(
            f.calls.text,
            0,
            'revocation must be checked after review and before external dispatch',
          );
          assert.equal(done.state, 'failed');
          assert.equal(done.hold_state, 'released');
          assert.equal(done.output, null);
        },
      );

      await run(
        'model disabled during input review stops image dispatch even though admission was valid',
        async (f) => {
          const job = await f.submit(f.imageBody());
          f.controls.beforeTextReview = async () => {
            await db.query(
              "UPDATE model_configs SET config=jsonb_set(config,'{enabled}','false'::jsonb),version=version+1 WHERE id=$1",
              [f.modelIds.image],
            );
          };
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(f.calls.image, 0);
          assert.equal(done.state, 'failed');
          assert.equal(done.hold_state, 'released');
        },
      );

      await run(
        'speech permission revoked during journal persistence stops transcription and erases queued audio',
        async (f) => {
          const job = await f.submit(f.audioBody());
          f.controls.afterJournal = async () => {
            await db.query(
              "UPDATE memberships SET role='viewer' WHERE user_id=$1 AND space_id=$2",
              [f.actorId, f.spaceId],
            );
          };
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(f.calls.speech, 0);
          assert.equal(done.state, 'failed');
          assert.equal(done.hold_state, 'released');
          assert.equal(done.input.audioBase64, undefined);
        },
      );

      await run(
        'image revocation during output review prevents asset attachment and discards the private candidate',
        async (f) => {
          const job = await f.submit(f.imageBody());
          f.controls.beforeImageReview = async () => {
            await db.query(
              "UPDATE memberships SET role='viewer' WHERE user_id=$1 AND space_id=$2",
              [f.actorId, f.spaceId],
            );
          };
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(f.calls.image, 1);
          assert.equal(done.state, 'unknown');
          assert.equal(done.output, null);
          assert.equal(done.hold_state, 'unknown');
          assert.equal(await f.generatedCount(), 0);
          assert.deepEqual((await readdir(f.storageDirectory)).sort(), [f.source.key]);
        },
      );

      await run(
        'frozen manifest detects tampering and binds image row model to the approved model',
        async (f) => {
          const changedPrompt = await f.submit(f.imageBody());
          await db.query(
            "UPDATE ai_jobs SET input=jsonb_set(input,'{manifest,prompt}',to_jsonb('被修改的提示词'::text)) WHERE id=$1",
            [changedPrompt.job.id],
          );
          await f.service.runOnce();
          assert.equal((await f.row(changedPrompt.job.id)).state, 'failed');
          const changedModel = await f.submit(f.imageBody());
          await db.query('UPDATE ai_jobs SET model_id=$2 WHERE id=$1', [
            changedModel.job.id,
            f.modelIds.otherImage,
          ]);
          await f.service.runOnce();
          const done = await f.row(changedModel.job.id);
          assert.equal(f.calls.image, 0, 'same manifest hash cannot authorize another row model');
          assert.equal(done.state, 'failed');
          assert.equal(done.hold_state, 'released');
          assert.equal(done.output, null);
        },
      );

      await run(
        'a missing frozen reference cannot silently downgrade an approved reference-image request to text-only generation',
        async (f) => {
          const job = await f.submit({ ...f.imageBody(), referenceAssetId: f.assetId });
          await db.query("UPDATE ai_jobs SET input=input-'reference' WHERE id=$1", [job.job.id]);
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(
            f.calls.image,
            0,
            'manifest still requiring a reference must make missing payload metadata fail closed',
          );
          assert.equal(done.state, 'failed');
          assert.equal(done.hold_state, 'released');
          assert.equal(done.output, null);
        },
      );

      await run(
        'reference revocation during image review prevents its bytes from being sent to generation',
        async (f) => {
          const job = await f.submit({ ...f.imageBody(), referenceAssetId: f.assetId });
          f.controls.beforeImageReview = async (_bytes, call) => {
            if (call === 1)
              await db.query('UPDATE assets SET deleted_at=clock_timestamp() WHERE id=$1', [
                f.assetId,
              ]);
          };
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(
            f.calls.image,
            0,
            'reference authorization must be rechecked after asynchronous image review',
          );
          assert.equal(done.state, 'failed');
          assert.equal(done.hold_state, 'released');
          assert.equal(done.output, null);
          assert.equal(await f.generatedCount(), 0);
        },
      );

      await run(
        'edit-plan integrity includes the whole base recipe, not only currentAdjustments sent to the LLM',
        async (f) => {
          const job = await f.submit(f.planBody());
          await db.query(
            "UPDATE ai_jobs SET input=jsonb_set(input,'{recipe,geometry,rotation}','90'::jsonb) WHERE id=$1",
            [job.job.id],
          );
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(
            f.calls.plan,
            0,
            'unapproved base geometry must not reach a paid proposal or generated candidate',
          );
          assert.equal(done.state, 'failed');
          assert.equal(done.hold_state, 'released');
          assert.equal(done.output, null);
        },
      );

      await run(
        'an existing dispatch record freezes a restored queued image job instead of sending it again',
        async (f) => {
          const job = await f.submit(f.imageBody());
          await f.journal.start(job.job.id, job.job.inputHash);
          await f.service.runOnce();
          const done = await f.row(job.job.id);
          assert.equal(done.state, 'unknown');
          assert.equal(done.hold_state, 'unknown');
          assert.equal(f.calls.image, 0);
          await f.service.runOnce();
          assert.equal(f.calls.image, 0);
          assert.equal(await f.generatedCount(), 0);
        },
      );

      await run(
        'missing database dispatch evidence halts new work instead of silently rebuilding vendor requests',
        async (f) => {
          await f.journal.start(randomUUID(), digest('missing restored job'));
          await assert.rejects(f.submit(f.imageBody()), /AI_RECOVERY_REQUIRED/);
          await assert.rejects(f.service.runOnce(), /AI_RECOVERY_REQUIRED/);
          assert.equal(f.calls.image + f.calls.text + f.calls.speech + f.calls.plan, 0);
        },
      );
    } finally {
      await db.end();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
