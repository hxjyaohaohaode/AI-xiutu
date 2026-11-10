import type { Point } from './types.js';
import type {
  RecipeV3,
  RecipeV3Overrides,
  SelectionMaskV3,
  OperationOriginV3,
  RenderOptionsV3,
  TiledRenderOptionsV3,
} from './v3-types.js';

/** Destination corners TL, TR, BR, BL in the normalized pre-projective output frame.
 * That frame already includes the legacy crop/turn/flip and fine v3 transform.
 * A valid quad is convex, clockwise in image coordinates, and has no horizon fold. */
export interface ProjectiveTransformV4 {
  enabled: boolean;
  corners: [Point, Point, Point, Point];
  fit: 'contain' | 'crop';
}

export interface HealingOperationV4 {
  origin?: OperationOriginV3;
  id: string;
  name: string;
  enabled: boolean;
  opacity: number;
  /** Both masks and donor center refer to normalized original source coordinates. */
  mask: SelectionMaskV3;
  protection: SelectionMaskV3 | null;
  method: 'diffusion' | 'patch-poisson';
  /** null selects a bounded deterministic surrounding donor search. */
  source: Point | null;
  /** Search radius in units of the shorter source edge. */
  searchRadius: number;
  /** Explicit finite Poisson relaxation budget, not a neural quality guarantee. */
  iterations: number;
  /** Donor-gradient preservation for patch-poisson; diffusion ignores this field. */
  texture: number;
}

/** Distinct local signal operations; no automatic acne/identity/3D reconstruction. */
export interface RetouchRegionV4 {
  origin?: OperationOriginV3;
  id: string;
  name: string;
  enabled: boolean;
  opacity: number;
  mask: SelectionMaskV3;
  protection: SelectionMaskV3 | null;
  /** Spatial radius relative to the shorter original source edge. */
  radius: number;
  smoothing: number;
  texture: number;
  uniformity: number;
  shine: number;
  speckle: number;
  fineLines: number;
}

/** New math is opt-in. Neutral migration delegates to the published v3 renderer. */
export interface RecipeV4 extends Omit<RecipeV3, 'schemaVersion' | 'engineVersion'> {
  schemaVersion: 4;
  engineVersion: '4.0.0';
  projective: ProjectiveTransformV4;
  healing: HealingOperationV4[];
  retouch: RetouchRegionV4[];
}

export type LayeredRecipe = RecipeV3 | RecipeV4;
export type RecipeV4Overrides = Omit<RecipeV3Overrides, 'schemaVersion' | 'engineVersion'> & {
  schemaVersion?: 4;
  engineVersion?: '4.0.0';
  projective?: Partial<ProjectiveTransformV4>;
  healing?: HealingOperationV4[];
  retouch?: RetouchRegionV4[];
};
export type RecipeV4ValidationResult =
  { valid: true; recipe: RecipeV4; errors: [] } | { valid: false; errors: string[] };
export type RenderOptionsV4 = RenderOptionsV3;
export type TiledRenderOptionsV4 = TiledRenderOptionsV3;

export const MAX_V4_PIXELS = 16_777_216;
export const MAX_V4_HEALING_OPERATIONS = 16;
export const MAX_V4_RETOUCH_REGIONS = 12;
export const MAX_V4_NEW_MASK_NODES = 128;
export const MAX_V4_HEAL_ROI_PIXELS = 1_048_576;
export const MAX_V4_HEAL_TARGET_PIXELS = 262_144;
export const MAX_V4_HEAL_WORK = 134_217_728;
