import type { RecipeV3 } from './v3-types.js';
import type { RecipeV4 } from './v4-types.js';
import type {
  Adjustments,
  Curves,
  Geometry,
  LocalAdjustment,
  Point,
  RadialMask,
  RecipeV1,
} from './types.js';

/** New structured controls. Units and ordering belong to engine 2.0.0. */
export interface LevelsV2 {
  inputBlack: number;
  inputWhite: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
}
export type HslBandId =
  'red' | 'orange' | 'yellow' | 'green' | 'aqua' | 'blue' | 'purple' | 'magenta';
export interface HslBandV2 {
  hue: number;
  saturation: number;
  lightness: number;
}
export type HslMixerV2 = Record<HslBandId, HslBandV2>;
export interface GradingToneV2 {
  hue: number;
  saturation: number;
  luminance: number;
}
export interface ColorGradingV2 {
  shadows: GradingToneV2;
  midtones: GradingToneV2;
  highlights: GradingToneV2;
  balance: number;
}
export interface DetailV2 {
  texture: number;
  clarity: number;
}
export interface VignetteV2 {
  /** Positive darkens the outer field; negative brightens it, in a bounded EV gain. */
  amount: number;
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  feather: number;
}
export interface GrainV2 {
  amount: number;
  /** Integer lattice spacing in original-input pixels, not browser CSS pixels. */
  size: number;
  /** Unsigned 32-bit seed. No random state or clock is read during rendering. */
  seed: number;
  colored: boolean;
}
export interface EffectsV2 {
  monochrome: number;
  fade: number;
  vignette: VignetteV2;
  grain: GrainV2;
}
export interface LinearMaskV2 {
  type: 'linear';
  /** Weight 0 at start and 1 at end; projection uses the source's pixel aspect. */
  start: Point;
  end: Point;
  smooth: boolean;
  invert: boolean;
}
export interface PolygonMaskV2 {
  type: 'polygon';
  points: Point[];
  /** Inward feather width as a fraction of the shorter original image edge. */
  feather: number;
  invert: boolean;
}
export interface BrushStrokeV2 {
  points: Point[];
  /** Circular capsule radius (0.000001…0.5) as a fraction of the shorter original image edge. */
  radius: number;
  feather: number;
  opacity: number;
  mode: 'add' | 'subtract';
}
export interface BrushMaskV2 {
  type: 'brush';
  strokes: BrushStrokeV2[];
  invert: boolean;
}
export interface RasterMaskV2 {
  type: 'raster';
  width: number;
  height: number;
  /** Alternating positive run length and byte weight, covering width*height cells. */
  runs: number[];
  /** Old masks omit this and retain nearest-cell sampling. */
  sampling?: 'bilinear-v1';
  /** Source-normalized mask viewport. Full frame when omitted. */
  bounds?: { x: number; y: number; width: number; height: number };
  invert: boolean;
}
export interface ColorRangeMaskV2 {
  type: 'color-range';
  /** Continuous circular HSV hue center and half-width, in degrees. */
  hue: number;
  hueWidth: number;
  saturationMin: number;
  saturationMax: number;
  /** Display-encoded Rec.709 Y′ proxy, not physical linear luminance. */
  luminanceMin: number;
  luminanceMax: number;
  feather: number;
  invert: boolean;
}
export type SelectionMaskV2 =
  RadialMask | LinearMaskV2 | PolygonMaskV2 | BrushMaskV2 | RasterMaskV2 | ColorRangeMaskV2;
export interface AdjustmentRegionV2 {
  id: string;
  name: string;
  enabled: boolean;
  opacity: number;
  mask: SelectionMaskV2;
  adjustments: Adjustments;
}

/** Keeps the complete v1 stage, then appends explicitly versioned new stages. */
export interface RecipeV2 {
  schemaVersion: 2;
  engineVersion: '2.0.0';
  adjustments: Adjustments;
  curves: Curves;
  geometry: Geometry;
  /** Original v1 local stage is retained exactly for lossless semantic migration. */
  local: LocalAdjustment;
  levels: LevelsV2;
  hsl: HslMixerV2;
  grading: ColorGradingV2;
  detail: DetailV2;
  effects: EffectsV2;
  /** Ordered manual adjustment regions, after global v2 tone/detail stages. */
  regions: AdjustmentRegionV2[];
}
export type EditorRecipe = RecipeV1 | RecipeV2 | RecipeV3 | RecipeV4;

type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [P in keyof T]?: DeepPartial<T[P]> }
    : T;
export type RecipeV2Overrides = DeepPartial<Omit<RecipeV2, 'regions'>> & {
  regions?: AdjustmentRegionV2[];
};
export type AdjustmentRegionV2Overrides = Partial<
  Omit<AdjustmentRegionV2, 'adjustments' | 'mask'>
> & {
  adjustments?: Partial<Adjustments>;
  mask?: SelectionMaskV2;
};
export type EditorRecipeValidationResult =
  { valid: true; recipe: EditorRecipe; errors: [] } | { valid: false; errors: string[] };
export type RecipeV2ValidationResult =
  { valid: true; recipe: RecipeV2; errors: [] } | { valid: false; errors: string[] };
export interface V2ToolDefinition {
  /** Dot path into a RecipeV2. All registry controls are numeric, not arbitrary object access. */
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  neutral: number;
  unit: '%' | '°' | 'ratio' | 'px' | 'seed';
  group: 'levels' | 'hsl' | 'grading' | 'detail-v2' | 'effects';
  domain: 'linear-srgb' | 'encoded-srgb' | 'hsl' | 'source-pixels';
  description: string;
}
