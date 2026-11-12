import { MAX_DIMENSION, MAX_EXPLICIT_PIXELS } from '@ai-xiutu/editor';

export function fitsNativePreview(width: number, height: number): boolean {
  return width <= MAX_DIMENSION && height <= MAX_DIMENSION && width * height <= MAX_EXPLICIT_PIXELS;
}
