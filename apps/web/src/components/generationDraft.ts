import { t } from '../i18n';
import type { AssetCopyRecord } from '@ai-xiutu/contracts';
import type { Asset } from '../lib/types';
import type { AIModel, ImageOptions } from '../ai/types';
import { allowedImageSizes, imageSizeError, defaultImageOptions, imageOptionsError, imagePointQuote, imageBatchError, requestImageOptions } from '../ai/capabilities';

type ImageShape = { width: number; height: number };
export type GenerationFrame = ImageShape & { exact?: boolean };

/** Explicit framing in the draft takes precedence over the first known reference. */
export function generationFrame(prompt: string, reference?: ImageShape): GenerationFrame | undefined {
  const pixels = prompt.match(/(?:^|[^0-9])([1-9][0-9]{1,4})\s*[x×✕]\s*([1-9][0-9]{1,4})(?![0-9])/i);
  if (pixels) return { width: Number(pixels[1]), height: Number(pixels[2]), exact: true };
  const ratios = prompt.matchAll(/(?<![0-9:：])([1-9][0-9]?)\s*[:：]\s*([1-9][0-9]?)(?![0-9:：])/g);
  for (const match of ratios) {
    const before = prompt.slice(Math.max(0, match.index! - 20), match.index);
    const after = prompt.slice(match.index! + match[0].length, match.index! + match[0].length + 20);
    const common = /^(?:1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|10:16|16:10|9:21|21:9|9:32|32:9)$/.test(match[1] + ':' + match[2]);
    const framed = /(?:画幅|比例|宽高比|aspect(?: ratio)?|ratio)[\s为是:=：]*$/i.test(before) ||
      /^[\s的]*(?:画幅|比例|宽高比|aspect ratio)/i.test(after);
    const clock = /(?:上午|下午|中午|晚上|凌晨|早上|时间|at)\s*$/i.test(before) ||
      /^\s*(?:am\b|pm\b|上课|下课|开会|开场|开门|出发|开始)/i.test(after);
    if (framed || (common && !clock)) return { width: Number(match[1]), height: Number(match[2]) };
  }
  if (/正方形|方形构图|方形画幅|一张方形|square (?:image|canvas|format|composition)/i.test(prompt))
    return { width: 1, height: 1 };
  return reference && reference.width > 0 && reference.height > 0 ? reference : undefined;
}

export function chooseGenerationSize(model: AIModel, options: ImageOptions, frame?: GenerationFrame) {
  const sizes = allowedImageSizes(model, options);
  if (!frame) return sizes.find(({ width, height }) => !imageBatchError(model, width, height, options));
  const ratio = frame.width / frame.height;
  const first = sizes[0];
  const minPixels = Math.max(1, model.minPixels ?? 1, model.parameterCapabilities?.size.minPixels ?? 1);
  const budget = first ? first.width * first.height : Math.max(1024 ** 2, minPixels);
  if (!model.parameterCapabilities?.size.allowedSizes) {
    const grid = model.parameterCapabilities?.size.multipleOf ?? 1;
    // Calculate at the model's usual pixel budget. Try both grid neighbors at
    // the lower boundary because rounding down can put a legal ratio below minPixels.
    const width = Math.sqrt(budget * ratio), height = Math.sqrt(budget / ratio);
    // Preserve exact common ratios on providers with a pixel grid (e.g. 9:16).
    if (Number.isSafeInteger(frame.width) && Number.isSafeInteger(frame.height)) {
      let a = frame.width, b = frame.height;
      while (b) [a, b] = [b, a % b];
      const unitWidth = frame.width / a * grid, unitHeight = frame.height / a * grid;
      const factor = Math.sqrt(budget / (unitWidth * unitHeight));
      for (const n of [Math.floor(factor), Math.ceil(factor)])
        if (n > 0) sizes.push({ width: unitWidth * n, height: unitHeight * n });
    }
    for (const x of [Math.floor(width / grid), Math.ceil(width / grid)])
      for (const y of [Math.floor(height / grid), Math.ceil(height / grid)])
        sizes.push({ width: x * grid, height: y * grid });
  }
  if (frame.exact) sizes.push({ width: frame.width, height: frame.height });
  const candidates = sizes.filter(({ width, height }) => !imageSizeError(model, width, height, options)
    && !imageBatchError(model, width, height, options));
  const exact = frame.exact && candidates.find((s) => s.width === frame.width && s.height === frame.height);
  if (exact) return exact;
  const score = (size: ImageShape) => {
    const aspectError = Math.abs(Math.log(size.width / size.height / ratio));
    return [Math.round(aspectError * 1000), Math.abs(Math.log(size.width * size.height / budget))] as const;
  };
  return candidates.sort((a, b) => {
    const left = score(a), right = score(b);
    return left[0] - right[0] || left[1] - right[1];
  })[0];
}

export function quickImageOffer(models: AIModel[], referenceCount: number, preferredId?: string, frame?: GenerationFrame) {
  const offers = models.flatMap((model) => {
    if (!model.enabled || !model.runtimeAvailable ||
        !model.runtimeOperations?.includes('generate-image')) return [];
    const refs = model.parameterCapabilities?.references;
    const referenceLimit = model.provider === 'ark'
      ? Number(model.supportsReference === true)
      : refs?.supported ? refs.maxCount : 0;
    if (referenceCount > referenceLimit) return [];
    const options = defaultImageOptions(model);
    const size = chooseGenerationSize(model, options, frame);
    const units = imagePointQuote(model, options);
    if (!size || units === null || imageOptionsError(model, options) ||
        imageBatchError(model, size.width, size.height, options)) return [];
    return [{ model, units, ...size, options: requestImageOptions(model, options) }];
  });
  // The runtime enforces shutdown dates. Prefer current models, but keep a still-live
  // model with an announced end date if it is the only one supporting this draft.
  const current = offers.filter((offer) => !offer.model.shutdownDate);
  const eligible = current.length ? current : offers;
  const preferred = eligible.find((offer) => offer.model.id === preferredId);
  if (preferred) return preferred;
  return eligible.sort((a, b) => {
    if (frame) {
      if (frame.exact) {
        const matches = (size: ImageShape) => Number(size.width === frame.width && size.height === frame.height);
        const exact = matches(b) - matches(a);
        if (exact) return exact;
      }
      const ratio = frame.width / frame.height;
      const mismatch = (s: ImageShape) => Math.round(100 * Math.abs(Math.log(s.width / s.height / ratio)));
      const framing = mismatch(a) - mismatch(b);
      if (framing) return framing;
    }
    return a.units - b.units || a.model.id.localeCompare(b.model.id);
  })[0];
}

export interface GenerationDraftInput {
  executionGrantId?: string;
  candidateId: string;
  prompt: string;
  referenceAssetIds: string[];
}

export interface PreparedGenerationDraft extends GenerationDraftInput {
  /** In the original order, using the destination IDs returned by the server. */
  referenceAssets: Asset[];
}

export interface ReferenceCopyAttempt {
  idempotencyKey: string;
  copiedAssetId?: string;
}

export type ReferenceCopyJournal = Map<string, ReferenceCopyAttempt>;

interface PreparationOptions<Result> {
  actorScope: string;
  projectId: string;
  journal: ReferenceCopyJournal;
  loadProjectAssets: () => Promise<Asset[]>;
  copyAsset: (
    sourceAssetId: string,
    idempotencyKey: string,
  ) => Promise<{ asset: Asset; copy: AssetCopyRecord }>;
  makeId: (sourceAssetId: string) => string;
  confirmCopy: (count: number) => boolean | Promise<boolean>;
  assertCurrent: () => void;
  onAssetReady: (asset: Asset) => void;
  commit: (draft: PreparedGenerationDraft) => Result;
}

/**
 * Prepare real authorized references without adopting the candidate or changing
 * the composer. The caller records the candidate decision first, then invokes
 * the returned commit. Failed/unknown copies retain their original request key.
 */
export async function prepareGenerationDraft<Result>(
  input: GenerationDraftInput,
  options: PreparationOptions<Result>,
): Promise<(() => Result | undefined) | null> {
  const draft = { ...input, referenceAssetIds: [...input.referenceAssetIds] };
  options.assertCurrent();
  const projectAssets = draft.referenceAssetIds.length ? await options.loadProjectAssets() : [];
  options.assertCurrent();
  if (projectAssets.some((asset) => asset.projectId !== options.projectId))
    throw new Error('素材列表与当前项目不一致，请刷新后再准备草案。');
  const available = new Map(projectAssets.map((asset) => [asset.id, asset]));
  const resolved = new Map<string, Asset>();
  const journalKey = (sourceId: string) =>
    JSON.stringify([options.actorScope, options.projectId, sourceId]);
  const uniqueReferences = [...new Set(draft.referenceAssetIds)];
  for (const sourceId of uniqueReferences) {
    const direct = available.get(sourceId);
    const prior = options.journal.get(journalKey(sourceId));
    const completed = prior?.copiedAssetId ? available.get(prior.copiedAssetId) : undefined;
    if (direct || completed) resolved.set(sourceId, (direct ?? completed)!);
  }
  const needsCopy = uniqueReferences.filter((sourceId) => !resolved.has(sourceId));
  if (needsCopy.length && !(await options.confirmCopy(needsCopy.length))) return null;
  options.assertCurrent();

  // Publish only actual assets. This also makes newly fetched same-project
  // references immediately visible when the parent list has not refreshed yet.
  for (const asset of resolved.values()) options.onAssetReady(asset);
  let completedThisAttempt = 0;
  try {
    for (const sourceId of needsCopy) {
      options.assertCurrent();
      const key = journalKey(sourceId);
      let attempt = options.journal.get(key);
      if (!attempt) {
        attempt = { idempotencyKey: options.makeId(sourceId) };
        options.journal.set(key, attempt);
      }
      const result = await options.copyAsset(sourceId, attempt.idempotencyKey);
      if (
        result.copy.sourceAssetId !== sourceId ||
        result.copy.targetProjectId !== options.projectId ||
        result.copy.copiedAssetId !== result.asset.id ||
        result.asset.projectId !== options.projectId ||
        result.asset.id === sourceId
      )
        throw new Error('复制回执与来源或目标项目不一致，未采用该素材。');
      // Preserve an acknowledged copy even if the user left during the request.
      // A later retry validates it against a fresh, authorized project listing.
      attempt.copiedAssetId = result.asset.id;
      completedThisAttempt++;
      options.assertCurrent();
      resolved.set(sourceId, result.asset);
      options.onAssetReady(result.asset);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '请求未完成，请重试。';
    throw new Error(
      t(
        '参考图尚未完整准备，草案没有切换。{copies}重试会核验并复用已完成的副本，不会丢弃参考图。{reason}',
        {
          copies: completedThisAttempt
            ? t('本次已确认的 {count} 张副本保留在目标项目。', { count: completedThisAttempt })
            : '',
          reason: t(reason),
        },
      ),
      { cause: error },
    );
  }
  options.assertCurrent();
  const referenceAssets = draft.referenceAssetIds.map((sourceId) => {
    const asset = resolved.get(sourceId);
    if (!asset) throw new Error('参考图未完整准备，草案仍待确认。');
    return asset;
  });
  const prepared: PreparedGenerationDraft = {
    ...draft,
    referenceAssetIds: referenceAssets.map((asset) => asset.id),
    referenceAssets,
  };
  let committed = false;
  return () => {
    if (committed) return;
    options.assertCurrent();
    committed = true;
    return options.commit(prepared);
  };
}
