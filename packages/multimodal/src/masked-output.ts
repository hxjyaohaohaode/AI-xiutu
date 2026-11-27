import sharp from 'sharp';

/** Combine an aligned model result with the canonical source. A transparent
 * mask pixel permits replacement; an opaque pixel retains the source exactly. */
export async function createMaskedOutput(
  source: Uint8Array,
  mask: Uint8Array,
  width: number,
  height: number,
  maxPixels: number,
) {
  async function decode(bytes: Uint8Array, alphaOnly = false) {
    const image = sharp(bytes, { limitInputPixels: maxPixels, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.width !== width || metadata.height !== height || (metadata.pages ?? 1) !== 1 ||
        (alphaOnly && !metadata.hasAlpha)) throw new Error('MASK_COORDINATES_MISMATCH');
    const pixels = alphaOnly ? image.extractChannel('alpha') : image.toColourspace('srgb').ensureAlpha();
    return pixels.raw({ depth: 'uchar' }).toBuffer();
  }
  const original = await decode(source);
  const coverage = await decode(mask, true);
  return async (generated: Uint8Array) => {
    const pixels = await decode(generated);
    for (let i = 0; i < coverage.length; i++) {
      const preserve = coverage[i]!;
      if (!preserve) continue;
      const offset = i * 4;
      if (preserve === 255) {
        pixels.writeUInt32LE(original.readUInt32LE(offset), offset);
        continue;
      }
      // Blend in premultiplied alpha so a transparent color cannot create a fringe.
      const originalWeight = preserve * original[offset + 3]!;
      const resultWeight = (255 - preserve) * pixels[offset + 3]!;
      const weight = originalWeight + resultWeight;
      for (let channel = offset; channel < offset + 3; channel++) {
        pixels[channel] = weight ? Math.round((original[channel]! * originalWeight +
          pixels[channel]! * resultWeight) / weight) : 0;
      }
      pixels[offset + 3] = Math.round(weight / 255);
    }
    return sharp(pixels, { raw: { width, height, channels: 4 } }).png().toBuffer();
  };
}
