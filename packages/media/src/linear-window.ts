import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, rename, statfs } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NEUTRAL_PRECISION_EDIT, type PrecisionEdit } from '@ai-xiutu/editor';
import { attachPngIcc, srgbProfile } from './icc.js';
import { precisionRecord, previewWindow } from './precision.js';
import type { NormalizedMediaOptions } from './process.js';
import {
  MEDIA_MAX_LINEAR_PIXELS,
  MEDIA_MAX_SIDE,
  MEDIA_PROTOCOL,
  MediaProcessingError,
  type MediaDescriptorV1,
  type MediaExportResult,
  type MediaPrecisionPreview,
  type MediaPrecisionWindow,
} from './types.js';

const MAX_WINDOW_FILE_BYTES = 40 * 1024 * 1024;
const WINDOW_IDLE_MS = 20_000;
const WINDOW_JOB_LIMIT = 256;
const aborted = () => new MediaProcessingError('Media operation cancelled', 'aborted');
const failed = () =>
  new MediaProcessingError('Isolated native window processing failed', 'processing');

interface NativeWindow {
  inputPath: string;
  inputBytes: number;
  inputSha256: string;
  outputPath: string;
  width: number;
  height: number;
  maxPixels: number;
  region: MediaPrecisionWindow;
  edit: PrecisionEdit;
  sdr: true;
}
interface WindowResult {
  width: number;
  height: number;
  channels: 3 | 4;
  bitDepth: 16;
}
interface PendingWindow {
  response: string;
  failure?: MediaProcessingError;
  finish: (error?: MediaProcessingError, result?: WindowResult) => void;
}

function startWindowProcess(python: string, memoryBytes: number) {
  const child = spawn(
    '/usr/bin/prlimit',
    [
      `--as=${memoryBytes}`,
      '--cpu=600',
      `--fsize=${MAX_WINDOW_FILE_BYTES}`,
      '--nofile=128',
      '--',
      python,
      '-B',
      fileURLToPath(new URL('../native/linear_window.py', import.meta.url)),
    ],
    {
      detached: true,
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LANG: 'C.UTF-8',
        TZ: 'UTC',
        OPENBLAS_NUM_THREADS: '1',
        OMP_NUM_THREADS: '1',
        MALLOC_ARENA_MAX: '2',
      },
    },
  );
  let pending: PendingWindow | undefined;
  let closing = false;
  let jobs = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const ended = new Promise<void>((done) => {
    child.once('close', (_code, signal) => {
      closing = true;
      clearTimeout(idle);
      const error =
        pending?.failure ??
        (signal === 'SIGXFSZ'
          ? new MediaProcessingError('Native window exceeded its output budget', 'limit')
          : failed());
      pending?.finish(error);
      pending = undefined;
      done();
    });
  });
  function stop(reason = failed()) {
    if (pending && !pending.failure) pending.failure = reason;
    if (!closing) {
      closing = true;
      clearTimeout(idle);
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // An already exited process still emits close.
        }
      }
    }
    return ended;
  }
  function scheduleIdle() {
    idle = setTimeout(() => void stop(), WINDOW_IDLE_MS);
    idle.unref();
  }
  scheduleIdle();
  child.on('error', () => void stop());
  child.stdin.on('error', () => void stop());
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (part: string) => {
    if (closing) return;
    if (!pending || pending.response.length + part.length > 512) {
      void stop();
      return;
    }
    pending.response += part;
    if (!pending.response.endsWith('\n')) return;
    let result: (WindowResult & { error?: string }) | undefined;
    try {
      result = JSON.parse(pending.response);
    } catch {
      void stop();
      return;
    }
    if (!result || typeof result !== 'object') {
      void stop();
      return;
    }
    const job = pending;
    pending = undefined;
    scheduleIdle();
    if (result.error) job.finish(failed());
    else job.finish(undefined, result);
  });
  return {
    accepts(executable: string, memory: number) {
      return !closing && python === executable && memoryBytes === memory && jobs < WINDOW_JOB_LIMIT;
    },
    stop,
    submit(request: NativeWindow, timeoutMs: number, signal?: AbortSignal) {
      if (closing || pending) return Promise.reject(failed());
      if (signal?.aborted) return Promise.reject(aborted());
      const line = JSON.stringify(request) + '\n';
      if (Buffer.byteLength(line) > 16_384)
        return Promise.reject(
          new MediaProcessingError('Native window request exceeds budget', 'limit'),
        );
      clearTimeout(idle);
      jobs++;
      return new Promise<WindowResult>((resolve, reject) => {
        const abort = () => void stop(aborted());
        const deadline = setTimeout(
          () =>
            void stop(
              new MediaProcessingError('Native window exceeded its wall-time budget', 'timeout'),
            ),
          timeoutMs,
        );
        pending = {
          response: '',
          finish(error, result) {
            clearTimeout(deadline);
            signal?.removeEventListener('abort', abort);
            if (error) reject(error);
            else resolve(result!);
          },
        };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        else child.stdin.write(line);
      });
    },
  };
}

/** One worker per API instance. The shared media queue admits one request at a time. */
export function createLinearWindowRuntime() {
  let current: ReturnType<typeof startWindowProcess> | undefined;
  let closed = false;
  return {
    async close() {
      closed = true;
      await current?.stop(aborted());
    },
    async render(request: NativeWindow, options: NormalizedMediaOptions, signal?: AbortSignal) {
      const { pythonExecutable, memoryBytes, timeoutMs } = options;
      if (!pythonExecutable)
        throw new MediaProcessingError('Native interpreter is unavailable', 'unsupported');
      if (closed || signal?.aborted) throw aborted();
      if (!current?.accepts(pythonExecutable, memoryBytes)) {
        await current?.stop();
        if (closed || signal?.aborted) throw aborted();
        current = startWindowProcess(pythonExecutable, memoryBytes);
      }
      return current.submit(request, timeoutMs, signal);
    },
  };
}

export interface LinearWindowContext {
  runtime: ReturnType<typeof createLinearWindowRuntime>;
  /** The immutable descriptor already scoped to the asset by the caller. */
  descriptor: MediaDescriptorV1;
}

export async function exportLinearWindow(
  context: LinearWindowContext,
  workDir: string,
  outputPath: string,
  preview: MediaPrecisionPreview,
  edit: PrecisionEdit | undefined,
  options: NormalizedMediaOptions,
  signal?: AbortSignal,
): Promise<MediaExportResult> {
  const { descriptor, runtime } = context;
  const source = descriptor.linearMaster;
  if (
    descriptor.protocol !== MEDIA_PROTOCOL ||
    !/^[a-f0-9]{64}$/.test(descriptor.sourceSha256) ||
    !source ||
    source.relativePath !== 'linear-master.exr' ||
    source.bitDepth !== 32 ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.bytes) ||
    source.bytes < 1 ||
    source.bytes > 2_147_483_648
  )
    throw new MediaProcessingError('Invalid retained linear master descriptor', 'processing');
  if (
    ![source.width, source.height].every(
      (edge) => Number.isSafeInteger(edge) && edge >= 1 && edge <= MEDIA_MAX_SIDE,
    ) ||
    source.width * source.height > MEDIA_MAX_LINEAR_PIXELS
  )
    throw new MediaProcessingError('Retained master exceeds the precision budget', 'limit');
  const region = previewWindow(preview, source);
  if (!region) throw new MediaProcessingError('Missing native preview window', 'processing');
  const count = region.width * region.height;
  const volume = await statfs(dirname(outputPath), { bigint: true });
  if (BigInt(count * 26 + 8 * 1024 * 1024) > volume.bavail * volume.bsize)
    throw new MediaProcessingError('Insufficient disk capacity for native preview', 'limit');
  const partial = `${outputPath}.partial`;
  const result = await runtime.render(
    {
      inputPath: join(workDir, source.relativePath),
      inputBytes: source.bytes,
      inputSha256: source.sha256,
      outputPath: partial,
      width: source.width,
      height: source.height,
      maxPixels: MEDIA_MAX_LINEAR_PIXELS,
      region,
      edit: edit ?? NEUTRAL_PRECISION_EDIT,
      sdr: true,
    },
    options,
    signal,
  );
  if (signal?.aborted) throw aborted();
  const info = await lstat(partial);
  if (
    !info.isFile() ||
    info.size < 33 ||
    info.size > MAX_WINDOW_FILE_BYTES ||
    result.width !== region.width ||
    result.height !== region.height ||
    result.bitDepth !== 16 ||
    ![3, 4].includes(result.channels)
  )
    throw failed();
  const metadata = await sharp(partial, { limitInputPixels: count }).metadata();
  if (
    metadata.format !== 'png' ||
    metadata.width !== region.width ||
    metadata.height !== region.height ||
    metadata.depth !== 'ushort' ||
    metadata.channels !== result.channels
  )
    throw failed();
  await attachPngIcc(partial, await srgbProfile());
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(partial)) hash.update(chunk);
  if (signal?.aborted) throw aborted();
  const bytes = (await lstat(partial)).size;
  await rename(partial, outputPath);
  return {
    relativePath: basename(outputPath),
    bytes,
    sha256: hash.digest('hex'),
    mime: 'image/png',
    width: result.width,
    height: result.height,
    bitDepth: 16,
    colorSpace: 'sRGB',
    format: 'png16',
    sourceSha256: descriptor.sourceSha256,
    includesEditorRecipe: false,
    ...precisionRecord(edit, descriptor.sourceSha256, 'linear-master'),
  };
}
