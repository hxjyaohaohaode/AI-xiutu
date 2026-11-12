import type { PaintMaterialV3 } from '@ai-xiutu/editor';
import { t } from '../i18n';
import './makeup-brush.css';

export type MakeupBrushId =
  'base' | 'shadow' | 'liner' | 'brow' | 'blush' | 'lip' | 'contour' | 'highlight' | 'undereye';
type MakeupBrush = {
  label: string;
  path: string;
  colors: readonly string[];
  radius: number;
  feather: number;
  opacity: number;
  material: PaintMaterialV3;
};

// Neutral, rose and bronze families and matte, satin and reflective finishes.
// These are editable screen colors inspired by product categories.
export const makeupBrushes: Record<MakeupBrushId, MakeupBrush> = {
  base: {
    label: '底妆',
    path: 'M5 15l8-9a3 3 0 0 1 4 0l1 1a3 3 0 0 1 0 4l-9 8H5v-4m7-7 4 4',
    colors: [
      '#dfb69e',
      '#bf9279',
      '#925f48',
      '#f3dfcb',
      '#eec9aa',
      '#e9c1ae',
      '#d7a183',
      '#c39b7a',
      '#b78364',
      '#a37155',
      '#80553f',
      '#694233',
      '#523628',
      '#3f2721',
    ],
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
    colors: [
      '#9a6b75',
      '#7d5965',
      '#b58a73',
      '#c69b93',
      '#d6ab94',
      '#bc8066',
      '#a77354',
      '#89634d',
      '#5e4b40',
      '#4b3847',
      '#a685a9',
      '#775280',
      '#4f4f76',
      '#607a77',
      '#4d737f',
      '#966c47',
      '#c7ad71',
      '#d9c4a6',
    ],
    radius: 0.019,
    feather: 0.72,
    opacity: 0.53,
    material: { algorithm: 'pigment-v1', finish: 'satin', saturation: 1, blendMode: 'color' },
  },
  liner: {
    label: '眼线',
    path: 'M3 15c6-6 12-2 18-10-3 6-5 10-11 12M18 9l2 2',
    colors: [
      '#302329',
      '#53382f',
      '#56374d',
      '#263b51',
      '#201d20',
      '#16131c',
      '#3f3436',
      '#643f35',
      '#734339',
      '#734252',
      '#423057',
      '#2e3c65',
      '#2e504a',
      '#4f5745',
      '#786653',
    ],
    radius: 0.0022,
    feather: 0.28,
    opacity: 0.93,
    material: { algorithm: 'pigment-v1', finish: 'matte', saturation: 1, blendMode: 'multiply' },
  },
  brow: {
    label: '眉妆',
    path: 'M3 14c4-4 8-7 13-7l5 4M3 16c4-2 8-4 13-6l5 1m-13 1 2 2m1-4 2 2',
    colors: [
      '#725046',
      '#493530',
      '#8b6754',
      '#34272a',
      '#554842',
      '#7d6f66',
      '#9b8269',
      '#6d6157',
      '#564e4a',
      '#8e6d5c',
      '#9f7e67',
      '#a8876b',
    ],
    radius: 0.004,
    feather: 0.47,
    opacity: 0.72,
    material: { algorithm: 'pigment-v1', finish: 'matte', saturation: 0.85, blendMode: 'multiply' },
  },
  blush: {
    label: '腮红',
    path: 'M6 10c4-3 8-3 12 0m-12 5c3 2 9 2 12 0M6 12l-1 2m5-3-1 2m5-2-1 2m5-1-1 2',
    colors: [
      '#bb6479',
      '#d18a77',
      '#ab586b',
      '#be7e91',
      '#e498a3',
      '#eea99c',
      '#e38571',
      '#ce6e60',
      '#cf786b',
      '#a74f55',
      '#a35e78',
      '#81425f',
      '#b76a9b',
      '#da9b88',
      '#b2796b',
      '#d9749c',
    ],
    radius: 0.04,
    feather: 0.9,
    opacity: 0.4,
    material: { algorithm: 'pigment-v1', finish: 'satin', saturation: 1, blendMode: 'color' },
  },
  lip: {
    label: '唇妆',
    path: 'M3 12c3-1 6-5 8-3l1 1 1-1c2-2 5 2 8 3-3 3-6 5-9 5s-6-2-9-5zm0 0c5 2 13 2 18 0',
    colors: [
      '#a54a61',
      '#ba6d66',
      '#863544',
      '#b08078',
      '#e5918f',
      '#c55c6a',
      '#a83c43',
      '#8d232f',
      '#a4493b',
      '#ca694d',
      '#c55958',
      '#9e5361',
      '#814455',
      '#77344d',
      '#652d42',
      '#975943',
      '#b87b61',
      '#aa6e75',
    ],
    radius: 0.014,
    feather: 0.45,
    opacity: 0.76,
    material: { algorithm: 'pigment-v1', finish: 'satin', saturation: 1, blendMode: 'color' },
  },
  contour: {
    label: '修容',
    path: 'M5 5c-2 5 0 11 7 14 7-3 9-9 7-14M6 11l4 4m8-4-4 4',
    colors: [
      '#846151',
      '#9c745e',
      '#70584d',
      '#b28a71',
      '#a98267',
      '#a48570',
      '#826d62',
      '#69584b',
      '#654537',
      '#503a32',
      '#3f302a',
      '#a08778',
    ],
    radius: 0.028,
    feather: 0.84,
    opacity: 0.37,
    material: { algorithm: 'pigment-v1', finish: 'matte', saturation: 0.85, blendMode: 'multiply' },
  },
  highlight: {
    label: '高光',
    path: 'M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3zm6 2 1 2m2 1-2 1',
    colors: [
      '#ebcdb2',
      '#d5c1e7',
      '#e3aa94',
      '#d9d6cb',
      '#f3dfc7',
      '#e7c2af',
      '#e9bca1',
      '#cfa989',
      '#c79e73',
      '#e9c887',
      '#ead9ac',
      '#e4d9e5',
      '#c9d4df',
      '#d0b9ad',
    ],
    radius: 0.016,
    feather: 0.77,
    opacity: 0.44,
    material: { algorithm: 'pigment-v1', finish: 'shimmer', saturation: 1, blendMode: 'screen' },
  },
  undereye: {
    label: '卧蚕妆',
    path: 'M3 10c5-4 13-4 18 0M4 14c5 3 11 3 16 0m-11 5 1-2m5 2-1-2',
    colors: [
      '#e7c0aa',
      '#ecd6c5',
      '#dcb298',
      '#d2ab8b',
      '#f4e4cf',
      '#e6c8b5',
      '#debb9c',
      '#cda7a1',
      '#d6b5ba',
      '#e4bdc4',
      '#cda58c',
      '#e1c59c',
    ],
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
          <span>{t('画笔')}</span>
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
}: {
  brush: MakeupBrushId;
  color: string;
  onColor: (value: string) => void;
}) {
  return (
    <div className="makeup-swatches" role="group" aria-label={t('画笔颜色')}>
      {makeupBrushes[brush].colors.map((shade) => (
        <button
          type="button"
          key={shade}
          aria-label={shade.toUpperCase()}
          title={shade.toUpperCase()}
          aria-pressed={color.toLowerCase().slice(0, 7) === shade}
          onClick={() => onColor(shade)}
        >
          <span style={{ background: shade }} />
        </button>
      ))}
    </div>
  );
}
