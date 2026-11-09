/** RGBA8, straight alpha, display-encoded sRGB. EXIF orientation is already applied. */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Adjustments {
  /** Linear-light gain in EV, -3 through +3. */
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;
  /** Separate nonnegative detail controls; neither is a face detector. */
  sharpness: number;
  soften: number;
}

export type AdjustmentId = keyof Adjustments;
export type CurvePoint = [number, number];
export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue';
export type Curves = Record<CurveChannel, CurvePoint[]>;

/** Normalized coordinates in the original, oriented input; before crop/rotate/flip. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Geometry {
  crop: CropRect | null;
  rotation: 0 | 90 | 180 | 270;
  /** Flips refer to the output axes, after clockwise rotation. */
  flipX: boolean;
  flipY: boolean;
}

export interface RadialMask {
  type: 'radial';
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  /** Fraction of radius occupied by the smooth edge, 0=hard edge, 1=all feather. */
  feather: number;
  invert: boolean;
}

export interface LocalAdjustment {
  enabled: boolean;
  mask: RadialMask;
  adjustments: Adjustments;
}

export interface RecipeV1 {
  schemaVersion: 1;
  engineVersion: '1.0.0';
  adjustments: Adjustments;
  curves: Curves;
  geometry: Geometry;
  local: LocalAdjustment;
}

export type Recipe = RecipeV1;

export interface RecipeOverrides {
  schemaVersion?: 1;
  engineVersion?: '1.0.0';
  adjustments?: Partial<Adjustments>;
  curves?: Partial<Curves>;
  geometry?: Partial<Geometry>;
  local?: {
    enabled?: boolean;
    mask?: Partial<RadialMask>;
    adjustments?: Partial<Adjustments>;
  };
}

export interface ToolDefinition {
  id: AdjustmentId;
  label: string;
  min: number;
  max: number;
  step: number;
  neutral: 0;
  unit: 'EV' | '%';
  group: 'light' | 'color' | 'detail';
  description: string;
  domain: 'linear-srgb' | 'encoded-srgb';
}

export type RecipeValidationResult =
  { valid: true; recipe: RecipeV1; errors: [] } | { valid: false; errors: string[] };

export interface RenderOptions {
  /** Default 4MP. Up to 16MP only when the caller explicitly budgets the memory. */
  maxPixels?: number;
  signal?: { readonly aborted: boolean };
}

/** Explicit high-resolution path. Application/decoder memory budgets may be lower. */
export interface TiledRenderOptions {
  /** Default/hard ceiling 67,108,864 pixels; this does not change renderRecipe's limits. */
  maxPixels?: number;
  /** Source-space core tile edge, integer 16..1024; default 512. Halo is additional. */
  tileSize?: number;
  signal?: { readonly aborted: boolean };
}

export interface Histogram {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  luminance: Uint32Array;
  /** Counts nonzero-alpha pixels, not alpha-weighted samples. */
  pixelCount: number;
}

export interface Point {
  x: number;
  y: number;
}
export interface Dimensions {
  width: number;
  height: number;
}
