import { constants, createReadStream } from 'node:fs';
import {
  mkdir, open, readFile, rm, lstat, readdir, statfs, type FileHandle,
} from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NEUTRAL_PRECISION_EDIT, parsePrecisionEdit, type PrecisionEdit } from '@ai-xiutu/editor';
import {
  processMedia,
  exportMedia,
  createLinearWindowRuntime,
  getMediaCapabilities,
  hasDisplayHdr,
  fitsGainMapRaster,
  MediaProcessingError,
  MEDIA_MAX_INPUT_BYTES,
  MEDIA_MAX_PIXELS,
  MEDIA_MAX_PRECISION_PIXELS,
  MEDIA_MAX_LINEAR_PIXELS,
  MEDIA_MAX_PREVIEW_EDGE,
  MEDIA_MAX_SIDE,
  MEDIA_MIN_GAIN_MAP_SIDE,
  MEDIA_MAX_GAIN_MAP_SIDE,
  type MediaDescriptorV1,
  type MediaExportFormat,
  type MediaExportResult,
  type MediaGradeRevision,
  type MediaPrecisionInput,
  type MediaPrecisionPreview,
} from '@ai-xiutu/media';
import {
  transaction,
  audit,
  emit,
  lockAssetStorageKeys,
  discardUnreferencedStorageKeys,
  type Database,
  type Queryable,
} from '@ai-xiutu/db';
import { LocalPrivateStorage } from './storage.js';
import type { AppConfig } from './config.js';
import {
  HttpError,
  requireUser,
  projectAccess,
  lockProjectMutation,
  assetDto,
  id,
  hash,
} from './core.js';

const CHUNK_BYTES = 4 * 1024 * 1024;
const DOWNLOAD_TTL_MS = 60_000;
const exportExtension = {
  png16: 'png',
  tiff16: 'tiff',
  exr32: 'exr',
  jpeg: 'jpeg',
  webp: 'webp',
  ultrahdr: 'jpg',
};
const safeName = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\x00-\x1f\x7f/\\]/.test(value));
const jobParams = z.object({ id });
const sourceDigest = z.string().regex(/^[a-f0-9]{64}$/);
const precisionInputSchema = z.enum(['master16', 'linear-master']);
const gradeVersionSchema = z.number().int().min(1).max(2_147_483_647);
const windowSchema = z
  .object({
    left: z.number().int().min(0).max(65_535),
    top: z.number().int().min(0).max(65_535),
    width: z.number().int().min(1).max(MEDIA_MAX_PREVIEW_EDGE),
    height: z.number().int().min(1).max(MEDIA_MAX_PREVIEW_EDGE),
  })
  .strict();
const ultraHdrCropSchema = windowSchema.extend({
  width: z.number().int().min(MEDIA_MIN_GAIN_MAP_SIDE).max(MEDIA_MAX_GAIN_MAP_SIDE),
  height: z.number().int().min(MEDIA_MIN_GAIN_MAP_SIDE).max(MEDIA_MAX_GAIN_MAP_SIDE),
});
const fittedWindowSchema = windowSchema.extend({
  width: z.number().int().min(1).max(MEDIA_MAX_SIDE),
  height: z.number().int().min(1).max(MEDIA_MAX_SIDE),
});
interface MediaAccess {
  project_id: string;
  object_id: string;
  descriptor: MediaDescriptorV1;
  canEdit: boolean;
}
interface MasterDownload {
  assetId: string;
  actorId: string;
  sessionHash: string;
  source: MediaAccess;
  input: MediaPrecisionInput;
  result: MediaExportResult;
  file: FileHandle;
  expiresAt: number;
  expiry: NodeJS.Timeout;
}
interface GradeRow {
  version: number;
  source_sha256: string;
  precision_input: MediaPrecisionInput;
  edit: unknown;
  created_at: Date;
}
function gradeDto(row: GradeRow): MediaGradeRevision {
  return {
    version: row.version,
    sourceSha256: row.source_sha256,
    precisionInput: row.precision_input,
    edit: parsePrecisionEdit(row.edit),
    createdAt: row.created_at.toISOString(),
  };
}
const checksum = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const jobDto = (row: Record<string, any>) => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  size: Number(row.expected_bytes),
  uploadedBytes: Number(row.uploaded_bytes),
  state: row.state,
  assetId: row.asset_id,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  updatedAt: row.updated_at,
  maxChunkBytes: CHUNK_BYTES,
});
async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('MEDIA_SYMLINK');
    if (entry.isDirectory()) total += await directoryBytes(path);
    else if (entry.isFile()) total += (await lstat(path)).size;
    else throw new Error('MEDIA_SPECIAL_FILE');
  }
  return total;
}
async function releaseReservation(tx: Queryable, row: Record<string, any>) {
  const amount = Number(row.reservation_bytes);
  if (!amount) return;
  await tx.query(
    'UPDATE space_storage_accounts SET media_reserved_bytes=media_reserved_bytes-$2,updated_at=clock_timestamp() WHERE space_id=(SELECT space_id FROM projects WHERE id=$1)',
    [row.project_id, amount],
  );
  await tx.query('UPDATE media_import_jobs SET reservation_bytes=0 WHERE id=$1', [row.id]);
}

/** Resumable bounded uploads. No browser paths/URLs/native commands are accepted. */
export function registerMediaImport(app: FastifyInstance, db: Database, config: AppConfig) {
  const storage = new LocalPrivateStorage(config);
  const root = join(config.storageDir, 'media-v1');
  const inputs = join(root, 'uploads');
  const inputPath = (jobId: string) => join(inputs, `${id.parse(jobId)}.upload`);
  const workDir = (jobId: string) => join(root, id.parse(jobId));
  const active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  const exporting = new Set<string>();
  const windowing = new Set<string>();
  const attachmentHolders = new Set<string>();
  const downloads = new Map<string, MasterDownload>();
  const enabled = process.env.MEDIA_ADVANCED_ENABLED === 'true';
  const pythonExecutable = process.env.MEDIA_PYTHON;
  const ultraHdrLibrary = process.env.MEDIA_UHDR_LIBRARY;
  const heicDecoder = process.env.MEDIA_HEIC_DECODER;
  const linearWindows = enabled && pythonExecutable ? createLinearWindowRuntime() : undefined;
  const maxPixels = process.env.MEDIA_RASTER_MAX_PIXELS
    ? z.coerce
        .number()
        .int()
        .min(1)
        .max(MEDIA_MAX_PIXELS)
        .parse(process.env.MEDIA_RASTER_MAX_PIXELS)
    : undefined;
  const capabilities = getMediaCapabilities({
    pythonExecutable,
    ultraHdrLibrary,
    heicDecoder,
    maxPixels,
  });
  let closing = false;
  function takeDownload(downloadId: string, download: MasterDownload) {
    if (downloads.get(downloadId) !== download) return false;
    downloads.delete(downloadId);
    clearTimeout(download.expiry);
    return true;
  }
  async function discardDownload(downloadId: string, download: MasterDownload) {
    if (!takeDownload(downloadId, download)) return;
    try {
      await download.file.close();
    } finally {
      attachmentHolders.delete(download.actorId);
    }
  }
  async function assertAvailable() {
    if (!enabled || !(await capabilities).available)
      throw new HttpError(
        503,
        'MEDIA_NOT_CONFIGURED',
        '高精度素材处理尚未启用，请联系运营配置 Linux 隔离处理环境。',
      );
  }
  async function jobAccess(tx: Queryable, jobId: string, actor: string, authHash?: string) {
    const row = (
      await tx.query('SELECT * FROM media_import_jobs WHERE id=$1 AND actor_id=$2', [jobId, actor])
    ).rows[0];
    if (!row) throw new HttpError(404, 'IMPORT_NOT_FOUND', '导入任务不存在');
    if (authHash !== undefined) {
      await lockProjectMutation(tx, row.project_id, actor, authHash);
      return (
        await tx.query('SELECT * FROM media_import_jobs WHERE id=$1 AND actor_id=$2 FOR UPDATE', [
          jobId,
          actor,
        ])
      ).rows[0]!;
    }
    await projectAccess(tx, row.project_id, actor, 'edit');
    return row;
  }
  async function failJob(jobId: string, code: string, message: string) {
    await transaction(db, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `media-object:${jobId}`,
      ]);
      const row = (
        await tx.query('SELECT * FROM media_import_jobs WHERE id=$1 FOR UPDATE', [jobId])
      ).rows[0];
      if (
        !row ||
        row.state === 'ready' ||
        (await tx.query('SELECT 1 FROM media_objects WHERE id=$1', [jobId])).rowCount
      )
        return;
      if (code === 'IMPORT_INTERRUPTED') {
        const age = Date.now() - new Date(row.updated_at).getTime();
        if (
          (row.state === 'uploading' && age < 30 * 60_000) ||
          (row.state === 'processing' && age < 5 * 60_000) ||
          !['uploading', 'processing', 'cancelled'].includes(row.state)
        )
          return;
      }
      await releaseReservation(tx, row);
      await tx.query(
        "UPDATE media_import_jobs SET state=CASE WHEN state='cancelled' THEN state ELSE 'failed' END,error_code=$2,error_message=$3,updated_at=clock_timestamp() WHERE id=$1",
        [jobId, code, message],
      );
      // All publication paths use the same lock. If the database state is unknown,
      // this transaction fails and private files are preserved for reconciliation.
      await rm(inputPath(jobId), { force: true });
      await rm(workDir(jobId), { recursive: true, force: true });
    });
  }
  async function runJob(row: Record<string, any>, signal: AbortSignal) {
    let storedKey: string | undefined;
    const heartbeat = setInterval(() => {
      // A cancel from another API process is a durable cancellation request.
      // Its reservation remains until this decoder has actually stopped.
      void db
        .query(
          "UPDATE media_import_jobs SET updated_at=clock_timestamp() WHERE id=$1 AND state IN ('processing','cancelled') RETURNING state",
          [row.id],
        )
        .then(({ rows }) => {
          if (rows[0]?.state !== 'processing') active.get(row.id)?.controller.abort();
        })
        .catch(() => undefined);
    }, 10000);
    heartbeat.unref();
    try {
      const runtime = await capabilities;
      const descriptor = await processMedia({
        inputPath: inputPath(row.id),
        workDir: workDir(row.id),
        originalName: row.name,
        signal,
        options: {
          pythonExecutable,
          ultraHdrLibrary: runtime.ultraHdrJpeg.available ? ultraHdrLibrary : undefined,
          heicDecoder: runtime.heicPq.available ? heicDecoder : undefined,
          maxPixels,
          generateTiles: row.generate_tiles,
        },
      });
      const retainedBytes = await directoryBytes(workDir(row.id));
      const proxy = await readFile(join(workDir(row.id), descriptor.proxy.relativePath));
      const stored = await storage.storeGenerated(proxy);
      storedKey = stored.key;
      await transaction(db, async (tx) => {
        const project = await lockProjectMutation(tx, row.project_id, row.actor_id);
        await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
          `media-object:${row.id}`,
        ]);
        await lockAssetStorageKeys(tx, [stored.key]);
        const current = (
          await tx.query('SELECT * FROM media_import_jobs WHERE id=$1 FOR UPDATE', [row.id])
        ).rows[0];
        if (current?.state !== 'processing' || signal.aborted)
          throw new HttpError(409, 'IMPORT_CANCELLED', '导入已取消');
        await releaseReservation(tx, current);
        await tx.query('INSERT INTO media_objects(id,descriptor,retained_bytes) VALUES($1,$2,$3)', [
          row.id,
          JSON.stringify(descriptor),
          retainedBytes,
        ]);
        const asset = (
          await tx.query(
            'INSERT INTO assets(project_id,name,storage_key,mime,width,height,bytes,content_hash,created_by,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
            [
              row.project_id,
              row.name,
              stored.key,
              stored.mime,
              stored.width,
              stored.height,
              stored.bytes,
              stored.hash,
              row.actor_id,
              JSON.stringify({
                kind: 'media-import',
                protocol: 'media-v1',
                sourceSha256: descriptor.sourceSha256,
                sourceWidth: descriptor.original.width,
                sourceHeight: descriptor.original.height,
                sourceBitDepth: descriptor.original.bitDepth,
                sourceColorSpace: descriptor.original.colorSpace,
                editorProxy: true,
              }),
            ],
          )
        ).rows[0]!;
        await tx.query(
          'INSERT INTO media_sources(asset_id,object_id,retained_bytes) VALUES($1,$2,$3)',
          [asset.id, row.id, retainedBytes],
        );
        await tx.query(
          "UPDATE media_import_jobs SET state='ready',asset_id=$2,updated_at=clock_timestamp() WHERE id=$1",
          [row.id, asset.id],
        );
        await emit(tx, project.space_id, row.project_id, 'asset.created', asset.id);
        await audit(tx, row.actor_id, 'media.import', 'asset', asset.id, {
          sourceHash: descriptor.sourceSha256,
          retainedBytes,
          pixels: descriptor.original.width * descriptor.original.height,
          editorProxyPixels: stored.width * stored.height,
        });
      });
      await rm(inputPath(row.id), { force: true });
    } catch (error) {
      const code =
        error instanceof MediaProcessingError
          ? `MEDIA_${error.code.toUpperCase()}`
          : error instanceof HttpError
            ? error.code
            : (error as { message?: string })?.message?.includes('SPACE_STORAGE_LIMIT')
              ? 'SPACE_STORAGE_LIMIT'
              : 'MEDIA_PROCESSING_FAILED';
      const message =
        code === 'SPACE_STORAGE_LIMIT'
          ? '保留原件、母版和图块后的容量超过空间额度；请调整空间存储额度后重新导入。'
          : code === 'MEDIA_UNSUPPORTED'
            ? '此文件的格式、位深或解码器暂不可用，原编辑器内容未改变。'
            : code === 'MEDIA_LIMIT' || code === 'MEDIA_TIMEOUT'
              ? '此文件超出隔离处理资源预算，请使用较小副本或调整部署资源。'
              : code === 'IMPORT_CANCELLED'
                ? '导入已取消。'
                : '导入未完成，未覆盖任何原有素材。请检查格式与处理环境后重新导入。';
      try {
        await failJob(row.id, code, message);
      } catch {
        process.stderr.write('{"event":"media_import_reconciliation_required"}\n');
      }
      if (storedKey)
        try {
          await discardUnreferencedStorageKeys(db, [storedKey], (key) => storage.discard(key));
        } catch {
          /* preserve uncertain private bytes */
        }
    } finally {
      clearInterval(heartbeat);
    }
  }
  function launch(row: Record<string, any>) {
    if (active.has(row.id) || closing) return;
    const controller = new AbortController();
    const promise = runJob(row, controller.signal).finally(() => {
      active.delete(row.id);
    });
    active.set(row.id, { controller, promise });
  }
  const cleanup = setInterval(() => {
    if (closing) return;
    void db
      .query(
        "SELECT id FROM media_import_jobs WHERE (state='uploading' AND updated_at<clock_timestamp()-interval '30 minutes') OR (state IN ('processing','cancelled') AND updated_at<clock_timestamp()-interval '5 minutes' AND (reservation_bytes>0 OR state='processing')) LIMIT 20",
      )
      .then(async ({ rows }) => {
        for (const row of rows)
          if (!active.has(row.id))
            await failJob(row.id, 'IMPORT_INTERRUPTED', '导入因超时或服务重启中断，请重新导入。');
      })
      .catch(() => undefined);
  }, 30000);
  cleanup.unref();
  app.addHook('onClose', async () => {
    closing = true;
    clearInterval(cleanup);
    for (const value of active.values()) value.controller.abort();
    await linearWindows?.close();
    await Promise.allSettled(
      [...downloads].map(([key, download]) => discardDownload(key, download)),
    );
    await Promise.allSettled([...active.values()].map((value) => value.promise));
  });

  app.get('/v1/media-capabilities', async () => ({
    ...(await capabilities),
    enabled,
    available: enabled && (await capabilities).available,
    maxChunkBytes: CHUNK_BYTES,
    retention:
      'original-and-master-retained; logical charges include copies; soft deletion does not reclaim originals',
  }));
  app.post('/v1/projects/:id/media-imports', async (req, reply) => {
    await assertAvailable();
    const actor = requireUser(req);
    const params = jobParams.parse(req.params);
    const body = z
      .object({
        name: safeName,
        size: z.number().int().min(1).max(MEDIA_MAX_INPUT_BYTES),
        idempotencyKey: id,
        generateTiles: z.boolean().default(true),
      })
      .strict()
      .parse(req.body);
    const requestHash = hash(
      JSON.stringify({
        name: body.name,
        size: body.size,
        generateTiles: body.generateTiles,
        projectId: params.id,
      }),
    );
    await mkdir(inputs, { recursive: true, mode: 0o700 });
    const disk = await statfs(inputs);
    if (Number(disk.bavail) * Number(disk.bsize) < body.size * 2 + 2 * 1024 ** 3)
      throw new HttpError(
        503,
        'MEDIA_DISK_BUDGET',
        '服务器临时磁盘空间不足，当前不能安全接收高精度素材。',
      );
    const result = await transaction(db, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('media-import-admission',0))");
      const project = await lockProjectMutation(
        tx,
        params.id,
        actor.id,
        hash(req.cookies.xiutu_session ?? ''),
      );
      const previous = (
        await tx.query('SELECT * FROM media_import_jobs WHERE actor_id=$1 AND idempotency_key=$2', [
          actor.id,
          body.idempotencyKey,
        ])
      ).rows[0];
      if (previous) {
        if (previous.request_hash !== requestHash)
          throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', '这个导入标识已用于另一个文件');
        return previous;
      }
      if (
        (
          await tx.query(
            "SELECT 1 FROM media_import_jobs WHERE actor_id=$1 AND (state IN ('uploading','processing') OR (state='cancelled' AND reservation_bytes>0))",
            [actor.id],
          )
        ).rowCount
      )
        throw new HttpError(409, 'IMPORT_BUSY', '请先完成或等待取消中的导入清理完成');
      if (
        Number(
          (
            await tx.query(
              "SELECT count(*) AS n FROM media_import_jobs WHERE state IN ('uploading','processing') OR (state='cancelled' AND reservation_bytes>0)",
            )
          ).rows[0]!.n,
        ) >= 4
      )
        throw new HttpError(
          503,
          'IMPORT_QUEUE_FULL',
          '当前有 4 个大文件导入占用临时容量，请稍后再试',
        );
      await tx.query(
        'INSERT INTO space_storage_accounts(space_id) VALUES($1) ON CONFLICT DO NOTHING',
        [project.space_id],
      );
      if (
        !(
          await tx.query(
            'UPDATE space_storage_accounts SET media_reserved_bytes=media_reserved_bytes+$2 WHERE space_id=$1 AND retained_bytes+media_reserved_bytes+$2<=max_bytes AND retained_assets<max_assets',
            [project.space_id, body.size],
          )
        ).rowCount
      )
        throw new HttpError(409, 'SPACE_STORAGE_LIMIT', '空间容量不足以预留这份原件，请先调整额度');
      return (
        await tx.query(
          'INSERT INTO media_import_jobs(project_id,actor_id,idempotency_key,request_hash,name,expected_bytes,generate_tiles,reservation_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$6) RETURNING *',
          [
            params.id,
            actor.id,
            body.idempotencyKey,
            requestHash,
            body.name,
            body.size,
            body.generateTiles,
          ],
        )
      ).rows[0]!;
    });
    return reply.code(201).send({ job: jobDto(result) });
  });
  app.get('/v1/media-imports/:id', async (req) => {
    const actor = requireUser(req);
    const { id: jobId } = jobParams.parse(req.params);
    const row = await jobAccess(db, jobId, actor.id);
    const asset = row.asset_id
      ? (await db.query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL', [row.asset_id]))
          .rows[0]
      : null;
    return { job: jobDto(row), asset: asset ? assetDto(asset) : null };
  });
  app.register(async (chunks) => {
    chunks.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: CHUNK_BYTES },
      (_request, body, done) => done(null, body),
    );
    chunks.put('/v1/media-imports/:id/chunk', { bodyLimit: CHUNK_BYTES }, async (req) => {
      await assertAvailable();
      const actor = requireUser(req);
      const { id: jobId } = jobParams.parse(req.params);
      const { offset } = z
        .object({ offset: z.coerce.number().int().nonnegative().max(MEDIA_MAX_INPUT_BYTES) })
        .strict()
        .parse(req.query);
      if (!Buffer.isBuffer(req.body) || !req.body.length || req.body.length > CHUNK_BYTES)
        throw new HttpError(400, 'CHUNK_INVALID', '上传分片不能为空或超过 4 MiB');
      const bytes = req.body;
      return transaction(db, async (tx) => {
        const row = await jobAccess(tx, jobId, actor.id, hash(req.cookies.xiutu_session ?? ''));
        if (row.state !== 'uploading')
          throw new HttpError(409, 'IMPORT_STATE', '当前任务不再接受上传');
        const uploaded = Number(row.uploaded_bytes);
        if (offset > uploaded || offset + bytes.length > Number(row.expected_bytes))
          throw new HttpError(409, 'CHUNK_OFFSET', '上传位置不一致，请读取任务进度后续传', {
            uploadedBytes: uploaded,
          });
        await mkdir(inputs, { recursive: true, mode: 0o700 });
        const file = await open(
          inputPath(jobId),
          constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          if (offset < uploaded) {
            if (offset + bytes.length > uploaded)
              throw new HttpError(409, 'CHUNK_OVERLAP', '分片不能跨过已经确认的边界');
            const old = Buffer.alloc(bytes.length);
            const read = await file.read(old, 0, old.length, offset);
            if (read.bytesRead !== bytes.length || checksum(old) !== checksum(bytes))
              throw new HttpError(
                409,
                'CHUNK_MISMATCH',
                '此位置已上传不同的数据，请取消后重新导入',
              );
          } else {
            // Rollback/crash may leave an uncommitted tail: only confirmed bytes survive.
            await file.truncate(uploaded);
            let written = 0;
            while (written < bytes.length) {
              const part = await file.write(
                bytes,
                written,
                bytes.length - written,
                offset + written,
              );
              if (!part.bytesWritten) throw new Error('SHORT_WRITE');
              written += part.bytesWritten;
            }
            await file.sync();
            await tx.query(
              'UPDATE media_import_jobs SET uploaded_bytes=$2,updated_at=clock_timestamp() WHERE id=$1',
              [jobId, offset + bytes.length],
            );
          }
        } finally {
          await file.close();
        }
        return {
          uploadedBytes: Math.max(uploaded, offset + bytes.length),
          chunkSha256: checksum(bytes),
        };
      });
    });
  });
  app.post('/v1/media-imports/:id/complete', async (req, reply) => {
    await assertAvailable();
    const actor = requireUser(req);
    const { id: jobId } = jobParams.parse(req.params);
    const row = await transaction(db, async (tx) => {
      const current = await jobAccess(tx, jobId, actor.id, hash(req.cookies.xiutu_session ?? ''));
      if (current.state === 'ready' || current.state === 'processing')
        return { ...current, launchNew: false };
      if (
        current.state !== 'uploading' ||
        Number(current.uploaded_bytes) !== Number(current.expected_bytes)
      )
        throw new HttpError(409, 'IMPORT_INCOMPLETE', '文件尚未完整上传');
      return {
        ...(
          await tx.query(
            "UPDATE media_import_jobs SET state='processing',updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
            [jobId],
          )
        ).rows[0]!,
        launchNew: true,
      };
    });
    if (row.launchNew) launch(row);
    return reply.code(202).send({ job: jobDto(row) });
  });
  app.post('/v1/media-imports/:id/cancel', async (req) => {
    const actor = requireUser(req);
    const { id: jobId } = jobParams.parse(req.params);
    const cancellation = await transaction(db, async (tx) => {
      const row = await jobAccess(tx, jobId, actor.id, hash(req.cookies.xiutu_session ?? ''));
      if (row.state === 'ready')
        throw new HttpError(409, 'IMPORT_COMPLETE', '素材已导入，取消不会删除已发布的原件');
      // A repeat must not erase the evidence that another process still owns
      // an in-flight decoder, or keep extending an orphan's cleanup deadline.
      const cleanupPending =
        row.state === 'processing' ||
        (row.state === 'cancelled' && Number(row.reservation_bytes) > 0);
      if (row.state !== 'cancelled')
        await tx.query(
          "UPDATE media_import_jobs SET state='cancelled',updated_at=clock_timestamp() WHERE id=$1",
          [jobId],
        );
      if (!cleanupPending) await releaseReservation(tx, row);
      return { cleanupPending };
    });
    const running = active.get(jobId);
    if (running) {
      running.controller.abort();
      await running.promise;
    } else if (!cancellation.cleanupPending)
      await failJob(jobId, 'IMPORT_CANCELLED', '导入已取消。');
    const current = (
      await db.query('SELECT reservation_bytes FROM media_import_jobs WHERE id=$1', [jobId])
    ).rows[0];
    return { ok: true, cleanupPending: Number(current?.reservation_bytes ?? 0) > 0 };
  });
  async function sourceAccess(
    assetId: string,
    actor: string,
    tx: Queryable = db,
  ): Promise<MediaAccess> {
    const row = (
      await tx.query<{
        project_id: string;
        object_id: string;
        descriptor: MediaDescriptorV1;
      }>(
        'SELECT a.project_id,m.object_id,o.descriptor FROM media_sources m JOIN assets a ON a.id=m.asset_id JOIN media_objects o ON o.id=m.object_id WHERE m.asset_id=$1 AND a.deleted_at IS NULL AND m.released_at IS NULL AND o.purged_at IS NULL',
        [assetId],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, 'MEDIA_NOT_FOUND', '此素材没有可用的原件保留记录');
    const access = await projectAccess(tx, row.project_id, actor);
    return { ...row, canEdit: ['owner', 'admin', 'editor'].includes(access.role) };
  }
  async function grade(assetId: string, version: number | undefined, tx: Queryable = db) {
    const row = (
      await tx.query<GradeRow>(
        `SELECT version,source_sha256,precision_input,edit,created_at FROM media_grade_revisions
         WHERE asset_id=$1 AND ($2::integer IS NULL OR version=$2) ORDER BY version DESC LIMIT 1`,
        [assetId, version ?? null],
      )
    ).rows[0];
    return row ? gradeDto(row) : null;
  }
  async function assertPrecision(
    row: MediaAccess,
    expectedDigest: string | undefined,
    input: MediaPrecisionInput,
    edit?: PrecisionEdit,
    preview?: MediaPrecisionPreview,
  ) {
    if (expectedDigest !== row.descriptor.sourceSha256)
      throw new HttpError(409, 'MEDIA_SOURCE_CHANGED', '母版来源已变化，请重新打开素材。');
    if (edit && edit.algorithm !== 'scene-linear-v1' && input !== 'linear-master')
      throw new HttpError(
        422,
        'MEDIA_FLOAT_INPUT',
        edit.algorithm === 'scene-linear-v2'
          ? '场景线性曲线需要线性母版作为调色输入。'
          : '场景线性局部调色需要线性母版作为输入。',
      );
    const master = input === 'linear-master' ? row.descriptor.linearMaster : row.descriptor.master;
    if (!master || (input === 'linear-master' && !(await capabilities).nativeReady))
      throw new HttpError(422, 'MEDIA_FLOAT_UNAVAILABLE', '线性母版或浮点运行环境不可用。');
    if (preview?.region && preview.fitRegion)
      throw new HttpError(422, 'MEDIA_PREVIEW_WINDOW', '请选择一种预览区域模式。');
    const region = preview?.region ?? preview?.fitRegion;
    if (region) {
      if (
        region.left + region.width > master.width ||
        region.top + region.height > master.height ||
        (preview?.region && (region.width > preview.maxEdge || region.height > preview.maxEdge))
      )
        throw new HttpError(422, 'MEDIA_PREVIEW_WINDOW', '预览区域超出母版或预览尺寸。');
      if (preview?.fitRegion && region.width * region.height > MEDIA_MAX_PRECISION_PIXELS)
        throw new HttpError(413, 'MEDIA_PRECISION_BUDGET', '适屏区域超过当前调色预算。');
    } else if (
      master.width * master.height >
      (input === 'linear-master' ? MEDIA_MAX_LINEAR_PIXELS : MEDIA_MAX_PRECISION_PIXELS)
    ) {
      throw new HttpError(413, 'MEDIA_PRECISION_BUDGET', '母版超过当前整图调色预算。');
    }
  }
  app.get('/v1/assets/:id/media', async (req) => {
    const actor = requireUser(req);
    const { id: assetId } = jobParams.parse(req.params);
    const row = await sourceAccess(assetId, actor.id);
    const runtime = await capabilities;
    const precision = runtime.precisionEditing;
    const currentGrade = await grade(assetId, undefined);
    const ultraHdrSource =
      enabled && hasDisplayHdr(row.descriptor.original) && runtime.ultraHdrJpeg.available;
    return {
      descriptor: row.descriptor,
      downloads: {
        original: `/v1/assets/${assetId}/media/original`,
        master: `/v1/assets/${assetId}/media/master`,
        linearMaster: row.descriptor.linearMaster
          ? `/v1/assets/${assetId}/media/linearMaster`
          : null,
        tiles: row.descriptor.tiles ? `/v1/assets/${assetId}/media/tiles.dzi` : null,
      },
      editor: {
        bitDepth: 8,
        colorSpace: 'sRGB',
        proxy: true,
        masterExportIncludesRecipe: false,
        precisionEditing: {
          ...precision,
          master16: enabled && precision.master16,
          sourceSha256: row.descriptor.sourceSha256,
          floatAvailable: enabled && !!row.descriptor.linearMaster && precision.linearFloat,
          ultraHdrJpeg: ultraHdrSource && fitsGainMapRaster(row.descriptor.master),
          ultraHdrJpegCrop: ultraHdrSource,
          curves: {
            ...precision.curves,
            available: enabled && !!row.descriptor.linearMaster && precision.curves.available,
          },
          regions: {
            ...precision.regions,
            available: enabled && !!row.descriptor.linearMaster && precision.regions.available,
          },
          canSave: enabled && precision.master16 && row.canEdit,
          currentGrade,
        },
      },
    };
  });
  app.get('/v1/assets/:id/media/grades', async (req) => {
    const actor = requireUser(req);
    const { id: assetId } = jobParams.parse(req.params);
    const { beforeVersion } = z
      .object({
        beforeVersion: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
      })
      .strict()
      .parse(req.query);
    await sourceAccess(assetId, actor.id);
    const { rows } = await db.query<GradeRow>(
      `SELECT version,source_sha256,precision_input,edit,created_at FROM media_grade_revisions
       WHERE asset_id=$1 AND ($2::integer IS NULL OR version<$2) ORDER BY version DESC LIMIT 31`,
      [assetId, beforeVersion ?? null],
    );
    const grades = rows.slice(0, 30).map(gradeDto);
    return { grades, nextBeforeVersion: rows.length > 30 ? grades.at(-1)!.version : null };
  });
  app.post('/v1/assets/:id/media/grades', async (req, reply) => {
    await assertAvailable();
    const actor = requireUser(req);
    const { id: assetId } = jobParams.parse(req.params);
    const body = z
      .object({
        expectedVersion: z.number().int().min(0).max(2_147_483_646),
        expectedSourceSha256: sourceDigest,
        precisionInput: precisionInputSchema,
        precisionEdit: z.unknown(),
      })
      .strict()
      .parse(req.body);
    const edit = parsePrecisionEdit(body.precisionEdit);
    const row = await sourceAccess(assetId, actor.id);
    if (!row.canEdit) throw new HttpError(403, 'PROJECT_FORBIDDEN', '没有此项目的操作权限');
    await assertPrecision(row, body.expectedSourceSha256, body.precisionInput, edit);
    const result = await transaction(db, async (tx) => {
      await lockProjectMutation(
        tx,
        row.project_id,
        actor.id,
        hash(req.cookies.xiutu_session ?? ''),
      );
      await tx.query('SELECT id FROM assets WHERE id=$1 AND project_id=$2 FOR UPDATE', [
        assetId,
        row.project_id,
      ]);
      const current = await sourceAccess(assetId, actor.id, tx);
      if (
        current.object_id !== row.object_id ||
        current.descriptor.sourceSha256 !== body.expectedSourceSha256
      )
        throw new HttpError(409, 'MEDIA_SOURCE_CHANGED', '母版来源已变化，请重新打开素材。');
      if (((await grade(assetId, undefined, tx))?.version ?? 0) !== body.expectedVersion)
        throw new HttpError(409, 'VERSION_CONFLICT', '母版调色版本已有更新，请重新加载版本。');
      const { rows } = await tx.query<GradeRow>(
        `INSERT INTO media_grade_revisions(asset_id,version,source_sha256,precision_input,edit)
         VALUES ($1,$2,$3,$4,$5) RETURNING version,source_sha256,precision_input,edit,created_at`,
        [assetId, body.expectedVersion + 1, body.expectedSourceSha256, body.precisionInput, edit],
      );
      return gradeDto(rows[0]!);
    });
    return reply.code(201).send({ grade: result });
  });
  app.get('/v1/assets/:id/media/:kind', async (req, reply) => {
    const actor = requireUser(req);
    const params = z
      .object({ id, kind: z.enum(['original', 'master', 'linearMaster', 'tiles.dzi']) })
      .parse(req.params);
    const row = await sourceAccess(params.id, actor.id);
    const item = params.kind === 'tiles.dzi' ? row.descriptor.tiles : row.descriptor[params.kind];
    if (!item) throw new HttpError(404, 'MEDIA_NOT_FOUND', '此素材没有图块');
    const path = join(workDir(row.object_id), item.relativePath);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new HttpError(404, 'MEDIA_NOT_FOUND', '文件不可用');
    const name =
      params.kind === 'original'
        ? row.descriptor.originalName
        : `${params.id}-${params.kind}${params.kind === 'master' ? '.tiff' : params.kind === 'linearMaster' ? '.exr' : ''}`;
    const encodedName = encodeURIComponent(name).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return reply
      .type(params.kind === 'tiles.dzi' ? 'application/xml' : 'application/octet-stream')
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header(
        'Content-Disposition',
        `${params.kind === 'tiles.dzi' ? 'inline' : 'attachment'}; filename="${params.id}-${params.kind}"; filename*=UTF-8''${encodedName}`,
      )
      .header('Content-Length', String(stat.size))
      .send(createReadStream(path));
  });
  app.get('/v1/assets/:id/media/tiles_files/:level/:tile', async (req, reply) => {
    const actor = requireUser(req);
    const params = z
      .object({
        id,
        level: z.coerce.number().int().min(0).max(30),
        tile: z.string().regex(/^\d{1,6}_\d{1,6}\.jpe?g$/),
      })
      .parse(req.params);
    const row = await sourceAccess(params.id, actor.id);
    const tile = row.descriptor.tiles;
    if (!tile || params.level >= tile.levels)
      throw new HttpError(404, 'TILE_NOT_FOUND', '图块不存在');
    const path = join(workDir(row.object_id), tile.directory, String(params.level), params.tile);
    let stat;
    try {
      stat = await lstat(path);
    } catch {
      throw new HttpError(404, 'TILE_NOT_FOUND', '图块不存在');
    }
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new HttpError(404, 'TILE_NOT_FOUND', '图块不存在');
    return reply
      .type('image/jpeg')
      .header('Cache-Control', 'private, no-store')
      .header('Content-Length', String(stat.size))
      .send(createReadStream(path));
  });
  async function assertCurrentExport(
    assetId: string,
    actorId: string,
    sessionHash: string,
    source: MediaAccess,
    input: MediaPrecisionInput,
    result: MediaExportResult,
  ) {
    const current = await sourceAccess(assetId, actorId);
    if (
      current.object_id !== source.object_id ||
      current.descriptor.sourceSha256 !== source.descriptor.sourceSha256 ||
      (input === 'linear-master' &&
        current.descriptor.linearMaster?.sha256 !== source.descriptor.linearMaster?.sha256) ||
      result.sourceSha256 !== source.descriptor.sourceSha256
    )
      throw new HttpError(409, 'MEDIA_SOURCE_CHANGED', '母版来源已变化，请重新打开素材。');
    const activeSession = await db.query(
      "SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>clock_timestamp() AND u.status='active'",
      [sessionHash, actorId],
    );
    if (!activeSession.rowCount)
      throw new HttpError(401, 'AUTH_REQUIRED', '登录已失效，请重新登录');
  }

  function streamMaster(
    reply: FastifyReply,
    stream: Readable,
    result: MediaExportResult,
    input: MediaPrecisionInput,
    disposition: string,
  ) {
    reply.raw.once('close', () => stream.destroy());
    return reply
      .type(result.mime)
      .header('X-Editor-Recipe-Included', 'false')
      .header('X-Precision-Input', input)
      .header('X-Precision-Edit-SHA256', result.precisionEdit?.sha256 ?? 'none')
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', disposition)
      .header('Content-Length', String(result.bytes))
      .send(stream);
  }

  async function sendMaster(
    req: FastifyRequest,
    reply: FastifyReply,
    assetId: string,
    actorId: string,
    row: MediaAccess,
    options: {
      format: MediaExportFormat;
      quality: number;
      precisionEdit?: PrecisionEdit;
      precisionInput?: MediaPrecisionInput;
      preview?: MediaPrecisionPreview;
      crop?: MediaPrecisionPreview['region'];
      delivery?: 'attachment';
    },
  ) {
    const attachment = options.delivery === 'attachment';
    const nativeWindow =
      !!linearWindows && !!options.preview?.region && options.precisionInput === 'linear-master';
    const lane = nativeWindow ? windowing : exporting;
    if (
      lane.has(actorId) || lane.size >= 2 ||
      (attachment && (attachmentHolders.has(actorId) || attachmentHolders.size >= 2))
    )
      throw new HttpError(429, 'MEDIA_EXPORT_BUSY', '已有母版转换正在处理，请等待完成后再试。');
    lane.add(actorId);
    if (attachment) attachmentHolders.add(actorId);
    // Master conversion remains separate from the RGBA8 editor; never imply a
    // high-bit round trip of the browser recipe. Result is private and temporary.
    const outputPath = join(root, `${randomUUID()}.export`);
    const controller = new AbortController();
    const abortExport = () => controller.abort();
    req.raw.once('aborted', abortExport);
    req.raw.socket.once('close', abortExport);
    if (req.raw.aborted) controller.abort();
    let handedOff = false;
    try {
      const result = await exportMedia(
        {
          workDir: workDir(row.object_id),
          outputPath,
          format: options.format,
          precisionEdit: options.precisionEdit,
          precisionInput: options.precisionInput,
          preview: options.preview,
          crop: options.crop,
          signal: controller.signal,
          options: {
            quality: options.quality,
            timeoutMs: 45000,
            ...(pythonExecutable ? { pythonExecutable } : {}),
          },
        },
        linearWindows ? { runtime: linearWindows, descriptor: row.descriptor } : undefined,
      );
      const sessionHash = hash(req.cookies.xiutu_session ?? '');
      const input = options.precisionInput ?? 'master16';
      await assertCurrentExport(assetId, actorId, sessionHash, row, input, result);
      if (controller.signal.aborted)
        throw new HttpError(409, 'MEDIA_EXPORT_CANCELLED', '母版请求已取消。');
      if (attachment) {
        const file = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await file.stat();
          if (!info.isFile() || info.size !== result.bytes) throw new Error('MEDIA_EXPORT_CHANGED');
          // The held descriptor owns these bytes. Expiry or process exit releases them.
          await rm(outputPath);
          if (controller.signal.aborted)
            throw new HttpError(409, 'MEDIA_EXPORT_CANCELLED', '母版请求已取消。');
        } catch (error) {
          await file.close();
          throw error;
        }
        const downloadId = randomUUID(),
          expiresAt = Date.now() + DOWNLOAD_TTL_MS;
        const expiry = setTimeout(() => {
          const entry = downloads.get(downloadId);
          if (entry) void discardDownload(downloadId, entry).catch(() => {});
        }, DOWNLOAD_TTL_MS).unref();
        downloads.set(downloadId, {
          assetId,
          actorId,
          sessionHash,
          source: row,
          input,
          result,
          file,
          expiresAt,
          expiry,
        });
        handedOff = true;
        return reply.code(201).send({ downloadId, expiresAt: new Date(expiresAt).toISOString() });
      }
      const stream = createReadStream(outputPath);
      const release = () => {
        if (handedOff) lane.delete(actorId);
        handedOff = false;
      };
      stream.once('end', release);
      stream.once('close', () => {
        release();
        void rm(outputPath, { force: true }).catch(() => {});
      });
      handedOff = true;
      return streamMaster(
        reply,
        stream,
        result,
        input,
        options.preview
          ? 'inline'
          : `attachment; filename="${assetId}-master.${exportExtension[result.format]}"`,
      );
    } catch (error) {
      await rm(outputPath, { force: true });
      if (error instanceof MediaProcessingError)
        throw new HttpError(
          error.code === 'limit' ? 413 : 422,
          'MASTER_EXPORT_FAILED',
          '母版转换未完成，此格式或资源预算不适用。',
        );
      throw error;
    } finally {
      req.raw.off('aborted', abortExport);
      req.raw.socket.off('close', abortExport);
      if (attachment || !handedOff) lane.delete(actorId);
      if (attachment && !handedOff) attachmentHolders.delete(actorId);
    }
  }
  app.post('/v1/assets/:id/media/preview', async (req, reply) => {
    await assertAvailable();
    const actor = requireUser(req);
    const { id: assetId } = jobParams.parse(req.params);
    const body = z
      .object({
        precisionInput: precisionInputSchema,
        precisionEdit: z.unknown().optional(),
        expectedSourceSha256: sourceDigest,
        maxEdge: z.number().int().min(128).max(MEDIA_MAX_PREVIEW_EDGE),
        region: windowSchema.optional(),
        fitRegion: fittedWindowSchema.optional(),
      })
      .strict()
      .parse(req.body);
    const row = await sourceAccess(assetId, actor.id);
    const preview = { maxEdge: body.maxEdge, region: body.region, fitRegion: body.fitRegion };
    const edit = parsePrecisionEdit(
      body.precisionEdit === undefined ? NEUTRAL_PRECISION_EDIT : body.precisionEdit,
    );
    await assertPrecision(row, body.expectedSourceSha256, body.precisionInput, edit, preview);
    return sendMaster(req, reply, assetId, actor.id, row, {
      format: 'png16',
      quality: 90,
      precisionInput: body.precisionInput,
      precisionEdit: edit,
      preview,
    });
  });
  app.post('/v1/assets/:id/media/export', async (req, reply) => {
    await assertAvailable();
    const actor = requireUser(req);
    const { id: assetId } = jobParams.parse(req.params);
    const body = z
      .object({
        format: z.enum(['png16', 'tiff16', 'jpeg', 'webp', 'exr32', 'ultrahdr']),
        quality: z.number().int().min(1).max(100).default(90),
        precisionEdit: z.unknown().optional(),
        precisionInput: precisionInputSchema.optional(),
        gradeVersion: gradeVersionSchema.optional(),
        expectedSourceSha256: sourceDigest.optional(),
        delivery: z.literal('attachment').optional(),
        crop: ultraHdrCropSchema.optional(),
      })
      .strict()
      .parse(req.body);
    const row = await sourceAccess(assetId, actor.id);
    const ultraHdr = body.format === 'ultrahdr';
    const floatFormat = ultraHdr || body.format === 'exr32';
    let precisionEdit =
      body.precisionEdit === undefined ? undefined : parsePrecisionEdit(body.precisionEdit);
    let precisionInput = body.precisionInput ?? (floatFormat ? 'linear-master' : 'master16');
    if (body.gradeVersion !== undefined) {
      if (precisionEdit || body.precisionInput)
        throw new HttpError(422, 'MEDIA_GRADE_INPUT', '请选择历史版本或当前调色参数。');
      const saved = await grade(assetId, body.gradeVersion);
      if (!saved) throw new HttpError(404, 'MEDIA_GRADE_NOT_FOUND', '母版调色版本不存在。');
      if (saved.sourceSha256 !== row.descriptor.sourceSha256)
        throw new HttpError(409, 'MEDIA_SOURCE_CHANGED', '母版来源已变化，请重新打开素材。');
      precisionEdit = saved.edit;
      precisionInput = saved.precisionInput;
    }
    if (floatFormat && precisionInput !== 'linear-master')
      throw new HttpError(
        422,
        'MEDIA_FLOAT_INPUT',
        'EXR 或 Ultra HDR JPEG 需要线性母版作为调色输入。',
      );
    if (
      ultraHdr &&
      (!hasDisplayHdr(row.descriptor.original) || !(await capabilities).ultraHdrJpeg.available)
    )
      throw new HttpError(
        422,
        'MEDIA_GAIN_MAP_UNAVAILABLE',
        '此素材没有可生成 HDR 增益图的线性母版。',
      );
    const crop = body.crop;
    if (
      crop &&
      (!ultraHdr ||
        crop.left + crop.width > row.descriptor.master.width ||
        crop.top + crop.height > row.descriptor.master.height)
    )
      throw new HttpError(422, 'MEDIA_EXPORT_CROP', '导出裁切超出素材尺寸或所选格式范围。');
    if (ultraHdr && !fitsGainMapRaster(crop ?? row.descriptor.master))
      throw new HttpError(413, 'MEDIA_GAIN_MAP_DIMENSIONS', '增益图 JPEG 超出输出尺寸，请选择裁切或 EXR。');
    if (precisionEdit || body.precisionInput || floatFormat)
      await assertPrecision(row, body.expectedSourceSha256, precisionInput, precisionEdit);
    return sendMaster(req, reply, assetId, actor.id, row, {
      format: body.format,
      quality: body.quality,
      precisionEdit,
      precisionInput,
      delivery: body.delivery,
      crop,
    });
  });
  app.get(
    '/v1/assets/:id/media/exports/:downloadId',
    { exposeHeadRoute: false },
    async (req, reply) => {
      const actor = requireUser(req);
      const params = jobParams.extend({ downloadId: id }).parse(req.params);
      const unavailable = () =>
        new HttpError(404, 'MEDIA_EXPORT_UNAVAILABLE', '下载已失效，请重新导出。');
      const download = downloads.get(params.downloadId);
      if (
        !download ||
        download.assetId !== params.id ||
        download.actorId !== actor.id ||
        download.sessionHash !== hash(req.cookies.xiutu_session ?? '')
      )
        throw unavailable();
      try {
        await assertCurrentExport(
          params.id, actor.id, download.sessionHash, download.source, download.input, download.result,
        );
        if (Date.now() >= download.expiresAt || !takeDownload(params.downloadId, download))
          throw unavailable();
      } catch (error) {
        await discardDownload(params.downloadId, download);
        throw error;
      }
      const stream = download.file.createReadStream();
      stream.once('close', () => attachmentHolders.delete(actor.id));
      const { result } = download;
      const filename = `${params.id}-${result.precisionEdit ? 'graded' : 'master'}.${exportExtension[result.format]}`;
      return streamMaster(reply, stream, result, download.input, `attachment; filename="${filename}"`);
    },
  );
  return { capabilities, enabled };
}
