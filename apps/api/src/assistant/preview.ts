import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import type { Queryable } from '@ai-xiutu/db';
import {
  getEditorOutputDimensions,
  getEditorPreProjectiveDimensions,
  MAX_TILED_DIMENSION,
  MAX_V4_PIXELS,
  parseEditorRecipe,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import { needsNativeSpatialCheck, recipeHash } from '@ai-xiutu/assistant';
import type { AssistantContext } from '@ai-xiutu/contracts';
import type { ImageModerator } from '@ai-xiutu/providers';
import { HttpError } from '../core.js';
import type { LocalPrivateStorage } from '../storage.js';
import { normalizeSharedImage, validateContext } from './context.js';

let active = 0;
let nativeActive = false;
interface PixelMeasurements {
  width: number;
  height: number;
  visiblePixels: number;
  meanLuma: number;
  lumaDeviation: number;
  blackFraction: number;
  whiteFraction: number;
}
interface CandidatePixelObservation {
  before: PixelMeasurements;
  after: PixelMeasurements;
  changedPixels: number | null;
  meanAbsoluteDelta: number | null;
  imageSha256: string;
  fidelity: string;
  fullResolutionChecked: boolean;
}
const maxPreviewBytes = 32 * 1024 * 1024;
export async function inspectCandidatePixels(
  db: Queryable,
  storage: LocalPrivateStorage,
  moderator: ImageModerator,
  actorId: string,
  projectId: string,
  context: AssistantContext,
  candidate: EditorRecipe,
) {
  if (!context.imageDataUrl)
    throw new HttpError(403, 'IMAGE_SHARING_REQUIRED', '需要先允许共享当前画面');
  if (active >= 2) throw new HttpError(429, 'PREVIEW_BUSY', '图像检查繁忙，请稍后再试');
  active++;
  let native = false;
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await validateContext(db, actorId, projectId, context);
    const parsed = parseEditorRecipe(candidate),
      base = parseEditorRecipe(context.recipe);
    native = needsNativeSpatialCheck(base, parsed);
    if (native && nativeActive) {
      native = false;
      throw new HttpError(429, 'NATIVE_PREVIEW_BUSY', '原尺寸图像检查繁忙，请稍后再试');
    }
    if (native) nativeActive = true;
    const layers = [base, parsed].flatMap((recipe) =>
      'imageLayers' in recipe ? recipe.imageLayers : [],
    );
    const ids = [...new Set([context.assetId, ...layers.map((layer) => layer.sourceId)])];
    const found = await db.query(
      `SELECT a.id,a.storage_key,a.content_hash,a.width,a.height,a.bytes,
        EXISTS (SELECT 1 FROM media_sources s WHERE s.asset_id=a.id AND s.released_at IS NULL) AS retained
      FROM assets a WHERE a.id=ANY($1::uuid[]) AND a.project_id=$2 AND a.deleted_at IS NULL`,
      [ids, projectId],
    );
    if (found.rowCount !== ids.length)
      throw new HttpError(403, 'PREVIEW_SOURCE_UNAVAILABLE', '检查所需素材已不可用');
    const enabled = new Set(
      layers.filter((layer) => layer.enabled && layer.opacity > 0).map((layer) => layer.sourceId),
    );
    const source = found.rows.find((asset) => asset.id === context.assetId)!;
    const assets = found.rows.filter((asset) => asset.id === source.id || enabled.has(asset.id));
    const pixels = (item: { width: number; height: number }) => item.width * item.height;
    if (native) {
      const layerPixels = assets.reduce((total, asset) => total + pixels(asset), -pixels(source));
      try {
        const raster = [...assets];
        const dimensions = [base, parsed].flatMap((recipe) => [
          getEditorOutputDimensions(source, recipe),
          getEditorPreProjectiveDimensions(source, recipe),
        ]);
        const workingBytes =
          (3 * pixels(source) +
            layerPixels +
            dimensions.reduce((total, size) => total + pixels(size), 0)) *
          4;
        if (
          layerPixels > MAX_V4_PIXELS ||
          workingBytes > 320 * 1024 * 1024 ||
          [...raster, ...dimensions].some(
            (item) =>
              pixels(item) > MAX_V4_PIXELS ||
              Math.max(item.width, item.height) > MAX_TILED_DIMENSION,
          )
        )
          throw new RangeError();
      } catch {
        throw new HttpError(
          413,
          'NATIVE_PREVIEW_BUDGET',
          '原尺寸画面、几何输出或图层超出当前检查预算',
        );
      }
    }
    const inputs: { id: string; width: number; height: number; bytes: Uint8Array }[] = [];
    let bytes = 0;
    for (const asset of assets) {
      const length = Number(asset.bytes);
      if (!Number.isSafeInteger(length) || length < 1 || length > maxPreviewBytes - bytes)
        throw new HttpError(413, 'PREVIEW_INPUT_BUDGET', '检查所需素材超出当前预算');
      const content = await storage.readBytes(asset.storage_key, length).catch(() => {
        throw new HttpError(409, 'PREVIEW_SOURCE_CHANGED', '读取冻结的检查素材失败');
      });
      if (
        content.length !== length ||
        createHash('sha256').update(content).digest('hex') !== asset.content_hash
      )
        throw new HttpError(409, 'PREVIEW_SOURCE_CHANGED', '检查素材与保存时的内容摘要不符');
      bytes += length;
      inputs.push({
        id: asset.id,
        width: asset.width,
        height: asset.height,
        bytes: Uint8Array.from(content),
      });
    }
    worker = new Worker(new URL('./preview-worker.mjs', import.meta.url), {
      execArgv: ['--import', 'tsx'],
      resourceLimits: { maxOldGenerationSizeMb: 192 },
      workerData: {
        inputs,
        sourceId: source.id,
        decodeLimit: native ? MAX_V4_PIXELS : storage.capabilities().maxPixels,
        base,
        candidate: parsed,
        fullResolution: native,
      },
      transferList: inputs.map((input) => input.bytes.buffer as ArrayBuffer),
    });
    const result = await new Promise<{ bytes: Uint8Array; observation: CandidatePixelObservation }>(
      (resolve, reject) => {
        timer = setTimeout(
          () => reject(new HttpError(408, 'PREVIEW_TIMEOUT', '图像检查超时，未修改作品')),
          native ? 30000 : 15000,
        );
        worker!.once('message', resolve);
        worker!.once('error', () =>
          reject(new HttpError(422, 'PREVIEW_RENDER_FAILED', '图像检查无法完成')),
        );
        worker!.once('exit', () =>
          reject(new HttpError(422, 'PREVIEW_RENDER_FAILED', '图像检查提前结束')),
        );
      },
    );
    await validateContext(db, actorId, projectId, context);
    const imageDataUrl = await normalizeSharedImage(
      `data:image/jpeg;base64,${Buffer.from(result.bytes).toString('base64')}`,
      moderator,
    );
    await validateContext(db, actorId, projectId, context);
    return {
      observation: {
        ...result.observation,
        sourceKind: source.retained ? 'retained-proxy' : 'canonical',
        fidelity:
          result.observation.fidelity +
          (source.retained ? ' The editable source is a retained-media proxy.' : ''),
        inspectedRecipeHash: recipeHash(parsed),
        imageSha256: createHash('sha256')
          .update(Buffer.from(imageDataUrl.split(',')[1]!, 'base64'))
          .digest('hex'),
      },
      imageDataUrl,
    };
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    if (native) nativeActive = false;
    active--;
  }
}
