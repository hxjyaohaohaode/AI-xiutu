import assert from 'node:assert/strict';
import test from 'node:test';
import type { Asset } from '../src/lib/types';
import {
  buildRestorationRequest,
  executeRestoration,
  initialRestorationDraft,
  readRestorationCapability,
  readRestorationQuote,
  RestorationError,
  RestorationLedger,
  validateRestorationRequest,
  type RestorationCapability,
  type RestorationSnapshot,
} from '../src/restoration/restoration-model';

const actorId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const assetId = '00000000-0000-4000-8000-000000000003';
const requestId = '00000000-0000-4000-8000-000000000004';
const outputId = '00000000-0000-4000-8000-000000000005';
const otherId = '00000000-0000-4000-8000-000000000006';
const capability: RestorationCapability = {
  algorithm: 'photo-restore-v1', maxPixels: 4_194_304, maxWork: 134_217_728,
  maxMotionLength: 31, maxIterations: 12,
};
function snapshot(): RestorationSnapshot {
  return {
    scope: { actorId, projectId, assetId },
    source: { assetId, contentHash: 'ab'.repeat(32), width: 64, height: 48 },
    request: buildRestorationRequest(assetId, requestId, 'photo-restored.png', initialRestorationDraft, capability),
  };
}
function quote(current = snapshot()) {
  return {
    available: true, limits: [], encodedBytes: 300,
    cost: { pixels: 64 * 48, work: 64 * 48 * 25, maxPixels: capability.maxPixels,
      maxWork: capability.maxWork, available: true },
    sources: [{ ...current.source }], checksDecodedPixels: false, reservesQuota: false,
  };
}
const resultAsset: Asset = {
  id: outputId, projectId, name: 'photo-restored.png', mime: 'image/png',
  width: 64, height: 48, bytes: 300, url: '/v1/assets/' + outputId + '/file',
  provenance: { kind: 'asset-derived', algorithm: 'photo-restore-v1' },
};
class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('storage unavailable');
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}
function fixture() {
  const storage = new MemoryStorage(), ledger = new RestorationLedger(() => storage);
  const calls: string[] = [];
  const options = {
    snapshot: snapshot(),
    recover: false,
    ledger,
    isCurrent: () => true,
    authorize: async () => ({ actorId, capability }),
    quote: async () => quote(),
    publish: async (body: ReturnType<typeof buildRestorationRequest>) => {
      calls.push(JSON.stringify(body));
      return { asset: resultAsset, replayed: false };
    },
  };
  return { storage, ledger, calls, options };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const hasCode = (code: string) => (error: unknown) =>
  error instanceof RestorationError && error.code === code;

test('restoration is available only for the advertised source format and immutable output protocol', () => {
  const raw = {
    protocolVersion: 1, sourcePixelFormat: 'srgb-rgba8', persistence: 'immutable-derived-asset',
    restoration: { ...capability, motionLengthUnit: 'source-pixels', unknownKernelEstimation: false },
  };
  assert.deepEqual(readRestorationCapability(raw), capability);
  assert.equal(readRestorationCapability({ ...raw, sourcePixelFormat: 'preview-rgba8' }), null);
  assert.equal(readRestorationCapability({ ...raw, persistence: 'recipe' }), null);
  assert.equal(readRestorationCapability({ ...raw, restoration: { ...raw.restoration, motionLengthUnit: 'preview-pixels' } }), null);
  assert.equal(readRestorationCapability(undefined), null);
  assert.equal(readRestorationCapability({ ...raw, restoration: { ...raw.restoration, maxIterations: 99 } })?.maxIterations, 12);
});

test('mode-specific settings never leak inactive motion or canvas masks into the original', () => {
  const noise = snapshot().request;
  assert.deepEqual(noise.settings.motion, { length: 0, angle: 0, iterations: 1, strength: 0 });
  assert.equal(noise.settings.luminanceNoise, 25);
  assert.ok(!('selection' in noise.settings) && !('protection' in noise.settings));
  const motion = buildRestorationRequest(assetId, requestId, 'out.png', {
    ...initialRestorationDraft, mode: 'motion', angle: -32.5,
  }, capability);
  assert.equal(motion.settings.luminanceNoise, 0);
  assert.equal(motion.settings.chromaNoise, 0);
  assert.deepEqual(motion.settings.motion, { length: 3, angle: -32.5, iterations: 2, strength: .65 });
  const mixed = buildRestorationRequest(assetId, requestId, 'out.png', {
    ...initialRestorationDraft, mode: 'motion', denoiseWithMotion: true,
  }, capability);
  assert.equal(mixed.settings.chromaNoise, 35);
  assert.throws(() => validateRestorationRequest({
    ...noise, settings: { ...noise.settings, selection: { type: 'all' } },
  }, capability), hasCode('INVALID_SETTINGS'));
  assert.throws(() => buildRestorationRequest(assetId, requestId, 'out.png', {
    ...initialRestorationDraft, luminance: 0, chroma: 0,
  }, capability), hasCode('INVALID_SETTINGS'));
  assert.throws(() => buildRestorationRequest(assetId, requestId, 'out.png', {
    ...initialRestorationDraft, mode: 'motion', iterations: 2.5,
  }, capability), hasCode('INVALID_SETTINGS'));
});

test('quote acceptance checks the original identity, pixel dimensions, hash and non-reservation contract', () => {
  const source = snapshot().source, asset = { id: assetId, width: 64, height: 48 };
  assert.equal(readRestorationQuote(quote(), asset).available, true);
  assert.throws(() => readRestorationQuote({ ...quote(), reservesQuota: true }, asset), hasCode('INVALID_SOURCE'));
  assert.throws(() => readRestorationQuote({
    ...quote(), sources: [{ ...source, assetId: otherId }],
  }, asset), hasCode('SOURCE_CHANGED'));
  assert.throws(() => readRestorationQuote({
    ...quote(), sources: [{ ...source, contentHash: 'cd'.repeat(32) }],
  }, asset, source), hasCode('SOURCE_CHANGED'));
  assert.throws(() => readRestorationQuote(quote(), { ...asset, width: 128 }), hasCode('SOURCE_CHANGED'));
});

test('an actor change before submission sends no write and releases the unsent operation', async () => {
  const f = fixture();
  await assert.rejects(executeRestoration({
    ...f.options, authorize: async () => ({ actorId: otherId, capability }),
  }), hasCode('SCOPE_CHANGED'));
  assert.equal(f.calls.length, 0);
  assert.equal(f.ledger.read(f.options.snapshot.scope), null);
});

test('permission or source changes during the final quote prevent the write', async () => {
  const f = fixture();
  let current = true;
  await assert.rejects(executeRestoration({
    ...f.options, isCurrent: () => current,
    quote: async () => { current = false; return quote(); },
  }), hasCode('SCOPE_CHANGED'));
  assert.equal(f.calls.length, 0);
  assert.equal(f.ledger.read(f.options.snapshot.scope), null);
  const next = fixture();
  await assert.rejects(executeRestoration({
    ...next.options,
    quote: async () => ({ ...quote(), sources: [{ ...snapshot().source, contentHash: 'cd'.repeat(32) }] }),
  }), hasCode('SOURCE_CHANGED'));
  assert.equal(next.calls.length, 0);
});

test('a synchronous ledger lock prevents two gestures from starting the same operation', async () => {
  const f = fixture();
  const gate = deferred<{ actorId: string; capability: RestorationCapability }>();
  const first = executeRestoration({ ...f.options, authorize: () => gate.promise });
  await assert.rejects(executeRestoration(f.options), hasCode('REQUEST_BUSY'));
  assert.equal(f.calls.length, 0);
  gate.resolve({ actorId, capability });
  assert.equal((await first).id, outputId);
  assert.equal(f.calls.length, 1);
  assert.equal(f.ledger.read(f.options.snapshot.scope)?.state, 'done');
});

test('lost responses freeze the payload; explicit recovery reuses the identical request identity', async () => {
  const f = fixture();
  const lost = Object.assign(new Error('network lost'), { code: 'NETWORK_UNAVAILABLE', status: 0 });
  await assert.rejects(executeRestoration({
    ...f.options, publish: async (body) => { f.calls.push(JSON.stringify(body)); throw lost; },
  }), /network lost/);
  const pending = f.ledger.read(f.options.snapshot.scope)!;
  assert.equal(pending.state, 'unknown');
  const changed = {
    ...f.options.snapshot,
    request: { ...f.options.snapshot.request, requestId: otherId, name: 'different.png' },
  };
  await assert.rejects(executeRestoration({ ...f.options, snapshot: changed }), hasCode('REQUEST_BUSY'));
  await executeRestoration({ ...f.options, snapshot: pending.snapshot, recover: true });
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0], f.calls[1], 'recovery cannot silently create a second logical operation');
});

test('a tab reload restores pending work as unknown and keeps actors and sources separate', () => {
  const f = fixture();
  f.ledger.start(f.options.snapshot, false);
  const reloaded = new RestorationLedger(() => f.storage);
  const recovered = reloaded.read(f.options.snapshot.scope)!;
  assert.equal(recovered.state, 'unknown');
  assert.deepEqual(recovered.snapshot, f.options.snapshot);
  assert.ok(Object.isFrozen(recovered.snapshot.request.settings.motion));
  assert.equal(reloaded.read({ ...f.options.snapshot.scope, actorId: otherId }), null);
  assert.equal(reloaded.read({ ...f.options.snapshot.scope, assetId: otherId }), null);
});

test('unavailable session storage blocks dispatch, but a failed receipt write cannot undo success', async () => {
  const blocked = fixture();
  blocked.storage.failWrites = true;
  await assert.rejects(executeRestoration(blocked.options), hasCode('JOURNAL_UNAVAILABLE'));
  assert.equal(blocked.calls.length, 0);
  const saved = fixture();
  const result = await executeRestoration({
    ...saved.options,
    publish: async (body) => {
      saved.calls.push(JSON.stringify(body));
      saved.storage.failWrites = true;
      return { asset: resultAsset, replayed: false };
    },
  });
  assert.equal(result.id, outputId);
  assert.equal(saved.ledger.read(saved.options.snapshot.scope)?.state, 'done');
  assert.equal(saved.calls.length, 1);
});

test('explicit server rejection permits new settings, but a failed recovery retains the unknown identity', async () => {
  const f = fixture();
  const busy = Object.assign(new Error('busy'), { code: 'ASSET_PROCESSING_BUSY', status: 503 });
  await assert.rejects(executeRestoration({ ...f.options, publish: async () => { throw busy; } }), /busy/);
  assert.equal(f.ledger.read(f.options.snapshot.scope), null);
  f.ledger.unknown(f.ledger.start(f.options.snapshot, false));
  const denied = Object.assign(new Error('forbidden'), { code: 'PROJECT_FORBIDDEN', status: 403 });
  await assert.rejects(executeRestoration({
    ...f.options, recover: true, quote: async () => { throw denied; },
  }), /forbidden/);
  assert.equal(f.ledger.read(f.options.snapshot.scope)?.state, 'unknown');
  assert.equal(f.ledger.read(f.options.snapshot.scope)?.snapshot.request.requestId, requestId);
});

test('a malformed or cross-project receipt remains unknown, never a successful local image', async () => {
  const f = fixture();
  await assert.rejects(executeRestoration({
    ...f.options,
    publish: async () => ({ asset: { ...resultAsset, projectId: otherId } }),
  }), hasCode('INVALID_RECEIPT'));
  assert.equal(f.ledger.read(f.options.snapshot.scope)?.state, 'unknown');
  assert.equal(f.ledger.read(f.options.snapshot.scope)?.asset, undefined);
});

test('a late successful response is retained even after the originating dialog has closed', async () => {
  const f = fixture();
  let current = true;
  const result = await executeRestoration({
    ...f.options, isCurrent: () => current,
    publish: async () => { current = false; return { asset: resultAsset }; },
  });
  assert.equal(result.id, outputId);
  assert.equal(f.ledger.read(f.options.snapshot.scope)?.asset?.id, outputId);
});
