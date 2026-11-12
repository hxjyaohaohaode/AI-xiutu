import { useId, useState, type ReactNode } from 'react';
import type { PaintMaterialV3 } from '@ai-xiutu/editor';
import { t } from '../i18n';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { ControlGlyph } from '../components/ControlGlyph';
import { RubberSegment, SquishSwitch, WarmTooltip } from '../components/control-motion';
import { makeupPalettes, type MakeupBrushId } from './makeup-palettes';
import { ParameterGlyph } from './ParameterGlyph';
import './makeup-brush.css';

export type { MakeupBrushId } from './makeup-palettes';
type MakeupBrush = {
  label: string;
  path: string;
  radius: number;
  feather: number;
  opacity: number;
  material: PaintMaterialV3;
};

export const makeupBrushes: Record<MakeupBrushId, MakeupBrush> = {
  base: {
    label: '底妆',
    path: 'M5 15l8-9a3 3 0 0 1 4 0l1 1a3 3 0 0 1 0 4l-9 8H5v-4m7-7 4 4',
    radius: 0.04,
    feather: 0.86,
    opacity: 0.29,
    material: {
      algorithm: 'pigment-v1',
      finish: 'matte',
      saturation: 0.9,
      blendMode: 'soft-light',
    },
  },
  shadow: {
    label: '眼影',
    path: 'M3 12s3-5 9-5 9 5 9 5-3 5-9 5-9-5-9-5zm6 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0M5 5c3-2 7-2 10-1',
    radius: 0.019,
    feather: 0.72,
    opacity: 0.53,
    material: { algorithm: 'pigment-v1', finish: 'satin', saturation: 1, blendMode: 'color' },
  },
  liner: {
    label: '眼线',
    path: 'M3 15c6-6 12-2 18-10-3 6-5 10-11 12M18 9l2 2',
    radius: 0.0022,
    feather: 0.28,
    opacity: 0.93,
    material: { algorithm: 'pigment-v1', finish: 'matte', saturation: 1, blendMode: 'multiply' },
  },
  brow: {
    label: '眉妆',
    path: 'M3 14c4-4 8-7 13-7l5 4M3 16c4-2 8-4 13-6l5 1m-13 1 2 2m1-4 2 2',
    radius: 0.004,
    feather: 0.47,
    opacity: 0.72,
    material: { algorithm: 'pigment-v1', finish: 'matte', saturation: 0.85, blendMode: 'multiply' },
  },
  blush: {
    label: '腮红',
    path: 'M6 10c4-3 8-3 12 0m-12 5c3 2 9 2 12 0M6 12l-1 2m5-3-1 2m5-2-1 2m5-1-1 2',
    radius: 0.04,
    feather: 0.9,
    opacity: 0.4,
    material: { algorithm: 'pigment-v1', finish: 'satin', saturation: 1, blendMode: 'color' },
  },
  lip: {
    label: '唇妆',
    path: 'M3 12c3-1 6-5 8-3l1 1 1-1c2-2 5 2 8 3-3 3-6 5-9 5s-6-2-9-5zm0 0c5 2 13 2 18 0',
    radius: 0.014,
    feather: 0.45,
    opacity: 0.76,
    material: { algorithm: 'pigment-v1', finish: 'satin', saturation: 1, blendMode: 'color' },
  },
  contour: {
    label: '修容',
    path: 'M5 5c-2 5 0 11 7 14 7-3 9-9 7-14M6 11l4 4m8-4-4 4',
    radius: 0.028,
    feather: 0.84,
    opacity: 0.37,
    material: { algorithm: 'pigment-v1', finish: 'matte', saturation: 0.85, blendMode: 'multiply' },
  },
  highlight: {
    label: '高光',
    path: 'M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3zm6 2 1 2m2 1-2 1',
    radius: 0.016,
    feather: 0.77,
    opacity: 0.44,
    material: { algorithm: 'pigment-v1', finish: 'shimmer', saturation: 1, blendMode: 'screen' },
  },
  undereye: {
    label: '卧蚕妆',
    path: 'M3 10c5-4 13-4 18 0M4 14c5 3 11 3 16 0m-11 5 1-2m5 2-1-2',
    radius: 0.009,
    feather: 0.72,
    opacity: 0.4,
    material: {
      algorithm: 'pigment-v1',
      finish: 'satin',
      saturation: 0.75,
      blendMode: 'soft-light',
    },
  },
};

export const makeupFinishLabels: Record<PaintMaterialV3['finish'], string> = {
  matte: '哑光',
  satin: '缎光',
  shimmer: '珠光',
  metallic: '金属光泽',
};

export function MakeupBrushRail({
  value,
  onChange,
  automatic = false,
}: {
  value: MakeupBrushId | null;
  onChange: (value: MakeupBrushId | null) => void;
  automatic?: boolean;
}) {
  return (
    <div
      className="makeup-brush-rail"
      role="group"
      aria-label={t(automatic ? '妆容区域' : '妆容笔')}
    >
      {!automatic && (
        <button type="button" onClick={() => onChange(null)} aria-pressed={!value}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 15 18 4l2 2L9 16m-1-1c-4-2-3 4-6 5 5 1 8-1 7-4" />
          </svg>
          <span>{t('自由画笔')}</span>
        </button>
      )}
      {(Object.entries(makeupBrushes) as [MakeupBrushId, MakeupBrush][]).map(([id, brush]) => (
        <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={brush.path} />
          </svg>
          <span>{t(brush.label)}</span>
        </button>
      ))}
    </div>
  );
}

export function MakeupSwatches({
  brush,
  color,
  onColor,
  children,
}: {
  brush: MakeupBrushId;
  color: string;
  onColor: (value: string) => void;
  children: ReactNode;
}) {
  const [familyName, setFamilyName] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const customId = useId();
  const families = makeupPalettes[brush];
  const selected = color.toLowerCase().slice(0, 7);
  const current =
    families.find(({ name }) => name === familyName) ??
    families.find(({ shades }) => shades.includes(selected)) ??
    families[0]!;
  return (
    <>
      <div className="makeup-palette">
        <ChoiceSelect
          size="compact"
          className="makeup-color-family"
          ariaLabel={t('色系')}
          value={current.name}
          onValueChange={setFamilyName}
          options={families.map(({ name }) => ({ value: name, label: t(name) }))}
        />
        <div className="makeup-swatches" role="group" aria-label={t('画笔颜色')}>
          {current.shades.map((shade) => (
            <button
              type="button"
              key={shade}
              aria-label={shade.toUpperCase()}
              title={shade.toUpperCase()}
              aria-pressed={selected === shade}
              onClick={() => onColor(shade)}
            >
              <span style={{ background: shade }} />
            </button>
          ))}
        </div>
        <WarmTooltip content={t('自定义颜色')}>
          <button
            type="button"
            className="makeup-custom-color"
            aria-label={t('自定义颜色')}
            aria-expanded={customOpen}
            aria-controls={customId}
            onClick={() => setCustomOpen((open) => !open)}
          >
            <span aria-hidden="true" style={{ backgroundColor: color }} />
            <ControlGlyph name="plus" size={13} />
          </button>
        </WarmTooltip>
      </div>
      <div className="makeup-custom-editor" id={customId} hidden={!customOpen}>
        {customOpen && children}
      </div>
    </>
  );
}

const parameterIcons = {
  color: <ParameterGlyph id="paintColor" />,
  strength: <ControlGlyph name="sliders" />,
  opacity: <ParameterGlyph id="opacity" />,
  saturation: <ParameterGlyph id="saturation" />,
  finish: <ControlGlyph name="sparkle" />,
  blend: <ParameterGlyph id="blend" />,
  brush: <ControlGlyph name="paint" />,
  layers: <ParameterGlyph id="layers" />,
};
type MakeupParameter = keyof typeof parameterIcons;

export function MakeupParameterRail<T extends MakeupParameter>({
  label,
  labels,
  value,
  onChange,
}: {
  label: string;
  labels: Readonly<Record<T, string>>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <RubberSegment<T>
      className="makeup-icon-rail"
      label={label}
      value={value}
      onChange={onChange}
      options={(Object.keys(labels) as T[]).map((value) => ({
        value,
        label: null,
        ariaLabel: t(labels[value]),
        title: t(labels[value]),
        icon: parameterIcons[value],
      }))}
    />
  );
}

export function PortraitModeSwitch({
  automatic,
  onChange,
  label,
  compact = false,
}: {
  automatic: boolean;
  onChange: (value: boolean) => void;
  label: string;
  compact?: boolean;
}) {
  return (
    <SquishSwitch
      checked={automatic}
      onCheckedChange={onChange}
      label={label}
      className="portrait-mode-switch"
      showLabel={!compact}
      displayLabel={t(automatic ? '自动' : '手动')}
      thumbIcon={<ControlGlyph name={automatic ? 'sparkle' : 'paint'} size={11} />}
    />
  );
}
