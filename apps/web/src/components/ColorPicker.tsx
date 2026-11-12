import { t } from '../i18n';
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import { MotionDetails } from '../motion/Presence';
import { Copy, Plus, Check } from './ControlGlyph';
import { IconButton, InlineError } from './Ui';
import { WarmTooltip } from './control-motion';
import '../editor/editor-controls.css';

import {
  clamp,
  rgba,
  hsv,
  hsl,
  hex,
  fromHsv,
  fromHsl,
  type RGB,
  type HSV,
  type HSL,
} from './color-model';

const quickColors = [
  '#FFFFFFFF',
  '#15171CFF',
  '#EF5852FF',
  '#EF9948FF',
  '#E5C844FF',
  '#A3C74CFF',
  '#48B681FF',
  '#46B9B6FF',
  '#4EABDDFF',
  '#5176D5FF',
  '#8E67CCFF',
  '#BD64BDFF',
  '#DA6D93FF',
  '#966D50FF',
  '#AAAAAAFF',
  '#555555FF',
];
function readSwatches(): string[] {
  try {
    const values: unknown = JSON.parse(localStorage.getItem('editor:color-swatches:v1') ?? '[]');
    return Array.isArray(values)
      ? values
          .filter((v): v is string => typeof v === 'string' && /^#[\da-f]{8}$/i.test(v))
          .slice(0, 16)
      : [];
  } catch {
    return [];
  }
}

/** Uiverse 204 neighbours decorate real colour-selection buttons; they never fake a copy result. */
function ColorSwatches({
  colors,
  value,
  onChoose,
  label,
  onSave,
}: {
  colors: string[];
  value: string;
  onChoose: (value: string) => void;
  label: string;
  onSave?: () => void;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const proximity = (active: HTMLButtonElement | null) => {
    const buttons = [...(rail.current?.querySelectorAll<HTMLButtonElement>('[data-color]') ?? [])];
    for (const button of buttons) {
      const steps =
        active && button.offsetTop === active.offsetTop
          ? Math.abs(button.offsetLeft - active.offsetLeft) / Math.max(1, active.offsetWidth + 2)
          : Infinity;
      const scale = steps < 0.1 ? 1.5 : steps < 1.2 ? 1.3 : steps < 2.2 ? 1.15 : 1;
      button.style.setProperty('--swatch-scale', String(scale));
    }
  };
  return (
    <div
      ref={rail}
      className="quick-colors color-swatch-rail"
      role="group"
      aria-label={label}
      onPointerOver={(event) => {
        if (event.pointerType !== 'touch' && event.target instanceof Element)
          proximity(event.target.closest<HTMLButtonElement>('[data-color]'));
      }}
      onPointerLeave={() =>
        proximity(
          rail.current?.querySelector<HTMLButtonElement>('[data-color]:focus-visible') ?? null,
        )
      }
      onFocus={(event) => proximity(event.target.closest<HTMLButtonElement>('[data-color]'))}
      onBlur={() => proximity(null)}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
          return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        const columns =
          getComputedStyle(event.currentTarget).display === 'grid'
            ? buttons.filter((button) => button.offsetTop === buttons[0]?.offsetTop).length
            : 1;
        const delta =
          event.key === 'ArrowUp'
            ? -columns
            : event.key === 'ArrowDown'
              ? columns
              : event.key === 'ArrowLeft'
                ? -1
                : 1;
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : Math.max(0, Math.min(buttons.length - 1, index + delta));
        event.preventDefault();
        const target = buttons[next];
        target?.focus({ preventScroll: true });
        if (target) {
          const left = target.offsetLeft,
            right = left + target.offsetWidth,
            node = event.currentTarget;
          if (left < node.scrollLeft) node.scrollLeft = left;
          else if (right > node.scrollLeft + node.clientWidth)
            node.scrollLeft = right - node.clientWidth;
        }
      }}
    >
      {colors.map((item) => (
        <WarmTooltip key={item} content={item}>
          <button
            type="button"
            data-color={item}
            style={{ '--swatch-color': item } as React.CSSProperties}
            aria-label={t('选取 {v0}', { v0: item })}
            aria-pressed={value === item}
            onClick={() => onChoose(item)}
          >
            <i />
          </button>
        </WarmTooltip>
      ))}
      {onSave && (
        <WarmTooltip content={t('保存当前颜色到色板')}>
          <button type="button" aria-label={t('保存当前颜色到色板')} onClick={onSave}>
            <Plus size={18} />
          </button>
        </WarmTooltip>
      )}
    </div>
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
  const lightnessValue = hsl(color);
  const [hue, setHue] = useState(saturationValue.h);
  const [draft, setDraft] = useState(hex(color));
  const [error, setError] = useState<string | null>(null);
  const [channelMode, setChannelMode] = useState<'rgb' | 'hsv' | 'hsl'>('hsv');
  const [swatches, setSwatches] = useState(readSwatches);
  const [copied, setCopied] = useState(false);
  const channelId = useId();
  const spectrumNode = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const beforeGesture = useRef({ value, hue });
  const currentColor = useRef(color);
  currentColor.current = color;
  function finishSpectrum(cancel: boolean) {
    const pointer = active.current;
    if (pointer === null) return;
    active.current = null;
    if (cancel) {
      setHue(beforeGesture.current.hue);
      onChange(beforeGesture.current.value);
    }
    if (spectrumNode.current?.hasPointerCapture(pointer))
      spectrumNode.current.releasePointerCapture(pointer);
  }
  const cancelRef = useRef(() => finishSpectrum(true));
  cancelRef.current = () => finishSpectrum(true);
  useEffect(() => {
    const cancel = () => cancelRef.current();
    const visibility = () => {
      if (document.visibilityState !== 'visible') cancel();
    };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      // Unmount may switch person, layer or source: discard ownership without writing to its successor.
      active.current = null;
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);
  useEffect(() => {
    const next = rgba(value);
    const converted = hsv(next);
    if (converted.s > 0 && converted.v > 0) setHue(converted.h);
    setDraft(hex(next));
  }, [value]);
  function emit(next: RGB) {
    currentColor.current = next;
    onChange(hex(next));
    setError(null);
  }
  function spectrum(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
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
  function setHsl(key: keyof HSL, number: number) {
    if (key === 'h') setHue(number);
    emit(fromHsl({ ...lightnessValue, h: hue, [key]: number }, color.a));
  }
  function saveColor() {
    const next = [hex(color), ...swatches.filter((item) => item !== hex(color))].slice(0, 16);
    setSwatches(next);
    try {
      localStorage.setItem('editor:color-swatches:v1', JSON.stringify(next));
    } catch {
      setError('当前浏览器无法保存色板，本次会话中仍可使用。');
    }
  }
  return (
    <section
      className="full-color-picker refined-color-picker"
      data-motion="color-picker"
      aria-label={t('{v0}选择器', { v0: label })}
    >
      <div className="color-picker-heading">
        <strong>{label}</strong>
        <span className="color-preview-checker">
          <i style={{ background: hex(color) }} />
        </span>
        <code>{hex(color)}</code>
        <IconButton
          label={t('复制当前HEX颜色')}
          onClick={() => {
            if (!navigator.clipboard) {
              setError(t('此环境不支持自动复制，可从HEX输入框手动复制。'));
              return;
            }
            void navigator.clipboard
              .writeText(hex(color))
              .then(() => setCopied(true))
              .catch(() => setError(t('无法自动复制，请手动复制HEX颜色。')));
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </IconButton>
      </div>
      <div
        ref={spectrumNode}
        className="color-spectrum"
        style={{ backgroundColor: `hsl(${hue},100%,50%)` }}
        tabIndex={0}
        role="slider"
        aria-label={t('饱和度和明度色谱，左右调饱和度，上下调明度')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(saturationValue.s * 100)}
        aria-valuetext={t('饱和度{v0}%，明度{v1}%', {
          v0: Math.round(saturationValue.s * 100),
          v1: Math.round(saturationValue.v * 100),
        })}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary || active.current !== null) {
            event.preventDefault();
            return;
          }
          beforeGesture.current = { value, hue };
          active.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          spectrum(event);
        }}
        onPointerMove={(event) => {
          if (active.current === event.pointerId) spectrum(event);
        }}
        onPointerUp={(event) => {
          if (active.current === event.pointerId) finishSpectrum(false);
        }}
        onPointerCancel={(event) => {
          if (active.current === event.pointerId) finishSpectrum(true);
        }}
        onLostPointerCapture={(event) => {
          if (active.current === event.pointerId) finishSpectrum(true);
        }}
        onBlur={() => finishSpectrum(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            finishSpectrum(true);
            return;
          }
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          if (active.current !== null) return;
          const amount = event.altKey ? 0.001 : event.shiftKey ? 0.1 : 0.01;
          const latest = hsv(currentColor.current);
          emit(
            fromHsv(
              {
                h: hue,
                s: clamp(
                  latest.s +
                    (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0),
                  0,
                  1,
                ),
                v: clamp(
                  latest.v +
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
        <span>{t('色相')}</span>
        <input
          aria-label={t('完整色相')}
          className="hue-range"
          type="range"
          min="0"
          max="359.9"
          step="0.1"
          value={hue}
          onChange={(event) => setHsv('h', Number(event.target.value))}
        />
        <output>{Number(hue.toFixed(1))}°</output>
      </label>
      <label className="color-range-row">
        <span>{t('透明度')}</span>
        <input
          aria-label={t('颜色不透明度')}
          className="alpha-range"
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={color.a * 100}
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
          aria-label={t('HEX颜色')}
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
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(hex(color));
              setError(null);
            }
          }}
        />
      </label>
      <div className="editor-subtabs" role="tablist" aria-label={t('颜色数值空间')}>
        {(['hsv', 'hsl', 'rgb'] as const).map((mode) => (
          <button
            key={mode}
            id={`${channelId}-${mode}`}
            role="tab"
            tabIndex={channelMode === mode ? 0 : -1}
            aria-selected={channelMode === mode}
            aria-controls={`${channelId}-fields`}
            onClick={() => setChannelMode(mode)}
            onKeyDown={(event) => {
              const modes = ['hsv', 'hsl', 'rgb'] as const;
              const index = modes.indexOf(mode);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? 2
                    : event.key === 'ArrowRight'
                      ? (index + 1) % 3
                      : event.key === 'ArrowLeft'
                        ? (index + 2) % 3
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setChannelMode(modes[next]!);
              document.getElementById(`${channelId}-${modes[next]}`)?.focus();
            }}
          >
            {mode.toUpperCase()}
          </button>
        ))}
      </div>
      <div
        className="color-numbers color-channel-fields"
        key={channelMode}
        id={`${channelId}-fields`}
        role="tabpanel"
        aria-labelledby={`${channelId}-${channelMode}`}
      >
        {channelMode === 'rgb' &&
          (['r', 'g', 'b'] as const).map((key) => (
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
        {channelMode === 'hsv' &&
          (['h', 's', 'v'] as const).map((key) => (
            <label key={key}>
              {key.toUpperCase()}
              {key === 'h' ? ' °' : ' %'}
              <input
                aria-label={`${label} HSV ${key.toUpperCase()}`}
                type="number"
                min="0"
                max={key === 'h' ? 359.9 : 100}
                step="0.1"
                value={Number((key === 'h' ? hue : saturationValue[key] * 100).toFixed(1))}
                onChange={(event) =>
                  setHsv(
                    key,
                    clamp(Number(event.target.value), 0, key === 'h' ? 359.9 : 100) /
                      (key === 'h' ? 1 : 100),
                  )
                }
              />
            </label>
          ))}
        {channelMode === 'hsl' &&
          (['h', 's', 'l'] as const).map((key) => (
            <label key={key}>
              {key.toUpperCase()} {key === 'h' ? '°' : '%'}
              <input
                aria-label={`${label} HSL ${key.toUpperCase()}`}
                type="number"
                min={0}
                max={key === 'h' ? 359.9 : 100}
                step={0.1}
                value={Number((key === 'h' ? hue : lightnessValue[key] * 100).toFixed(1))}
                onChange={(event) =>
                  setHsl(
                    key,
                    clamp(Number(event.target.value), 0, key === 'h' ? 359.9 : 100) /
                      (key === 'h' ? 1 : 100),
                  )
                }
              />
            </label>
          ))}
      </div>
      <ColorSwatches
        colors={quickColors}
        value={hex(color)}
        onChoose={(item) => emit(rgba(item))}
        label={t('快速色板')}
      />
      <MotionDetails className="editor-section color-saved">
        <summary>
          <span>{t('我的色板')}</span>
          <small>{swatches.length}/16</small>
        </summary>
        <div className="editor-section-body">
          <ColorSwatches
            colors={swatches}
            value={hex(color)}
            onChoose={(item) => emit(rgba(item))}
            label={t('我的色板')}
            onSave={saveColor}
          />
        </div>
      </MotionDetails>
      <span className="sr-only" role="status">
        {copied ? t('颜色已复制') : ''}
      </span>
      <InlineError message={error} />
    </section>
  );
}
