export type SampleSettings = {
  warmth: number;
  exposure: number;
  preset: 'natural' | 'vivid' | 'soft';
  sampleId?: 'color-study' | 'coast' | 'portrait';
};
/** Public, bundled examples only. Never fetch a URL supplied by navigation state. */
export function getSampleImage(settings?: SampleSettings): string {
  switch (settings?.sampleId) {
    case 'coast':
      return '/about/coast.webp';
    case 'portrait':
      return '/about/portrait.webp';
    default:
      return '/about/color-study.webp';
  }
}
export const DEFAULT_SAMPLE_SETTINGS: SampleSettings = {
  warmth: 18,
  exposure: 0.1,
  preset: 'natural',
};
