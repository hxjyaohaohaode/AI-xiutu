import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Copy } from '@phosphor-icons/react';
import { IconButton, InlineError } from './Ui';

type RGB = { r: number; g: number; b: number; a: number };
type HSV = { h: number; s: number; v: number };
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Number.isFinite(value) ? value : low));
function rgba(value: string): RGB {
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
function hsv(color: RGB): HSV {
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
function fromHsv(color: HSV, a: number): RGB {
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
function hex(color: RGB) {
  return (
    '#' +
    [color.r, color.g, color.b, Math.round(color.a * 255)]
      .map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function ColorPicker({
  value,
  onChange,
  label = '颜色',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const color = rgba(value);
  const saturationValue = hsv(color);
  const [hue, setHue] = useState(saturationValue.h);
  const [draft, setDraft] = useState(hex(color));
  const [error, setError] = useState<string | null>(null);
  const active = useRef<number | null>(null);
  useEffect(() => {
    const next = rgba(value);
    const converted = hsv(next);
    if (converted.s > 0 && converted.v > 0) setHue(converted.h);
    setDraft(hex(next));
  }, [value]);
  function emit(next: RGB) {
    onChange(hex(next));
    setError(null);
  }
  function spectrum(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const s = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const v = 1 - clamp((event.clientY - bounds.top) / bounds.height, 0, 1);
    emit(fromHsv({ h: hue, s, v }, color.a));
  }
  function commitHex() {
    if (!/^#?([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(draft)) {
      setError('HEX 使用 3、4、6 或 8 位十六进制颜色。');
      return;
    }
    emit(rgba(draft));
  }
  function setHsv(key: keyof HSV, value: number) {
    const next = { h: hue, s: saturationValue.s, v: saturationValue.v, [key]: value };
    if (key === 'h') setHue(value);
    emit(fromHsv(next, color.a));
  }
  return (
    <section className="full-color-picker" aria-label={`${label}选择器`}>
      <div className="color-picker-heading">
        <strong>{label}</strong>
        <span className="color-preview-checker">
          <i style={{ background: hex(color) }} />
        </span>
        <code>{hex(color)}</code>
        <IconButton
          label="复制当前HEX颜色"
          onClick={() => {
            if (!navigator.clipboard) {
              setError('此环境不支持自动复制，可从HEX输入框手动复制。');
              return;
            }
            void navigator.clipboard
              .writeText(hex(color))
              .catch(() => setError('无法自动复制，请手动复制HEX颜色。'));
          }}
        >
          <Copy size={16} />
        </IconButton>
      </div>
      <div
        className="color-spectrum"
        style={{ backgroundColor: `hsl(${hue},100%,50%)` }}
        tabIndex={0}
        role="slider"
        aria-label="饱和度和明度色谱，左右调饱和度，上下调明度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(saturationValue.s * 100)}
        aria-valuetext={`饱和度${Math.round(saturationValue.s * 100)}%，明度${Math.round(saturationValue.v * 100)}%`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          active.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          spectrum(event);
        }}
        onPointerMove={(event) => {
          if (active.current === event.pointerId) spectrum(event);
        }}
        onPointerUp={(event) => {
          active.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          active.current = null;
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          const amount = event.shiftKey ? 0.1 : 0.01;
          emit(
            fromHsv(
              {
                h: hue,
                s: clamp(
                  saturationValue.s +
                    (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0),
                  0,
                  1,
                ),
                v: clamp(
                  saturationValue.v +
                    (event.key === 'ArrowUp' ? amount : event.key === 'ArrowDown' ? -amount : 0),
                  0,
                  1,
                ),
              },
              color.a,
            ),
          );
        }}
      >
        <div />
        <span
          className="color-spectrum-cursor"
          style={{ left: `${saturationValue.s * 100}%`, top: `${(1 - saturationValue.v) * 100}%` }}
        />
      </div>
      <label className="color-range-row">
        <span>色相</span>
        <input
          aria-label="完整色相"
          className="hue-range"
          type="range"
          min="0"
          max="359"
          step="1"
          value={Math.round(hue)}
          onChange={(event) => setHsv('h', Number(event.target.value))}
        />
        <output>{Math.round(hue)}°</output>
      </label>
      <label className="color-range-row">
        <span>透明度</span>
        <input
          aria-label="颜色不透明度"
          className="alpha-range"
          type="range"
          min="0"
          max="100"
          step="1"
          value={Math.round(color.a * 100)}
          style={
            { '--color-opaque': `rgb(${color.r},${color.g},${color.b})` } as React.CSSProperties
          }
          onChange={(event) => emit({ ...color, a: Number(event.target.value) / 100 })}
        />
        <output>{Math.round(color.a * 100)}%</output>
      </label>
      <label className="color-hex">
        HEX
        <input
          aria-label="HEX颜色"
          value={draft}
          maxLength={9}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitHex}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitHex();
            }
          }}
        />
      </label>
      <div className="color-numbers">
        {(['r', 'g', 'b'] as const).map((key) => (
          <label key={key}>
            {key.toUpperCase()}
            <input
              aria-label={`${label} RGB ${key.toUpperCase()}`}
              type="number"
              min="0"
              max="255"
              step="1"
              value={color[key]}
              onChange={(event) =>
                emit({ ...color, [key]: clamp(Number(event.target.value), 0, 255) })
              }
            />
          </label>
        ))}
      </div>
      <div className="color-numbers">
        {(['h', 's', 'v'] as const).map((key) => (
          <label key={key}>
            {key.toUpperCase()}
            {key === 'h' ? ' °' : ' %'}
            <input
              aria-label={`${label} HSV ${key.toUpperCase()}`}
              type="number"
              min="0"
              max={key === 'h' ? 359 : 100}
              step="1"
              value={Math.round(key === 'h' ? hue : saturationValue[key] * 100)}
              onChange={(event) =>
                setHsv(
                  key,
                  clamp(Number(event.target.value), 0, key === 'h' ? 359 : 100) /
                    (key === 'h' ? 1 : 100),
                )
              }
            />
          </label>
        ))}
      </div>
      <InlineError message={error} />
    </section>
  );
}
