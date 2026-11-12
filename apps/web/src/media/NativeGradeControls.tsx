import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Circle, Eye, EyeSlash, Gradient, Trash } from '@phosphor-icons/react';
import {
  PRECISION_EDIT_CONTROLS,
  type PrecisionCurveChannel,
  type PrecisionEdit,
  type PrecisionRegionV3,
} from '@ai-xiutu/editor';
import type { MediaPrecisionInput } from '@ai-xiutu/media';
import { t } from '../i18n';
import { IconButton } from '../components/Ui';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { secureUuid } from '../lib/uuid';
import { ParameterShelf, type ShelfControl } from '../editor/ParameterShelf';
import { NativeCurveEditor } from './NativeCurveEditor';
import {
  appendNativeRegion, createNativeRegion, moveNativeRegion, nativeCurvePoints,
  nativeGradeLimits, nativeRegions, updateNativeRegion, withNativeCurve, withNativeRegions,
  type NativeGradeCapabilities, type NativeMask,
} from './native-grade-model';
import '../editor/precision-studio.css';
import './native-grade.css';

type Update = (current: PrecisionEdit) => PrecisionEdit;
const channelNames: Record<PrecisionCurveChannel, string> = { luminance: '明度', red: '红', green: '绿', blue: '蓝' };
const channelColors: Record<PrecisionCurveChannel, string> = { luminance: 'var(--ink)', red: '#bd6458', green: '#49896b', blue: '#557eae' };

export function NativeGradeControls({
  edit, input, capabilities, disabled, selectedRegionId, onSelectRegion, onChange,
}: {
  edit: PrecisionEdit;
  input: MediaPrecisionInput;
  capabilities?: NativeGradeCapabilities;
  disabled: boolean;
  selectedRegionId: string | null;
  onSelectRegion: (id: string | null) => void;
  onChange: (update: Update) => void;
}) {
  const [mode, setMode] = useState<'global' | 'curves' | 'regions'>('global');
  const [channel, setChannel] = useState<PrecisionCurveChannel>('luminance');
  const [localMode, setLocalMode] = useState<'adjust' | 'mask'>('adjust');
  const limits = nativeGradeLimits(capabilities, input);
  const regions = nativeRegions(edit);
  const selected = regions.find((region) => region.id === selectedRegionId) ?? regions[0];
  const showCurves = limits.channels.length > 0 || (edit.algorithm !== 'scene-linear-v1' && Object.keys(edit.curves).length > 0);
  const showRegions = limits.maxRegions > 0 || edit.algorithm === 'scene-linear-v3';
  const activeMode = mode === 'curves' && !showCurves || mode === 'regions' && !showRegions ? 'global' : mode;
  const channels = limits.channels.length ? limits.channels : (['luminance', 'red', 'green', 'blue'] as const);
  const activeChannel = channels.includes(channel) ? channel : channels[0]!;
  useEffect(() => {
    if (activeMode === 'regions' && selectedRegionId !== (selected?.id ?? null)) onSelectRegion(selected?.id ?? null);
    else if (activeMode !== 'regions' && selectedRegionId !== null) onSelectRegion(null);
  }, [activeMode, selected?.id, selectedRegionId, onSelectRegion]);

  const globalControls: ShelfControl[] = PRECISION_EDIT_CONTROLS.map(({ key, label, minimum, maximum, step, unit }) => ({
    id: key, label, value: edit[key], min: minimum, max: maximum, step, unit, neutral: 0, disabled,
    onChange: (value) => onChange((current) => ({ ...current, [key]: value })),
    onReset: () => onChange((current) => ({ ...current, [key]: 0 })),
  }));
  function changeRegion(update: (region: PrecisionRegionV3) => PrecisionRegionV3) {
    if (selected) onChange((current) => updateNativeRegion(current, selected.id, update));
  }
  const localControls: ShelfControl[] = selected ? limits.adjustments.map(({ key, label, minimum, maximum, step, unit }) => ({
    id: key, label, value: selected.adjustments[key] ?? 0, min: minimum, max: maximum, step, unit, neutral: 0, disabled,
    onChange: (value) => changeRegion((region) => ({ ...region, adjustments: { ...region.adjustments, [key]: value } })),
    onReset: () => changeRegion((region) => {
      const adjustments = { ...region.adjustments };
      delete adjustments[key];
      return { ...region, adjustments };
    }),
  })) : [];
  const geometry: ShelfControl[] = selected ? [{
    id: 'opacity', label: '不透明度', value: selected.opacity * 100, min: 0, max: 100, step: .1, unit: '%', neutral: 100, disabled,
    onChange: (value) => changeRegion((region) => ({ ...region, opacity: value / 100 })),
    onReset: () => changeRegion((region) => ({ ...region, opacity: 1 })),
  }] : [];
  function maskNumber(id: string, label: string, value: number, min: number, max: number, change: (mask: NativeMask, value: number) => NativeMask, unit = '%') {
    geometry.push({
      id, label, value, min, max, step: unit === '°' ? .1 : .01, unit, disabled,
      onChange: (number) => changeRegion((region) => ({ ...region, mask: change(region.mask, number) })),
    });
  }
  if (selected?.mask.type === 'radial') {
    const mask = selected.mask;
    for (const [key, label] of [
      ['centerX', '中心 X'], ['centerY', '中心 Y'], ['radiusX', '横向半径'], ['radiusY', '纵向半径'], ['feather', '羽化'],
    ] as const) maskNumber(key, label, mask[key] * 100, key.startsWith('radius') ? .01 : 0, 100,
      (current, value) => current.type === 'radial' ? { ...current, [key]: value / 100 } : current);
    maskNumber('rotation', '旋转', mask.rotationDegrees ?? 0, -180, 180,
      (current, value) => current.type === 'radial' ? { ...current, rotationDegrees: value } : current, '°');
  } else if (selected?.mask.type === 'linear') {
    const mask = selected.mask;
    for (const [end, coordinate, label] of [
      ['start', 'x', '起点 X'], ['start', 'y', '起点 Y'], ['end', 'x', '终点 X'], ['end', 'y', '终点 Y'],
    ] as const) maskNumber(end + '.' + coordinate, label, mask[end][coordinate] * 100, 0, 100, (current, value) => {
      if (current.type !== 'linear') return current;
      const next = { ...current, [end]: { ...current[end], [coordinate]: value / 100 } };
      return (next.end.x - next.start.x) ** 2 + (next.end.y - next.start.y) ** 2 < 1e-12 ? current : next;
    });
  }
  function selectMode(next: typeof mode) {
    setMode(next);
    onSelectRegion(next === 'regions' ? selected?.id ?? null : null);
  }
  function addRegion(type: 'radial' | 'linear') {
    const region = createNativeRegion('native-' + secureUuid(), type);
    onChange((current) => appendNativeRegion(current, region, limits.maxRegions));
    onSelectRegion(region.id);
    setLocalMode('mask');
  }
  return (
    <div className="native-grade-controls refined-inspector">
      <div className="native-grade-tabs" role="group" aria-label={t('母版调色工具')}>
        <button type="button" aria-pressed={activeMode === 'global'} onClick={() => selectMode('global')}>{t('色调')}</button>
        {showCurves && <button type="button" aria-pressed={activeMode === 'curves'} onClick={() => selectMode('curves')}>{t('曲线')}</button>}
        {showRegions && <button type="button" aria-pressed={activeMode === 'regions'} onClick={() => selectMode('regions')}>{t('局部')}{regions.length > 0 && <small>{regions.length}</small>}</button>}
      </div>
      {activeMode === 'global' && (
        <>
          <ParameterShelf label={t('母版高位深调色')} controls={globalControls} />
          <ChoiceSelect ariaLabel={t('高光色调映射')} value={edit.toneMap} disabled={disabled}
            options={[{ value: 'none', label: t('保留线性高光') }, { value: 'reinhard', label: t('压缩高光 Reinhard') }]}
            onValueChange={(value) => onChange((current) => ({ ...current, toneMap: value === 'reinhard' ? value : 'none' }))}
          />
        </>
      )}
      {activeMode === 'curves' && (
        <section className="native-grade-curves" aria-label={t('场景线性曲线')}>
          <div className="native-curve-channels" role="group" aria-label={t('曲线通道')}>
            {channels.map((key) => (
              <button type="button" key={key} aria-pressed={key === activeChannel} onClick={() => setChannel(key)}>
                <i style={{ background: channelColors[key] }} aria-hidden="true" />{t(channelNames[key])}
              </button>
            ))}
          </div>
          <NativeCurveEditor key={activeChannel}
            points={nativeCurvePoints(edit, activeChannel, limits.minEv, limits.maxEv)}
            minEv={limits.minEv} maxEv={limits.maxEv} maxPoints={limits.maxPoints}
            color={channelColors[activeChannel]} disabled={disabled || !limits.canCurves}
            onChange={(points) => onChange((current) => withNativeCurve(current, activeChannel, points))}
            onReset={() => onChange((current) => withNativeCurve(current, activeChannel, null))}
            onCancel={() => onChange(() => edit)}
          />
        </section>
      )}
      {activeMode === 'regions' && (
        <section className="native-grade-regions" aria-label={t('局部调色顺序')}>
          <div className="native-region-add">
            {limits.masks.includes('radial') && <button type="button" disabled={disabled || regions.length >= limits.maxRegions} onClick={() => addRegion('radial')}><Circle size={17} />{t('径向')}</button>}
            {limits.masks.includes('linear') && <button type="button" disabled={disabled || regions.length >= limits.maxRegions} onClick={() => addRegion('linear')}><Gradient size={17} />{t('渐变')}</button>}
            <small>{regions.length}/{limits.maxRegions || 8}</small>
          </div>
          <ol className="native-region-list">
            {regions.map((region, index) => (
              <li key={region.id} data-selected={selected?.id === region.id ? 'true' : undefined}>
                <button type="button" className="native-region-name" aria-pressed={selected?.id === region.id} onClick={() => onSelectRegion(region.id)}>
                  <span>{index + 1}</span>{region.mask.type === 'radial' ? <Circle size={16} /> : <Gradient size={16} />}
                  {t(region.mask.type === 'radial' ? '径向' : '渐变')}
                </button>
                <IconButton label={t(region.enabled ? '隐藏局部' : '显示局部')} disabled={disabled} onClick={() => onChange((current) => updateNativeRegion(current, region.id, (item) => ({ ...item, enabled: !item.enabled })))}>{region.enabled ? <Eye size={15} /> : <EyeSlash size={15} />}</IconButton>
                <IconButton label={t('上移')} disabled={disabled || index === 0} onClick={() => onChange((current) => moveNativeRegion(current, region.id, -1))}><ArrowUp size={15} /></IconButton>
                <IconButton label={t('下移')} disabled={disabled || index === regions.length - 1} onClick={() => onChange((current) => moveNativeRegion(current, region.id, 1))}><ArrowDown size={15} /></IconButton>
                <IconButton label={t('删除局部')} disabled={disabled} onClick={() => onChange((current) => withNativeRegions(current, nativeRegions(current).filter((item) => item.id !== region.id)))}><Trash size={15} /></IconButton>
              </li>
            ))}
          </ol>
          {selected && (
            <div className="native-region-current">
              <div className="native-grade-tabs native-region-modes" role="group" aria-label={t('局部参数')}>
                <button type="button" aria-pressed={localMode === 'adjust'} onClick={() => setLocalMode('adjust')}>{t('调节')}</button>
                <button type="button" aria-pressed={localMode === 'mask'} onClick={() => setLocalMode('mask')}>{t('范围')}</button>
                <button type="button" className="native-mask-invert" aria-pressed={selected.mask.invert} disabled={disabled} onClick={() => changeRegion((region) => ({ ...region, mask: { ...region.mask, invert: !region.mask.invert } }))}>{t('反选')}</button>
              </div>
              {localMode === 'adjust' ? <ParameterShelf key={selected.id + '-adjust'} label={t('局部参数')} controls={localControls} /> : (
                <>
                  {selected.mask.type === 'radial' ? <ChoiceSelect
                    ariaLabel={t('选区形状')} value={selected.mask.shape ?? 'ellipse'} disabled={disabled}
                    options={[{ value: 'ellipse', label: t('椭圆') }, { value: 'rectangle', label: t('矩形') }, { value: 'diamond', label: t('菱形') }]}
                    onValueChange={(value) => changeRegion((region) => ({ ...region, mask: region.mask.type === 'radial' ? { ...region.mask, shape: value as 'ellipse' | 'rectangle' | 'diamond' } : region.mask }))}
                  /> : <label className="native-mask-smooth"><input type="checkbox" checked={selected.mask.smooth} disabled={disabled} onChange={(event) => {
                    const smooth = event.target.checked;
                    changeRegion((region) => ({ ...region, mask: region.mask.type === 'linear' ? { ...region.mask, smooth } : region.mask }));
                  }} />{t('平滑过渡')}</label>}
                  <ParameterShelf key={selected.id + '-mask'} label={t('原图坐标')} controls={geometry} />
                </>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
