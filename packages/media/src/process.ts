import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile, lstat, mkdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { parsePrecisionEdit } from '@ai-xiutu/editor';
import { exportLinearWindow, type LinearWindowContext } from './linear-window.js';
import {
  MEDIA_MAX_INPUT_BYTES,
  MEDIA_DEFAULT_MAX_PIXELS,
  MEDIA_MAX_PIXELS,
  MEDIA_MAX_PROXY_PIXELS,
  MediaProcessingError,
  type ProcessMediaRequest,
  type ExportMediaRequest,
  type MediaDescriptorV1,
  type MediaExportResult,
  type MediaProcessingOptions,
} from './types.js';

export { MediaProcessingError } from './types.js';
export interface NormalizedMediaOptions {
  maxPixels: number;
  maxInputBytes: number;
  maxProxyPixels: number;
  tileSize: 256 | 512 | 1024;
  generateTiles: boolean;
  timeoutMs: number;
  memoryBytes: number;
  pythonExecutable?: string;
}
function integer(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new MediaProcessingError(`${label} exceeds the documented media budget`, 'limit');
  return n;
}
export function normalizeMediaOptions(
  options: MediaProcessingOptions = {},
): NormalizedMediaOptions {
  if (options.generateTiles !== undefined && typeof options.generateTiles !== 'boolean')
    throw new MediaProcessingError('generateTiles must be an explicit boolean', 'limit');
  if (
    options.pythonExecutable !== undefined &&
    (!isAbsolute(options.pythonExecutable) || options.pythonExecutable.includes('\0'))
  )
    throw new MediaProcessingError(
      'Native interpreter must be a trusted absolute deployment path',
      'unsupported',
    );
  const tileSize = options.tileSize ?? 512;
  if (![256, 512, 1024].includes(tileSize))
    throw new MediaProcessingError('Unsupported tile size', 'limit');
  return {
    maxPixels: integer(
      options.maxPixels,
      MEDIA_DEFAULT_MAX_PIXELS,
      1,
      MEDIA_MAX_PIXELS,
      'Pixel count',
    ),
    maxInputBytes: integer(
      options.maxInputBytes,
      MEDIA_MAX_INPUT_BYTES,
      1,
      MEDIA_MAX_INPUT_BYTES,
      'Input size',
    ),
    maxProxyPixels: integer(
      options.maxProxyPixels,
      MEDIA_MAX_PROXY_PIXELS,
      1,
      MEDIA_MAX_PROXY_PIXELS,
      'Proxy pixels',
    ),
    tileSize,
    generateTiles: options.generateTiles ?? true,
    timeoutMs: integer(options.timeoutMs, 180_000, 1000, 600_000, 'Job wall time'),
    memoryBytes: integer(
      options.memoryBytes,
      4_294_967_296,
      1_073_741_824,
      8_589_934_592,
      'Job address space',
    ),
    ...(options.pythonExecutable ? { pythonExecutable: options.pythonExecutable } : {}),
  };
}
type Waiter = {
  signal?: AbortSignal;
  resolve: (release: () => void) => void;
  reject: (reason: Error) => void;
  abort: () => void;
};
let active = false;
const waiters: Waiter[] = [];
function release() {
  const next = waiters.shift();
  if (!next) {
    active = false;
    return;
  }
  next.signal?.removeEventListener('abort', next.abort);
  next.resolve(release);
}
function slot(signal?: AbortSignal): Promise<() => void> {
  if (signal?.aborted)
    return Promise.reject(new MediaProcessingError('Media operation cancelled', 'aborted'));
  if (!active) {
    active = true;
    return Promise.resolve(release);
  }
  if (waiters.length >= 8)
    return Promise.reject(
      new MediaProcessingError('Media queue is full; try after the active task finishes', 'limit'),
    );
  return new Promise((resolve, reject) => {
    const item: Waiter = {
      signal,
      resolve,
      reject,
      abort: () => {
        const index = waiters.indexOf(item);
        if (index >= 0) waiters.splice(index, 1);
        reject(new MediaProcessingError('Queued media operation cancelled', 'aborted'));
      },
    };
    waiters.push(item);
    signal?.addEventListener('abort', item.abort, { once: true });
    if (signal?.aborted) item.abort();
  });
}
async function absent(path: string) {
  try {
    await lstat(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  throw new MediaProcessingError(
    'Media output already exists; immutable originals are never overwritten',
    'processing',
  );
}
async function assertIsolation() {
  if (process.platform !== 'linux')
    throw new MediaProcessingError(
      'Media processor requires the Linux prlimit isolation runtime',
      'unsupported',
    );
  await access('/usr/bin/prlimit', constants.X_OK);
}
async function isolated<T>(
  job: Record<string, unknown>,
  options: NormalizedMediaOptions,
  signal?: AbortSignal,
): Promise<T> {
  await assertIsolation();
  const releaseSlot = await slot(signal);
  let control: string | undefined;
  try {
    control = await mkdtemp(join(tmpdir(), 'xiutu-media-control-'));
    if (signal?.aborted) throw new MediaProcessingError('Media operation cancelled', 'aborted');
    const requestPath = join(control, 'request.json'),
      resultPath = join(control, 'result.json');
    await writeFile(requestPath, JSON.stringify({ ...job, options, resultPath }), { mode: 0o600 });
    const worker = fileURLToPath(new URL('./worker.ts', import.meta.url));
    await new Promise<void>((resolveDone, reject) => {
      const child = spawn(
        '/usr/bin/prlimit',
        [
          `--as=${options.memoryBytes}`,
          `--cpu=${Math.ceil(options.timeoutMs / 1000) + 2}`,
          '--fsize=2147483648',
          '--nofile=128',
          '--',
          process.execPath,
          '--max-old-space-size=512',
          '--jitless',
          '--disable-wasm-trap-handler',
          '--import',
          'tsx',
          worker,
          requestPath,
        ],
        {
          cwd: dirname(fileURLToPath(new URL('../../../package.json', import.meta.url))),
          detached: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          // Decoders receive no application credentials, proxy passwords, or provider keys.
          env: {
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            LANG: 'C.UTF-8',
            TZ: 'UTC',
            UV_THREADPOOL_SIZE: '1',
            VIPS_CONCURRENCY: '1',
            OPENBLAS_NUM_THREADS: '1',
            OMP_NUM_THREADS: '1',
            GOMAXPROCS: '2',
            MALLOC_ARENA_MAX: '2',
          },
        },
      );
      let stderr = '',
        terminal: MediaProcessingError | null = null;
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 4096) stderr += chunk.toString('utf8').slice(0, 4096 - stderr.length);
      });
      const kill = () => {
        if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* already exited */
          }
        }
      };
      const abort = () => {
        terminal = new MediaProcessingError('Media operation cancelled', 'aborted');
        kill();
      };
      const timer = setTimeout(() => {
        terminal = new MediaProcessingError(
          'Media processing exceeded its wall-time budget',
          'timeout',
        );
        kill();
      }, options.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
      };
      child.once('error', (error) => {
        finish();
        reject(
          new MediaProcessingError(
            `Unable to start the isolated media runtime: ${error.message}`,
            'processing',
          ),
        );
      });
      child.once('close', (code, killedBy) => {
        finish();
        if (terminal) reject(terminal);
        else if (code === 2 || killedBy === 'SIGXFSZ')
          reject(
            new MediaProcessingError(
              stderr.trim().slice(0, 1200) || 'Media resource budget exceeded',
              'limit',
            ),
          );
        else if (code !== 0)
          reject(
            new MediaProcessingError(
              `Isolated media processor failed${killedBy ? ` (${killedBy})` : ''}: ${stderr.trim().slice(0, 1200) || 'resource limit or unsupported input'}`,
              'processing',
            ),
          );
        else resolveDone();
      });
    });
    if (signal?.aborted) throw new MediaProcessingError('Media operation cancelled', 'aborted');
    const result = await readFile(resultPath, 'utf8');
    if (result.length > 262_144)
      throw new MediaProcessingError('Media result exceeds metadata budget', 'limit');
    return JSON.parse(result) as T;
  } finally {
    try {
      if (control) await rm(control, { recursive: true, force: true });
    } finally {
      releaseSlot();
    }
  }
}
export async function processMedia(request: ProcessMediaRequest): Promise<MediaDescriptorV1> {
  const options = normalizeMediaOptions(request.options),
    inputPath = resolve(request.inputPath),
    workDir = resolve(request.workDir);
  if (inputPath === workDir)
    throw new MediaProcessingError('Input and output must differ', 'processing');
  await absent(workDir);
  const input = await lstat(inputPath);
  if (
    !input.isFile() ||
    input.isSymbolicLink() ||
    input.size === 0 ||
    input.size > options.maxInputBytes
  )
    throw new MediaProcessingError('Input must be a bounded regular file', 'limit');
  // An exclusive reservation prevents a failing duplicate job from deleting another job's result.
  await mkdir(workDir, { mode: 0o700 });
  try {
    return await isolated<MediaDescriptorV1>(
      {
        kind: 'import',
        inputPath,
        workDir,
        originalName: (request.originalName ?? 'image').slice(0, 255),
      },
      options,
      request.signal,
    );
  } catch (error) {
    await rm(workDir, { recursive: true, force: true });
    throw error;
  }
}
export async function exportMedia(
  request: ExportMediaRequest,
  window?: LinearWindowContext,
): Promise<MediaExportResult> {
  if (!['png16', 'tiff16', 'jpeg', 'webp', 'exr32'].includes(request.format))
    throw new MediaProcessingError('Unsupported export format', 'unsupported');
  if (
    (request.precisionInput !== undefined &&
      (!['master16', 'linear-master'].includes(request.precisionInput) ||
        (request.format === 'exr32' && request.precisionInput !== 'linear-master'))) ||
    (request.preview && request.format !== 'png16')
  )
    throw new MediaProcessingError('Unsupported precision input or preview format', 'unsupported');
  const options = normalizeMediaOptions({ ...request.options, maxPixels: MEDIA_MAX_PIXELS }),
    outputPath = resolve(request.outputPath),
    workDir = resolve(request.workDir);
  await absent(outputPath);
  // These suffixes belong to this new export, never to an earlier unrelated task.
  await absent(`${outputPath}.partial`);
  await absent(`${outputPath}.partial.icc`);
  const quality = integer(request.options?.quality, 90, 1, 100, 'Export quality');
  const precisionEdit =
    request.precisionEdit === undefined ? undefined : parsePrecisionEdit(request.precisionEdit);
  if (
    precisionEdit &&
    precisionEdit.algorithm !== 'scene-linear-v1' &&
    request.precisionInput !== 'linear-master' &&
    request.format !== 'exr32'
  )
    throw new MediaProcessingError(
      precisionEdit.algorithm === 'scene-linear-v2'
        ? 'Scene-linear curves require the retained float master'
        : 'Scene-linear regions require the retained float master',
      'unsupported',
    );
  const reservation = await open(outputPath, 'wx', 0o600);
  await reservation.close();
  try {
    if (
      window &&
      request.preview?.region &&
      request.precisionInput === 'linear-master' &&
      process.platform === 'linux' &&
      (await access('/proc/self/fd', constants.R_OK | constants.X_OK).then(
        () => true,
        () => false,
      ))
    ) {
      await assertIsolation();
      const releaseSlot = await slot(request.signal);
      try {
        return await exportLinearWindow(
          window,
          workDir,
          outputPath,
          request.preview,
          precisionEdit,
          options,
          request.signal,
        );
      } catch (error) {
        if (error instanceof MediaProcessingError) throw error;
        throw new MediaProcessingError('Isolated native window processing failed', 'processing');
      } finally {
        releaseSlot();
      }
    }
    return await isolated<MediaExportResult>(
      {
        kind: 'export',
        workDir,
        outputPath,
        format: request.format,
        quality,
        ...(precisionEdit ? { precisionEdit } : {}),
        ...(request.precisionInput ? { precisionInput: request.precisionInput } : {}),
        ...(request.preview ? { preview: request.preview } : {}),
      },
      options,
      request.signal,
    );
  } catch (error) {
    // SIGKILL cannot run attachPngIcc's child-side finally block.
    await rm(`${outputPath}.partial.icc`, { force: true });
    await rm(`${outputPath}.partial`, { force: true });
    await rm(outputPath, { force: true });
    throw error;
  }
}
