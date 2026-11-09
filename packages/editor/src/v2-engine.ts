import { renderRecipeV3, renderRecipeV3Tiled } from './v3-engine.js';
import type { RenderOptionsV3, TiledRenderOptionsV3 } from './v3-types.js';
import {
  createRenderSession,
  renderValidatedRegion,
  validateImage,
  renderRecipe,
  RenderAbortedError,
  srgbToLinear,
  linearToSrgb,
  tone,
  mapPoint,
  detailPoint,
  NO_CURVES,
  type LinearRegionExtension,
  type ReferenceRenderWorkspace,
} from './engine.js';
import { renderRecipeTiled, validateTiledImage, DEFAULT_TILE_SIZE } from './tiled.js';
import { getOutputDimensions, outputPixel, pixelCrop } from './geometry.js';
import { radialMaskWeight } from './mask.js';
import { ADJUSTMENT_IDS } from './registry.js';
import { HSL_BANDS } from './v2-registry.js';
import { parseEditorRecipe, parseRecipeV2, recipeV1Stage } from './v2-recipe.js';
import { compileSelectionMask } from './v2-mask.js';
import type { Dimensions, RenderOptions, RGBAImage, TiledRenderOptions } from './types.js';
import type { EditorRecipe, RecipeV2 } from './v2-types.js';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (x: number) => x * x * (3 - 2 * x);
const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const toward = (value: number, amount: number) => value + amount * (amount > 0 ? 1 - value : value);
const check = (options: RenderOptions) => {
  if (options.signal?.aborted) throw new RenderAbortedError();
};

function rgbToHsl(r: number, g: number, b: number, out: Float64Array): void {
  const maximum = Math.max(r, g, b),
    minimum = Math.min(r, g, b),
    delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  if (delta === 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = lightness;
    return;
  }
  let hue =
    maximum === r
      ? ((g - b) / delta) % 6
      : maximum === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  // Avoid subtracting nearly equal values for very dark/bright level outputs.
  const denominator = lightness <= 0.5 ? maximum + minimum : 1 - maximum + (1 - minimum);
  out[0] = hue;
  out[1] = clamp(delta / denominator);
  out[2] = lightness;
}
function hslToRgb(hue: number, saturation: number, lightness: number, out: Float64Array): void {
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs((h % 2) - 1)),
    m = lightness - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 1) {
    r = c;
    g = x;
  } else if (h < 2) {
    r = x;
    g = c;
  } else if (h < 3) {
    g = c;
    b = x;
  } else if (h < 4) {
    g = x;
    b = c;
  } else if (h < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  out[0] = r + m;
  out[1] = g + m;
  out[2] = b + m;
}

function randomLattice(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ seed) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}
function noiseAt(x: number, y: number, size: number, seed: number): number {
  const px = (x + 0.5) / size,
    py = (y + 0.5) / size;
  const ix = Math.floor(px),
    iy = Math.floor(py),
    u = smoothstep(px - ix),
    v = smoothstep(py - iy);
  const upper = randomLattice(ix, iy, seed) * (1 - u) + randomLattice(ix + 1, iy, seed) * u;
  const lower = randomLattice(ix, iy + 1, seed) * (1 - u) + randomLattice(ix + 1, iy + 1, seed) * u;
  return upper * (1 - v) + lower * v;
}

function compileExtension(recipe: RecipeV2, original: RGBAImage): LinearRegionExtension {
  const dimensions: Dimensions = original;
  const levels = recipe.levels;
  const levelActive =
    levels.inputBlack !== 0 ||
    levels.inputWhite !== 1 ||
    levels.gamma !== 1 ||
    levels.outputBlack !== 0 ||
    levels.outputWhite !== 1;
  const hslActive = HSL_BANDS.some((band) =>
    Object.values(recipe.hsl[band.id]).some((value) => value !== 0),
  );
  const zones = [recipe.grading.shadows, recipe.grading.midtones, recipe.grading.highlights];
  const gradeActive = zones.some((zone) => zone.saturation !== 0 || zone.luminance !== 0);
  const temporary = new Float64Array(3);
  const offsets = zones.map((zone) => {
    hslToRgb(zone.hue, 1, 0.5, temporary);
    const y = luminance(temporary[0]!, temporary[1]!, temporary[2]!);
    return [0, 1, 2].map(
      (channel) =>
        0.25 * (zone.saturation / 100) * (temporary[channel]! - y) + (0.2 * zone.luminance) / 100,
    );
  });
  const pivot = 0.5 + recipe.grading.balance / 400;
  const mono = recipe.effects.monochrome / 100,
    fade = recipe.effects.fade / 100;
  const pointActive = levelActive || hslActive || gradeActive || mono !== 0 || fade !== 0;
  const extendedDetail = recipe.detail.texture !== 0 || recipe.detail.clarity !== 0;
  const activeRegions = recipe.regions
    .filter(
      (region) =>
        region.enabled &&
        region.opacity > 0 &&
        ADJUSTMENT_IDS.some((id) => region.adjustments[id] !== 0),
    )
    .map((region) => ({
      region,
      mask: compileSelectionMask(region.mask, dimensions, original),
      tone: tone(region.adjustments),
      detail: region.adjustments.sharpness > 0 || region.adjustments.soften > 0,
    }));
  const vignette = { ...recipe.effects.vignette, type: 'radial' as const, invert: false };
  const vignetteActive = vignette.amount !== 0;
  const grain = recipe.effects.grain,
    grainActive = grain.amount !== 0;
  const active =
    pointActive || extendedDetail || activeRegions.length !== 0 || vignetteActive || grainActive;
  const level = (value: number) =>
    levels.outputBlack +
    (levels.outputWhite - levels.outputBlack) *
      clamp((value - levels.inputBlack) / (levels.inputWhite - levels.inputBlack)) **
        (1 / levels.gamma);

  return {
    active,
    apply(working, scratch, image, coordinates, options) {
      const originX = coordinates?.originX ?? 0,
        originY = coordinates?.originY ?? 0;
      const fullWidth = dimensions.width,
        fullHeight = dimensions.height;
      const color = new Float64Array(3),
        detail = new Float64Array(3);
      if (pointActive) {
        for (let y = 0; y < image.height; y += 1) {
          if ((y & 31) === 0) check(options);
          for (let x = 0; x < image.width; x += 1) {
            const pixel = y * image.width + x,
              at = pixel * 3;
            if (image.data[pixel * 4 + 3] === 0) continue;
            let r = working[at]!,
              g = working[at + 1]!,
              b = working[at + 2]!;
            if (levelActive || hslActive || gradeActive) {
              r = clamp(linearToSrgb(r));
              g = clamp(linearToSrgb(g));
              b = clamp(linearToSrgb(b));
              if (levelActive) {
                r = level(r);
                g = level(g);
                b = level(b);
              }
              const chroma = Math.max(r, g, b) - Math.min(r, g, b);
              if (hslActive && chroma > 0) {
                rgbToHsl(r, g, b, color);
                const hue = color[0]!;
                let band = 0;
                while (band < HSL_BANDS.length - 1 && hue >= HSL_BANDS[band + 1]!.center) band += 1;
                const first = HSL_BANDS[band]!,
                  second = HSL_BANDS[(band + 1) % HSL_BANDS.length]!;
                const right = second.center === 0 ? 360 : second.center;
                const t = (hue - first.center) / (right - first.center);
                const a = recipe.hsl[first.id],
                  z = recipe.hsl[second.id],
                  gate = clamp(chroma / 0.05);
                const hueDelta = (a.hue * (1 - t) + z.hue * t) * gate;
                const saturationDelta = ((a.saturation * (1 - t) + z.saturation * t) / 100) * gate;
                const lightnessDelta = ((a.lightness * (1 - t) + z.lightness * t) / 100) * gate;
                if (hueDelta !== 0 || saturationDelta !== 0 || lightnessDelta !== 0) {
                  hslToRgb(
                    hue + hueDelta,
                    toward(color[1]!, saturationDelta),
                    toward(color[2]!, lightnessDelta),
                    color,
                  );
                  r = color[0]!;
                  g = color[1]!;
                  b = color[2]!;
                }
              }
              if (gradeActive) {
                const y = luminance(r, g, b);
                const shadow = y < pivot ? 1 - y / pivot : 0;
                const highlight = y > pivot ? (y - pivot) / (1 - pivot) : 0;
                const mid = 1 - shadow - highlight;
                r = clamp(
                  r +
                    shadow * offsets[0]![0]! +
                    mid * offsets[1]![0]! +
                    highlight * offsets[2]![0]!,
                );
                g = clamp(
                  g +
                    shadow * offsets[0]![1]! +
                    mid * offsets[1]![1]! +
                    highlight * offsets[2]![1]!,
                );
                b = clamp(
                  b +
                    shadow * offsets[0]![2]! +
                    mid * offsets[1]![2]! +
                    highlight * offsets[2]![2]!,
                );
              }
              r = srgbToLinear(r);
              g = srgbToLinear(g);
              b = srgbToLinear(b);
            }
            if (mono !== 0) {
              const y = luminance(r, g, b);
              r += (y - r) * mono;
              g += (y - g) * mono;
              b += (y - b) * mono;
            }
            if (fade !== 0) {
              r = srgbToLinear(0.12 * fade + (1 - 0.24 * fade) * clamp(linearToSrgb(r)));
              g = srgbToLinear(0.12 * fade + (1 - 0.24 * fade) * clamp(linearToSrgb(g)));
              b = srgbToLinear(0.12 * fade + (1 - 0.24 * fade) * clamp(linearToSrgb(b)));
            }
            working[at] = r;
            working[at + 1] = g;
            working[at + 2] = b;
          }
        }
      }
      if (extendedDetail) {
        const radius = recipe.detail.clarity !== 0 ? 2 : 1;
        const kernel5 = [1, 4, 6, 4, 1];
        for (let y = 0; y < image.height; y += 1) {
          if ((y & 31) === 0) check(options);
          for (let x = 0; x < image.width; x += 1) {
            const pixel = y * image.width + x,
              at = pixel * 3;
            if (image.data[pixel * 4 + 3] === 0) {
              scratch[at] = working[at]!;
              scratch[at + 1] = working[at + 1]!;
              scratch[at + 2] = working[at + 2]!;
              continue;
            }
            const center = luminance(working[at]!, working[at + 1]!, working[at + 2]!);
            let sum3 = 0,
              weight3 = 0,
              sum5 = 0,
              weight5 = 0;
            for (let dy = -radius; dy <= radius; dy += 1)
              for (let dx = -radius; dx <= radius; dx += 1) {
                const sx = Math.max(0, Math.min(image.width - 1, x + dx)),
                  sy = Math.max(0, Math.min(image.height - 1, y + dy));
                const p = sy * image.width + sx,
                  a = image.data[p * 4 + 3]! / 255;
                if (a === 0) continue;
                const value = luminance(working[p * 3]!, working[p * 3 + 1]!, working[p * 3 + 2]!);
                if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
                  const weight = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1) * a;
                  sum3 += value * weight;
                  weight3 += weight;
                }
                if (radius === 2) {
                  const weight = kernel5[dx + 2]! * kernel5[dy + 2]! * a;
                  sum5 += value * weight;
                  weight5 += weight;
                }
              }
            const high3 = center - (weight3 > 0 ? sum3 / weight3 : center),
              high5 = center - (weight5 > 0 ? sum5 / weight5 : center);
            const texture =
              (Math.sign(high3) *
                Math.max(0, Math.abs(high3) - 0.002) *
                0.8 *
                recipe.detail.texture) /
              100;
            const clarity =
              ((Math.sign(high5) *
                Math.max(0, Math.abs(high5) - 0.001) *
                0.8 *
                recipe.detail.clarity) /
                100) *
              4 *
              center *
              (1 - center);
            for (let channel = 0; channel < 3; channel += 1)
              scratch[at + channel] = clamp(working[at + channel]! + texture + clarity);
          }
        }
        const previous = working;
        working = scratch;
        scratch = previous;
      }
      for (const compiled of activeRegions) {
        const region = compiled.region;
        for (let y = 0; y < image.height; y += 1) {
          if ((y & 31) === 0) check(options);
          for (let x = 0; x < image.width; x += 1) {
            const pixel = y * image.width + x,
              at = pixel * 3;
            if (image.data[pixel * 4 + 3] === 0) {
              scratch[at] = working[at]!;
              scratch[at + 1] = working[at + 1]!;
              scratch[at + 2] = working[at + 2]!;
            } else
              mapPoint(
                working[at]!,
                working[at + 1]!,
                working[at + 2]!,
                compiled.tone,
                NO_CURVES,
                scratch,
                at,
              );
          }
        }
        for (let y = 0; y < image.height; y += 1) {
          if ((y & 31) === 0) check(options);
          for (let x = 0; x < image.width; x += 1) {
            const pixel = y * image.width + x,
              at = pixel * 3;
            if (image.data[pixel * 4 + 3] === 0) continue;
            const weight =
              compiled.mask((x + originX + 0.5) / fullWidth, (y + originY + 0.5) / fullHeight) *
              region.opacity;
            if (weight === 0) continue;
            if (compiled.detail) detailPoint(scratch, image, x, y, region.adjustments, detail);
            for (let channel = 0; channel < 3; channel += 1) {
              const candidate = compiled.detail ? detail[channel]! : scratch[at + channel]!;
              working[at + channel] =
                working[at + channel]! + (candidate - working[at + channel]!) * weight;
            }
          }
        }
      }
      if (vignetteActive || grainActive) {
        for (let y = 0; y < image.height; y += 1) {
          if ((y & 31) === 0) check(options);
          for (let x = 0; x < image.width; x += 1) {
            const pixel = y * image.width + x,
              at = pixel * 3;
            if (image.data[pixel * 4 + 3] === 0) continue;
            const sx = x + originX,
              sy = y + originY;
            const gain = vignetteActive
              ? 2 **
                (((-2 * vignette.amount) / 100) *
                  (1 - radialMaskWeight(vignette, (sx + 0.5) / fullWidth, (sy + 0.5) / fullHeight)))
              : 1;
            let r = clamp(working[at]! * gain),
              g = clamp(working[at + 1]! * gain),
              b = clamp(working[at + 2]! * gain);
            if (grainActive) {
              r = clamp(linearToSrgb(r));
              g = clamp(linearToSrgb(g));
              b = clamp(linearToSrgb(b));
              const y = luminance(r, g, b),
                amplitude = ((0.12 * grain.amount) / 100) * (0.25 + 0.75 * 4 * y * (1 - y));
              const n = noiseAt(sx, sy, grain.size, grain.seed);
              r = srgbToLinear(clamp(r + amplitude * n));
              g = srgbToLinear(
                clamp(
                  g +
                    amplitude *
                      (grain.colored ? noiseAt(sx, sy, grain.size, grain.seed ^ 0x9e3779b9) : n),
                ),
              );
              b = srgbToLinear(
                clamp(
                  b +
                    amplitude *
                      (grain.colored ? noiseAt(sx, sy, grain.size, grain.seed ^ 0x85ebca6b) : n),
                ),
              );
            }
            working[at] = r;
            working[at + 1] = g;
            working[at + 2] = b;
          }
        }
      }
      return working;
    },
  };
}

/** Conservative exact dependency radius: v1(2) + extended detail(≤2) + ordered regional detail(≤8). */
export function recipeV2Halo(input: RecipeV2): number {
  const recipe = parseRecipeV2(input);
  return (
    2 +
    (recipe.detail.clarity !== 0 ? 2 : recipe.detail.texture !== 0 ? 1 : 0) +
    recipe.regions.filter(
      (region) =>
        region.enabled &&
        region.opacity > 0 &&
        (region.adjustments.sharpness > 0 || region.adjustments.soften > 0),
    ).length
  );
}

export function renderRecipeV2(
  image: RGBAImage,
  input: RecipeV2,
  options: RenderOptions = {},
): RGBAImage {
  validateImage(image, options);
  const recipe = parseRecipeV2(input),
    session = createRenderSession(recipeV1Stage(recipe));
  return renderValidatedRegion(
    image,
    session,
    options,
    undefined,
    undefined,
    compileExtension(recipe, image),
  );
}

export function renderRecipeV2Tiled(
  image: RGBAImage,
  input: RecipeV2,
  options: TiledRenderOptions = {},
): RGBAImage {
  validateTiledImage(image, options);
  const recipe = parseRecipeV2(input),
    extension = compileExtension(recipe, image);
  if (!extension.active) return renderRecipeTiled(image, recipeV1Stage(recipe), options);
  const session = createRenderSession(recipeV1Stage(recipe)),
    geometry = recipe.geometry;
  const crop = pixelCrop(image, geometry),
    dimensions = getOutputDimensions(image, geometry);
  const tileSize = options.tileSize ?? DEFAULT_TILE_SIZE,
    halo = recipeV2Halo(recipe);
  const capacityWidth = Math.min(image.width, Math.min(tileSize, crop.width) + 2 * halo);
  const capacityHeight = Math.min(image.height, Math.min(tileSize, crop.height) + 2 * halo);
  const pixels = capacityWidth * capacityHeight,
    tileBytes = new Uint8ClampedArray(pixels * 4);
  const workspace: ReferenceRenderWorkspace = {
    working: new Float32Array(pixels * 3),
    scratch: new Float32Array(pixels * 3),
    output: new Uint8ClampedArray(pixels * 4),
  };
  const regionSession = {
    ...session,
    recipe: {
      ...session.recipe,
      geometry: { crop: null, rotation: 0 as const, flipX: false, flipY: false },
    },
  };
  const output = new Uint8ClampedArray(dimensions.width * dimensions.height * 4);
  const right = crop.left + crop.width,
    bottom = crop.top + crop.height;
  for (let y = crop.top; y < bottom; y += tileSize)
    for (let x = crop.left; x < right; x += tileSize) {
      check(options);
      const coreWidth = Math.min(tileSize, right - x),
        coreHeight = Math.min(tileSize, bottom - y);
      const originX = Math.max(0, x - halo),
        originY = Math.max(0, y - halo);
      const regionWidth = Math.min(image.width, x + coreWidth + halo) - originX,
        regionHeight = Math.min(image.height, y + coreHeight + halo) - originY;
      const data = tileBytes.subarray(0, regionWidth * regionHeight * 4);
      for (let row = 0; row < regionHeight; row += 1) {
        const offset = ((originY + row) * image.width + originX) * 4;
        data.set(image.data.subarray(offset, offset + regionWidth * 4), row * regionWidth * 4);
      }
      const rendered = renderValidatedRegion(
        { width: regionWidth, height: regionHeight, data },
        regionSession,
        options,
        { width: image.width, height: image.height, originX, originY },
        workspace,
        extension,
      );
      for (let row = 0; row < coreHeight; row += 1) {
        if ((row & 31) === 0) check(options);
        for (let column = 0; column < coreWidth; column += 1) {
          const source = ((y - originY + row) * regionWidth + x - originX + column) * 4;
          const target = outputPixel(x + column, y + row, dimensions, crop, geometry) * 4;
          for (let channel = 0; channel < 4; channel += 1)
            output[target + channel] = rendered.data[source + channel]!;
        }
      }
    }
  check(options);
  return { ...dimensions, data: output };
}

/** Existing persisted v1 recipes always dispatch to the unchanged v1 algorithm. */
export function renderEditorRecipe(
  image: RGBAImage,
  input: EditorRecipe,
  options: RenderOptionsV3 = {},
): RGBAImage {
  const recipe = parseEditorRecipe(input);
  return recipe.schemaVersion === 1
    ? renderRecipe(image, recipe, options)
    : recipe.schemaVersion === 2
      ? renderRecipeV2(image, recipe, options)
      : renderRecipeV3(image, recipe, options);
}
export function renderEditorRecipeTiled(
  image: RGBAImage,
  input: EditorRecipe,
  options: TiledRenderOptionsV3 = {},
): RGBAImage {
  const recipe = parseEditorRecipe(input);
  return recipe.schemaVersion === 1
    ? renderRecipeTiled(image, recipe, options)
    : recipe.schemaVersion === 2
      ? renderRecipeV2Tiled(image, recipe, options)
      : renderRecipeV3Tiled(image, recipe, options);
}
