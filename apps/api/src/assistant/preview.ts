import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import type { Queryable } from '@ai-xiutu/db';
import { parseEditorRecipe, type EditorRecipe } from '@ai-xiutu/editor';
import type { AssistantContext } from '@ai-xiutu/contracts';
import type { ImageModerator } from '@ai-xiutu/providers';
import { HttpError } from '../core.js';
import type { LocalPrivateStorage } from '../storage.js';
import { normalizeSharedImage, validateContext } from './context.js';

let active = 0;
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
}
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
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await validateContext(db, actorId, projectId, context);
    const parsed = parseEditorRecipe(candidate),
      base = parseEditorRecipe(context.recipe);
    const layerIds = [
      ...new Set(
        [base, parsed].flatMap((recipe) =>
          'imageLayers' in recipe ? recipe.imageLayers.map((layer) => layer.sourceId) : [],
        ),
      ),
    ];
    const ids = [...new Set([context.assetId, ...layerIds])];
    const found = await db.query(
      'SELECT id,storage_key FROM assets WHERE id=ANY($1::uuid[]) AND project_id=$2 AND deleted_at IS NULL',
      [ids, projectId],
    );
    if (found.rowCount !== ids.length)
      throw new HttpError(403, 'PREVIEW_SOURCE_UNAVAILABLE', '检查所需素材已不可用');
    const sources = new Map<string, Buffer>();
    let bytes = 0;
    for (const asset of found.rows) {
      const content = await storage.readBytes(asset.storage_key, 32 * 1024 * 1024);
      bytes += content.byteLength;
      if (bytes > 32 * 1024 * 1024)
        throw new HttpError(413, 'PREVIEW_INPUT_BUDGET', '检查所需素材超出当前预算');
      sources.set(asset.id, content);
    }
    worker = new Worker(new URL('./preview-worker.mjs', import.meta.url), {
      execArgv: ['--import', 'tsx'],
      resourceLimits: { maxOldGenerationSizeMb: 192 },
      workerData: {
        source: sources.get(context.assetId),
        layers: layerIds.map((id) => ({ id, bytes: sources.get(id) })),
        base,
        candidate: parsed,
      },
    });
    const result = await new Promise<{ bytes: Uint8Array; observation: CandidatePixelObservation }>(
      (resolve, reject) => {
        timer = setTimeout(
          () => reject(new HttpError(408, 'PREVIEW_TIMEOUT', '图像检查超时，未修改作品')),
          15000,
        );
        worker!.once('message', resolve);
        worker!.once('error', reject);
        worker!.once('exit', () => reject(new Error('PREVIEW_EXITED')));
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
        imageSha256: createHash('sha256')
          .update(Buffer.from(imageDataUrl.split(',')[1]!, 'base64'))
          .digest('hex'),
      },
      imageDataUrl,
    };
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
    active--;
  }
}
