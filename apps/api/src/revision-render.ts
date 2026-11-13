import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '@ai-xiutu/db';
import {
  getEditorOutputDimensions,
  getEditorPreProjectiveDimensions,
  MAX_TILED_DIMENSION,
  MAX_V3_PIXELS,
  parseEditorRecipe,
} from '@ai-xiutu/editor';
import { z } from 'zod';
import { hash, HttpError, id, projectAccess, rateLimit, requireUser } from './core.js';
import type { LocalPrivateStorage } from './storage.js';

const maxEncodedBytes = 72 * 1024 * 1024;
const maxWorkingBytes = 320 * 1024 * 1024;
const maxOutputBytes = 72 * 1024 * 1024;
const renderTimeMs = 30_000;
type AssetRow = {
  id: string;
  width: number;
  height: number;
  bytes: number | string;
  storage_key: string;
  content_hash: string;
  retained: boolean;
};
type Dimensions = { width: number; height: number };
const pixels = (image: Dimensions) => image.width * image.height;
const exceedsRaster = (image: Dimensions) =>
  !Number.isSafeInteger(pixels(image)) ||
  image.width < 1 ||
  image.height < 1 ||
  image.width > MAX_TILED_DIMENSION ||
  image.height > MAX_TILED_DIMENSION ||
  pixels(image) > MAX_V3_PIXELS;

function dimensionDto(image: Dimensions) {
  return { width: image.width, height: image.height };
}

async function authorizedRevision(db: Database, req: FastifyRequest) {
  const actor = requireUser(req);
  const { id: artworkId, revisionId } = z.object({ id, revisionId: id }).parse(req.params);
  const revision = (
    await db.query(
      `SELECT r.id,r.version,r.recipe,r.origin_kind,a.project_id,s.asset_id
      FROM revisions r JOIN artworks a ON a.id=r.artwork_id
      JOIN revision_sources s ON s.revision_id=r.id WHERE a.id=$1 AND r.id=$2 AND a.deleted_at IS NULL`,
      [artworkId, revisionId],
    )
  ).rows[0];
  if (!revision) throw new HttpError(404, 'REVISION_NOT_FOUND', '版本不存在');
  const authHash = hash(req.cookies.xiutu_session ?? '');
  const assertReadAccess = async () => {
    const session = await db.query(
      `SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND u.status='active'`,
      [authHash, actor.id],
    );
    if (!session.rowCount) throw new HttpError(401, 'AUTH_REQUIRED', '登录已失效，请重新登录');
    await projectAccess(db, revision.project_id, actor.id);
  };
  await assertReadAccess();
  const recipe = parseEditorRecipe(revision.recipe);
  const layers = 'imageLayers' in recipe ? recipe.imageLayers : [];
  const snapshots = (
    await db.query('SELECT layer_id,asset_id FROM revision_image_layers WHERE revision_id=$1', [
      revision.id,
    ])
  ).rows;
  // Revisions from before layer snapshots were introduced retain the immutable
  // recipe IDs. Every resolved asset is still constrained to this project.
  if (revision.origin_kind || snapshots.length) {
    const recorded = new Map(snapshots.map((row) => [row.layer_id, row.asset_id]));
    if (
      recorded.size !== layers.length ||
      layers.some((layer) => recorded.get(layer.id) !== layer.sourceId)
    )
      throw new HttpError(409, 'REVISION_LAYER_INCONSISTENT', '历史版本的图层来源不一致');
  }
  const ids = [...new Set([revision.asset_id as string, ...layers.map((layer) => layer.sourceId)])];
  if (ids.some((assetId) => !id.safeParse(assetId).success))
    throw new HttpError(409, 'REVISION_SOURCE_UNAVAILABLE', '历史版本的素材来源不完整');
  const rows = (
    await db.query<AssetRow>(
      `SELECT a.id,a.width,a.height,a.bytes,a.storage_key,a.content_hash,
        EXISTS(SELECT 1 FROM media_sources m WHERE m.asset_id=a.id AND m.released_at IS NULL) AS retained
      FROM assets a WHERE a.id=ANY($1::uuid[]) AND a.project_id=$2 AND a.deleted_at IS NULL`,
      [ids, revision.project_id],
    )
  ).rows;
  const source = rows.find((row) => row.id === revision.asset_id);
  if (!source || rows.length !== ids.length)
    throw new HttpError(409, 'REVISION_SOURCE_UNAVAILABLE', '历史版本的素材来源不完整');
  const enabled = new Set(
    layers.filter((layer) => layer.enabled && layer.opacity > 0).map((layer) => layer.sourceId),
  );
  const assets = rows.filter((row) => row.id === source.id || enabled.has(row.id));
  let output: Dimensions | null = null;
  let intermediate: Dimensions | null = null;
  const limits: string[] = [];
  try {
    output = getEditorOutputDimensions(source, recipe);
    intermediate = getEditorPreProjectiveDimensions(source, recipe);
  } catch {
    limits.push('GEOMETRY_UNAVAILABLE');
  }
  const encodedBytes = assets.reduce((sum, row) => sum + Number(row.bytes), 0);
  const layerPixels = assets.reduce((sum, row) => sum + pixels(row), -pixels(source));
  const workingBytes =
    (3 * pixels(source) +
      layerPixels +
      (output ? pixels(output) : 0) +
      Math.max(pixels(source), intermediate ? pixels(intermediate) : 0)) *
    4;
  if (exceedsRaster(source)) limits.push('SOURCE_RASTER_BUDGET');
  if (
    assets.some((row) => row.id !== source.id && exceedsRaster(row)) ||
    layerPixels > MAX_V3_PIXELS
  )
    limits.push('LAYER_RASTER_BUDGET');
  if ((output && exceedsRaster(output)) || (intermediate && exceedsRaster(intermediate)))
    limits.push('OUTPUT_RASTER_BUDGET');
  if (encodedBytes > maxEncodedBytes || !Number.isSafeInteger(encodedBytes) || encodedBytes < 1)
    limits.push('ENCODED_INPUT_BUDGET');
  if (workingBytes > maxWorkingBytes || !Number.isSafeInteger(workingBytes))
    limits.push('DECODED_WORKING_BUDGET');
  return {
    actor,
    recipe,
    assets,
    source,
    assertReadAccess,
    info: {
      artworkId,
      revisionId,
      version: revision.version as number,
      source: {
        assetId: source.id,
        ...dimensionDto(source),
        kind: source.retained ? 'retained-proxy' : 'canonical',
      },
      output: output && dimensionDto(output),
      pixelFormat: 'srgb-rgba8' as const,
      encodedBytes,
      estimatedWorkingBytes: workingBytes,
      available: limits.length === 0,
      limits,
      budget: { maxRasterPixels: MAX_V3_PIXELS, maxEncodedBytes, maxWorkingBytes },
    },
  };
}

async function renderPixels(
  plan: Awaited<ReturnType<typeof authorizedRevision>>,
  storage: LocalPrivateStorage,
  signal: AbortSignal,
) {
  const inputs: { id: string; width: number; height: number; bytes: Uint8Array }[] = [];
  let used = 0;
  for (const asset of plan.assets) {
    signal.throwIfAborted();
    const expected = Number(asset.bytes);
    let bytes;
    try {
      bytes = await storage.readBytes(
        asset.storage_key,
        Math.min(expected, maxEncodedBytes - used),
      );
    } catch {
      throw new HttpError(409, 'REVISION_SOURCE_UNAVAILABLE', '读取版本素材失败');
    }
    used += bytes.length;
    if (
      bytes.length !== expected ||
      createHash('sha256').update(bytes).digest('hex') !== asset.content_hash
    )
      throw new HttpError(409, 'REVISION_SOURCE_CHANGED', '版本素材与保存时的内容摘要不符');
    inputs.push({
      id: asset.id,
      width: asset.width,
      height: asset.height,
      bytes: Uint8Array.from(bytes),
    });
  }
  signal.throwIfAborted();
  const worker = new Worker(new URL('./revision-render-worker.mjs', import.meta.url), {
    execArgv: ['--import', 'tsx'],
    resourceLimits: { maxOldGenerationSizeMb: 192 },
    workerData: {
      inputs,
      sourceId: plan.source.id,
      recipe: plan.recipe,
      maxPixels: MAX_V3_PIXELS,
    },
    transferList: inputs.map((input) => input.bytes.buffer as ArrayBuffer),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const result = await new Promise<{ width: number; height: number; png: Uint8Array }>(
      (resolve, reject) => {
        abort = () => reject(new HttpError(408, 'RENDER_CANCELLED', '渲染已取消'));
        signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(
          () => reject(new HttpError(408, 'RENDER_TIMEOUT', '版本渲染超时')),
          renderTimeMs,
        );
        worker.once('message', (message) => {
          if (message.error === 'BUDGET')
            reject(new HttpError(413, 'RENDER_ALGORITHM_BUDGET', '配方计算超过此渲染执行器的预算'));
          else if (message.error)
            reject(new HttpError(422, 'RENDER_FAILED', '版本无法由当前图像执行器渲染'));
          else resolve(message);
        });
        worker.once('error', () => reject(new HttpError(422, 'RENDER_FAILED', '版本渲染执行失败')));
        worker.once('exit', () => reject(new HttpError(422, 'RENDER_FAILED', '版本渲染提前结束')));
        if (signal.aborted) abort();
      },
    );
    if (
      result.width !== plan.info.output?.width ||
      result.height !== plan.info.output?.height ||
      !result.png.byteLength ||
      result.png.byteLength > maxOutputBytes
    )
      throw new HttpError(422, 'RENDER_OUTPUT_MISMATCH', '版本渲染输出与计划不一致');
    return result;
  } finally {
    clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
    await worker.terminate();
  }
}

export function registerRevisionRender(
  app: FastifyInstance,
  db: Database,
  storage: LocalPrivateStorage,
) {
  const path = '/v1/artworks/:id/revisions/:revisionId';
  let running: AbortController | undefined;
  app.addHook('preClose', async () => running?.abort());
  app.get(path + '/render-info', async (req) => (await authorizedRevision(db, req)).info);
  app.get(path + '/render', { exposeHeadRoute: false }, async (req, reply) => {
    const plan = await authorizedRevision(db, req);
    if (!plan.info.available)
      throw new HttpError(
        413,
        'REVISION_RENDER_UNAVAILABLE',
        '此版本超出当前执行器的原尺寸预算',
        plan.info,
      );
    await rateLimit(db, 'revision-render:' + plan.actor.id, 12, 60);
    if (running) throw new HttpError(429, 'REVISION_RENDER_BUSY', '服务端版本渲染繁忙');
    const controller = new AbortController();
    const close = () => {
      if (!reply.raw.writableEnded) controller.abort();
    };
    reply.raw.once('close', close);
    running = controller;
    try {
      const result = await renderPixels(plan, storage, controller.signal);
      await plan.assertReadAccess();
      controller.signal.throwIfAborted();
      return reply
        .type('image/png')
        .header('Cache-Control', 'private, no-store')
        .header(
          'Content-Disposition',
          `attachment; filename="revision-${plan.info.revisionId}.png"`,
        )
        .header('X-Xiutu-Revision', plan.info.revisionId)
        .header('X-Xiutu-Pixel-Format', plan.info.pixelFormat)
        .send(Buffer.from(result.png.buffer, result.png.byteOffset, result.png.byteLength));
    } finally {
      running = undefined;
      reply.raw.off('close', close);
    }
  });
}
