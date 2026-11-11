import { linearToSrgb } from './transfer.js';

// First representable Float32 value that the reference encoder rounds to byte k.
// Compute with the original function, including its rounding, rather than assuming
// that analytically inverting the transfer function has the same boundary.
const boundary = new Float32Array(256);
const bits = new Uint32Array(1);
const value = new Float32Array(bits.buffer);
for (let k = 1; k <= 255; k++) {
  let low = 0,
    high = 0x3f800000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    bits[0] = middle;
    if (Math.round(linearToSrgb(value[0]!) * 255) >= k) high = middle;
    else low = middle + 1;
  }
  bits[0] = low;
  boundary[k] = value[0]!;
}
const guess = Uint8Array.from({ length: 4096 }, (_, i) => Math.round(linearToSrgb(i / 4096) * 255));

/** Exact reference byte encoding for a Float32 linear working-buffer sample.
 * This table only accelerates quantization. It never approximates a float stage. */
export function encodeFloat32Byte(sample: number): number {
  if (!(sample > 0)) return 0;
  if (sample >= 1) return 255;
  let byte = guess[Math.floor(sample * 4096)]!;
  while (byte < 255 && sample >= boundary[byte + 1]!) byte++;
  while (byte > 0 && sample < boundary[byte]!) byte--;
  return byte;
}
