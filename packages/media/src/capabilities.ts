import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { isAbsolute } from 'node:path';
import {
  PRECISION_CURVE_CHANNELS,
  PRECISION_CURVE_LIMITS,
  MAX_PRECISION_REGIONS,
  PRECISION_REGION_MASKS,
  PRECISION_EDIT_CONTROLS,
} from '@ai-xiutu/editor';
import sharp from 'sharp';
import {
  MEDIA_DEFAULT_MAX_PIXELS,
  MEDIA_MAX_PIXELS,
  MEDIA_MAX_INPUT_BYTES,
  MEDIA_MAX_PROXY_PIXELS,
  MEDIA_MAX_SIDE,
  MEDIA_MAX_TILE_COUNT,
  MEDIA_MAX_PRECISION_PIXELS,
  MEDIA_MAX_LINEAR_PIXELS,
  MEDIA_MAX_HDR_IMPORT_PIXELS,
  MEDIA_MAX_PREVIEW_EDGE,
} from './types.js';
const probes = new Map<string, { at: number; versions: Record<string, string> | null }>();
async function probeNative(path: string): Promise<Record<string, string> | null> {
  const cached = probes.get(path);
  if (cached && Date.now() - cached.at < 60_000) return cached.versions;
  const versions = await new Promise<Record<string, string> | null>((resolve) => {
    execFile(
      path,
      [
        '-I',
        '-c',
        'import json,rawpy,OpenImageIO as o,numpy; print(json.dumps({"rawpy":rawpy.__version__,"openimageio":o.VERSION_STRING,"numpy":numpy.__version__,"libraw":".".join(map(str,rawpy.libraw_version))}))',
      ],
      {
        timeout: 5000,
        maxBuffer: 4096,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          OPENBLAS_NUM_THREADS: '1',
          OMP_NUM_THREADS: '1',
        },
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        try {
          const value: unknown = JSON.parse(stdout);
          resolve(
            value &&
              typeof value === 'object' &&
              ['rawpy', 'openimageio', 'numpy', 'libraw'].every(
                (key) => typeof (value as Record<string, unknown>)[key] === 'string',
              )
              ? (value as Record<string, string>)
              : null,
          );
        } catch {
          resolve(null);
        }
      },
    );
  });
  if (probes.size >= 8) probes.clear();
  probes.set(path, { at: Date.now(), versions });
  return versions;
}

/** Deployment availability, distinct from an image's successful decode or an editor's precision. */
export async function getMediaCapabilities(
  options: { pythonExecutable?: string; maxPixels?: number } = {},
) {
  let isolated = false,
    nativeConfigured = false;
  if (process.platform === 'linux')
    try {
      await access('/usr/bin/prlimit', constants.X_OK);
      isolated = true;
    } catch {
      /* unavailable */
    }
  if (options.pythonExecutable && isAbsolute(options.pythonExecutable))
    try {
      await access(options.pythonExecutable, constants.X_OK);
      nativeConfigured = true;
    } catch {
      /* unavailable */
    }
  const nativeVersions = nativeConfigured ? await probeNative(options.pythonExecutable!) : null;
  return {
    protocol: 'media-v1' as const,
    available: isolated,
    isolation: isolated ? ('linux-prlimit' as const) : null,
    maxPixels: options.maxPixels ?? MEDIA_DEFAULT_MAX_PIXELS,
    absoluteRasterPixelCeiling: MEDIA_MAX_PIXELS,
    maxRasterSide: MEDIA_MAX_SIDE,
    maxTileCount: MEDIA_MAX_TILE_COUNT,
    formatAndResourceLimitsApply: true,
    maxInputBytes: MEDIA_MAX_INPUT_BYTES,
    maxProxyPixels: MEDIA_MAX_PROXY_PIXELS,
    maxRawPixels: Math.min(options.maxPixels ?? MEDIA_DEFAULT_MAX_PIXELS, MEDIA_MAX_LINEAR_PIXELS),
    maxPsdPixels: Math.min(options.maxPixels ?? MEDIA_DEFAULT_MAX_PIXELS, 16_777_216),
    maxHdrPixels: Math.min(
      options.maxPixels ?? MEDIA_DEFAULT_MAX_PIXELS,
      MEDIA_MAX_HDR_IMPORT_PIXELS,
    ),
    maxConcurrent: 1,
    maxQueued: 8,
    nativeConfigured,
    nativeReady: nativeVersions !== null,
    nativeVersions,
    nativeNotice: nativeVersions
      ? 'Native imports succeeded; individual formats, color interpretation and budgets are still validated per input'
      : nativeConfigured
        ? 'Interpreter exists but native dependencies could not be imported'
        : 'RAW/EXR/Radiance require the separately installed native requirements',
    rasterFormats: Object.entries(sharp.format)
      .filter(
        ([name, value]) =>
          ['jpeg', 'png', 'webp', 'tiff', 'gif', 'heif'].includes(name) && value.input.file,
      )
      .map(([name]) => (name === 'heif' ? 'avif' : name)),
    psd: {
      composite: true,
      layersEditable: false,
      bitDepths: [8, 16],
      colorModes: ['rgb', 'grayscale'],
      maxLayers: 256,
    },
    exports: ['png16', 'tiff16', 'jpeg', 'webp'] as const,
    precisionEditing: {
      algorithm: 'scene-linear-v1',
      master16: isolated,
      linearFloat: isolated && nativeVersions !== null,
      floatFormat: 'exr32',
      maxPixels: MEDIA_MAX_PRECISION_PIXELS,
      maxLinearPixels: MEDIA_MAX_LINEAR_PIXELS,
      previewMaxEdge: MEDIA_MAX_PREVIEW_EDGE,
      curves: {
        algorithm: 'scene-linear-v2',
        input: 'linear-master',
        available: isolated && nativeVersions !== null,
        channels: PRECISION_CURVE_CHANNELS,
        referenceGrey: 0.18,
        ...PRECISION_CURVE_LIMITS,
      },
      regions: {
        algorithm: 'scene-linear-v3',
        input: 'linear-master',
        available: isolated && nativeVersions !== null,
        coordinates: 'source-normalized',
        maxRegions: MAX_PRECISION_REGIONS,
        masks: PRECISION_REGION_MASKS,
        adjustments: PRECISION_EDIT_CONTROLS.map(({ key }) => key),
      },
      controls: [
        'exposure',
        'temperature',
        'tint',
        'contrast',
        'saturation',
        'shadows',
        'highlights',
        'toneMap',
      ],
      browserRecipeIncluded: false,
      sourceHashRequired: true,
    },
    editorPrecision: 'sRGB RGBA8 proxy; master export does not include browser recipe edits',
    versions: { sharp: sharp.versions.sharp, vips: sharp.versions.vips, lcms: sharp.versions.lcms },
  };
}
