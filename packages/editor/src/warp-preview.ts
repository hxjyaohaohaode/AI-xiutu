import type { RenderOptions, RGBAImage } from './types.js';
import type { RecipeV3, TiledRenderOptionsV3, WarpV3 } from './v3-types.js';
import type { RecipeV4 } from './v4-types.js';
import { applyWarpV3 } from './v3-warp.js';

/** One immutable source-space intermediate, owned by a single preview worker. */
export class WarpPreviewCache {
  private frame: {
    source: RGBAImage;
    signature: string;
    auxiliary: Array<RGBAImage | undefined>;
    image: RGBAImage;
  } | null = null;
  private prefix: {
    input: RGBAImage;
    original: RGBAImage;
    signature: string;
    pixels: RGBAImage;
  } | null = null;
  private settled: typeof this.prefix = null;
  private warming = false;

  prewarm(render: () => RGBAImage) {
    this.warming = true;
    try {
      render();
    } finally {
      this.warming = false;
    }
  }

  clear() {
    this.frame = null;
    this.prefix = null;
    this.settled = null;
  }

  keeps(image: RGBAImage) {
    return (
      this.frame?.image.data.buffer === image.data.buffer ||
      this.prefix?.pixels.data.buffer === image.data.buffer ||
      this.settled?.pixels.data.buffer === image.data.buffer
    );
  }

  beforeWarp(
    source: RGBAImage,
    recipe: RecipeV3 | RecipeV4,
    options: TiledRenderOptionsV3,
    tiled: boolean,
    render: () => RGBAImage,
  ): RGBAImage {
    const {
      warp: _warp,
      geometry: _geometry,
      transform: _transform,
      projective: _projective,
      ...prefix
    } = recipe as RecipeV4;
    // Names and ownership are editor metadata. Changing a portrait strength
    // updates provenance on all its operations even when their pixels are identical.
    const pixelsOnly = <T extends { origin?: unknown; name?: string }>({
      origin,
      name,
      ...pixels
    }: T) => pixels;
    const signature = JSON.stringify([
      {
        ...prefix,
        regionEdits: prefix.regionEdits.map(pixelsOnly),
        paintLayers: prefix.paintLayers.map(pixelsOnly),
        imageLayers: prefix.imageLayers.map(pixelsOnly),
        ...('healing' in prefix
          ? {
              healing: prefix.healing.map(pixelsOnly),
              retouch: prefix.retouch.map(pixelsOnly),
            }
          : {}),
      },
      options.maxPixels,
      options.tileSize,
      tiled,
    ]);
    const auxiliary = prefix.imageLayers
      .filter((layer) => layer.enabled && layer.opacity > 0)
      .map((layer) => options.images?.get(layer.sourceId));
    const frame = this.frame;
    if (
      frame?.source === source &&
      frame.signature === signature &&
      auxiliary.every((image, index) => image === frame.auxiliary[index])
    )
      return frame.image;
    const image = render();
    this.prefix = null;
    this.settled = null;
    this.frame = { source, signature, auxiliary, image };
    return image;
  }

  warp(image: RGBAImage, recipe: WarpV3, original: RGBAImage, options: RenderOptions): RGBAImage {
    if (this.warming) {
      const pixels = applyWarpV3(image, recipe, original, options);
      this.settled = { input: image, original, signature: JSON.stringify(recipe), pixels };
      this.prefix = null;
      return pixels;
    }
    if (!recipe.enabled || recipe.strokes.length <= 1)
      return applyWarpV3(image, recipe, original, options);
    const last = recipe.strokes.at(-1)!;
    // A new scene field can change the shared displacement wherever it
    // overlaps another portrait field, including its smoothed grid edge.
    if (last.algorithm === 'portrait-field-v1' &&
        recipe.strokes.at(-2)?.algorithm === 'portrait-field-v1')
      return applyWarpV3(image, recipe, original, options);
    const prior = { ...recipe, strokes: recipe.strokes.slice(0, -1) };
    const signature = JSON.stringify(prior);
    const matches = (frame: typeof this.prefix): frame is NonNullable<typeof this.prefix> =>
      !!frame &&
      frame.input === image &&
      frame.original === original &&
      frame.signature === signature;
    const frame = matches(this.prefix)
      ? this.prefix
      : matches(this.settled)
        ? this.settled
        : {
            input: image,
            original,
            signature,
            pixels: applyWarpV3(image, prior, original, options),
          };
    this.prefix = frame;
    this.settled = null;
    // Only the last stroke can change its output support. Within that window,
    // compose every reverse map and sample the pre-warp pixels once.
    return last.strength === 0
      ? frame.pixels
      : applyWarpV3(image, recipe, original, options, {
          previousPixels: frame.pixels,
          stroke: last,
        });
  }
}
