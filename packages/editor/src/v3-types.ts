import type {
  Adjustments,
  Curves,
  Point,
  RadialMask,
  RenderOptions,
  RGBAImage,
  TiledRenderOptions,
} from './types.js';
import type {
  RecipeV2,
  LevelsV2,
  HslMixerV2,
  ColorGradingV2,
  DetailV2,
  EffectsV2,
  SelectionMaskV2,
} from './v2-types.js';

export interface OperationOriginV3 {
  moduleId: string;
  instanceId: string;
  parameterId: string;
  value: number;
  parameters?: Record<string, number>;
}

/** All coordinates refer to the oriented, uncropped source image. */
export interface CompoundMaskV3 {
  type: 'compound';
  operation: 'union' | 'intersection' | 'subtract' | 'xor';
  masks: SelectionMaskV3[];
  invert: boolean;
}
export type RadialShapeV3 = 'ellipse' | 'rectangle' | 'diamond';
export interface RadialMaskV3 extends RadialMask {
  /** Clockwise in oriented source-pixel space. Omitted uses the published axis-aligned ellipse. */
  rotationDegrees?: number;
  shape?: RadialShapeV3;
}
export type SelectionMaskV3 = Exclude<SelectionMaskV2, RadialMask> | RadialMaskV3 | CompoundMaskV3;

export interface FineTransformV3 {
  /** Clockwise rotation, degrees. Applied after the legacy integer crop/quarter turn. */
  rotationDegrees: number;
  /** Projective tilt in degrees, signed. ±60°, not a 3D camera/scene reconstruction. */
  perspectiveX: number;
  perspectiveY: number;
  /** Affine shear in degrees, signed. */
  skewX: number;
  skewY: number;
  scaleX: number;
  scaleY: number;
  /** Translation as a fraction of the pre-transform cropped width/height. */
  translateX: number;
  translateY: number;
  /** contain expands to include transformed corners; crop retains the old output extent. */
  fit: 'contain' | 'crop';
}
export interface OpticsV3 {
  denoiseLuminance: number;
  denoiseChroma: number;
  /** Signed radial red/blue displacement, pixels at the shorter source half-edge. */
  aberrationRed: number;
  aberrationBlue: number;
  aberrationCenterX: number;
  aberrationCenterY: number;
}
export interface ColorBlockV3 {
  adjustments: Adjustments;
  curves: Curves;
  levels: LevelsV2;
  hsl: HslMixerV2;
  grading: ColorGradingV2;
  detail: DetailV2;
  effects: EffectsV2;
  optics: OpticsV3;
}
export interface AdjustmentRegionV3 {
  origin?: OperationOriginV3;
  id: string;
  name: string;
  enabled: boolean;
  opacity: number;
  mask: SelectionMaskV3;
  color: ColorBlockV3;
  /** null = independent; the group's color is applied once to the union of its active masks. */
  groupId: string | null;
}
export interface RegionGroupV3 {
  id: string;
  name: string;
  enabled: boolean;
  opacity: number;
  color: ColorBlockV3;
}
export type BlendModeV3 =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'color-dodge'
  | 'color-burn'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';
export interface PaintStrokeV3 {
  points: Point[];
  /** Explicit pressure/continuity semantics. Omitted strokes use the published rasterizer. */
  sampling?: {
    algorithm: 'swept-v1';
    pressure: number[];
    breaks: number[];
    antialias: boolean;
  };
  /** Radius in units of the shorter source edge; 0.5/sourceShortEdge is one pixel. */
  radius: number;
  feather: number;
  opacity: number;
  mode: 'paint' | 'erase' | 'clone';
  /** Straight RGBA8. Alpha is opacity, 255 = fully opaque. */
  color: [number, number, number, number];
  /** Clone sample origin corresponding to points[0], from immutable pre-paint image. */
  source: Point | null;
}
export interface PaintLayerV3 {
  origin?: OperationOriginV3;
  id: string;
  name: string;
  enabled: boolean;
  opacity: number;
  blendMode: BlendModeV3;
  mask: SelectionMaskV3 | null;
  strokes: PaintStrokeV3[];
}
export interface WarpStrokeV3 {
  /** Omitted preserves the published displacement field. New flows integrate a smooth velocity. */
  algorithm?: 'flow-v1' | 'flow-v2';
  resampling?: 'bounded-cubic-v1';
  origin?: OperationOriginV3;
  id: string;
  mode: 'push' | 'pinch' | 'bulge' | 'twirl';
  from: Point;
  to: Point;
  radius: number;
  feather: number;
  /** Signed amount, -1…1. Negative reverses direction; zero is identity. */
  strength: number;
}
export interface WarpV3 {
  enabled: boolean;
  strokes: WarpStrokeV3[];
  /** Full weight locks original displayed pixels; feathered weights soften the boundary. */
  protection: SelectionMaskV3 | null;
}
export interface ImageLayerV3 {
  origin?: OperationOriginV3;
  id: string;
  name: string;
  enabled: boolean;
  opacity: number;
  blendMode: BlendModeV3;
  /** A caller-resolved immutable image identifier, never a URL or executable resource. */
  sourceId: string;
  /** Placement in normalized source-frame coordinates; may extend outside its edges. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotationDegrees: number;
  flipX: boolean;
  flipY: boolean;
  mask: SelectionMaskV3 | null;
}
/** All legacy v2 stages remain intact; v3 additions have explicit separate ordering. */
export interface RecipeV3 extends Omit<RecipeV2, 'schemaVersion' | 'engineVersion'> {
  schemaVersion: 3;
  engineVersion: '3.0.0';
  transform: FineTransformV3;
  optics: OpticsV3;
  regionEdits: AdjustmentRegionV3[];
  regionGroups: RegionGroupV3[];
  imageLayers: ImageLayerV3[];
  paintLayers: PaintLayerV3[];
  warp: WarpV3;
}
type PartialData<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: PartialData<T[K]> }
    : T;
export type RecipeV3Overrides = PartialData<
  Omit<
    RecipeV3,
    'regions' | 'regionEdits' | 'regionGroups' | 'imageLayers' | 'paintLayers' | 'warp'
  >
> & {
  regions?: RecipeV2['regions'];
  regionEdits?: AdjustmentRegionV3[];
  regionGroups?: RegionGroupV3[];
  imageLayers?: ImageLayerV3[];
  paintLayers?: PaintLayerV3[];
  warp?: Partial<WarpV3>;
};
export type ColorBlockV3Overrides = PartialData<ColorBlockV3>;
export type AdjustmentRegionV3Overrides = Partial<Omit<AdjustmentRegionV3, 'color'>> & {
  color?: ColorBlockV3Overrides;
};
export type RecipeV3ValidationResult =
  { valid: true; recipe: RecipeV3; errors: [] } | { valid: false; errors: string[] };
export interface V3ToolDefinition {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
  neutral: number;
  unit: '%' | '°' | 'ratio' | 'px';
  group: 'transform' | 'optics';
  description: string;
}
/** Resolved image data is supplied by a trusted caller; this package performs no I/O. */
export interface RenderOptionsV3 extends RenderOptions {
  images?: ReadonlyMap<string, RGBAImage>;
  warpPreviewCache?: import('./warp-preview.js').WarpPreviewCache;
}
export interface TiledRenderOptionsV3 extends TiledRenderOptions {
  images?: ReadonlyMap<string, RGBAImage>;
  warpPreviewCache?: import('./warp-preview.js').WarpPreviewCache;
}
