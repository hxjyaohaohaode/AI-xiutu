export const MEDIA_PROTOCOL = 'media-v1' as const;
export const MEDIA_DEFAULT_MAX_PIXELS = 200_000_000;
// The 2 GiB worker file limit leaves room for a 4-channel uint16 TIFF and its
// bounded tile/codec overhead at this ceiling. Format budgets can be lower.
export const MEDIA_MAX_PIXELS = 256_000_000;
export const MEDIA_MAX_SIDE = 65_535;
export const MEDIA_MAX_TILE_COUNT = 8_192;
export const MEDIA_MAX_INPUT_BYTES = 536_870_912;
export const MEDIA_MAX_PROXY_PIXELS = 4_194_304;
export const MEDIA_MAX_PRECISION_PIXELS = 16_777_216;
export const MEDIA_MAX_LINEAR_PIXELS = 64_000_000;
export const MEDIA_MAX_HDR_IMPORT_PIXELS = 50_000_000;
export const MEDIA_MAX_GAIN_MAP_PIXELS = 24_000_000;
export const MEDIA_MAX_GAIN_MAP_BYTES = 128 * 1024 ** 2;
export const MEDIA_MIN_GAIN_MAP_SIDE = 8;
export const MEDIA_MAX_GAIN_MAP_SIDE = 8192;
export const MEDIA_MAX_PREVIEW_EDGE = 2048;
export class MediaProcessingError extends Error {
  constructor(
    message: string,
    readonly code: 'unsupported' | 'limit' | 'aborted' | 'timeout' | 'processing',
  ) {
    super(message);
    this.name = 'MediaProcessingError';
  }
}
export interface MediaProcessingOptions {
  maxPixels?: number;
  maxInputBytes?: number;
  maxProxyPixels?: number;
  tileSize?: 256 | 512 | 1024;
  generateTiles?: boolean;
  /** Wall time includes subprocess bootstrap and all decodes/encodes. */
  timeoutMs?: number;
  /** Linux address-space limit. Native decoders run only in the isolated subprocess. */
  memoryBytes?: number;
  /** Optional trusted interpreter with the pinned native requirements installed. */
  pythonExecutable?: string;
  /** Optional trusted reference Ultra HDR codec library. */
  ultraHdrLibrary?: string;
}
export interface MediaFileV1 {
  relativePath: string;
  bytes: number;
  sha256: string;
  mime: string;
  width: number;
  height: number;
  bitDepth: number;
  colorSpace: string;
}
export interface MediaDescriptorV1 {
  protocol: typeof MEDIA_PROTOCOL;
  id: string;
  sourceSha256: string;
  originalName: string;
  original: MediaFileV1 & {
    format: string;
    /** Native formats disambiguate half/float/RGBE or sensor samples from decoded precision. */
    sampleEncoding?: 'uint' | 'half-float' | 'float' | 'rgbe' | 'sensor-raw' | 'gain-map';
    decodedBitDepth?: number;
    gainMap?: { width: number; height: number; hdrGamut: 'Rec.709' | 'Display P3' | 'Rec.2020' };
    /** null means that this decoder did not inspect an embedded ICC resource. */
    hasIcc: boolean | null;
    metadataSummary: {
      inspection: 'full' | 'icc-only' | 'not-inspected';
      orientation: number | null;
      hasExif: boolean | null;
      hasXmp: boolean | null;
      iccSha256: string | null;
      pages: number;
    };
  };
  /** sRGB uint16 TIFF working master. HDR source is retained; this master is explicitly SDR. */
  master: MediaFileV1;
  /** Scene-linear float32 pixels from validated HDR input or a linear RAW development. */
  linearMaster?: MediaFileV1;
  /** Display sRGB RGBA8 PNG, separate from the immutable encoded source/master. */
  proxy: MediaFileV1 & { normalizedDimensions: { width: number; height: number } };
  tiles: {
    relativePath: 'tiles.dzi';
    directory: 'tiles_files';
    tileSize: number;
    overlap: 1;
    levels: number;
    format: 'jpeg';
    bytes: number;
    count: number;
  } | null;
  /** PSD metadata is bounded, descriptive, and does not claim editable round-trip fidelity. */
  layers: {
    name: string;
    left: number;
    top: number;
    right: number;
    bottom: number;
    hidden: boolean;
  }[];
  warnings: string[];
  processor: {
    sharp: string;
    vips: string;
    native: string | null;
    isolation: 'linux-prlimit';
    memoryBytes: number;
    timeoutMs: number;
    durationMs?: number;
    peakRssBytes?: number;
    nativePeakRssBytes?: number;
  };
}
export interface ProcessMediaRequest {
  /** An API-owned regular file, never an arbitrary client path or URL. */
  inputPath: string;
  /** A new private output directory. Existing output is never overwritten. */
  workDir: string;
  originalName?: string;
  signal?: AbortSignal;
  options?: MediaProcessingOptions;
}
export type MediaExportFormat = 'png16' | 'tiff16' | 'jpeg' | 'webp' | 'exr32' | 'ultrahdr';
export type MediaPrecisionInput = 'master16' | 'linear-master';
export interface MediaGradeRevision {
  version: number;
  sourceSha256: string;
  precisionInput: MediaPrecisionInput;
  edit: PrecisionEdit;
  createdAt: string;
}
export interface MediaPrecisionWindow {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface MediaPrecisionPreview {
  maxEdge: number;
  /** Source data-window coordinates after orientation normalization. */
  region?: MediaPrecisionWindow;
}
export interface ExportMediaRequest {
  workDir: string;
  /** A new API-owned output path. No replacement of existing files. */
  outputPath: string;
  format: MediaExportFormat;
  /** Explicit global grading of the actual retained master, independently versioned. */
  precisionEdit?: PrecisionEdit;
  /** Existing SDR exports default to master16. EXR always requires the linear master. */
  precisionInput?: MediaPrecisionInput;
  /** Display PNG16, optionally limited to a native-resolution window. */
  preview?: MediaPrecisionPreview;
  /** Ultra HDR JPEG output crop in orientation-normalized source pixels. */
  crop?: MediaPrecisionWindow;
  signal?: AbortSignal;
  options?: Pick<MediaProcessingOptions, 'timeoutMs' | 'memoryBytes' | 'pythonExecutable'> & {
    quality?: number;
  };
}
export interface MediaExportResult extends MediaFileV1 {
  format: MediaExportFormat;
  sourceSha256: string;
  /** This converts the retained master; browser edits are not injected into a high-bit master. */
  includesEditorRecipe: false;
  precisionEdit?: {
    algorithm: PrecisionEdit['algorithm'];
    sha256: string;
    input: MediaPrecisionInput;
    edit: PrecisionEdit;
  };
}
import type { PrecisionEdit } from '@ai-xiutu/editor';
