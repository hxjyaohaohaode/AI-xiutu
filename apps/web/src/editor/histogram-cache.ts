import { computeHistogram, type Histogram, type RGBAImage } from '@ai-xiutu/editor';

// Worker previews are immutable objects. A new frame must have a new identity;
// neither consumer may mutate these shared bins or the source pixel buffer.
// Values contain only histogram counts, never a strong reference to the image.
const cache = new WeakMap<RGBAImage, Readonly<Histogram>>();

/** Share one exact scan between the histogram panel and curve graph for a frame. */
export function sharedHistogram(image: RGBAImage | null): Readonly<Histogram> | null {
  if (!image) return null;
  const previous = cache.get(image);
  if (previous) return previous;
  const result = Object.freeze(computeHistogram(image));
  cache.set(image, result);
  return result;
}
