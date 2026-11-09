import { compileSelectionMask, type SelectionMaskSampler } from './v2-mask.js';
import { parseSelectionMaskV3 } from './v3-recipe.js';
import type { Dimensions, RGBAImage } from './types.js';
import type { SelectionMaskV3 } from './v3-types.js';

/** Soft Boolean masks: max union, min intersection, a*(1-b) subtract, probabilistic xor. */
export function compileSelectionMaskV3(
  input: SelectionMaskV3,
  dimensions: Dimensions,
  source?: RGBAImage,
): SelectionMaskSampler {
  const mask = parseSelectionMaskV3(input);
  const compile = (m: SelectionMaskV3): SelectionMaskSampler => {
    if (m.type !== 'compound') return compileSelectionMask(m, dimensions, source);
    const children = m.masks.map(compile),
      first = children[0]!,
      rest = children.slice(1);
    return (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw new RangeError('Mask sample coordinates must be finite');
      if (x < 0 || y < 0 || x > 1 || y > 1) return 0;
      let value = first(x, y);
      for (const sample of rest) {
        if (
          (m.operation === 'union' && value === 1) ||
          ((m.operation === 'intersection' || m.operation === 'subtract') && value === 0)
        )
          break;
        const b = sample(x, y);
        switch (m.operation) {
          case 'union':
            value = Math.max(value, b);
            break;
          case 'intersection':
            value = Math.min(value, b);
            break;
          case 'subtract':
            value *= 1 - b;
            break;
          case 'xor':
            value = value + b - 2 * value * b;
            break;
        }
      }
      return m.invert ? 1 - value : value;
    };
  };
  return compile(mask);
}
