import { createHash } from 'node:crypto';
import {
  compilePrecisionEdit,
  linearToSrgb,
  parsePrecisionEdit,
  srgbToLinear,
  type PrecisionEdit,
  type PrecisionEditV1,
} from '@ai-xiutu/editor';
import {
  MEDIA_MAX_PREVIEW_EDGE,
  MEDIA_MAX_PRECISION_PIXELS,
  MediaProcessingError,
  type MediaPrecisionInput,
  type MediaPrecisionPreview,
} from './types.js';

export function precisionRecord(
  inputEdit: PrecisionEdit | undefined,
  source: string,
  input: MediaPrecisionInput,
) {
  if (!inputEdit) return {};
  const edit = parsePrecisionEdit(inputEdit);
  return {
    precisionEdit: {
      algorithm: edit.algorithm,
      input,
      edit,
      sha256: createHash('sha256').update(JSON.stringify({ source, input, edit })).digest('hex'),
    },
  };
}

export function previewWindow(
  preview: MediaPrecisionPreview | undefined,
  source: { width: number; height: number },
) {
  if (!preview) return undefined;
  if (
    !Number.isInteger(preview.maxEdge) ||
    preview.maxEdge < 128 ||
    preview.maxEdge > MEDIA_MAX_PREVIEW_EDGE
  )
    throw new MediaProcessingError('Preview edge is outside the display budget', 'limit');
  if (preview.region && preview.fitRegion)
    throw new MediaProcessingError('Select one preview window mode', 'unsupported');
  const region = preview.region ?? preview.fitRegion;
  if (!region) return undefined;
  if (
    ![region.left, region.top, region.width, region.height].every(Number.isSafeInteger) ||
    region.left < 0 ||
    region.top < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    (preview.region
      ? region.width > preview.maxEdge || region.height > preview.maxEdge
      : region.width * region.height > MEDIA_MAX_PRECISION_PIXELS) ||
    region.left + region.width > source.width ||
    region.top + region.height > source.height
  )
    throw new MediaProcessingError(
      'Preview region is outside the source or display budget',
      'limit',
    );
  return region;
}

const decode = Float64Array.from({ length: 65536 }, (_, i) => srgbToLinear(i / 65535));
/** Work on the actual uint16 samples. No RGBA8 proxy or quantization in between. */
export function editMaster16(
  pixels: Uint16Array,
  channels: 3 | 4,
  edit: PrecisionEditV1,
): Uint16Array {
  if (pixels.length % channels) throw new RangeError('Incomplete master sample layout');
  const transform = compilePrecisionEdit(edit),
    sample = new Float64Array(3);
  const output = pixels.slice();
  for (let at = 0; at < pixels.length; at += channels) {
    if (channels === 4 && pixels[at + 3] === 0) continue;
    transform(decode[pixels[at]!]!, decode[pixels[at + 1]!]!, decode[pixels[at + 2]!]!, sample);
    for (let c = 0; c < 3; c++) {
      if (!Number.isFinite(sample[c]))
        throw new RangeError('Precision edit produced a non-finite sample');
      output[at + c] = Math.round(Math.max(0, Math.min(1, linearToSrgb(sample[c]!))) * 65535);
    }
  }
  return output;
}
