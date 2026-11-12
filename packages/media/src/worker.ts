/** Fixed subprocess entry. Never import this module in the API process. */
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  rename,
  rm,
  lstat,
  statfs,
  readdir,
  open,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { readPsd, initializeCanvas, type Layer } from 'ag-psd';
import { attachPngIcc, attachTiffIcc, srgbProfile } from './icc.js';
import { editMaster16, fitPrecisionPreview, precisionRecord, previewWindow } from './precision.js';
import { parsePrecisionEdit, NEUTRAL_PRECISION_EDIT, type PrecisionEdit } from '@ai-xiutu/editor';
import type { NormalizedMediaOptions } from './process.js';
import {
  MEDIA_MAX_PIXELS,
  MEDIA_MAX_SIDE,
  MEDIA_MAX_TILE_COUNT,
  MEDIA_MAX_PRECISION_PIXELS,
  MEDIA_MAX_SDR_MASTER_PIXELS,
  MEDIA_MAX_LINEAR_PIXELS,
  MEDIA_MAX_HDR_IMPORT_PIXELS,
  MEDIA_MAX_GAIN_MAP_PIXELS,
  MEDIA_MAX_GAIN_MAP_BYTES,
  MEDIA_MAX_HEIC_HLG_PIXELS,
  MEDIA_MAX_HEIC_HDR_BYTES,
  fitsGainMapRaster,
  hasDisplayHdr,
  isSdrJpegSource,
  MediaProcessingError,
  type MediaDescriptorV1,
  type MediaFileV1,
  type MediaExportFormat,
  type MediaExportResult,
  type MediaPrecisionInput,
  type MediaPrecisionPreview,
  type MediaPrecisionWindow,
} from './types.js';

sharp.cache({ memory: 32, files: 8, items: 64 });
sharp.concurrency(1);
initializeCanvas(
  () => {
    throw new Error('Canvas rasterization is not part of the PSD composite importer');
  },
  (width, height) => {
    boundedDimensions(width, height, 16_777_216);
    return { width, height, colorSpace: 'srgb', data: new Uint8ClampedArray(width * height * 4) };
  },
);
interface Job {
  kind: 'import' | 'export';
  inputPath?: string;
  workDir: string;
  originalName?: string;
  options: NormalizedMediaOptions;
  resultPath: string;
  outputPath?: string;
  format?: MediaExportFormat;
  quality?: number;
  precisionEdit?: PrecisionEdit;
  precisionInput?: MediaPrecisionInput;
  preview?: MediaPrecisionPreview;
  crop?: MediaPrecisionWindow;
}
class MediaLimitError extends Error {}
const digest = async (path: string) => {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const depth = (m: Metadata) =>
  m.bitsPerSample ??
  (m.depth === 'ushort'
    ? 16
    : m.depth === 'float' || m.depth === 'int' || m.depth === 'uint'
      ? 32
      : m.depth === 'double'
        ? 64
        : 8);
function boundedDimensions(width: number, height: number, limit: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MEDIA_MAX_SIDE ||
    height > MEDIA_MAX_SIDE ||
    width * height > limit
  )
    throw new MediaLimitError('Decoded dimensions exceed the media budget');
}

function fitProxy(width: number, height: number, limit: number) {
  const scale = Math.min(1, Math.sqrt(limit / (width * height)));
  const w = Math.max(1, Math.floor(width * scale));
  const h = Math.max(1, Math.floor(height * scale));
  // Once a side reaches one pixel, uniform scaling can still exceed the area
  // limit because the other side was computed before that clamp.
  return {
    width: width >= height ? Math.min(w, Math.floor(limit / h)) : w,
    height: height > width ? Math.min(h, Math.floor(limit / w)) : h,
  };
}

function pyramidSize(width: number, height: number, tileSize: number) {
  let tiles = 0,
    pixels = 0;
  for (;;) {
    tiles += Math.ceil(width / tileSize) * Math.ceil(height / tileSize);
    pixels += width * height;
    if (width === 1 && height === 1) return { tiles, pixels };
    width = Math.ceil(width / 2);
    height = Math.ceil(height / 2);
  }
}

async function diskBudget(path: string, bytes: number) {
  const volume = await statfs(path, { bigint: true });
  if (BigInt(Math.ceil(bytes)) > volume.bavail * volume.bsize)
    throw new MediaLimitError('Insufficient disk capacity for bounded media staging');
}

async function preflightRaster(metadata: Metadata, options: NormalizedMediaOptions, stage: string) {
  const { width, height, orientation, format, channels } = metadata;
  boundedDimensions(width, height, options.maxPixels);
  const pixels = width * height;
  // Frame-oriented codecs, progressive decoders and vertical orientation can
  // require full-frame buffers. Leave address space for the worker and libvips.
  if (
    format === 'heif' ||
    format === 'webp' ||
    format === 'gif' ||
    metadata.isProgressive ||
    (orientation !== undefined && orientation >= 3)
  ) {
    const decoded = pixels * Math.max(4, channels) * Math.ceil(depth(metadata) / 8);
    if (decoded * 2 + pixels * 8 > options.memoryBytes * 0.7)
      throw new MediaLimitError(
        'Format and orientation require more decoded working memory than available',
      );
  }
  const pyramid = options.generateTiles ? pyramidSize(width, height, options.tileSize) : null;
  if (pyramid && pyramid.tiles > MEDIA_MAX_TILE_COUNT)
    throw new MediaLimitError('Tile count exceeds budget; use a larger tile size or disable tiles');
  await diskBudget(
    stage,
    pixels * 8.125 +
      options.maxProxyPixels * 8 +
      (pyramid ? pyramid.pixels * 4.1 + pyramid.tiles * 8192 : 0) +
      8 * 1024 * 1024,
  );
}
async function fileInfo(
  path: string,
  relativePath: string,
  mime: string,
  colorSpace?: string,
): Promise<MediaFileV1> {
  const m = await sharp(path, { limitInputPixels: MEDIA_MAX_PIXELS }).metadata();
  return {
    relativePath,
    bytes: (await lstat(path)).size,
    sha256: await digest(path),
    mime,
    width: m.width,
    height: m.height,
    bitDepth: depth(m),
    colorSpace: colorSpace ?? m.space,
  };
}
type NativeSourceInfo = Pick<
  MediaDescriptorV1['original'],
  'width' | 'height' | 'bitDepth' | 'colorSpace' | 'sampleEncoding' | 'decodedBitDepth' | 'gainMap' | 'pq' | 'hlg'
>;
async function nativeDecode(
  job: Job,
  inputPath: string,
  stage: string,
  kind: 'raw' | 'hdr' | 'gain-map' | 'heic-hdr',
  orientation = 1,
) {
  if (!job.options.pythonExecutable)
    throw new Error(`${kind.toUpperCase()} requires the separately installed native decoder`);
  const outputPath = join(stage, 'native.tif'),
    resultPath = join(stage, 'native-result.json'),
    requestPath = join(stage, 'native-request.json');
  await writeFile(
    requestPath,
    JSON.stringify({
      inputPath,
      outputPath,
      kind,
      maxPixels: Math.min(job.options.maxPixels, {
        raw: MEDIA_MAX_LINEAR_PIXELS,
        hdr: MEDIA_MAX_HDR_IMPORT_PIXELS,
        'gain-map': MEDIA_MAX_GAIN_MAP_PIXELS,
        'heic-hdr': MEDIA_MAX_HEIC_HLG_PIXELS,
      }[kind]),
      ...(kind === 'gain-map' ? { ultraHdrLibrary: job.options.ultraHdrLibrary, orientation } : {}),
      ...(kind === 'heic-hdr' ? { heicDecoder: job.options.heicDecoder } : {}),
      resultPath,
    }),
    { mode: 0o600 },
  );
  await new Promise<void>((resolveDone, reject) => {
    const child = spawn(
      job.options.pythonExecutable!,
      ['-B', fileURLToPath(new URL('../native/convert.py', import.meta.url)), requestPath],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let error = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (error.length < 4096) error += chunk.toString('utf8').slice(0, 4096 - error.length);
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0
        ? resolveDone()
        : reject(new Error(`Native decoder rejected input: ${error.trim().slice(-1500)}`)),
    );
  });
  const result = JSON.parse(await readFile(resultPath, 'utf8')) as {
    source: NativeSourceInfo;
    native: Record<string, string>;
    warnings: string[];
    peakRssBytes: number;
  };
  await rm(requestPath);
  await rm(resultPath);
  return { path: outputPath, result };
}
async function psdComposite(inputPath: string, stage: string, limit: number) {
  const stat = await lstat(inputPath);
  if (stat.size > 134_217_728) throw new Error('PSD compressed file exceeds 128MiB');
  const bytes = await readFile(inputPath);
  if (bytes.length < 26 || bytes.toString('ascii', 0, 4) !== '8BPS' || bytes.readUInt16BE(4) !== 1)
    throw new Error('Only standard PSD version 1 is currently supported');
  const height = bytes.readUInt32BE(14),
    width = bytes.readUInt32BE(18),
    bits = bytes.readUInt16BE(22),
    mode = bytes.readUInt16BE(24);
  boundedDimensions(width, height, Math.min(limit, 16_777_216));
  if (![8, 16].includes(bits) || ![1, 3].includes(mode))
    throw new Error(
      'PSD import supports RGB/grayscale 8/16-bit composites; CMYK/32-bit PSD are not silently approximated',
    );
  const psd = readPsd(bytes, {
    useImageData: true,
    skipLayerImageData: true,
    skipLinkedFilesData: true,
    skipThumbnail: true,
    totalMemoryLimit: 536_870_912,
    imageResourcesWhitelist: ['iccProfile'],
  });
  const composite = psd.imageData;
  if (!composite || composite.width !== width || composite.height !== height)
    throw new Error('PSD needs an intact stored composite; layer rendering is not substituted');
  const layers: MediaDescriptorV1['layers'] = [],
    pending = [...(psd.children ?? [])] as Layer[];
  while (pending.length) {
    const layer = pending.shift()!;
    if (layers.length >= 256 || pending.length > 256)
      throw new Error('PSD layer metadata exceeds 256 nodes');
    layers.push({
      name: (layer.name ?? '').slice(0, 120),
      left: layer.left ?? 0,
      top: layer.top ?? 0,
      right: layer.right ?? 0,
      bottom: layer.bottom ?? 0,
      hidden: layer.hidden ?? false,
    });
    if (layer.children) pending.push(...layer.children);
  }
  if (
    !(composite.data instanceof Uint8ClampedArray) &&
    !(composite.data instanceof Uint8Array) &&
    !(composite.data instanceof Uint16Array)
  )
    throw new Error('Unsupported PSD composite sample type');
  const path = join(stage, 'psd-composite.png');
  await sharp(composite.data, { raw: { width, height, channels: 4 } })
    .toColourspace(bits === 16 ? 'rgb16' : 'srgb')
    .png()
    .toFile(path);
  const icc = psd.imageResources?.iccProfile ? Buffer.from(psd.imageResources.iccProfile) : null;
  if (icc) await attachPngIcc(path, icc);
  return { path, layers, icc, width, height, bits };
}
async function countTiles(directory: string) {
  let bytes = 0,
    count = 0;
  const pending = [directory];
  while (pending.length) {
    const path = pending.pop()!;
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) pending.push(child);
      else if (entry.isFile()) {
        bytes += (await lstat(child)).size;
        if (++count > MEDIA_MAX_TILE_COUNT) throw new MediaLimitError('Tile count exceeds budget');
      } else throw new Error('Unexpected non-file in generated tile pyramid');
    }
  }
  return { bytes, count };
}
async function importMedia(job: Job): Promise<MediaDescriptorV1> {
  const started = performance.now();
  const options = job.options,
    stage = join(job.workDir, '.partial');
  await mkdir(stage, { mode: 0o700 });
  const originalPath = join(stage, 'original.bin');
  await copyFile(job.inputPath!, originalPath);
  const sourceStat = await lstat(originalPath);
  if (sourceStat.size < 1 || sourceStat.size > options.maxInputBytes)
    throw new Error('Source size changed beyond budget');
  const sourceSha256 = await digest(originalPath),
    h = Buffer.alloc(32),
    handle = await open(originalPath, 'r');
  try {
    await handle.read(h, 0, h.length, 0);
  } finally {
    await handle.close();
  }
  const extension = extname(job.originalName ?? '').toLowerCase(),
    rawExtension = [
      '.dng',
      '.nef',
      '.nrw',
      '.arw',
      '.cr2',
      '.cr3',
      '.raf',
      '.orf',
      '.rw2',
      '.pef',
      '.srw',
    ].includes(extension),
    hdr =
      h.readUInt32LE(0) === 20000630 ||
      h.toString('ascii', 0, 10).startsWith('#?RADIANCE') ||
      h.toString('ascii', 0, 6) === '#?RGBE';
  const heic =
    h.toString('ascii', 4, 8) === 'ftyp' &&
    h.readUInt32BE(0) >= 16 &&
    [8, 16, 20, 24, 28].some(
      (offset) =>
        offset + 4 <= h.readUInt32BE(0) &&
        ['heic', 'heix', 'hevc', 'hevx'].includes(h.toString('ascii', offset, offset + 4)),
    );
  let inputPath = originalPath,
    native: string | null = null,
    sourceOverride: NativeSourceInfo | null = null,
    layers: MediaDescriptorV1['layers'] = [],
    sourceFormat = '',
    sourceIcc: Buffer | null = null;
  const warnings: string[] = [];
  let nativePeakRssBytes: number | undefined;
  if (heic) {
    if (!options.heicDecoder)
      throw new MediaProcessingError('HEIC HDR requires the configured native decoder', 'unsupported');
    if (sourceStat.size > MEDIA_MAX_HEIC_HDR_BYTES)
      throw new MediaLimitError('HEIC HDR exceeds the 128 MiB compressed budget');
  }
  if (rawExtension || hdr || heic) {
    const result = await nativeDecode(job, originalPath, stage, heic ? 'heic-hdr' : hdr ? 'hdr' : 'raw');
    inputPath = result.path;
    native = JSON.stringify(result.result.native);
    sourceOverride = result.result.source;
    sourceFormat = heic
      ? 'heic'
      : hdr
        ? (h.readUInt32LE(0) === 20000630 ? 'exr' : 'radiance')
        : extension.slice(1);
    warnings.push(...result.result.warnings);
    nativePeakRssBytes = result.result.peakRssBytes;
  } else if (h.toString('ascii', 0, 4) === '8BPS') {
    const decoded = await psdComposite(originalPath, stage, options.maxPixels);
    inputPath = decoded.path;
    layers = decoded.layers;
    sourceIcc = decoded.icc;
    sourceFormat = 'psd';
    sourceOverride = {
      width: decoded.width,
      height: decoded.height,
      bitDepth: decoded.bits,
      colorSpace: 'RGB',
    };
    warnings.push(
      'PSD uses the saved composite and bounded layer metadata. Editable text, smart objects, effects and layer round-trip are not rendered by this importer.',
    );
  }
  const metadata = await sharp(inputPath, {
    // Metadata is read without pixel allocation, in the isolated worker.
    // Apply the configured bound below before creating a decode pipeline.
    limitInputPixels: false,
    failOn: 'warning',
    sequentialRead: true,
  }).metadata();
  if (!sourceFormat && !['jpeg', 'png', 'webp', 'tiff', 'gif', 'heif'].includes(metadata.format))
    throw new Error('Unsupported static raster format');
  if ((metadata.pages ?? 1) !== 1)
    throw new Error('Animated or multi-page images require an explicit frame extraction workflow');
  if (!sourceOverride && depth(metadata) > 16)
    throw new Error(
      'Floating-point TIFF requires an explicit HDR interpretation; use EXR/Radiance',
    );
  const isCmyk = metadata.space === 'cmyk';
  if (isCmyk && !metadata.icc)
    throw new Error(
      'CMYK import requires an embedded ICC profile; an unknown print profile is not guessed',
    );
  if (isCmyk && depth(metadata) > 8)
    throw new Error(
      'The current CMYK converter is validated for 8-bit JPEG/TIFF; high-bit CMYK is not silently quantized',
    );
  if (metadata.icc && !['RGB ', 'CMYK'].includes(metadata.icc.toString('ascii', 16, 20)))
    throw new Error('The embedded ICC color model is not supported by this RGB/CMYK pipeline');
  await preflightRaster(metadata, options, stage);
  if (!sourceOverride) sourceIcc = metadata.icc ?? null;
  const hasGainMap = metadata.format === 'jpeg' && !!metadata.gainMap;
  let gainMapSource: Awaited<ReturnType<typeof nativeDecode>>['result']['source'] | undefined;
  if (hasGainMap) {
    if (!options.pythonExecutable || !options.ultraHdrLibrary) {
      warnings.push('Ultra HDR gain map retained in the original. HDR development requires the reference decoder.');
    } else if (
      !fitsGainMapRaster(metadata) || sourceStat.size > MEDIA_MAX_GAIN_MAP_BYTES
    ) {
      warnings.push('Ultra HDR gain map retained in the original. This image exceeds the HDR development budget.');
    } else {
      const decoded = await nativeDecode(job, originalPath, stage, 'gain-map', metadata.orientation ?? 1);
      gainMapSource = decoded.result.source;
      if (!gainMapSource.gainMap) throw new Error('Ultra HDR decoder returned no gain map metadata');
      native = JSON.stringify(decoded.result.native);
      nativePeakRssBytes = decoded.result.peakRssBytes;
      warnings.push(...decoded.result.warnings);
      await preflightRaster(metadata, options, stage);
    }
  }
  const profile = await srgbProfile(),
    masterPath = join(stage, 'master.tif');
  // sharp 0.35 uses P3 as its implicit RGB16 processing profile. For RGB, skip that
  // implicit conversion and perform exactly one embedded-profile -> sRGB transform.
  // Untagged RGB is explicitly sRGB. Known sRGB masters are subsequently read with
  // ignoreIcc to avoid an unnecessary sRGB -> P3 -> sRGB round-trip.
  let toMaster = sharp(inputPath, {
    limitInputPixels: options.maxPixels,
    failOn: 'warning',
    sequentialRead: true,
    ignoreIcc: !isCmyk,
  })
    .autoOrient()
    .toColourspace('rgb16');
  if (metadata.icc) toMaster = toMaster.withIccProfile('srgb');
  await toMaster
    .tiff({
      compression: 'deflate',
      predictor: 'horizontal',
      tile: true,
      tileWidth: 256,
      tileHeight: 256,
    })
    .timeout({ seconds: Math.ceil(options.timeoutMs / 1000) })
    .toFile(masterPath);
  await attachTiffIcc(masterPath, profile);
  const master = await fileInfo(masterPath, 'master.tif', 'image/tiff', 'sRGB');
  if (master.bitDepth !== 16) throw new Error('Master encoding failed the uint16 verification');
  if (gainMapSource && (gainMapSource.width !== master.width || gainMapSource.height !== master.height))
    throw new Error('Ultra HDR and SDR orientation disagree');
  boundedDimensions(master.width, master.height, options.maxPixels);
  const proxySize = fitProxy(master.width, master.height, options.maxProxyPixels);
  const proxyPath = join(stage, 'proxy.png');
  await sharp(masterPath, {
    limitInputPixels: options.maxPixels,
    sequentialRead: true,
    ignoreIcc: true,
  })
    .resize(proxySize.width, proxySize.height, { fit: 'fill' })
    .toColourspace('srgb')
    .ensureAlpha()
    .png()
    .toFile(proxyPath);
  await attachPngIcc(proxyPath, profile);
  const proxy = {
    ...(await fileInfo(proxyPath, 'proxy.png', 'image/png', 'sRGB')),
    normalizedDimensions: { width: master.width, height: master.height },
  };
  if (proxy.bitDepth !== 8 || proxy.width * proxy.height > options.maxProxyPixels)
    throw new Error('Proxy encoding failed budget/precision validation');
  let tiles: MediaDescriptorV1['tiles'] = null;
  if (options.generateTiles) {
    await sharp(masterPath, {
      limitInputPixels: options.maxPixels,
      sequentialRead: true,
      ignoreIcc: true,
    })
      .toColourspace('srgb')
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 88 })
      .tile({
        size: options.tileSize,
        overlap: 1,
        depth: 'onepixel',
        layout: 'dz',
        container: 'fs',
      })
      .toFile(join(stage, 'tiles.dz'));
    const stats = await countTiles(join(stage, 'tiles_files'));
    tiles = {
      relativePath: 'tiles.dzi',
      directory: 'tiles_files',
      tileSize: options.tileSize,
      overlap: 1,
      levels: Math.ceil(Math.log2(Math.max(master.width, master.height))) + 1,
      format: 'jpeg',
      ...stats,
    };
  }
  const source = sourceOverride ?? {
    width: metadata.width,
    height: metadata.height,
    bitDepth: depth(metadata),
    colorSpace: metadata.space,
  };
  if (source.bitDepth < 16 && !hdr && !hasGainMap && !heic)
    warnings.push(
      `The 16-bit working container does not add captured precision beyond the source's ${source.bitDepth}-bit samples.`,
    );
  if (sourceFormat === 'radiance')
    warnings.push(
      'Radiance stores 8-bit RGB mantissas with a shared exponent (RGBE); decoded floating-point samples preserve dynamic range. It is not ordinary 8-bit SDR, nor a 32-bit-per-channel encoded original.',
    );
  if (!sourceIcc && !sourceOverride)
    warnings.push('Input has no embedded ICC; RGB is explicitly interpreted as sRGB.');
  if (sourceOverride && hdr)
    warnings.push(
      'linear-master.exr stores the decoded floating-point source separately from the SDR working master.',
    );
  const originalFormat = sourceFormat || metadata.format,
    original: MediaDescriptorV1['original'] = {
      relativePath: 'original.bin',
      bytes: sourceStat.size,
      sha256: sourceSha256,
      mime:
        sourceFormat === 'psd'
          ? 'image/vnd.adobe.photoshop'
          : sourceFormat === 'heic'
            ? 'image/heic'
            : sourceFormat
              ? 'application/octet-stream'
              : (metadata.mediaType ?? 'application/octet-stream'),
      ...source,
      ...(hasGainMap ? { sampleEncoding: 'gain-map' as const } : {}),
      ...(gainMapSource ? { decodedBitDepth: 16, gainMap: gainMapSource.gainMap } : {}),
      format: originalFormat,
      hasIcc: native && !hasGainMap ? null : sourceIcc !== null,
      metadataSummary: {
        inspection: native && !hasGainMap ? 'not-inspected' : sourceOverride ? 'icc-only' : 'full',
        orientation: sourceOverride ? null : (metadata.orientation ?? null),
        hasExif: sourceOverride ? null : !!metadata.exif,
        hasXmp: sourceOverride ? null : !!metadata.xmp,
        iccSha256: sourceIcc ? sha(sourceIcc) : null,
        pages: metadata.pages ?? 1,
      },
    };
  const descriptor: MediaDescriptorV1 = {
    protocol: 'media-v1',
    id: randomUUID(),
    sourceSha256,
    originalName: basename(job.originalName ?? 'image').slice(0, 255),
    original,
    master,
    proxy,
    tiles,
    layers,
    warnings,
    processor: {
      sharp: sharp.versions.sharp!,
      vips: sharp.versions.vips!,
      native,
      isolation: 'linux-prlimit',
      memoryBytes: options.memoryBytes,
      timeoutMs: options.timeoutMs,
      durationMs: Math.round(performance.now() - started),
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      ...(nativePeakRssBytes ? { nativePeakRssBytes } : {}),
    },
  };
  if (hdr || rawExtension || gainMapSource || heic) {
    const linearPath = join(stage, 'linear-master.exr');
    descriptor.linearMaster = {
      relativePath: 'linear-master.exr',
      bytes: (await lstat(linearPath)).size,
      sha256: await digest(linearPath),
      mime: 'image/x-exr',
      width: master.width,
      height: master.height,
      bitDepth: 32,
      colorSpace:
        gainMapSource?.colorSpace ??
        (heic
          ? 'linear-sRGB/Rec709-display-referred'
          : hdr
            ? 'linear-sRGB/Rec709-assumed'
            : 'linear-sRGB/Rec709-developed'),
    };
  }
  if (inputPath !== originalPath) await rm(inputPath, { force: true });
  await writeFile(join(stage, 'descriptor.json'), JSON.stringify(descriptor), { mode: 0o600 });
  // Parent owns the private directory reservation. Descriptor is published only after all data.
  const entries = await readdir(stage);
  for (const entry of entries.filter((entry) => entry !== 'descriptor.json'))
    await rename(join(stage, entry), join(job.workDir, entry));
  await rename(join(stage, 'descriptor.json'), join(job.workDir, 'descriptor.json'));
  await rm(stage, { recursive: true });
  return descriptor;
}
async function writeSdrExport(pipeline: Sharp, job: Job, output: string) {
  if (job.preview && !job.preview.region)
    pipeline = fitPrecisionPreview(pipeline, job.preview.maxEdge);
  const format = job.format!;
  if (format === 'png16') {
    await pipeline.toColourspace('rgb16').png().toFile(output);
    await attachPngIcc(output, await srgbProfile());
  } else if (format === 'tiff16') {
    await pipeline
      .toColourspace('rgb16')
      .tiff({
        compression: 'deflate',
        predictor: 'horizontal',
        tile: true,
        tileWidth: 256,
        tileHeight: 256,
      })
      .toFile(output);
    await attachTiffIcc(output, await srgbProfile());
  } else if (format === 'jpeg') {
    const sdr =
      job.precisionInput === 'linear-master'
        ? pipeline.withIccProfile('srgb')
        : pipeline.keepIccProfile();
    await sdr
      .toColourspace('srgb')
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: job.quality! })
      .toFile(output);
  } else {
    const sdr =
      job.precisionInput === 'linear-master'
        ? pipeline.withIccProfile('srgb')
        : pipeline.keepIccProfile();
    await sdr.toColourspace('srgb').webp({ quality: job.quality! }).toFile(output);
  }
  const info = await fileInfo(
    output,
    basename(job.outputPath!),
    format === 'png16' ? 'image/png' : format === 'tiff16' ? 'image/tiff' : `image/${format}`,
    'sRGB',
  );
  if ((format === 'png16' || format === 'tiff16') && info.bitDepth !== 16)
    throw new Error('Export bit-depth verification failed');
  return info;
}

async function exportNativeMaster(
  job: Job,
  descriptor: MediaDescriptorV1,
  region: MediaPrecisionWindow | undefined,
  input: MediaPrecisionInput,
): Promise<MediaExportResult> {
  const inputSrgb = input === 'master16';
  const source = inputSrgb ? descriptor.master : descriptor.linearMaster;
  const maxPixels = inputSrgb ? MEDIA_MAX_SDR_MASTER_PIXELS : MEDIA_MAX_LINEAR_PIXELS;
  if (
    !source ||
    source.relativePath !== (inputSrgb ? 'master.tif' : 'linear-master.exr') ||
    source.bitDepth !== (inputSrgb ? 16 : 32) ||
    !/^[a-f0-9]{64}$/.test(source.sha256) ||
    !Number.isSafeInteger(source.bytes) ||
    source.bytes < 1 ||
    !job.options.pythonExecutable
  )
    throw new Error('Native export requires the retained master and native runtime');
  boundedDimensions(source.width, source.height, maxPixels);
  const inputPath = join(job.workDir, source.relativePath),
    outputPath = `${job.outputPath!}.partial`;
  const info = await lstat(inputPath);
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.size !== source.bytes ||
    (await digest(inputPath)) !== source.sha256
  )
    throw new Error('Retained master failed its immutable integrity check');
  const dimensions = region ?? source;
  const count = dimensions.width * dimensions.height;
  const ultraHdr = job.format === 'ultrahdr';
  if (
    ultraHdr &&
    (!hasDisplayHdr(descriptor.original) || !fitsGainMapRaster(dimensions))
  )
    throw new MediaLimitError(
      'Ultra HDR JPEG requires a supported display HDR source and output dimensions',
    );
  if (
    job.format === 'webp' &&
    (Math.max(dimensions.width, dimensions.height) > 16383 ||
      count * 16 > job.options.memoryBytes * 0.7)
  )
    throw new MediaLimitError('WebP encoder dimensions or working memory exceed the media budget');
  await diskBudget(dirname(outputPath), count * 26 + 8 * 1024 * 1024);
  // Parent-owned control directory is also removed after a process-group kill.
  const control = dirname(job.resultPath);
  const requestPath = join(control, 'linear-request.json'),
    resultPath = join(control, 'linear-result.json'),
    intermediate = job.format === 'exr32' ? undefined : join(control, 'developed.tif');
  const sdr = intermediate !== undefined && !ultraHdr;
  if (intermediate) await diskBudget(control, count * (ultraHdr ? 13 : 8.125) + 8 * 1024 * 1024);
  try {
    await writeFile(
      requestPath,
      JSON.stringify({
        inputPath,
        outputPath: intermediate ?? outputPath,
        resultPath,
        width: source.width,
        height: source.height,
        maxPixels,
        edit: parsePrecisionEdit(job.precisionEdit ?? NEUTRAL_PRECISION_EDIT),
        sdr,
        sdrToneMap: sdr && !inputSrgb && hasDisplayHdr(descriptor.original),
        ...(inputSrgb ? { inputSrgb: true } : {}),
        // The bounded private TIFF is immediately read by the final encoder.
        // Compress only the deliverable to avoid two lossless encodes.
        uncompressedSdr: sdr && !job.preview?.region,
        ...(ultraHdr ? { linearTiff: true } : {}),
        region,
      }),
      { mode: 0o600 },
    );
    await new Promise<void>((done, reject) => {
      const child = spawn(
        job.options.pythonExecutable!,
        ['-B', fileURLToPath(new URL('../native/linear_export.py', import.meta.url)), requestPath],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let error = '';
      child.stderr.on('data', (part: Buffer) => {
        if (error.length < 2048) error += part.toString('utf8').slice(0, 2048 - error.length);
      });
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 ? done() : reject(new Error(`Native export failed: ${error.slice(-1000)}`)),
      );
    });
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    if (
      result.width !== dimensions.width ||
      result.height !== dimensions.height ||
      result.bitDepth !== (sdr ? 16 : 32) ||
      ![3, 4].includes(result.channels)
    )
      throw new Error('Invalid native export result');
    let info: MediaFileV1;
    if (intermediate) {
      const pipeline = sharp(intermediate, {
        limitInputPixels: count,
        failOn: 'warning',
        sequentialRead: true,
        ignoreIcc: true,
      });
      if (ultraHdr) {
        const linear = await pipeline.metadata();
        if (linear.space !== 'scrgb' || linear.depth !== 'float' || linear.channels !== 3)
          throw new Error('Ultra HDR encoder requires linear float RGB');
        await pipeline.toColourspace('scrgb').jpeg({ quality: job.quality! }).toFile(outputPath);
        const generated = await sharp(outputPath, { limitInputPixels: count }).metadata();
        if (!generated.gainMap || generated.width !== dimensions.width || generated.height !== dimensions.height)
          throw new Error('Ultra HDR encoding did not publish the expected gain map and dimensions');
        info = await fileInfo(outputPath, basename(job.outputPath!), 'image/jpeg', 'Ultra HDR JPEG');
      } else {
        info = await writeSdrExport(pipeline, job, outputPath);
      }
    } else {
      const outputStat = await lstat(outputPath);
      if (!outputStat.isFile() || outputStat.size < 16 || outputStat.size > 2_147_483_648)
        throw new Error('Invalid float output size');
      info = {
        relativePath: basename(job.outputPath!),
        mime: 'image/x-exr',
        bytes: outputStat.size,
        sha256: await digest(outputPath),
        width: source.width,
        height: source.height,
        bitDepth: 32,
        colorSpace: 'linear Rec.709',
      };
    }
    await rename(outputPath, job.outputPath!);
    return {
      ...info,
      format: job.format!,
      sourceSha256: descriptor.sourceSha256,
      includesEditorRecipe: false,
      ...precisionRecord(job.precisionEdit, descriptor.sourceSha256, input),
    };
  } finally {
    await rm(requestPath, { force: true });
    await rm(resultPath, { force: true });
    if (intermediate) await rm(intermediate, { force: true });
  }
}
async function exportMaster(job: Job): Promise<MediaExportResult> {
  const descriptor = JSON.parse(
    await readFile(join(job.workDir, 'descriptor.json'), 'utf8'),
  ) as MediaDescriptorV1;
  if (
    descriptor.protocol !== 'media-v1' ||
    !/^[a-f0-9]{64}$/.test(descriptor.sourceSha256) ||
    descriptor.master?.relativePath !== 'master.tif' ||
    !/^[a-f0-9]{64}$/.test(descriptor.master.sha256) ||
    descriptor.master.bitDepth !== 16 ||
    descriptor.master.colorSpace !== 'sRGB' ||
    !Number.isSafeInteger(descriptor.master.bytes) ||
    descriptor.master.bytes < 1 ||
    descriptor.master.bytes > 2_147_483_648
  )
    throw new Error('Invalid media descriptor');
  const crop = job.crop;
  if (crop && (
    ![crop.left, crop.top, crop.width, crop.height].every(Number.isSafeInteger) ||
    crop.left < 0 || crop.top < 0 || crop.width < 1 || crop.height < 1 ||
    crop.left + crop.width > descriptor.master.width || crop.top + crop.height > descriptor.master.height
  )) throw new MediaLimitError('Ultra HDR crop is outside the orientation-normalized source');
  const region = crop ?? previewWindow(job.preview, descriptor.master);
  if (job.format === 'exr32' || job.precisionInput === 'linear-master')
    return exportNativeMaster(job, descriptor, region, 'linear-master');
  const edit = job.precisionEdit === undefined ? undefined : parsePrecisionEdit(job.precisionEdit);
  if (edit && edit.algorithm !== 'scene-linear-v1')
    throw new Error('Scene-linear curves and regions require the retained float master');
  const master = join(job.workDir, 'master.tif'),
    output = `${job.outputPath!}.partial`,
    format = job.format!;
  boundedDimensions(descriptor.master.width, descriptor.master.height, job.options.maxPixels);
  const dimensions = region ?? descriptor.master;
  const pixels = dimensions.width * dimensions.height;
  if (edit && pixels > MEDIA_MAX_PRECISION_PIXELS) {
    if (
      !job.options.pythonExecutable ||
      !isSdrJpegSource(descriptor.original) ||
      pixels > MEDIA_MAX_SDR_MASTER_PIXELS
    )
      throw new MediaLimitError('Precision edits exceed the SDR master pixel budget');
    return exportNativeMaster(job, descriptor, region, 'master16');
  }
  if (
    format === 'webp' &&
    (Math.max(descriptor.master.width, descriptor.master.height) > 16383 ||
      pixels * 16 > job.options.memoryBytes * 0.7)
  )
    throw new MediaLimitError('WebP encoder dimensions or working memory exceed the media budget');
  await diskBudget(
    dirname(output),
    pixels * (format === 'png16' ? 16.25 : 8.125) + 8 * 1024 * 1024,
  );
  const masterStat = await lstat(master);
  if (
    !masterStat.isFile() ||
    masterStat.isSymbolicLink() ||
    masterStat.size !== descriptor.master.bytes ||
    (await digest(master)) !== descriptor.master.sha256
  )
    throw new Error('Retained master failed its immutable integrity check');
  let pipeline = sharp(master, {
    limitInputPixels: descriptor.master.width * descriptor.master.height,
    failOn: 'warning',
    sequentialRead: !region,
    ignoreIcc: true,
  });
  const actual = await pipeline.metadata();
  if (
    actual.width !== descriptor.master.width ||
    actual.height !== descriptor.master.height ||
    actual.format !== 'tiff' ||
    depth(actual) !== 16 ||
    (actual.pages ?? 1) !== 1
  )
    throw new Error('Retained master metadata does not match the descriptor');
  if (region) pipeline = pipeline.extract(region);
  if (edit) {
    const raw = await pipeline
      .toColourspace('rgb16')
      .ensureAlpha()
      .raw({ depth: 'ushort' })
      .toBuffer();
    if (raw.byteLength !== pixels * 8) throw new Error('Invalid master sample layout');
    const edited = editMaster16(
      new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2),
      4,
      edit,
    );
    pipeline = sharp(edited, {
      raw: { width: dimensions.width, height: dimensions.height, channels: 4 },
    }).toColourspace('rgb16');
  }
  const result = await writeSdrExport(pipeline, job, output);
  await rename(output, job.outputPath!);
  return {
    ...result,
    format,
    sourceSha256: descriptor.sourceSha256,
    includesEditorRecipe: false,
    ...precisionRecord(job.precisionEdit, descriptor.sourceSha256, 'master16'),
  };
}

try {
  const request = process.argv[2];
  if (!request) throw new Error('Missing fixed media job');
  const job = JSON.parse(await readFile(request, 'utf8')) as Job;
  const result =
    job.kind === 'import'
      ? await importMedia(job)
      : job.kind === 'export'
        ? await exportMaster(job)
        : (() => {
            throw new Error('Unknown media operation');
          })();
  await writeFile(job.resultPath, JSON.stringify(result), { mode: 0o600 });
} catch (error) {
  // Diagnostic text stays in the parent process boundary. No binary image or credentials are printed.
  process.stderr.write(`${error instanceof Error ? error.message : 'Media processing failed'}\n`);
  process.exitCode =
    error instanceof MediaLimitError ||
    (error instanceof MediaProcessingError && error.code === 'limit')
      ? 2
      : 1;
}
