import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  animationEditRequest,
  derivedAssetRequest,
  type AnimationDescriptor,
} from '@ai-xiutu/contracts';
import {
  discardUnreferencedStorageKeys,
  emit,
  lockAssetStorageKeys,
  transaction,
  type Database,
  type Queryable,
} from '@ai-xiutu/db';
import {
  MAX_CUTOUT_PIXELS,
  parseEditorRecipe,
  parseSelectionMaskV3,
  restorationCost,
} from '@ai-xiutu/editor';
import { syncStorageDirectory } from '@ai-xiutu/storage';
import {
  assetDto,
  hash,
  HttpError,
  id,
  lockProjectMutation,
  projectAccess,
  rateLimit,
  requireUser,
} from './core.js';
import type { AppConfig } from './config.js';
import type { LocalPrivateStorage } from './storage.js';

const maxEncoded = 48 * 1024 * 1024;
const maxGifBytes = 16 * 1024 * 1024;
const maxCollagePixels = 16_777_216;
let processing = 0;
export const assetProcessingCapabilities = () => ({
  protocolVersion: 1,
  sourcePixelFormat: 'srgb-rgba8',
  maxEncodedBytes: maxEncoded,
  cutout: {
    algorithms: ['ray-v1', 'guided-v2'],
    defaultAlgorithm: 'ray-v1',
    maxPixels: MAX_CUTOUT_PIXELS,
    maxUncertainPixels: 1_048_576,
    semanticSelectionRequired: true,
  },
  restoration: {
    algorithm: 'photo-restore-v1',
    maxPixels: 4_194_304,
    maxWork: 134_217_728,
    motionLengthUnit: 'source-pixels',
    maxMotionLength: 31,
    maxIterations: 12,
    unknownKernelEstimation: false,
  },
  collage: { maxPixels: maxCollagePixels, maxCells: 12 },
  persistence: 'immutable-derived-asset',
});

export type ProcessAsset = {
  id: string;
  project_id: string;
  storage_key: string;
  content_hash: string;
  width: number;
  height: number;
  bytes: string | number;
};
type WorkInput = { id?: string; width?: number; height?: number; bytes: Uint8Array };
type WorkResult = { png: Uint8Array; gif?: Uint8Array; descriptor?: AnimationDescriptor };
export async function findProcessAsset(db: Queryable, assetId: string) {
  const asset = (
    await db.query<ProcessAsset>('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL', [
      assetId,
    ])
  ).rows[0];
  if (!asset) throw new HttpError(404, 'ASSET_NOT_FOUND', '素材不存在');
  return asset;
}
export async function verifiedAssetBytes(
  storage: LocalPrivateStorage,
  asset: ProcessAsset,
  limit = maxEncoded,
) {
  const bytes = await storage.readBytes(asset.storage_key, limit);
  if (bytes.byteLength !== Number(asset.bytes) || hash(bytes) !== asset.content_hash)
    throw new HttpError(409, 'ASSET_SOURCE_CHANGED', '素材原始字节与来源摘要不一致');
  return bytes;
}

async function runWorker(
  req: FastifyRequest,
  kind: string,
  load: () => Promise<WorkInput[]>,
  settings?: unknown,
) {
  if (processing >= 2)
    throw new HttpError(503, 'ASSET_PROCESSING_BUSY', '素材处理繁忙，请稍后重试');
  processing++;
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    const inputs = await load();
    if (req.raw.aborted) throw new HttpError(408, 'ASSET_PROCESSING_CANCELLED', '素材处理已取消');
    worker = new Worker(new URL('./asset-processing-worker.mjs', import.meta.url), {
      execArgv: ['--import', 'tsx'],
      resourceLimits: { maxOldGenerationSizeMb: 192 },
      workerData: { kind, inputs, settings },
      transferList: inputs.map((input) => input.bytes.buffer as ArrayBuffer),
    });
    return await new Promise<WorkResult>((resolve, reject) => {
      const invalid = () =>
        reject(
          new HttpError(422, 'ASSET_PROCESSING_FAILED', '无法按指定参数处理素材，请检查图片和设置'),
        );
      cancel = () => reject(new HttpError(408, 'ASSET_PROCESSING_CANCELLED', '素材处理已取消'));
      req.raw.once('aborted', cancel);
      req.raw.socket.once('close', cancel);
      if (req.raw.aborted) cancel();
      timer = setTimeout(
        () => reject(new HttpError(408, 'ASSET_PROCESSING_TIMEOUT', '素材处理超时')),
        30_000,
      );
      worker!.once('message', (message: WorkResult & { error?: string }) => {
        if (message.error === 'BUDGET')
          reject(new HttpError(413, 'ASSET_PROCESSING_BUDGET', '计算或输出超出当前素材处理预算'));
        else if (message.error || !(message.png instanceof Uint8Array) || message.png.length < 16)
          invalid();
        else resolve(message);
      });
      worker!.once('error', invalid);
      worker!.once('exit', invalid);
    });
  } finally {
    clearTimeout(timer);
    if (cancel) {
      req.raw.off('aborted', cancel);
      req.raw.socket.off('close', cancel);
    }
    try {
      await worker?.terminate();
    } finally {
      processing--;
    }
  }
}

export function registerAssetProcessing(
  app: FastifyInstance,
  db: Database,
  config: AppConfig,
  storage: LocalPrivateStorage,
) {
  const folder = join(config.storageDir, 'animation-v1');
  const animationPath = (key: string) => join(folder, `${id.parse(key)}.gif`);
  async function previous(
    tx: Queryable,
    actorId: string,
    requestId: string,
    projectId: string,
    digest: string,
  ) {
    const row = (
      await tx.query(
        `SELECT a.*,d.request_hash, g.descriptor FROM asset_derivations d JOIN assets a ON a.id=d.asset_id
       LEFT JOIN animation_assets g ON g.asset_id=a.id WHERE d.actor_id=$1 AND d.request_id=$2`,
        [actorId, requestId],
      )
    ).rows[0];
    if (!row) return null;
    if (row.request_hash !== digest || row.project_id !== projectId || row.deleted_at)
      throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '操作标识已使用或生成的素材已删除');
    return { asset: assetDto(row), animation: row.descriptor ?? null, replayed: true };
  }
  async function sources(projectId: string, ids: string[]) {
    const rows = (
      await db.query<ProcessAsset>(
        'SELECT * FROM assets WHERE project_id=$1 AND id=ANY($2::uuid[]) AND deleted_at IS NULL ORDER BY id',
        [projectId, ids],
      )
    ).rows;
    if (rows.length !== ids.length) throw new HttpError(404, 'ASSET_NOT_FOUND', '项目素材不存在');
    return rows;
  }
  async function publish(
    req: FastifyRequest,
    projectId: string,
    requestId: string,
    digest: string,
    name: string,
    algorithm: string,
    parameters: unknown,
    inputs: ProcessAsset[],
    output: WorkResult,
  ) {
    const user = requireUser(req);
    const stored = await storage.storeGenerated(output.png);
    let storageName: string | null = null;
    let committed = false;
    try {
      if (output.gif && output.descriptor) {
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const key = randomUUID();
        const handle = await open(animationPath(key), 'wx', 0o600);
        storageName = key;
        try {
          await handle.writeFile(output.gif);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await syncStorageDirectory(folder);
      }
      const result = await transaction(db, async (tx) => {
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `asset-process:${user.id}:${requestId}`,
        ]);
        const project = await lockProjectMutation(
          tx,
          projectId,
          user.id,
          hash(req.cookies.xiutu_session ?? ''),
        );
        const replay = await previous(tx, user.id, requestId, projectId, digest);
        if (replay) return replay;
        await lockAssetStorageKeys(tx, [stored.key]);
        for (const input of inputs) {
          const locked = await tx.query(
            'SELECT id FROM assets WHERE id=$1 AND project_id=$2 AND content_hash=$3 AND deleted_at IS NULL FOR SHARE',
            [input.id, projectId, input.content_hash],
          );
          if (!locked.rowCount)
            throw new HttpError(409, 'ASSET_SOURCE_CHANGED', '处理期间来源素材已改变');
        }
        const lineage = inputs.map((input) => ({
          assetId: input.id,
          contentHash: input.content_hash,
        }));
        const row = (
          await tx.query(
            `INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by,provenance)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [
              projectId,
              name,
              stored.key,
              stored.mime,
              stored.width,
              stored.height,
              stored.bytes,
              stored.hash,
              user.id,
              JSON.stringify({
                kind: 'asset-derived',
                algorithm,
                ...(storageName ? { animation: true } : {}),
              }),
            ],
          )
        ).rows[0]!;
        await tx.query('INSERT INTO asset_derivations VALUES($1,$2,$3,$4,$5,$6,$7)', [
          row.id,
          user.id,
          requestId,
          digest,
          algorithm,
          JSON.stringify(lineage),
          JSON.stringify(parameters),
        ]);
        if (storageName && output.gif && output.descriptor)
          await tx.query('INSERT INTO animation_assets VALUES($1,$2,$3,$4,$5)', [
            row.id,
            storageName,
            hash(output.gif),
            output.gif.byteLength,
            JSON.stringify(output.descriptor),
          ]);
        await emit(tx, project.space_id, projectId, 'asset.created', row.id);
        return { asset: assetDto(row), animation: output.descriptor ?? null, replayed: false };
      });
      committed = !result.replayed;
      return result;
    } finally {
      if (!committed) {
        try {
          await discardUnreferencedStorageKeys(db, [stored.key], (key) => storage.discard(key));
          if (
            storageName &&
            !(await db.query('SELECT 1 FROM animation_assets WHERE storage_name=$1', [storageName]))
              .rowCount
          )
            await unlink(animationPath(storageName)).catch(() => {});
        } catch {
          process.stderr.write('{"event":"asset_processing_cleanup_deferred"}\n');
        }
      }
    }
  }

  app.post('/v1/projects/:id/derived-assets/quote', async (req) => {
    const user = requireUser(req),
      { id: projectId } = z.object({ id }).parse(req.params);
    const body = derivedAssetRequest.parse(req.body);
    await projectAccess(db, projectId, user.id, 'edit');
    await rateLimit(db, `derive-quote:${user.id}`, 90, 60);
    if (body.kind === 'cutout') {
      parseSelectionMaskV3(body.settings.selection);
      if (body.settings.foreground !== undefined) parseSelectionMaskV3(body.settings.foreground);
      if (body.settings.background !== undefined) parseSelectionMaskV3(body.settings.background);
    } else if (body.kind === 'restoration') {
      if (body.settings.selection !== undefined) parseSelectionMaskV3(body.settings.selection);
      if (body.settings.protection !== undefined) parseSelectionMaskV3(body.settings.protection);
    }
    const ids =
      body.kind === 'collage'
        ? [...new Set(body.cells.map((cell) => cell.assetId))]
        : [body.sourceAssetId];
    const assets = await sources(projectId, ids),
      limits: string[] = [];
    if (assets.some((asset) => asset.width * asset.height > MAX_CUTOUT_PIXELS))
      limits.push('SOURCE_PIXEL_BUDGET');
    const encodedBytes = assets.reduce((sum, asset) => sum + Number(asset.bytes), 0);
    if (encodedBytes > maxEncoded) limits.push('ENCODED_INPUT_BUDGET');
    const cost =
      body.kind === 'restoration'
        ? restorationCost(assets[0]!.width, assets[0]!.height, body.settings)
        : null;
    if (cost && !cost.available) limits.push('RESTORATION_WORK_BUDGET');
    if (
      body.kind === 'collage' &&
      (body.width * body.height > maxCollagePixels ||
        body.cells.reduce((sum, cell) => sum + cell.width * cell.height, 0) > 2 * maxCollagePixels)
    )
      limits.push('COLLAGE_OUTPUT_BUDGET');
    return {
      available: !limits.length,
      limits,
      encodedBytes,
      cost,
      sources: assets.map((asset) => ({
        assetId: asset.id,
        contentHash: asset.content_hash,
        width: asset.width,
        height: asset.height,
      })),
      checksDecodedPixels: false,
      reservesQuota: false,
    };
  });
  app.post('/v1/projects/:id/derived-assets', async (req, reply) => {
    const user = requireUser(req);
    const { id: projectId } = z.object({ id }).parse(req.params);
    const body = derivedAssetRequest.parse(req.body);
    await projectAccess(db, projectId, user.id, 'edit');
    await rateLimit(db, `derive-asset:${user.id}`, 30, 60);
    const settings =
      body.kind === 'cutout'
        ? {
            ...body.settings,
            selection: parseSelectionMaskV3(body.settings.selection),
            foreground:
              body.settings.foreground === undefined
                ? undefined
                : parseSelectionMaskV3(body.settings.foreground),
            background:
              body.settings.background === undefined
                ? undefined
                : parseSelectionMaskV3(body.settings.background),
          }
        : body.kind === 'restoration'
          ? {
              ...body.settings,
              selection:
                body.settings.selection === undefined
                  ? undefined
                  : parseSelectionMaskV3(body.settings.selection),
              protection:
                body.settings.protection === undefined
                  ? undefined
                  : parseSelectionMaskV3(body.settings.protection),
            }
          : {
              width: body.width,
              height: body.height,
              cells: body.cells,
              background: body.background,
            };
    const digest = hash(
      JSON.stringify([
        projectId,
        body.kind,
        body.name,
        body.kind !== 'collage' ? body.sourceAssetId : null,
        settings,
      ]),
    );
    const replay = await previous(db, user.id, body.requestId, projectId, digest);
    if (replay) return replay;
    const ids =
      body.kind !== 'collage'
        ? [body.sourceAssetId]
        : [...new Set(body.cells.map((cell) => cell.assetId))];
    const assets = await sources(projectId, ids);
    if (
      body.kind === 'restoration' &&
      !restorationCost(assets[0]!.width, assets[0]!.height, body.settings).available
    )
      throw new HttpError(
        413,
        'ASSET_PROCESSING_BUDGET',
        '修复工作量超过预算，请减少范围、运动长度或迭代次数',
      );
    if (
      assets.some((asset) => asset.width * asset.height > MAX_CUTOUT_PIXELS) ||
      assets.reduce((sum, asset) => sum + Number(asset.bytes), 0) > maxEncoded ||
      (body.kind === 'collage' &&
        (body.width * body.height > maxCollagePixels ||
          body.cells.reduce((sum, cell) => sum + cell.width * cell.height, 0) >
            2 * maxCollagePixels))
    )
      throw new HttpError(413, 'ASSET_PROCESSING_BUDGET', '素材尺寸或图层面积超过当前处理预算');
    const output = await runWorker(
      req,
      body.kind,
      async () => {
        const inputs: WorkInput[] = [];
        for (const asset of assets)
          inputs.push({
            id: asset.id,
            width: asset.width,
            height: asset.height,
            bytes: Uint8Array.from(await verifiedAssetBytes(storage, asset)),
          });
        return inputs;
      },
      settings,
    );
    const result = await publish(
      req,
      projectId,
      body.requestId,
      digest,
      body.name,
      body.kind === 'cutout'
        ? body.settings.algorithm === 'guided-v2'
          ? 'rgb-guided-trimap-v2'
          : 'linear-trimap-v1'
        : body.kind === 'restoration'
          ? 'photo-restore-v1'
          : 'collage-v1',
      settings,
      assets,
      output,
    );
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.get('/v1/assets/:id/derivation', async (req) => {
    const user = requireUser(req);
    const asset = await findProcessAsset(db, z.object({ id }).parse(req.params).id);
    await projectAccess(db, asset.project_id, user.id);
    const row = (
      await db.query(
        'SELECT algorithm,sources,parameters FROM asset_derivations WHERE asset_id=$1',
        [asset.id],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'DERIVATION_NOT_FOUND', '此素材没有派生记录');
    return { assetId: asset.id, ...row };
  });

  app.post('/v1/projects/:id/animations', async (req, reply) => {
    const user = requireUser(req);
    const { id: projectId } = z.object({ id }).parse(req.params);
    const { requestId } = z.object({ requestId: id }).strict().parse(req.query);
    await projectAccess(db, projectId, user.id, 'edit');
    await rateLimit(db, `animation:${user.id}`, 12, 60);
    const file = await req.file({ limits: { fileSize: maxGifBytes, files: 1, parts: 1 } });
    if (!file) throw new HttpError(400, 'FILE_REQUIRED', '请选择 GIF 动图');
    const bytes = await file.toBuffer();
    const name = file.filename.slice(0, 120) || 'animation.gif';
    const originalHash = hash(bytes);
    const digest = hash(JSON.stringify([projectId, name, originalHash]));
    const replay = await previous(db, user.id, requestId, projectId, digest);
    if (replay) return replay;
    const output = await runWorker(req, 'animation', async () => [
      { bytes: Uint8Array.from(bytes) },
    ]);
    const result = await publish(
      req,
      projectId,
      requestId,
      digest,
      name,
      'gif-v1',
      { originalHash },
      [],
      output,
    );
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  async function animationRecord(assetId: string) {
    const row = (await db.query('SELECT * FROM animation_assets WHERE asset_id=$1', [assetId]))
      .rows[0];
    if (!row) throw new HttpError(404, 'ANIMATION_NOT_FOUND', '动图不存在');
    return row;
  }
  async function animationBytes(row: Record<string, any>) {
    const path = animationPath(row.storage_name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile() || info.size !== row.bytes || info.size > maxGifBytes)
      throw new HttpError(409, 'ANIMATION_SOURCE_CHANGED', '动图字节不可用或已改变');
    const bytes = await readFile(path);
    if (bytes.length !== row.bytes || hash(bytes) !== row.content_hash)
      throw new HttpError(409, 'ANIMATION_SOURCE_CHANGED', '动图字节与来源摘要不一致');
    return bytes;
  }
  app.get('/v1/assets/:id/animation', async (req) => {
    const user = requireUser(req);
    const asset = await findProcessAsset(db, z.object({ id }).parse(req.params).id);
    await projectAccess(db, asset.project_id, user.id);
    const row = await animationRecord(asset.id);
    return {
      assetId: asset.id,
      animation: row.descriptor,
      url: `/v1/assets/${asset.id}/animation/file`,
    };
  });
  app.get('/v1/assets/:id/animation/file', async (req, reply) => {
    const user = requireUser(req);
    const asset = await findProcessAsset(db, z.object({ id }).parse(req.params).id);
    await projectAccess(db, asset.project_id, user.id);
    const bytes = await animationBytes(await animationRecord(asset.id));
    await findProcessAsset(db, asset.id);
    await projectAccess(db, asset.project_id, user.id);
    return reply
      .type('image/gif')
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .send(bytes);
  });
  app.post('/v1/assets/:id/animation/edit', async (req, reply) => {
    const user = requireUser(req);
    const asset = await findProcessAsset(db, z.object({ id }).parse(req.params).id);
    const body = animationEditRequest.parse(req.body);
    await projectAccess(db, asset.project_id, user.id, 'edit');
    await rateLimit(db, `animation:${user.id}`, 12, 60);
    const row = await animationRecord(asset.id);
    const { requestId, name, ...input } = body;
    const settings = {
      ...input,
      recipe: input.recipe === undefined ? undefined : parseEditorRecipe(input.recipe),
    };
    const digest = hash(JSON.stringify([asset.id, row.content_hash, name, settings]));
    const replay = await previous(db, user.id, requestId, asset.project_id, digest);
    if (replay) return replay;
    const output = await runWorker(
      req,
      'animation',
      async () => [{ bytes: Uint8Array.from(await animationBytes(row)) }],
      settings,
    );
    const result = await publish(
      req,
      asset.project_id,
      requestId,
      digest,
      name,
      'gif-v1',
      { ...settings, animationSourceHash: row.content_hash },
      [asset],
      output,
    );
    return reply.code(result.replayed ? 200 : 201).send(result);
  });
}
