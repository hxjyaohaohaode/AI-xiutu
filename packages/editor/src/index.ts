export type * from './types.js';
export { localEditorSourceLimits } from './source-limits.js';
export type * from './v2-types.js';
export { TOOLS, ADJUSTMENT_IDS, neutralAdjustments } from './registry.js';
export {
  DEFAULT_RECIPE,
  ENGINE_VERSION,
  SCHEMA_VERSION,
  RecipeValidationError,
  createRecipe,
  validateRecipe,
  parseRecipe,
} from './recipe.js';
export {
  MAX_DIMENSION,
  MAX_INPUT_PIXELS,
  MAX_EXPLICIT_PIXELS,
  MAX_TILED_DIMENSION,
  MAX_TILED_PIXELS,
  getOutputDimensions,
  fitOrientedCrop,
  orientedCropSpace,
  orientGeometry,
  pixelCrop,
  mapSourceToOutput,
  mapOutputToSource,
} from './geometry.js';
export type { OrientationAction } from './geometry.js';
export {
  renderRecipe,
  computeHistogram,
  validateImage,
  RenderAbortedError,
  srgbToLinear,
  linearToSrgb,
} from './engine.js';
export {
  compileCurveLut,
  sampleCurveLut,
  isIdentityCurve,
  withCurve,
  smoothCurveSegments,
  translateCurvePoints,
  compileCurveFunction,
} from './curves.js';
export { radialMaskWeight } from './mask.js';
export { renderRecipeTiled, validateTiledImage, DEFAULT_TILE_SIZE, TILE_HALO } from './tiled.js';
export { readImageHeader, MAX_HEADER_BYTES, ImageHeaderError } from './headers.js';
export { encodeRgbaPng } from './png.js';
export { radialMaskFrameV3 } from './v3-radial.js';
export { WarpPreviewCache } from './warp-preview.js';
export { measureSceneTone } from './scene-tone.js';
export type { ImageHeader, HeaderLimits } from './headers.js';
export {
  DEFAULT_RECIPE_V2,
  SCHEMA_VERSION_V2,
  ENGINE_VERSION_V2,
  createRecipeV2,
  parseRecipeV2,
  validateRecipeV2,
  parseEditorRecipe,
  validateEditorRecipe,
  migrateRecipeToV2,
  patchEditorAdjustments,
  createAdjustmentRegionV2,
  parseSelectionMask,
  getRecipeV2Parameter,
  setRecipeV2Parameter,
} from './v2-recipe.js';
export {
  V2_TOOLS,
  HSL_BANDS,
  MAX_ADJUSTMENT_REGIONS,
  MAX_POLYGON_POINTS,
  MAX_BRUSH_STROKES,
  MAX_BRUSH_POINTS_PER_STROKE,
  MAX_BRUSH_POINTS_PER_MASK,
  MAX_TOTAL_BRUSH_POINTS,
  MAX_RASTER_RUNS_PER_MASK,
  MAX_TOTAL_RASTER_RUNS,
} from './v2-registry.js';
export { compileSelectionMask, createRasterMask } from './v2-mask.js';
export type { SelectionMaskSampler } from './v2-mask.js';
export {
  renderRecipeV2,
  renderRecipeV2Tiled,
  renderEditorRecipe,
  renderEditorRecipeTiled,
  recipeV2Halo,
} from './v2-engine.js';

export type * from './v3-types.js';
export {
  SCHEMA_VERSION_V3,
  ENGINE_VERSION_V3,
  createRecipeV3,
  parseRecipeV3,
  validateRecipeV3,
  migrateRecipeToV3,
  createColorBlockV3,
  createAdjustmentRegionV3,
  createFineTransformV3,
  createOpticsV3,
  parseSelectionMaskV3,
  recipeV2Stage,
  getEditorParameter,
  setEditorParameter,
} from './v3-recipe.js';
export {
  V3_TOOLS,
  BLEND_MODES_V3,
  MAX_V3_PIXELS,
  MAX_V3_REGION_EDITS,
  MAX_V3_REGION_GROUPS,
  MAX_V3_PAINT_LAYERS,
  MAX_V3_IMAGE_LAYERS,
  MAX_V3_PAINT_STROKES,
  MAX_V3_PAINT_POINTS,
  MAX_V3_STROKE_POINTS,
  MAX_V3_WARP_STROKES,
  MAX_V3_MASK_NODES,
  MAX_V3_MASK_DEPTH,
  MAX_V3_PAINT_INDEX_REFERENCES,
  MAX_V3_PAINT_WORK,
} from './v3-registry.js';
export { renderRecipeV3, renderRecipeV3Tiled } from './v3-engine.js';
export {
  compileFineTransformV3,
  applyMatrixV3,
  getEditorOutputDimensions,
  getEditorPreProjectiveDimensions,
  mapEditorSourceToOutput,
  mapEditorOutputToSource,
  mapEditorOutputToContent,
  compileEditorCoordinateMap,
} from './v3-geometry.js';
export type { Matrix3V3, TransformContextV3, EditorCoordinateMap } from './v3-geometry.js';
export { compileSelectionMaskV3, getSelectionBoundsV3 } from './v3-mask.js';
export { blendRgbaV3 } from './v3-blend.js';
export { compileWarpFieldV3 } from './v3-warp.js';
export type * from './v4-types.js';
export {
  SCHEMA_VERSION_V4,
  ENGINE_VERSION_V4,
  createRecipeV4,
  parseRecipeV4,
  validateRecipeV4,
  migrateRecipeToV4,
  createProjectiveTransformV4,
  createHealingOperationV4,
  createRetouchRegionV4,
} from './v4-recipe.js';
export {
  compileProjectiveTransformV4,
  validateProjectiveQuadV4,
  applyProjectiveMatrixV4,
  mapProjectiveOutputToCornerFrame,
  mapProjectiveCornerFrameToOutput,
} from './v4-geometry.js';
export type { ProjectiveContextV4 } from './v4-geometry.js';
export {
  MAX_V4_PIXELS,
  MAX_V4_HEALING_OPERATIONS,
  MAX_V4_RETOUCH_REGIONS,
  MAX_V4_NEW_MASK_NODES,
  MAX_V4_HEAL_ROI_PIXELS,
  MAX_V4_HEAL_TARGET_PIXELS,
  MAX_V4_HEAL_WORK,
} from './v4-types.js';
export { MAX_V4_RETOUCH_PIXELS } from './v4-spatial.js';
export { renderRecipeV4, renderRecipeV4Tiled } from './v4-engine.js';
export { renderCutout, MAX_CUTOUT_PIXELS, type CutoutSettings } from './matte.js';
export {
  renderPhotoRestoration,
  restorationCost,
  motionKernel,
  type PhotoRestorationSettings,
} from './restoration.js';
export {
  NEUTRAL_PRECISION_EDIT,
  PRECISION_EDIT_CONTROLS,
  parsePrecisionEdit,
  compilePrecisionEdit,
  type PrecisionEditV1,
} from './linear-edit.js';
