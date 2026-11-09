import { mkdir, unlink, stat, readFile, writeFile, open, rename } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import sharp, { type OutputInfo } from 'sharp';

export interface StorageConfig {
  storageDir: string;
  maxPixels: number;
  maxUploadBytes: number;
}
export interface StoredImage {
  key: string;
  mime: 'image/png';
  width: number;
  height: number;
  bytes: number;
  hash: string;
}
export interface ThumbnailInfo {
  mime: 'image/webp';
  width: number;
  height: number;
  bytes: number;
}
export const MAX_CANONICAL_BYTES = 256 * 1024 * 1024;
export const MAX_SERVER_DIMENSION = 16384;
export type ServerImageFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'tiff';
// All instances in one process share admission, including API-created services.
let decodeBusy = false;
const decodeWaiters = new Set<() => void>();
const thumbnailTasks = new Map<string, Promise<ThumbnailInfo>>();
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
function releaseDecode() {
  decodeBusy = false;
  for (const wake of [...decodeWaiters]) wake();
}
async function acquireThumbnailSlot() {
  const deadline = Date.now() + 15000;
  while (decodeBusy) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new StorageError(503, 'MEDIA_BUSY', '缩略图处理繁忙，请稍后重试');
    await new Promise<void>((resolve, reject) => {
      const wake = () => {
        clearTimeout(timer);
        decodeWaiters.delete(wake);
        resolve();
      };
      const timer = setTimeout(() => {
        decodeWaiters.delete(wake);
        reject(new StorageError(503, 'MEDIA_BUSY', '缩略图处理繁忙，请稍后重试'));
      }, remaining);
      decodeWaiters.add(wake);
    });
  }
  decodeBusy = true;
}
sharp.concurrency(1);
sharp.cache({ memory: 32, files: 0, items: 32 });
export function serverImportFormats(): ServerImageFormat[] {
  const candidates: ServerImageFormat[] = ['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'];
  return candidates.filter((format) =>
    format === 'avif'
      ? sharp.format.heif.input.file && sharp.format.heif.input.fileSuffix?.includes('.avif')
      : sharp.format[format].input.file,
  );
}
export class StorageError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
/** Reject containers we do not support before invoking any decoder, including SVG/HEIC. */
function inspectContainer(bytes: Buffer): ServerImageFormat {
  let format: ServerImageFormat | undefined;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    format = 'jpeg';
  else if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    format = 'png';
    let offset = 8;
    let ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const end = offset + length + 12;
      if (length > 0x7fffffff || end > bytes.length)
        throw new StorageError(400, 'INVALID_IMAGE', 'PNG数据块不完整');
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (['acTL', 'fcTL', 'fdAT'].includes(type))
        throw new StorageError(
          415,
          'ANIMATED_IMAGE_UNSUPPORTED',
          '暂不支持动画图片，请提供静态副本',
        );
      offset = end;
      if (type === 'IEND') {
        ended = length === 0 && offset === bytes.length;
        break;
      }
    }
    if (!ended) throw new StorageError(400, 'INVALID_IMAGE', 'PNG结束数据不完整或含额外内容');
  } else if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    format = 'webp';
  else if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)))
    format = 'gif';
  else if (
    bytes.length >= 4 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && [42, 43].includes(bytes[2]!) && bytes[3] === 0) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0 && [42, 43].includes(bytes[3]!)))
  )
    format = 'tiff';
  else if (bytes.length >= 16 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    const size = bytes.readUInt32BE(0);
    if (size < 16 || size > bytes.length || size > 4096 || (size - 16) % 4 !== 0)
      throw new StorageError(400, 'INVALID_IMAGE', '图像容器类型信息无效');
    const brands = [bytes.toString('ascii', 8, 12)];
    for (let at = 16; at + 4 <= size; at += 4) brands.push(bytes.toString('ascii', at, at + 4));
    if (brands.includes('avis'))
      throw new StorageError(415, 'ANIMATED_IMAGE_UNSUPPORTED', '暂不支持AVIF序列，请提供静态副本');
    if (brands.includes('avif')) format = 'avif';
  }
  if (!format || !serverImportFormats().includes(format))
    throw new StorageError(
      415,
      'UNSUPPORTED_IMAGE',
      '当前服务器支持静态 JPEG、PNG、WebP、AVIF、GIF 与单页 TIFF；此格式或解码器不可用',
    );
  return format;
}
export class LocalPrivateStorage {
  private directory: string;
  constructor(private config: StorageConfig) {
    if (
      !config.storageDir ||
      !Number.isSafeInteger(config.maxPixels) ||
      config.maxPixels < 1 ||
      config.maxPixels > 64_000_000 ||
      !Number.isSafeInteger(config.maxUploadBytes) ||
      config.maxUploadBytes < 1024 ||
      config.maxUploadBytes > 50 * 1024 * 1024
    )
      throw new StorageError(500, 'INVALID_STORAGE_CONFIG', '私有存储配置无效');
    this.directory = resolve(config.storageDir);
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }
  capabilities() {
    return {
      serverImport: serverImportFormats(),
      canonical: 'png' as const,
      maxPixels: this.config.maxPixels,
      maxDimension: MAX_SERVER_DIMENSION,
      maxUploadBytes: this.config.maxUploadBytes,
      maxCanonicalBytes: MAX_CANONICAL_BYTES,
    };
  }
  path(key: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/.test(key))
      throw new StorageError(404, 'ASSET_NOT_FOUND', '资源不存在');
    return join(this.directory, key);
  }
  private acquire() {
    if (decodeBusy) throw new StorageError(503, 'MEDIA_BUSY', '正在处理另一张图片，请稍后重试');
    decodeBusy = true;
  }
  private async inspect(source: string) {
    if ((await stat(source)).size > this.config.maxUploadBytes)
      throw new StorageError(413, 'UPLOAD_TOO_LARGE', '图片超过上传大小限制');
    return inspectContainer(await readFile(source));
  }
  private async normalize(source: string, key: string): Promise<StoredImage> {
    const format = await this.inspect(source);
    const meta = await sharp(source, {
      limitInputPixels: this.config.maxPixels,
      failOn: 'warning',
      animated: true,
    }).metadata();
    if ((meta.pages ?? 1) > 1)
      throw new StorageError(
        415,
        'MULTIPAGE_IMAGE_UNSUPPORTED',
        '暂不支持动画或多页图片，请明确导出需要的单张图像',
      );
    if (
      !meta.width ||
      !meta.height ||
      meta.format !== (format === 'avif' ? 'heif' : format) ||
      (format === 'avif' && meta.compression !== 'av1')
    )
      throw new StorageError(415, 'UNSUPPORTED_IMAGE', '图像格式或解码器不符合当前支持范围');
    if (
      meta.width > MAX_SERVER_DIMENSION ||
      meta.height > MAX_SERVER_DIMENSION ||
      meta.width * meta.height > this.config.maxPixels
    )
      throw new StorageError(413, 'IMAGE_TOO_LARGE', '图片尺寸或像素超过当前容量');
    const destination = this.path(key);
    let info: OutputInfo | undefined;
    let bytes = 0;
    const digest = createHash('sha256');
    const output = sharp(source, { limitInputPixels: this.config.maxPixels, failOn: 'warning' })
      .rotate()
      .toColourspace('srgb')
      .png();
    output.on('info', (value) => {
      info = value;
    });
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_CANONICAL_BYTES)
          callback(
            new StorageError(
              413,
              'NORMALIZED_IMAGE_TOO_LARGE',
              '规范化PNG超过256MiB，请提供较小副本',
            ),
          );
        else {
          digest.update(chunk);
          callback(null, chunk);
        }
      },
    });
    await pipeline(output, limit, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    if (!info) throw new StorageError(400, 'INVALID_IMAGE', '图像解码未完成');
    const file = await open(destination, 'r');
    try {
      await file.sync();
    } finally {
      await file.close();
    }
    const directory = await open(this.directory, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return {
      key,
      mime: 'image/png',
      width: info.width,
      height: info.height,
      bytes,
      hash: digest.digest('hex'),
    };
  }
  async ingest(file: { file: Readable & { truncated?: boolean } }): Promise<StoredImage> {
    if (decodeBusy) {
      file.file.resume();
      throw new StorageError(503, 'MEDIA_BUSY', '正在处理另一张图片，请稍后重试');
    }
    this.acquire();
    const key = `${randomUUID()}.png`;
    const temporary = join(this.directory, `${randomUUID()}.upload`);
    let received = 0;
    const maximum = this.config.maxUploadBytes;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > maximum)
          callback(new StorageError(413, 'UPLOAD_TOO_LARGE', '图片超过上传大小限制'));
        else callback(null, chunk);
      },
    });
    try {
      await pipeline(
        file.file,
        limiter,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      if (file.file.truncated || (await stat(temporary)).size > this.config.maxUploadBytes)
        throw new StorageError(413, 'UPLOAD_TOO_LARGE', '图片超过上传大小限制');
      return await this.normalize(temporary, key);
    } catch (error) {
      await this.discard(key);
      if (error instanceof StorageError) throw error;
      throw new StorageError(400, 'INVALID_IMAGE', '图片无法安全解码，请检查格式或提供较小副本');
    } finally {
      releaseDecode();
      await unlink(temporary).catch(() => {});
    }
  }
  /** Unreferenced private file until caller has moderated THESE normalized bytes and committed an authorized asset. */
  async storeGenerated(bytes: Uint8Array): Promise<StoredImage> {
    if (bytes.byteLength < 16 || bytes.byteLength > this.config.maxUploadBytes)
      throw new StorageError(413, 'GENERATED_IMAGE_TOO_LARGE', '生成图像超过处理限制');
    this.acquire();
    const key = `${randomUUID()}.png`;
    const temporary = join(this.directory, `${randomUUID()}.generated`);
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      return await this.normalize(temporary, key);
    } catch (error) {
      await this.discard(key);
      if (error instanceof StorageError) throw error;
      throw new StorageError(400, 'INVALID_IMAGE', '生成图片无法安全解码');
    } finally {
      releaseDecode();
      await unlink(temporary).catch(() => {});
    }
  }
  async readBytes(key: string, maxBytes: number): Promise<Buffer> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_CANONICAL_BYTES)
      throw new StorageError(400, 'INVALID_READ_LIMIT', '读取上限无效');
    const filename = this.path(key);
    const size = (await stat(filename)).size;
    if (size > maxBytes) throw new StorageError(413, 'ASSET_TOO_LARGE', '资源超过此操作的大小限制');
    const bytes = await readFile(filename);
    if (bytes.byteLength > maxBytes)
      throw new StorageError(413, 'ASSET_TOO_LARGE', '资源超过此操作的大小限制');
    return bytes;
  }
  private thumbnailPath(key: string) {
    return this.path(key).slice(0, -4) + '.thumb.webp';
  }
  private async cachedThumbnail(key: string): Promise<ThumbnailInfo | null> {
    const filename = this.thumbnailPath(key);
    let file;
    try {
      file = await stat(filename);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new StorageError(503, 'THUMBNAIL_UNAVAILABLE', '缩略图暂不可读取');
    }
    if (!file.isFile() || file.size < 16 || file.size > MAX_THUMBNAIL_BYTES)
      throw new StorageError(503, 'THUMBNAIL_CACHE_INVALID', '缩略图缓存无效，请联系维护人员');
    try {
      const info = await sharp(filename, {
        limitInputPixels: 512 * 512,
        failOn: 'warning',
      }).metadata();
      if (
        info.format !== 'webp' ||
        !info.width ||
        !info.height ||
        info.width > 512 ||
        info.height > 512 ||
        (info.pages ?? 1) > 1
      )
        throw new Error('invalid thumbnail');
      return { mime: 'image/webp', width: info.width, height: info.height, bytes: file.size };
    } catch {
      throw new StorageError(503, 'THUMBNAIL_CACHE_INVALID', '缩略图缓存无效，请联系维护人员');
    }
  }
  private async createThumbnail(key: string): Promise<ThumbnailInfo> {
    await acquireThumbnailSlot();
    const temporary = join(this.directory, `${randomUUID()}.thumbnail`);
    try {
      const existing = await this.cachedThumbnail(key);
      if (existing) return existing;
      const { data, info } = await sharp(this.path(key), {
        limitInputPixels: this.config.maxPixels,
        failOn: 'warning',
      })
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 3 })
        .toBuffer({ resolveWithObject: true });
      if (info.width > 512 || info.height > 512 || data.length > MAX_THUMBNAIL_BYTES)
        throw new StorageError(400, 'THUMBNAIL_OUTPUT_INVALID', '缩略图超过当前处理限制');
      await writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
      const file = await open(temporary, 'r');
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.thumbnailPath(key));
      const directory = await open(this.directory, 'r');
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      return { mime: 'image/webp', width: info.width, height: info.height, bytes: data.length };
    } catch (error) {
      if (error instanceof StorageError) throw error;
      if ((error as NodeJS.ErrnoException).code)
        throw new StorageError(503, 'THUMBNAIL_UNAVAILABLE', '缩略图暂不可生成');
      throw new StorageError(400, 'THUMBNAIL_INVALID_SOURCE', '源图片无法生成缩略图');
    } finally {
      await unlink(temporary).catch(() => {});
      releaseDecode();
    }
  }
  /** Callers must check the current asset ACL for every request, including cache hits. */
  async thumbnail(key: string): Promise<ThumbnailInfo> {
    const path = this.thumbnailPath(key);
    const cached = await this.cachedThumbnail(key);
    if (cached) return cached;
    const running = thumbnailTasks.get(path);
    if (running) return running;
    if (thumbnailTasks.size >= 32)
      throw new StorageError(503, 'MEDIA_BUSY', '缩略图队列已满，请稍后重试');
    const task = this.createThumbnail(key);
    thumbnailTasks.set(path, task);
    try {
      return await task;
    } finally {
      thumbnailTasks.delete(path);
    }
  }
  thumbnailStream(key: string) {
    return createReadStream(this.thumbnailPath(key));
  }
  async discard(key: string) {
    await Promise.all([
      unlink(this.path(key)).catch(() => {}),
      unlink(this.thumbnailPath(key)).catch(() => {}),
    ]);
  }
  stream(key: string) {
    return createReadStream(this.path(key));
  }
}
export function createPrivateStorage(env: NodeJS.ProcessEnv = process.env) {
  return new LocalPrivateStorage({
    storageDir: env.STORAGE_DIR ?? '.data/private',
    maxPixels: Number(env.MAX_IMAGE_PIXELS ?? 40_000_000),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024),
  });
}
