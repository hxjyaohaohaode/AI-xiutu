export type SamplePreset = 'natural' | 'vivid' | 'soft';
export type SampleAdjustments = {
  warmth: number;
  exposure: number;
  contrast: number;
  saturation: number;
  highlights: number;
  shadows: number;
  vibrance: number;
  clarity: number;
};
export type SampleParameter = keyof SampleAdjustments;
/** New fields stay optional for earlier #/sample entries; visible controls always use a complete snapshot. */
export type SampleSettings = Pick<SampleAdjustments, 'warmth' | 'exposure'> &
  Partial<Omit<SampleAdjustments, 'warmth' | 'exposure'>> & {
    preset: SamplePreset | 'custom';
    sampleId?: 'color-study' | 'coast' | 'portrait';
  };
export type ResolvedSampleSettings = SampleSettings & SampleAdjustments;

export const SAMPLE_PARAMETER_LIMITS: Readonly<
  Record<SampleParameter, { min: number; max: number; step: number }>
> = {
  exposure: { min: -2, max: 2, step: 0.01 },
  warmth: { min: -100, max: 100, step: 1 },
  contrast: { min: -100, max: 100, step: 1 },
  saturation: { min: -100, max: 100, step: 1 },
  highlights: { min: -100, max: 100, step: 1 },
  shadows: { min: -100, max: 100, step: 1 },
  vibrance: { min: -100, max: 100, step: 1 },
  clarity: { min: -100, max: 100, step: 1 },
};

const presets: Readonly<Record<SamplePreset, Readonly<SampleAdjustments>>> = {
  natural: {
    warmth: 10,
    exposure: 0.12,
    contrast: 4,
    saturation: -4,
    highlights: -16,
    shadows: 14,
    vibrance: 12,
    clarity: 6,
  },
  vivid: {
    warmth: 4,
    exposure: 0.18,
    contrast: 18,
    saturation: 12,
    highlights: -28,
    shadows: 18,
    vibrance: 24,
    clarity: 16,
  },
  soft: {
    warmth: 20,
    exposure: 0.22,
    contrast: -16,
    saturation: -10,
    highlights: -30,
    shadows: 26,
    vibrance: 6,
    clarity: -12,
  },
};
const neutral: SampleAdjustments = {
  warmth: 0,
  exposure: 0,
  contrast: 0,
  saturation: 0,
  highlights: 0,
  shadows: 0,
  vibrance: 0,
  clarity: 0,
};

export function samplePreset(preset: SamplePreset): ResolvedSampleSettings {
  return { preset, ...presets[preset] };
}
function sampleParameterValue(key: SampleParameter, value: number, fallback: number) {
  const { min, max, step } = SAMPLE_PARAMETER_LIMITS[key];
  const finite = Number.isFinite(value) ? value : fallback;
  const quantized = Math.round(Math.max(min, Math.min(max, finite)) / step) * step;
  return Number(quantized.toFixed(step < 1 ? 2 : 0));
}
export function resolveSampleSettings(
  settings: SampleSettings = DEFAULT_SAMPLE_SETTINGS,
): ResolvedSampleSettings {
  const preset =
    settings.preset === 'vivid' || settings.preset === 'soft' || settings.preset === 'custom'
      ? settings.preset
      : 'natural';
  const base = preset === 'custom' ? neutral : presets[preset];
  const values = Object.fromEntries(
    (Object.keys(SAMPLE_PARAMETER_LIMITS) as SampleParameter[]).map((key) => [
      key,
      sampleParameterValue(key, settings[key] ?? base[key], base[key]),
    ]),
  ) as SampleAdjustments;
  return { ...values, preset, ...(settings.sampleId ? { sampleId: settings.sampleId } : {}) };
}
/** Editing one value preserves the other seven actual values and removes preset reapplication. */
export function changeSampleParameter(
  settings: SampleSettings,
  key: SampleParameter,
  value: number,
): ResolvedSampleSettings {
  const current = resolveSampleSettings(settings);
  return { ...current, [key]: sampleParameterValue(key, value, current[key]), preset: 'custom' };
}

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
export const DEFAULT_SAMPLE_SETTINGS: Readonly<ResolvedSampleSettings> = Object.freeze(
  samplePreset('natural'),
);
