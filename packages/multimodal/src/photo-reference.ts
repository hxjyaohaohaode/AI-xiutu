import sharp from 'sharp';

/** The source is a verified private canonical PNG. The original stays in project storage. */
export async function boundedPhotoReference(bytes: Uint8Array): Promise<Buffer> {
  const png = await sharp(bytes, { limitInputPixels: 64_000_000, sequentialRead: true, failOn: 'warning' })
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').png().toBuffer();
  if (png.length > 4_250_000) throw new Error('PHOTO_REFERENCE_ENCODE_LIMIT');
  return png;
}
