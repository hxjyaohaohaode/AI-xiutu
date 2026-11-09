import { createHash } from 'node:crypto';

// Versioned official assets. Size and structural checks are intentional: a hash
// accidentally recorded from a partial download must not validate a broken model.
export const assets = [
  {
    file: 'face_landmarker.task',
    path: 'face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    bytes: 3758596,
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    format: 'task',
  },
  {
    file: 'pose_landmarker_lite.task',
    path: 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    bytes: 5777746,
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
    format: 'task',
  },
  {
    file: 'selfie_multiclass_256x256.tflite',
    path: 'image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite',
    bytes: 16371837,
    sha256: 'c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0',
    format: 'tflite',
  },
];

export function verifyVisionAsset(asset, input) {
  const bytes = Buffer.from(input);
  if (bytes.length !== asset.bytes) throw new Error(`Model length mismatch: ${asset.file}`);
  if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error(`SHA256 mismatch: ${asset.file}`);
  if (asset.format === 'tflite') {
    if (bytes.length < 8 || bytes.toString('ascii', 4, 8) !== 'TFL3')
      throw new Error(`Invalid TFLite header: ${asset.file}`);
    return;
  }
  if (asset.format !== 'task') throw new Error('Unknown model format');
  const footer = bytes.length - 22;
  // These exact pinned task files have no ZIP comment, no spanning, no ZIP64.
  if (
    footer < 0 ||
    bytes.readUInt32LE(footer) !== 0x06054b50 ||
    bytes.readUInt16LE(footer + 4) !== 0 ||
    bytes.readUInt16LE(footer + 6) !== 0 ||
    bytes.readUInt16LE(footer + 20) !== 0 ||
    bytes.readUInt16LE(footer + 8) !== bytes.readUInt16LE(footer + 10)
  )
    throw new Error(`Incomplete task archive: ${asset.file}`);
  const count = bytes.readUInt16LE(footer + 10),
    size = bytes.readUInt32LE(footer + 12),
    offset = bytes.readUInt32LE(footer + 16);
  if (!count || offset + size !== footer) throw new Error(`Invalid task directory: ${asset.file}`);
  let cursor = offset;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > footer || bytes.readUInt32LE(cursor) !== 0x02014b50)
      throw new Error(`Invalid task entry: ${asset.file}`);
    cursor +=
      46 +
      bytes.readUInt16LE(cursor + 28) +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
  }
  if (cursor !== footer) throw new Error(`Truncated task directory: ${asset.file}`);
}
