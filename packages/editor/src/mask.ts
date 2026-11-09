import type { RadialMask } from './types.js';

/** Input point and mask are in normalized original-source coordinates. */
export function radialMaskWeight(mask: RadialMask, x: number, y: number): number {
  const dx = (x - mask.centerX) / mask.radiusX;
  const dy = (y - mask.centerY) / mask.radiusY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  let weight: number;
  if (distance >= 1) weight = 0;
  else if (mask.feather === 0 || distance <= 1 - mask.feather) weight = 1;
  else {
    const t = (1 - distance) / mask.feather;
    weight = t * t * (3 - 2 * t);
  }
  return mask.invert ? 1 - weight : weight;
}
