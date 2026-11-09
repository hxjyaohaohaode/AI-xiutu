import {
  createRenderSession,
  renderValidatedRegion,
  RenderAbortedError,
  type ReferenceRenderWorkspace,
} from './engine.js';
import {
  getOutputDimensions,
  outputPixel,
  pixelCrop,
  validateTiledDimensions,
} from './geometry.js';
import type { RecipeV1, RGBAImage, TiledRenderOptions } from './types.js';

export const DEFAULT_TILE_SIZE = 512;
/** Recipe engine 1.0.0 has two consecutive radius-1 detail stages. */
export const TILE_HALO = 2;

export function validateTiledImage(image: RGBAImage, options: TiledRenderOptions = {}): void {
  if (!image || typeof image !== 'object') throw new TypeError('Expected an RGBA image');
  validateTiledDimensions(image, options.maxPixels);
  if (
    !(image.data instanceof Uint8ClampedArray) ||
    image.data.length !== image.width * image.height * 4
  )
    throw new TypeError('Image data must contain exactly width × height × 4 RGBA8 bytes');
  const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
  if (!Number.isSafeInteger(tileSize) || tileSize < 16 || tileSize > 1024)
    throw new RangeError('tileSize must be an integer from 16 to 1024');
  if (options.signal?.aborted) throw new RenderAbortedError();
}

/**
 * Explicit high-resolution CPU renderer. Full input and full output RGBA remain
 * resident; only source-space tile/halo Float32 buffers are allocated and reused.
 * Exact reference semantics for the same input resolution and Recipe v1.
 */
export function renderRecipeTiled(
  image: RGBAImage,
  inputRecipe: RecipeV1,
  options: TiledRenderOptions = {},
): RGBAImage {
  validateTiledImage(image, options);
  const session = createRenderSession(inputRecipe);
  const geometry = session.recipe.geometry;
  const crop = pixelCrop(image, geometry);
  const dimensions = getOutputDimensions(image, geometry);
  const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE;
  const capacityWidth = Math.min(image.width, Math.min(tileSize, crop.width) + 2 * TILE_HALO);
  const capacityHeight = Math.min(image.height, Math.min(tileSize, crop.height) + 2 * TILE_HALO);
  const capacityPixels = capacityWidth * capacityHeight;
  const tileBytes = new Uint8ClampedArray(capacityPixels * 4);
  const workspace: ReferenceRenderWorkspace = {
    working: new Float32Array(capacityPixels * 3),
    scratch: new Float32Array(capacityPixels * 3),
    output: new Uint8ClampedArray(capacityPixels * 4),
  };
  // Process colors/details in original source coordinates. Geometry is performed
  // exactly once while the core (not the halo) is copied into the final output.
  const regionSession = {
    ...session,
    recipe: {
      ...session.recipe,
      geometry: { crop: null, rotation: 0 as const, flipX: false, flipY: false },
    },
  };
  const output = new Uint8ClampedArray(dimensions.width * dimensions.height * 4);
  const right = crop.left + crop.width;
  const bottom = crop.top + crop.height;
  for (let y = crop.top; y < bottom; y += tileSize) {
    for (let x = crop.left; x < right; x += tileSize) {
      if (options.signal?.aborted) throw new RenderAbortedError();
      const coreWidth = Math.min(tileSize, right - x);
      const coreHeight = Math.min(tileSize, bottom - y);
      const originX = Math.max(0, x - TILE_HALO);
      const originY = Math.max(0, y - TILE_HALO);
      const regionWidth = Math.min(image.width, x + coreWidth + TILE_HALO) - originX;
      const regionHeight = Math.min(image.height, y + coreHeight + TILE_HALO) - originY;
      const data = tileBytes.subarray(0, regionWidth * regionHeight * 4);
      for (let row = 0; row < regionHeight; row += 1) {
        const sourceOffset = ((originY + row) * image.width + originX) * 4;
        data.set(
          image.data.subarray(sourceOffset, sourceOffset + regionWidth * 4),
          row * regionWidth * 4,
        );
      }
      const rendered = renderValidatedRegion(
        { width: regionWidth, height: regionHeight, data },
        regionSession,
        options,
        { width: image.width, height: image.height, originX, originY },
        workspace,
      );
      for (let row = 0; row < coreHeight; row += 1) {
        if ((row & 31) === 0 && options.signal?.aborted) throw new RenderAbortedError();
        for (let column = 0; column < coreWidth; column += 1) {
          const sourceOffset = ((y - originY + row) * regionWidth + x - originX + column) * 4;
          const targetOffset = outputPixel(x + column, y + row, dimensions, crop, geometry) * 4;
          output[targetOffset] = rendered.data[sourceOffset]!;
          output[targetOffset + 1] = rendered.data[sourceOffset + 1]!;
          output[targetOffset + 2] = rendered.data[sourceOffset + 2]!;
          output[targetOffset + 3] = rendered.data[sourceOffset + 3]!;
        }
      }
    }
  }
  if (options.signal?.aborted) throw new RenderAbortedError();
  return { ...dimensions, data: output };
}
