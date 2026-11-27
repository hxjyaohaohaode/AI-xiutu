/** Run with CI=true TEST_DATABASE_URL=...test and two actual camera/drawing files.
 * Inputs are streamed through loopback HTTP, never uploaded to a model vendor. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { createOpenAIImageProvider } from '@ai-xiutu/multimodal';
import { createAiService, DispatchJournal } from '@ai-xiutu/ai';
import { adjustUnits, transaction } from '@ai-xiutu/db';
import { LocalPrivateStorage } from '@ai-xiutu/storage';
import { join } from 'node:path';
import { createRecipeV4 } from '@ai-xiutu/editor';
import { collaborationFixture } from '../../apps/api/test/collaboration-fixture.ts';
import { buildApp } from '../../apps/api/src/app.ts';

const db = process.env.TEST_DATABASE_URL, files = process.argv.slice(2);
assert.ok(process.env.CI === 'true' && db && /test/.test(new URL(db).pathname) && files.length);
process.env.MEDIA_ADVANCED_ENABLED = 'false';
const origin = 'http://photo.test';
const model = 'gpt-image-2.5-sunburst';
let supplierCalls = 0, lastReference;
const fixture = await collaborationFixture(db, { origin, createJobService(database, config) {
  const provider = createOpenAIImageProvider({ OPENAI_IMAGE_MODELS: model, OPENAI_API_KEY: 'local-fixture',
    OPENAI_IMAGE_ENABLED: 'true' }, async (url, options) => {
    assert.equal(new URL(url).pathname, '/v1/images/edits');
    const payload = JSON.parse(options.body);
    assert.equal(payload.images.length, 1);
    const png = Buffer.from(payload.images[0].image_url.replace('data:image/png;base64,', ''), 'base64');
    const meta = await sharp(png).metadata();
    assert.ok(Math.max(meta.width, meta.height) <= 1024 && png.length <= 4_250_000);
    lastReference = { width: meta.width, height: meta.height, bytes: png.length };
    supplierCalls++;
    const image = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#667788' } }).png().toBuffer();
    return Response.json({ data: [{ b64_json: image.toString('base64') }] }, { headers: { 'x-request-id': 'fixture-' + supplierCalls } });
  });
  const moderator = { configured: true, async check(value) {
    return { decision: 'passed', inputHash: createHash('sha256').update(value).digest('hex'), requestId: 'fixture-pass' };
  } };
  return createAiService(database, { AI_IMAGE_ENABLED: 'true' }, { openAIImageProvider: provider,
    moderator, imageModerator: moderator, storage: new LocalPrivateStorage(config),
    journal: new DispatchJournal(join(config.storageDir, 'journal')) });
} });
let api = fixture.app;
let endpoint;
async function listen() { endpoint = await api.listen({ host: '127.0.0.1', port: 0 }); }
async function request(method, path, body, type, actor = 'owner') {
  return fetch(endpoint + path, {
    method, headers: { origin, cookie: fixture.actors[actor].cookie, ...(type ? { 'content-type': type } : {}) },
    ...(body ? { body } : {}),
  });
}
async function json(method, path, body) {
  const r = await request(method, path, body && JSON.stringify(body), body && 'application/json');
  const value = await r.json();
  assert.ok(r.ok, JSON.stringify(value));
  return value;
}
async function sha(stream) {
  const h = createHash('sha256');
  for await (const bytes of stream) h.update(bytes);
  return h.digest('hex');
}
const assetIds = [];
try {
  await fixture.db.query('INSERT INTO model_configs(id,config) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET config=EXCLUDED.config',
    [model, JSON.stringify({ label: 'Local reference check', provider: 'openai', enabled: true, operations: ['generate-image'],
      unitCost: 3, minWidth: 64, maxWidth: 3840, minHeight: 64, maxHeight: 3840 })]);
  await transaction(fixture.db, (tx) => adjustUnits(tx, { spaceId: fixture.teamId, actorId: fixture.actors.operator.id,
    units: files.length * 3, reason: 'large photo fixture', idempotencyKey: randomUUID(), requestHash: randomUUID() }));
  await listen();
  const capabilities = await json('GET', '/v1/media-capabilities');
  assert.equal(capabilities.enabled, false);
  assert.ok(capabilities.ordinaryPhotos.available);
  for (const file of files) {
    const size = (await stat(file)).size, hash = await sha(createReadStream(file));
    assert.ok(size >= 20 * 1024 * 1024 && size <= capabilities.ordinaryPhotos.maxBytes);
    const input = await sharp(file).metadata();
    const create = { name: basename(file), size, profile: 'photo', sourceSha256: hash, idempotencyKey: randomUUID() };
    const path = '/v1/projects/' + fixture.projectId + '/media-imports';
    const { job } = await json('POST', path, create);
    assert.equal((await json('POST', path, create)).job.id, job.id);
    const jobPath = '/v1/media-imports/' + job.id;
    const handle = await open(file, 'r');
    let chunks = 0;
    try {
      for (let offset = 0; offset < size; offset += job.maxChunkBytes) {
        const bytes = Buffer.alloc(Math.min(job.maxChunkBytes, size - offset));
        assert.equal((await handle.read(bytes, 0, bytes.length, offset)).bytesRead, bytes.length);
        const url = jobPath + '/chunk?offset=' + offset;
        const reply = await request('PUT', url, bytes, 'application/octet-stream');
        const receipt = await reply.json();
        assert.equal(reply.status, 200, JSON.stringify(receipt));
        assert.equal(receipt.chunkSha256, createHash('sha256').update(bytes).digest('hex'));
        if (!chunks) assert.equal((await request('PUT', url, bytes, 'application/octet-stream')).status, 200);
        chunks++;
      }
    } finally { await handle.close(); }
    await json('POST', jobPath + '/complete', {});
    let result;
    const deadline = Date.now() + 180_000;
    do { result = await json('GET', jobPath); if (result.job.state !== 'processing') break; await delay(350); }
    while (Date.now() < deadline);
    assert.equal(result.job.state, 'ready', JSON.stringify(result.job));
    const asset = result.asset;
    assert.equal(asset.provenance.sourceSha256, hash);
    assert.equal(asset.provenance.profile, 'photo');
    assert.equal(asset.provenance.originalFormat, input.format);
    assert.equal(asset.provenance.originalBytes, size);
    assert.equal(asset.provenance.uprightWidth, input.autoOrient.width);
    assert.equal(asset.provenance.uprightHeight, input.autoOrient.height);
    const fileResult = await request('GET', '/v1/assets/' + asset.id + '/file');
    assert.equal(fileResult.status, 200);
    const proxy = Buffer.from(await fileResult.arrayBuffer());
    const info = await sharp(proxy).metadata();
    assert.ok(info.width * info.height <= 4_194_304);
    const key = randomUUID();
    const options = { operation: 'generate-image', modelId: model, prompt: '保留主体并调整色调', referenceAssetIds: [asset.id],
      width: 1024, height: 1024, expectedUnits: 3, idempotencyKey: key };
    const jobs = '/v1/projects/' + fixture.projectId + '/ai-jobs';
    const { job: generation } = await json('POST', jobs, options);
    assert.equal((await json('POST', jobs, options)).job.id, generation.id);
    assert.ok(await fixture.jobService.runOnce());
    const completed = (await json('GET', jobs + '?requestKey=' + key)).jobs[0];
    assert.equal(completed.state, 'completed', JSON.stringify(completed));
    assert.ok(lastReference);
    const source = '/v1/assets/' + asset.id + '/media/original';
    const original = await request('GET', source);
    assert.equal(original.status, 200);
    assert.equal(await sha(original.body), hash);
    assert.ok([403, 404].includes((await request('GET', source, undefined, undefined, 'outsider')).status));
    const recipe = createRecipeV4();
    recipe.adjustments.exposure = 0.5;
    const artwork = await json('POST', '/v1/projects/' + fixture.projectId + '/artworks',
      { assetId: asset.id, title: basename(file), recipe });
    assetIds.push({ assetId: asset.id, hash, artworkId: artwork.artwork.id });
    console.log(JSON.stringify({ name: basename(file), bytes: size, chunks, hash, storedOriginal: input.autoOrient,
      editorProxy: [info.width, info.height], supplierReference: lastReference, imageJob: completed.state }));
  }
  assert.equal(supplierCalls, files.length);
  await api.close();
  api = await buildApp({ db: fixture.db, config: fixture.config });
  await listen();
  for (const item of assetIds) {
    const reopened = await json('GET', '/v1/artworks/' + item.artworkId);
    assert.equal(reopened.revision.recipe.adjustments.exposure, 0.5);
    assert.equal(reopened.asset.id, item.assetId);
    const r = await request('GET', '/v1/assets/' + item.assetId + '/media/original');
    assert.equal(r.status, 200);
    assert.equal(await sha(r.body), item.hash);
  }
  console.log('Passed: large sources, original hashes after API restart, edited artwork, private access and bounded references.');
} finally {
  if (api !== fixture.app) await api.close();
  await fixture.close();
}
