/** Canonical sRGB / RGBA8 color conversion shared by picker controls and tests. */
export type RGB = { r: number; g: number; b: number; a: number };
export type HSV = { h: number; s: number; v: number };
export type HSL = { h: number; s: number; l: number };
export const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
export function rgba(value: string): RGB {
  let hex = value.replace('#', '');
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((char) => char + char).join('');
  if (!/^[\da-f]{6}([\da-f]{2})?$/i.test(hex)) hex = '34372eff';
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}
export function hsv(color: RGB): HSV {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = !delta
    ? 0
    : max === r
      ? ((g - b) / delta) % 6
      : max === g
        ? (b - r) / delta + 2
        : (r - g) / delta + 4;
  h = (h * 60 + 360) % 360;
  return { h, s: max ? delta / max : 0, v: max };
}
export function fromHsv(color: HSV, a: number): RGB {
  const h = ((color.h % 360) + 360) % 360;
  const c = color.v * color.s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = color.v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return {
    r: Math.round((r! + m) * 255),
    g: Math.round((g! + m) * 255),
    b: Math.round((b! + m) * 255),
    a,
  };
}
export function hex(color: RGB) {
  return (
    '#' +
    [color.r, color.g, color.b, Math.round(color.a * 255)]
      .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}
export function hsl(color: RGB): HSL {
  const converted = hsv(color);
  const l = converted.v * (1 - converted.s / 2);
  return { h: converted.h, s: l === 0 || l === 1 ? 0 : (converted.v - l) / Math.min(l, 1 - l), l };
}
export function fromHsl(color: HSL, alpha: number): RGB {
  const v = color.l + color.s * Math.min(color.l, 1 - color.l);
  return fromHsv({ h: color.h, s: v ? 2 * (1 - color.l / v) : 0, v }, alpha);
}
