import { useState, type KeyboardEvent } from 'react';
import type { Geometry, OrientationAction } from '@ai-xiutu/editor';
import {
  ArrowArcLeft,
  ArrowArcRight,
  ArrowsClockwise,
  ArrowsDownUp,
  ArrowsLeftRight,
  CompassTool,
  Crop,
  ImageSquare,
} from '../components/ControlGlyph';
import { t } from '../i18n';

const ratios = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['5:4', 5 / 4],
  ['4:5', 4 / 5],
  ['1.85:1', 1.85],
  ['2.39:1', 2.39],
  ['21:9', 21 / 9],
] as const;

export function CropPresetRail({
  originalRatio,
  value,
  onChange,
}: {
  originalRatio: number;
  value: number | null;
  onChange: (ratio: number | null, label: string) => void;
}) {
  const [chosen, setChosen] = useState<string>();
  const options = [
    { id: 'free', label: t('自由'), ratio: null },
    { id: 'original', label: t('原图'), ratio: originalRatio },
    ...ratios.map(([label, ratio]) => ({ id: label, label, ratio })),
  ];
  const matches = options.filter((option) => option.ratio === value);
  const selected = matches.find((option) => option.id === chosen) ?? matches[0];

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    )
      return;
    const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
    const button = buttons[next];
    if (!button) return;
    button.focus({ preventScroll: true });
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <div className="crop-preset-rail" role="group" aria-label={t('裁切比例')} onKeyDown={moveFocus}>
      {options.map(({ id, label, ratio }) => {
        const width = 18 * Math.min(1, ratio ?? 1);
        const height = 18 * Math.min(1, 1 / (ratio ?? 1));
        const cinema = id === '1.85:1' || id === '2.39:1';
        return (
          <button
            key={id}
            type="button"
            title={cinema ? t('电影 {v0}', { v0: label }) : undefined}
            aria-label={cinema ? t('电影 {v0}', { v0: label }) : undefined}
            aria-pressed={id === selected?.id}
            tabIndex={id === (selected?.id ?? 'free') ? 0 : -1}
            onClick={() => {
              setChosen(id);
              onChange(ratio, label);
            }}
          >
            {id === 'free' ? (
              <Crop size={22} />
            ) : id === 'original' ? (
              <ImageSquare size={22} />
            ) : (
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
                <rect
                  x={(24 - width) / 2}
                  y={(24 - height) / 2}
                  width={width}
                  height={height}
                  rx="1.8"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
              </svg>
            )}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function CropOrientationControls({
  geometry,
  onChange,
}: {
  geometry: Geometry;
  onChange: (action: OrientationAction, label: string) => void;
}) {
  const actions = [
    { id: 'left', label: '左转', name: '向左旋转90度', Glyph: ArrowArcLeft },
    { id: 'right', label: '右转', name: '向右旋转90度', Glyph: ArrowArcRight },
    { id: 'half-turn', label: '180°', name: '旋转180度', Glyph: ArrowsClockwise },
    {
      id: 'mirror',
      label: '水平镜像',
      name: '水平镜像',
      Glyph: ArrowsLeftRight,
      active: geometry.flipX,
    },
    {
      id: 'flip',
      label: '垂直镜像',
      name: '垂直镜像',
      Glyph: ArrowsDownUp,
      active: geometry.flipY,
    },
    { id: 'reset', label: '原方向', name: '恢复原图方向', Glyph: CompassTool },
  ] as const;
  return (
    <div className="crop-orientation-actions" role="group" aria-label={t('画幅与方向')}>
      {actions.map(({ id, label, name, Glyph, ...state }) => (
        <button
          key={id}
          type="button"
          aria-label={t(name)}
          title={t(name)}
          aria-pressed={'active' in state ? state.active : undefined}
          disabled={id === 'reset' && !geometry.rotation && !geometry.flipX && !geometry.flipY}
          onClick={() => onChange(id, t(name))}
        >
          <Glyph size={18} />
          {t(label)}
        </button>
      ))}
    </div>
  );
}
