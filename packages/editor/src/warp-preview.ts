import type { RGBAImage } from './types.js';
import type { RecipeV3, TiledRenderOptionsV3 } from './v3-types.js';
import type { RecipeV4 } from './v4-types.js';

/** One immutable source-space intermediate, owned by a single preview worker. */
export class WarpPreviewCache {
  private frame: {
    source: RGBAImage;
    signature: string;
    auxiliary: Array<RGBAImage | undefined>;
    image: RGBAImage;
  } | null = null;

  clear() {
    this.frame = null;
  }

  keeps(image: RGBAImage) {
    return this.frame?.image.data.buffer === image.data.buffer;
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
    const signature = JSON.stringify([prefix, options.maxPixels, options.tileSize, tiled]);
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
    this.frame = { source, signature, auxiliary, image };
    return image;
  }
}
