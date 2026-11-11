import {
  compilePrecisionEdit,
  linearToSrgb,
  srgbToLinear,
  type PrecisionEditV1,
} from '@ai-xiutu/editor';

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
