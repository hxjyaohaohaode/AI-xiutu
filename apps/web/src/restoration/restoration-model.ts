import type { DerivedAssetRequest } from '@ai-xiutu/contracts';
import type { Asset } from '../lib/types';

export type RestorationRequest = Extract<DerivedAssetRequest, { kind: 'restoration' }>;
export type RestorationCapability = {
  algorithm: 'photo-restore-v1';
  maxPixels: number;
  maxWork: number;
  maxMotionLength: number;
  maxIterations: number;
};
export type RestorationDraft = {
  mode: 'denoise' | 'motion';
  luminance: number;
  chroma: number;
  denoiseWithMotion: boolean;
  length: number;
  angle: number;
  iterations: number;
  strength: number;
};
export const initialRestorationDraft: RestorationDraft = {
  mode: 'denoise',
  luminance: 25,
  chroma: 35,
  denoiseWithMotion: false,
  length: 3,
  angle: 0,
  iterations: 2,
  strength: 65,
};
export type RestorationSource = {
  assetId: string;
  contentHash: string;
  width: number;
  height: number;
};
export type RestorationQuote = {
  available: boolean;
  limits: string[];
  encodedBytes: number;
  cost: { pixels: number; work: number; maxWork: number; maxPixels: number; available: boolean };
  sources: RestorationSource[];
  checksDecodedPixels: false;
  reservesQuota: false;
};
export type RestorationScope = { actorId: string; projectId: string; assetId: string };
export type RestorationSnapshot = {
  scope: RestorationScope;
  source: RestorationSource;
  request: RestorationRequest;
};
export type RestorationOperation = {
  snapshot: RestorationSnapshot;
  state: 'pending' | 'unknown' | 'done';
  asset?: Asset;
};
export class RestorationError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'RestorationError';
  }
}
const object = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
const within = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readRestorationCapability(value: unknown): RestorationCapability | null {
  if (
    !object(value) ||
    value.protocolVersion !== 1 ||
    value.sourcePixelFormat !== 'srgb-rgba8' ||
    value.persistence !== 'immutable-derived-asset'
  ) return null;
  const caps = value.restoration;
  if (
    !object(caps) || caps.algorithm !== 'photo-restore-v1' ||
    caps.motionLengthUnit !== 'source-pixels' ||
    !positive(caps.maxPixels) || !positive(caps.maxWork) ||
    !positive(caps.maxMotionLength) || !positive(caps.maxIterations)
  ) return null;
  return {
    algorithm: 'photo-restore-v1',
    maxPixels: caps.maxPixels,
    maxWork: caps.maxWork,
    maxMotionLength: Math.min(31, caps.maxMotionLength),
    maxIterations: Math.min(12, caps.maxIterations),
  };
}

export function buildRestorationRequest(
  assetId: string,
  requestId: string,
  name: string,
  draft: RestorationDraft,
  caps: RestorationCapability,
): RestorationRequest {
  const noise = draft.mode === 'denoise' || draft.denoiseWithMotion;
  const motion = draft.mode === 'motion';
  const request: RestorationRequest = {
    kind: 'restoration',
    sourceAssetId: assetId,
    requestId,
    name: name.trim(),
    settings: {
      algorithm: 'photo-restore-v1',
      luminanceNoise: noise ? draft.luminance : 0,
      chromaNoise: noise ? draft.chroma : 0,
      motion: {
        length: motion ? draft.length : 0,
        angle: motion ? draft.angle : 0,
        iterations: motion ? draft.iterations : 1,
        strength: motion ? draft.strength / 100 : 0,
      },
    },
  };
  validateRestorationRequest(request, caps);
  return request;
}

export function validateRestorationRequest(
  request: RestorationRequest,
  caps: RestorationCapability,
) {
  const settings = request?.settings, motion = settings?.motion;
  if (
    request?.kind !== 'restoration' || !uuid.test(request.sourceAssetId) ||
    !uuid.test(request.requestId) || typeof request.name !== 'string' ||
    !request.name.trim() || request.name.length > 120 ||
    settings?.algorithm !== caps.algorithm ||
    // This entry edits the whole original. Never inherit an editor-space mask.
    settings.selection !== undefined || settings.protection !== undefined ||
    !within(settings.luminanceNoise, 0, 100) ||
    !within(settings.chromaNoise, 0, 100) ||
    !motion || !within(motion.length, 0, caps.maxMotionLength) ||
    !within(motion.angle, -180, 180) ||
    !Number.isInteger(motion.iterations) || !within(motion.iterations, 1, caps.maxIterations) ||
    !within(motion.strength, 0, 1) ||
    (!settings.luminanceNoise && !settings.chromaNoise && !(motion.length > 0 && motion.strength > 0))
  ) throw new RestorationError('INVALID_SETTINGS');
}

export function readRestorationQuote(
  value: unknown,
  asset: Pick<Asset, 'id' | 'width' | 'height'>,
  previous?: RestorationSource,
): RestorationQuote {
  if (
    !object(value) || typeof value.available !== 'boolean' ||
    !Array.isArray(value.limits) || !value.limits.every((item: unknown) => typeof item === 'string') ||
    !Number.isFinite(value.encodedBytes) || value.encodedBytes < 0 ||
    value.reservesQuota !== false || value.checksDecodedPixels !== false ||
    !Array.isArray(value.sources) || value.sources.length !== 1 ||
    !object(value.cost) || !Number.isFinite(value.cost.work) || value.cost.work < 0 ||
    !positive(value.cost.maxWork) || !positive(value.cost.maxPixels) ||
    typeof value.cost.available !== 'boolean'
  ) throw new RestorationError('INVALID_SOURCE');
  const source = value.sources[0];
  if (
    !object(source) || source.assetId !== asset.id ||
    !positive(source.width) || !positive(source.height) ||
    source.width !== asset.width || source.height !== asset.height ||
    typeof source.contentHash !== 'string' || !/^[0-9a-f]{64}$/i.test(source.contentHash) ||
    value.cost.pixels !== source.width * source.height
  ) throw new RestorationError('SOURCE_CHANGED');
  if (
    previous &&
    (source.assetId !== previous.assetId || source.contentHash !== previous.contentHash ||
      source.width !== previous.width || source.height !== previous.height)
  ) throw new RestorationError('SOURCE_CHANGED');
  if (value.available && (value.limits.length || !value.cost.available ||
    value.cost.work > value.cost.maxWork || value.cost.pixels > value.cost.maxPixels))
    throw new RestorationError('INVALID_SOURCE');
  return value as RestorationQuote;
}

export function restorationDraftFromRequest(request: RestorationRequest): RestorationDraft {
  const { luminanceNoise, chromaNoise, motion } = request.settings;
  const hasMotion = motion.length > 0 && motion.strength > 0;
  return {
    mode: hasMotion ? 'motion' : 'denoise',
    luminance: luminanceNoise,
    chroma: chromaNoise,
    denoiseWithMotion: hasMotion && !!(luminanceNoise || chromaNoise),
    length: hasMotion ? motion.length : initialRestorationDraft.length,
    angle: motion.angle,
    iterations: hasMotion ? motion.iterations : initialRestorationDraft.iterations,
    strength: hasMotion ? motion.strength * 100 : initialRestorationDraft.strength,
  };
}
export const restorationScopeKey = (scope: RestorationScope) =>
  [scope.actorId, scope.projectId, scope.assetId].join(':');

function copySnapshot(snapshot: RestorationSnapshot): RestorationSnapshot {
  const copy: RestorationSnapshot = JSON.parse(JSON.stringify(snapshot));
  Object.freeze(copy.scope);
  Object.freeze(copy.source);
  Object.freeze(copy.request.settings.motion);
  Object.freeze(copy.request.settings);
  Object.freeze(copy.request);
  return Object.freeze(copy);
}
function validReceipt(asset: unknown, snapshot: RestorationSnapshot): asset is Asset {
  return object(asset) &&
    typeof asset.id === 'string' && uuid.test(asset.id) && asset.id !== snapshot.source.assetId &&
    asset.projectId === snapshot.scope.projectId &&
    asset.width === snapshot.source.width && asset.height === snapshot.source.height &&
    typeof asset.name === 'string' && typeof asset.url === 'string' &&
    asset.mime === 'image/png' && asset.provenance?.algorithm === 'photo-restore-v1';
}

type JournalStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A pending operation survives dialog/project changes and a tab reload. */
export class RestorationLedger {
  private entries = new Map<string, RestorationOperation>();
  private listeners = new Set<() => void>();
  constructor(private storage: () => JournalStorage) {}
  private key(scope: RestorationScope) {
    return 'yingjian.restoration.v1:' + restorationScopeKey(scope);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private notify() {
    for (const listener of this.listeners) listener();
  }
  read(scope: RestorationScope): RestorationOperation | null {
    const key = this.key(scope), cached = this.entries.get(key);
    if (cached) return cached;
    let raw: string | null;
    try { raw = this.storage().getItem(key); }
    catch { throw new RestorationError('JOURNAL_UNAVAILABLE'); }
    if (!raw) return null;
    try {
      const saved: RestorationOperation = JSON.parse(raw);
      if (
        !object(saved) || !object(saved.snapshot) ||
        !object(saved.snapshot.scope) ||
        restorationScopeKey(saved.snapshot.scope) !== restorationScopeKey(scope) ||
        !object(saved.snapshot.source) || saved.snapshot.source.assetId !== scope.assetId ||
        !positive(saved.snapshot.source.width) || !positive(saved.snapshot.source.height) ||
        !/^[0-9a-f]{64}$/i.test(saved.snapshot.source.contentHash) ||
        saved.snapshot.request?.sourceAssetId !== scope.assetId ||
        !['pending', 'unknown', 'done'].includes(saved.state)
      ) throw new Error('invalid journal');
      validateRestorationRequest(saved.snapshot.request, {
        algorithm: 'photo-restore-v1', maxPixels: 4_194_304, maxWork: 134_217_728,
        maxMotionLength: 31, maxIterations: 12,
      });
      if (saved.state === 'done' && !validReceipt(saved.asset, saved.snapshot))
        throw new Error('invalid receipt');
      const entry: RestorationOperation = {
        snapshot: copySnapshot(saved.snapshot),
        state: saved.state === 'pending' ? 'unknown' : saved.state,
        ...(saved.asset ? { asset: saved.asset } : {}),
      };
      this.entries.set(key, entry);
      return entry;
    } catch { throw new RestorationError('JOURNAL_INVALID'); }
  }
  start(snapshot: RestorationSnapshot, recover: boolean): RestorationOperation {
    const existing = this.read(snapshot.scope);
    if (
      (existing && (!recover || existing.state !== 'unknown' ||
        existing.snapshot.request.requestId !== snapshot.request.requestId ||
        JSON.stringify(existing.snapshot) !== JSON.stringify(snapshot))) ||
      (!existing && recover)
    ) throw new RestorationError('REQUEST_BUSY');
    const entry: RestorationOperation = { snapshot: copySnapshot(snapshot), state: 'pending' };
    // A write is never sent without first retaining its exact idempotency identity.
    try { this.storage().setItem(this.key(snapshot.scope), JSON.stringify(entry)); }
    catch { throw new RestorationError('JOURNAL_UNAVAILABLE'); }
    this.entries.set(this.key(snapshot.scope), entry);
    this.notify();
    return entry;
  }
  unknown(entry: RestorationOperation) {
    this.store({ snapshot: entry.snapshot, state: 'unknown' });
  }
  complete(entry: RestorationOperation, asset: Asset) {
    this.store({ snapshot: entry.snapshot, state: 'done', asset });
  }
  private store(entry: RestorationOperation) {
    this.entries.set(this.key(entry.snapshot.scope), entry);
    // A receipt is authoritative even if saving the local receipt later fails.
    try { this.storage().setItem(this.key(entry.snapshot.scope), JSON.stringify(entry)); } catch {}
    this.notify();
  }
  discardUnsent(entry: RestorationOperation) {
    const key = this.key(entry.snapshot.scope);
    try {
      this.storage().removeItem(key);
      this.entries.delete(key);
      this.notify();
    } catch { this.unknown(entry); }
  }
  forgetCompleted(scope: RestorationScope) {
    const entry = this.read(scope);
    if (entry?.state === 'done') this.discardUnsent(entry);
  }
}

function definitelyRejected(error: unknown) {
  if (!object(error)) return false;
  if (['ASSET_PROCESSING_BUSY', 'ASSET_PROCESSING_FAILED', 'ASSET_PROCESSING_BUDGET',
    'ASSET_PROCESSING_CANCELLED', 'ASSET_PROCESSING_TIMEOUT'].includes(error.code)) return true;
  return Number.isInteger(error.status) && error.status >= 400 && error.status < 500 &&
    error.status !== 408 && error.code !== 'IDEMPOTENCY_CONFLICT';
}

export async function executeRestoration(options: {
  snapshot: RestorationSnapshot;
  recover: boolean;
  ledger: RestorationLedger;
  isCurrent(): boolean;
  authorize(): Promise<{ actorId: string | null; capability: RestorationCapability | null }>;
  quote(request: RestorationRequest): Promise<unknown>;
  publish(request: RestorationRequest): Promise<unknown>;
}): Promise<Asset> {
  const { snapshot, ledger, recover } = options;
  if (!options.isCurrent()) throw new RestorationError('SCOPE_CHANGED');
  const entry = ledger.start(snapshot, recover);
  let dispatched = false;
  try {
    const authorization = await options.authorize();
    if (!options.isCurrent() || authorization.actorId !== snapshot.scope.actorId)
      throw new RestorationError('SCOPE_CHANGED');
    if (!authorization.capability) throw new RestorationError('CAPABILITY_UNAVAILABLE');
    validateRestorationRequest(snapshot.request, authorization.capability);
    const checked = readRestorationQuote(
      await options.quote(snapshot.request),
      { id: snapshot.source.assetId, width: snapshot.source.width, height: snapshot.source.height },
      snapshot.source,
    );
    if (!options.isCurrent()) throw new RestorationError('SCOPE_CHANGED');
    if (!checked.available) throw new RestorationError('QUOTE_UNAVAILABLE');
    dispatched = true;
    const result = await options.publish(snapshot.request);
    if (!object(result) || !validReceipt(result.asset, snapshot))
      throw new RestorationError('INVALID_RECEIPT');
    // Record late receipts even if the source dialog is no longer mounted.
    ledger.complete(entry, result.asset);
    return result.asset;
  } catch (error) {
    if (recover || (dispatched && !definitelyRejected(error))) ledger.unknown(entry);
    else ledger.discardUnsent(entry);
    throw error;
  }
}
