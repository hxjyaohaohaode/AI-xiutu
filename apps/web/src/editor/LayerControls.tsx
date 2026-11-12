import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RubberSegment } from '../components/control-motion';
import {
  ArrowUp,
  ArrowDown,
  Copy,
  Eye,
  EyeSlash,
  Plus,
  Trash,
  UploadSimple,
  ShieldCheckered,
  Eraser,
} from '../components/ControlGlyph';
import {
  BLEND_MODES_V3,
  MAX_V3_PAINT_LAYERS,
  MAX_V3_PAINT_STROKES,
  MAX_V3_IMAGE_LAYERS,
  MAX_V3_WARP_STROKES,
  type BlendModeV3,
  type PaintLayerV3,
  type PaintMaterialV3,
  type PaintStrokeV3,
  type ImageLayerV3,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
import { secureUuid } from '../lib/uuid';
import { errorMessage } from '../lib/api';
import { ColorPicker } from '../components/ColorPicker';
import { IconButton } from '../components/Ui';
import { ParameterShelf, type ShelfControl } from './ParameterShelf';
import { MaskControls } from './MaskControls';
import { currentV3, newMask, rgbaHex, hexRgba, type InspectorController } from './advanced-model';
import { portraitSelectionMatchesSource } from './portrait-selection';
import { editorFlowText } from './flow-copy';
import {
  MakeupBrushRail,
  MakeupSwatches,
  makeupBrushes,
  makeupFinishLabels,
  type MakeupBrushId,
} from './MakeupBrushRail';
import { AutomaticMakeupControls } from './AutomaticMakeupControls';

const blendLabels: Record<BlendModeV3, string> = {
  normal: '正常混合',
  multiply: '正片叠底',
  screen: '滤色',
  overlay: '叠加',
  'soft-light': '柔光',
  'hard-light': '强光',
  darken: '变暗',
  lighten: '变亮',
  difference: '差值',
  exclusion: '排除',
  'color-dodge': '颜色减淡',
  'color-burn': '颜色加深',
  hue: '色相',
  saturation: '饱和度',
  color: '颜色',
  luminosity: '明度',
};
export function BlendPicker({
  value,
  onChange,
  ariaLabel = t('图层混合模式'),
}: {
  value: BlendModeV3;
  onChange: (value: BlendModeV3) => void;
  ariaLabel?: string;
}) {
  return (
    <label className="advanced-select">
      {t('混合模式')}
      <ChoiceSelect
        ariaLabel={ariaLabel}
        size="compact"
        value={value}
        onValueChange={(value) => onChange(value as BlendModeV3)}
        options={BLEND_MODES_V3.map((mode) => ({ value: mode, label: t(blendLabels[mode]) }))}
      />
    </label>
  );
}
function MaterialChoices({
  value,
  onChange,
}: {
  value: PaintMaterialV3;
  onChange: (value: PaintMaterialV3) => void;
}) {
  return (
    <div className="makeup-detail-fields">
      <ChoiceSelect
        size="compact"
        label={t('妆效')}
        value={value.finish}
        onValueChange={(finish) => onChange({ ...value, finish })}
        options={(Object.keys(makeupFinishLabels) as PaintMaterialV3['finish'][]).map((finish) => ({
          value: finish,
          label: t(makeupFinishLabels[finish]),
        }))}
      />
      <BlendPicker
        value={value.blendMode}
        ariaLabel={t('笔触混合模式')}
        onChange={(blendMode) => onChange({ ...value, blendMode })}
      />
    </div>
  );
}
function shifted<T>(items: T[], index: number, direction: number): T[] {
  const next = [...items];
  const target = index + direction;
  if (target >= 0 && target < items.length)
    [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}
export function PaintControls({
  controller,
  headerTarget,
  pickedColor,
  onSample,
  sampling,
}: {
  controller: InspectorController;
  headerTarget?: HTMLElement | null;
  pickedColor: string;
  onSample?: () => void;
  sampling?: boolean;
}) {
  const { editor, apply, report } = controller,
    recipe = currentV3(editor);
  const layer =
    recipe.paintLayers.find((item) => item.id === editor.activePaintLayerId) ??
    recipe.paintLayers.at(-1);
  const [pixelX, setPixelX] = useState(0),
    [pixelY, setPixelY] = useState(0),
    [path, setPath] = useState<number[]>([]);
  const width = editor.dimensions?.width ?? 1,
    height = editor.dimensions?.height ?? 1,
    short = Math.min(width, height);
  const settings = editor.paintSettings;
  const material = settings.mode === 'paint' ? settings.material : undefined;
  const [makeupView, setMakeupView] = useState<'brush' | 'color' | 'layers'>('brush');
  const [strokeEdit, setStrokeEdit] = useState<{
    layerId: string;
    index: number;
    original: PaintStrokeV3;
    draft: PaintStrokeV3;
  } | null>(null);
  const selectedStroke = strokeEdit?.layerId === layer?.id ? strokeEdit : null;
  const editableStrokes =
    layer?.strokes.flatMap((stroke, index) => (stroke.material ? [index] : [])) ?? [];
  useEffect(() => {
    if (layer && editor.activePaintLayerId !== layer.id) editor.setActivePaintLayerId(layer.id);
  }, [layer?.id, editor.activePaintLayerId]);
  function patch(patch: Partial<PaintLayerV3>, label: string, commit = true) {
    if (!layer) return false;
    const latest = currentV3(editor);
    return apply(
      {
        ...latest,
        paintLayers: latest.paintLayers.map((item) =>
          item.id === layer.id ? { ...item, ...patch } : item,
        ),
      },
      label,
      commit,
    );
  }
  function addLayer() {
    const latest = currentV3(editor),
      next: PaintLayerV3 = {
        id: secureUuid(),
        name: t('绘制 ') + (latest.paintLayers.length + 1),
        enabled: true,
        opacity: 1,
        blendMode: 'normal',
        mask: null,
        strokes: [],
      };
    if (apply({ ...latest, paintLayers: [...latest.paintLayers, next] }, '新建绘制图层', true))
      editor.setActivePaintLayerId(next.id);
  }
  function selectMakeup(tip: MakeupBrushId | null) {
    const preset = tip ? makeupBrushes[tip] : undefined;
    editor.setPaintSettings((previous) => ({
      ...previous,
      mode: 'paint',
      choosingSource: false,
      makeupTip: tip ?? undefined,
      material: preset?.material,
      ...(preset
        ? {
            color: hexRgba(preset.colors[0]!),
            radius: preset.radius,
            feather: preset.feather,
            opacity: preset.opacity,
          }
        : {}),
    }));
  }
  function chooseStroke(index: number) {
    const original = layer?.strokes[index];
    if (!layer || !original?.material) return;
    setStrokeEdit({ layerId: layer.id, index, original, draft: original });
  }
  function changeStroke(changes: Partial<PaintStrokeV3>) {
    setStrokeEdit((value) => (value ? { ...value, draft: { ...value.draft, ...changes } } : null));
  }
  function saveStroke(remove = false) {
    if (!selectedStroke || !layer) return;
    const latest = currentV3(editor).paintLayers.find((item) => item.id === selectedStroke.layerId);
    if (
      !latest ||
      JSON.stringify(latest.strokes[selectedStroke.index]) !==
        JSON.stringify(selectedStroke.original)
    ) {
      report(t('笔画已变化，请重新选择。'));
      setStrokeEdit(null);
      return;
    }
    const strokes = latest.strokes.flatMap((stroke, index) =>
      index === selectedStroke.index ? (remove ? [] : [selectedStroke.draft]) : [stroke],
    );
    if (patch({ strokes }, t(remove ? '删除妆容笔画' : '应用笔画修改'))) setStrokeEdit(null);
  }
  function stamp() {
    if (!layer || (settings.mode === 'clone' && !settings.source)) return;
    const latest = currentV3(editor),
      current = latest.paintLayers.find((item) => item.id === layer.id);
    if (!current) return;
    const {
      choosingSource: _state,
      pressureSensitive: _pressure,
      makeupTip: _tip,
      material: _material,
      automaticMakeup: _auto,
      ...stroke
    } = settings;
    apply(
      {
        ...latest,
        paintLayers: latest.paintLayers.map((item) =>
          item.id === current.id
            ? {
                ...item,
                strokes: [
                  ...item.strokes,
                  {
                    ...stroke,
                    ...(material
                      ? {
                          material,
                          sampling: {
                            algorithm: 'swept-v1' as const,
                            pressure: [1],
                            breaks: [],
                            antialias: true,
                          },
                        }
                      : {}),
                    points: [
                      {
                        x: (Math.min(width - 1, pixelX) + 0.5) / width,
                        y: (Math.min(height - 1, pixelY) + 0.5) / height,
                      },
                    ],
                  },
                ],
              }
            : item,
        ),
      },
      '按原图坐标落笔',
      true,
    );
  }
  const modeSwitch = (
    <RubberSegment<'manual' | 'auto'>
      label={t('妆容方式')}
      className="makeup-mode"
      value={settings.automaticMakeup ? 'auto' : 'manual'}
      onChange={(value) => {
        editor.commitCurrent(t('完成妆容调节'));
        editor.setPaintSettings((previous) => ({ ...previous, automaticMakeup: value === 'auto' }));
      }}
      options={[
        { value: 'manual', label: t('手动') },
        { value: 'auto', label: t('自动') },
      ]}
    />
  );
  return (
    <section className="advanced-tool-family" data-motion="paint-controls">
      {headerTarget ? createPortal(modeSwitch, headerTarget) : modeSwitch}
      {settings.automaticMakeup ? (
        <AutomaticMakeupControls controller={controller} />
      ) : (
        <>
          <MakeupBrushRail
            value={material ? (settings.makeupTip ?? null) : null}
            onChange={selectMakeup}
          />
          {material && (
            <RubberSegment<'brush' | 'color' | 'layers'>
              label={t('手动妆容参数')}
              className="makeup-parameter-tabs"
              value={makeupView}
              onChange={setMakeupView}
              options={[
                { value: 'brush', label: t('笔触') },
                { value: 'color', label: t('颜色') },
                { value: 'layers', label: t('图层') },
              ]}
            />
          )}
          {material && (
            <>
              {makeupView === 'brush' && (
                <ParameterShelf
                  label={t('妆容笔')}
                  controls={[
                    {
                      id: 'makeup-diameter',
                      glyph: 'diameter',
                      label: t('直径'),
                      value: settings.radius * short * 2,
                      min: 0.5,
                      max: short,
                      step: 0.1,
                      unit: 'px',
                      onChange: (n) =>
                        editor.setPaintSettings((s) => ({ ...s, radius: n / short / 2 })),
                    },
                    {
                      id: 'makeup-opacity',
                      glyph: 'opacity',
                      label: t('笔触透明度'),
                      value: settings.opacity * 100,
                      min: 0,
                      max: 100,
                      step: 0.1,
                      unit: '%',
                      onChange: (n) => editor.setPaintSettings((s) => ({ ...s, opacity: n / 100 })),
                    },
                    {
                      id: 'makeup-saturation',
                      glyph: 'saturation',
                      label: t('饱和度'),
                      value: material.saturation * 100,
                      min: 0,
                      max: 200,
                      step: 0.1,
                      unit: '%',
                      onChange: (n) =>
                        editor.setPaintSettings((s) =>
                          s.material
                            ? { ...s, material: { ...s.material, saturation: n / 100 } }
                            : s,
                        ),
                    },
                    {
                      id: 'makeup-feather',
                      glyph: 'feather',
                      label: t('柔边'),
                      value: settings.feather * 100,
                      min: 0,
                      max: 100,
                      step: 0.1,
                      unit: '%',
                      onChange: (n) => editor.setPaintSettings((s) => ({ ...s, feather: n / 100 })),
                    },
                  ]}
                />
              )}
              {makeupView === 'color' && (
                <>
                  {settings.makeupTip && (
                    <MakeupSwatches
                      brush={settings.makeupTip}
                      color={rgbaHex(settings.color)}
                      onColor={(color) =>
                        editor.setPaintSettings((previous) => {
                          const next = hexRgba(color);
                          next[3] = previous.color[3];
                          return { ...previous, color: next };
                        })
                      }
                    />
                  )}
                  <MotionDetails className="advanced-disclosure">
                    <summary>
                      <i
                        className="paint-color-chip"
                        style={{ background: rgbaHex(settings.color) }}
                      />
                      {t('画笔颜色与 Alpha')}
                    </summary>
                    <ColorPicker
                      value={rgbaHex(settings.color)}
                      label={t('画笔颜色')}
                      onChange={(color) =>
                        editor.setPaintSettings((s) => ({ ...s, color: hexRgba(color) }))
                      }
                    />
                    <MaterialChoices
                      value={material}
                      onChange={(value) =>
                        editor.setPaintSettings((s) => ({ ...s, material: value }))
                      }
                    />
                  </MotionDetails>
                </>
              )}
            </>
          )}
          {(!material || makeupView === 'layers') && (
            <>
              <div className="advanced-row">
                <span>
                  {t('绘制图层')}
                  {recipe.paintLayers.length} / {MAX_V3_PAINT_LAYERS}
                </span>
                <button
                  className="text-button"
                  disabled={recipe.paintLayers.length >= MAX_V3_PAINT_LAYERS}
                  onClick={addLayer}
                >
                  <Plus size={16} />
                  {t('新建')}
                </button>
              </div>
              <div className="advanced-object-list" aria-label={t('绘制图层')}>
                {recipe.paintLayers.map((item, index) => (
                  <div key={item.id} className="advanced-row" data-selected={item.id === layer?.id}>
                    <button
                      className="object-name"
                      aria-pressed={item.id === layer?.id}
                      onClick={() => {
                        editor.setActivePaintLayerId(item.id);
                        setPath([]);
                        setStrokeEdit(null);
                      }}
                    >
                      {item.name}
                      <small>
                        {t(item.strokes.length === 1 ? '1 笔 · {mode}' : '{count} 笔 · {mode}', {
                          count: item.strokes.length,
                          mode: t(blendLabels[item.blendMode]),
                        })}
                      </small>
                    </button>
                    <IconButton
                      label={editorFlowText(item.enabled ? 'hideNamed' : 'showNamed', {
                        name: item.name,
                      })}
                      onClick={() =>
                        apply(
                          {
                            ...currentV3(editor),
                            paintLayers: currentV3(editor).paintLayers.map((p) =>
                              p.id === item.id ? { ...p, enabled: !p.enabled } : p,
                            ),
                          },
                          t('切换绘制图层'),
                          true,
                        )
                      }
                    >
                      {item.enabled ? <Eye size={16} /> : <EyeSlash size={16} />}
                    </IconButton>
                  </div>
                ))}
              </div>
              {layer && (
                <>
                  <div className="tonal-tabs" aria-label={t('绘制模式')}>
                    {(
                      [
                        ['paint', t('画笔')],
                        ['erase', t('橡皮')],
                        ['clone', t('克隆')],
                      ] as const
                    ).map(([mode, name]) => (
                      <button
                        key={mode}
                        aria-pressed={settings.mode === mode}
                        onClick={() =>
                          editor.setPaintSettings({ ...settings, mode, choosingSource: false })
                        }
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <ParameterShelf
                    label={t('绘制参数')}
                    controls={(
                      [
                        {
                          id: 'diameter',
                          label: t('直径'),
                          value: settings.radius * short * 2,
                          min: 1,
                          max: short,
                          step: 0.1,
                          unit: 'px',
                          description: t('以原图像素为准；1px 使用精确栅格落点。'),
                          onChange: (n) =>
                            editor.setPaintSettings((s) => ({ ...s, radius: n / short / 2 })),
                        },
                        {
                          id: 'feather',
                          label: t('柔边'),
                          value: settings.feather * 100,
                          min: 0,
                          max: 100,
                          step: 0.1,
                          unit: '%',
                          onChange: (n) =>
                            editor.setPaintSettings((s) => ({ ...s, feather: n / 100 })),
                        },
                        {
                          id: 'flow',
                          label: t('笔触透明度'),
                          value: settings.opacity * 100,
                          min: 0,
                          max: 100,
                          step: 0.1,
                          unit: '%',
                          onChange: (n) =>
                            editor.setPaintSettings((s) => ({ ...s, opacity: n / 100 })),
                        },
                        {
                          id: 'layer-opacity',
                          label: t('图层透明度'),
                          value: layer.opacity * 100,
                          min: 0,
                          max: 100,
                          step: 0.1,
                          unit: '%',
                          onChange: (n) => patch({ opacity: n / 100 }, t('调整图层透明度'), false),
                        },
                      ] satisfies ShelfControl[]
                    ).filter((control) => !material || control.id === 'layer-opacity')}
                    onCommit={(name) => editor.commitCurrent(t('调整{v0}', { v0: t(name) }))}
                    onCancel={editor.cancelPreview}
                  />
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={settings.pressureSensitive}
                      onChange={(event) =>
                        editor.setPaintSettings((previous) => ({
                          ...previous,
                          pressureSensitive: event.target.checked,
                        }))
                      }
                    />
                    {t('数位笔压感与平滑边缘（大于 1 px 的画笔）')}
                  </label>
                  {settings.mode === 'paint' && !material && (
                    <MotionDetails className="advanced-disclosure" defaultOpen>
                      <summary>
                        <i
                          className="paint-color-chip"
                          style={{ background: rgbaHex(settings.color) }}
                        />
                        {t('画笔颜色与 Alpha')}
                      </summary>
                      <ColorPicker
                        value={rgbaHex(settings.color)}
                        onChange={(value) =>
                          editor.setPaintSettings((s) => ({ ...s, color: hexRgba(value) }))
                        }
                        label={t('画笔颜色')}
                      />
                      <div className="advanced-row">
                        <button className="text-button" onClick={onSample}>
                          {sampling ? t('结束取色') : t('从原图取色')}
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            editor.setPaintSettings((s) => ({ ...s, color: hexRgba(pickedColor) }))
                          }
                        >
                          {t('使用所取颜色')}
                        </button>
                      </div>
                    </MotionDetails>
                  )}
                  {settings.mode === 'clone' && (
                    <>
                      <button
                        className="text-button"
                        aria-pressed={settings.choosingSource}
                        onClick={() =>
                          editor.setPaintSettings((s) => ({
                            ...s,
                            choosingSource: !s.choosingSource,
                          }))
                        }
                      >
                        {settings.choosingSource
                          ? t('点击照片设定克隆来源')
                          : t('在照片选择克隆来源')}
                      </button>
                      <p className="control-note">
                        {settings.source
                          ? t('来源约为 ({v0}, {v1})；采样绘制前图像，不累积复制自身。', {
                              v0: Math.floor(settings.source.x * width),
                              v1: Math.floor(settings.source.y * height),
                            })
                          : t('先选择来源，再绘制；也可以在下面按像素坐标设置来源。')}
                      </p>
                    </>
                  )}
                  <BlendPicker
                    value={layer.blendMode}
                    onChange={(blendMode) => patch({ blendMode }, t('切换绘制混合模式'))}
                  />
                  {editableStrokes.length > 0 && (
                    <MotionDetails className="advanced-disclosure">
                      <summary>{t('编辑妆容笔画')}</summary>
                      <ChoiceSelect
                        size="compact"
                        label={t('笔画')}
                        value={selectedStroke ? String(selectedStroke.index) : ''}
                        onValueChange={(index) => chooseStroke(Number(index))}
                        options={editableStrokes.map((index) => ({
                          value: String(index),
                          label: t('第 {v0} 笔', { v0: index + 1 }),
                        }))}
                      />
                      {selectedStroke?.draft.material && (
                        <>
                          <ColorPicker
                            value={rgbaHex(selectedStroke.draft.color)}
                            label={t('画笔颜色')}
                            onChange={(color) => changeStroke({ color: hexRgba(color) })}
                          />
                          <MaterialChoices
                            value={selectedStroke.draft.material}
                            onChange={(value) => changeStroke({ material: value })}
                          />
                          <ParameterShelf
                            label={t('编辑妆容笔画')}
                            controls={[
                              {
                                id: 'stroke-diameter',
                                glyph: 'diameter',
                                label: t('直径'),
                                value: selectedStroke.draft.radius * short * 2,
                                min: 0.5,
                                max: short,
                                step: 0.1,
                                unit: 'px',
                                onChange: (n) => changeStroke({ radius: n / short / 2 }),
                              },
                              {
                                id: 'stroke-feather',
                                glyph: 'feather',
                                label: t('柔边'),
                                value: selectedStroke.draft.feather * 100,
                                min: 0,
                                max: 100,
                                step: 0.1,
                                unit: '%',
                                onChange: (n) => changeStroke({ feather: n / 100 }),
                              },
                              {
                                id: 'stroke-opacity',
                                glyph: 'opacity',
                                label: t('笔触透明度'),
                                value: selectedStroke.draft.opacity * 100,
                                min: 0,
                                max: 100,
                                step: 0.1,
                                unit: '%',
                                onChange: (n) => changeStroke({ opacity: n / 100 }),
                              },
                              {
                                id: 'stroke-saturation',
                                glyph: 'saturation',
                                label: t('饱和度'),
                                value: selectedStroke.draft.material.saturation * 100,
                                min: 0,
                                max: 200,
                                step: 0.1,
                                unit: '%',
                                onChange: (n) =>
                                  changeStroke({
                                    material: {
                                      ...selectedStroke.draft.material!,
                                      saturation: n / 100,
                                    },
                                  }),
                              },
                            ]}
                          />
                          <div className="advanced-row">
                            <IconButton label={t('删除妆容笔画')} onClick={() => saveStroke(true)}>
                              <Trash size={16} />
                            </IconButton>
                            <button
                              type="button"
                              className="button button-primary"
                              onClick={() => saveStroke()}
                            >
                              {t('应用笔画修改')}
                            </button>
                          </div>
                        </>
                      )}
                    </MotionDetails>
                  )}
                  <MotionDetails className="advanced-disclosure">
                    <summary>{t('逐像素落点')}</summary>
                    <ParameterShelf
                      label={t('原图像素位置')}
                      controls={[
                        {
                          id: 'x',
                          label: t('像素 X'),
                          value: Math.min(width - 1, pixelX),
                          min: 0,
                          max: width - 1,
                          step: material ? 0.1 : 1,
                          integer: !material,
                          unit: 'px',
                          onChange: setPixelX,
                        },
                        {
                          id: 'y',
                          label: t('像素 Y'),
                          value: Math.min(height - 1, pixelY),
                          min: 0,
                          max: height - 1,
                          step: material ? 0.1 : 1,
                          integer: !material,
                          unit: 'px',
                          onChange: setPixelY,
                        },
                      ]}
                    />
                    <div className="advanced-row">
                      <button
                        className="text-button"
                        disabled={settings.mode === 'clone' && !settings.source}
                        onClick={stamp}
                      >
                        {t('在这个像素落笔')}
                      </button>
                      {settings.mode === 'clone' && (
                        <button
                          className="text-button"
                          onClick={() =>
                            editor.setPaintSettings((s) => ({
                              ...s,
                              source: {
                                x: (Math.min(width - 1, pixelX) + 0.5) / width,
                                y: (Math.min(height - 1, pixelY) + 0.5) / height,
                              },
                              choosingSource: false,
                            }))
                          }
                        >
                          {t('设为克隆来源')}
                        </button>
                      )}
                    </div>
                  </MotionDetails>
                  <MotionDetails className="advanced-disclosure">
                    <summary>{t('限制绘制范围')}</summary>
                    <label className="advanced-select">
                      {t('使用局部选区')}
                      <ChoiceSelect
                        ariaLabel={t('绘制范围来源')}
                        size="compact"
                        value=""
                        onValueChange={(value) => {
                          const selected = currentV3(editor).regionEdits.find(
                            (r) => r.id === value,
                          );
                          if (selected) {
                            patch({ mask: structuredClone(selected.mask) }, t('复制绘制范围'));
                            setPath([]);
                          }
                        }}
                        options={[
                          { value: '', label: t('选择一个范围副本') },
                          ...recipe.regionEdits.map((r) => ({ value: r.id, label: r.name })),
                        ]}
                      />
                    </label>
                    {layer.mask && (
                      <>
                        <MaskControls
                          controller={controller}
                          path={path}
                          onPath={setPath}
                          drawsMask={false}
                          getMask={() =>
                            currentV3(editor).paintLayers.find((p) => p.id === layer.id)!.mask!
                          }
                          onChange={(mask, commit) => patch({ mask }, t('修改绘制范围'), commit)}
                        />
                        <button
                          className="text-button"
                          onClick={() => patch({ mask: null }, t('解除绘制范围'))}
                        >
                          {t('解除范围限制')}
                        </button>
                      </>
                    )}
                  </MotionDetails>
                  <MotionDetails className="advanced-disclosure">
                    <summary>{t('图层与笔画管理')}</summary>
                    <label className="advanced-select">
                      {t('名称')}
                      <input
                        aria-label={t('绘制图层名称')}
                        key={layer.id + ':' + layer.name}
                        defaultValue={layer.name}
                        maxLength={120}
                        onBlur={(event) => {
                          const name = event.currentTarget.value.trim();
                          if (!name || name === layer.name) {
                            event.currentTarget.value = layer.name;
                            return;
                          }
                          patch({ name }, t('重命名绘制图层'));
                        }}
                        onKeyDown={(event) => {
                          if (event.nativeEvent.isComposing) return;
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') {
                            event.currentTarget.value = layer.name;
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <div className="advanced-row">
                      <button
                        className="text-button"
                        disabled={!layer.strokes.length}
                        onClick={() =>
                          patch({ strokes: layer.strokes.slice(0, -1) }, t('移除最后一笔'))
                        }
                      >
                        {t('移除最后一笔')}
                      </button>
                      <IconButton
                        label={t('绘制图层前移')}
                        disabled={recipe.paintLayers[0]?.id === layer.id}
                        onClick={() =>
                          apply(
                            {
                              ...recipe,
                              paintLayers: shifted(
                                recipe.paintLayers,
                                recipe.paintLayers.indexOf(layer),
                                -1,
                              ),
                            },
                            t('调整绘制图层顺序'),
                            true,
                          )
                        }
                      >
                        <ArrowUp size={16} />
                      </IconButton>
                      <IconButton
                        label={t('绘制图层后移')}
                        disabled={recipe.paintLayers.at(-1)?.id === layer.id}
                        onClick={() =>
                          apply(
                            {
                              ...recipe,
                              paintLayers: shifted(
                                recipe.paintLayers,
                                recipe.paintLayers.indexOf(layer),
                                1,
                              ),
                            },
                            t('调整绘制图层顺序'),
                            true,
                          )
                        }
                      >
                        <ArrowDown size={16} />
                      </IconButton>
                      <IconButton
                        label={t('删除绘制图层，可撤销')}
                        onClick={() => {
                          if (
                            apply(
                              {
                                ...recipe,
                                paintLayers: recipe.paintLayers.filter((p) => p.id !== layer.id),
                              },
                              t('删除绘制图层'),
                              true,
                            )
                          )
                            editor.setActivePaintLayerId(null);
                        }}
                      >
                        <Trash size={16} />
                      </IconButton>
                    </div>
                  </MotionDetails>
                  <small className="control-note">
                    {t('总笔画预算')}
                    {recipe.paintLayers.reduce((n, p) => n + p.strokes.length, 0)} /{' '}
                    {MAX_V3_PAINT_STROKES}
                    {t('；重置参数不改已绘制的笔画。')}
                  </small>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function LiquifyControls({ controller }: { controller: InspectorController }) {
  const { editor, apply, report } = controller,
    recipe = currentV3(editor),
    settings = editor.warpSettings;
  const short = Math.min(editor.dimensions?.width ?? 1, editor.dimensions?.height ?? 1);
  async function protectBackground() {
    const before = editor.getSourceIdentity();
    const frame = editor.getSourceFrame();
    let analysis = editor.portrait.analysis;
    if (!portraitSelectionMatchesSource(analysis, frame) || !analysis?.segmentation?.subject)
      analysis = (await editor.portrait.analyze()) ?? null;
    if (before !== editor.getSourceIdentity()) return;
    const subject = analysis?.segmentation?.subject;
    if (
      !portraitSelectionMatchesSource(analysis, editor.getSourceFrame()) ||
      !subject ||
      !analysis?.targets.length
    ) {
      report(t('没有识别到可信的人像边界。可用画笔标记要保护的位置。'));
      return;
    }
    const current = currentV3(editor);
    const background = { ...subject, invert: !subject.invert };
    const previous = current.warp.protection;
    const key = JSON.stringify(background);
    if (
      previous &&
      (JSON.stringify(previous) === key ||
        (previous.type === 'compound' &&
          previous.operation === 'union' &&
          !previous.invert &&
          previous.masks.some((item) => JSON.stringify(item) === key)))
    )
      return;
    const protection: SelectionMaskV3 =
      previous && !(previous.type === 'brush' && !previous.strokes.length && !previous.invert)
        ? { type: 'compound', operation: 'union', masks: [previous, background], invert: false }
        : background;
    if (
      apply({ ...current, warp: { ...current.warp, protection } }, t('保护识别到的人像背景'), true)
    )
      editor.setActiveMaskPath([]);
  }
  return (
    <section className="advanced-tool-family" data-motion="warp-controls">
      <div className="tonal-tabs" aria-label={t('液化方式')}>
        {(
          [
            ['push', t('推动')],
            ['pinch', t('收缩')],
            ['bulge', t('膨胀')],
            ['twirl', t('旋转')],
            ['restore', t('局部恢复')],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            aria-pressed={settings.mode === mode && !settings.protecting}
            onClick={() =>
              editor.setWarpSettings((s) => ({
                ...s,
                mode,
                protecting: false,
              }))
            }
          >
            {mode === 'restore' && <Eraser size={16} />}
            {label}
          </button>
        ))}
      </div>
      <div className="makeup-parameter-tabs portrait-manual-rail">
        <RubberSegment<'free' | 'horizontal' | 'vertical'>
          label={t('拉伸方向')}
          value={settings.axis ?? 'free'}
          onChange={(axis) =>
            editor.setWarpSettings((current) => ({
              ...current,
              axis,
              mode: 'push',
              protecting: false,
            }))
          }
          options={[
            { value: 'free', label: t('自由') },
            { value: 'horizontal', label: t('横向') },
            { value: 'vertical', label: t('纵向') },
          ]}
        />
        {recipe.regionEdits.some((region) => region.enabled) && (
          <ChoiceSelect
            size="compact"
            ariaLabel={t('拉伸范围')}
            value={settings.regionId ?? ''}
            onValueChange={(regionId) =>
              editor.setWarpSettings((current) => ({ ...current, regionId }))
            }
            options={[
              { value: '', label: t('整张图片') },
              ...recipe.regionEdits
                .filter((region) => region.enabled)
                .map(({ id, name }) => ({ value: id, label: name })),
            ]}
          />
        )}
      </div>
      <ParameterShelf
        label={t('液化画笔')}
        controls={[
          {
            id: 'radius',
            label: t('作用直径'),
            value: settings.radius * short * 2,
            min: 0.5,
            max: short * 2,
            step: 0.1,
            unit: 'px',
            onChange: (n) => editor.setWarpSettings((s) => ({ ...s, radius: n / short / 2 })),
          },
          {
            id: 'strength',
            label: settings.mode === 'restore' ? t('恢复强度') : t('双向强度'),
            value:
              (settings.mode === 'restore' ? settings.restoreStrength : settings.strength) * 100,
            min: settings.mode === 'restore' ? 0 : -100,
            max: 100,
            step: 0.1,
            neutral: 0,
            unit: '%',
            onChange: (n) =>
              editor.setWarpSettings((s) => ({
                ...s,
                [settings.mode === 'restore' ? 'restoreStrength' : 'strength']: n / 100,
              })),
          },
          {
            id: 'feather',
            label: t('边缘过渡'),
            value: settings.feather * 100,
            min: 0,
            max: 100,
            step: 0.1,
            unit: '%',
            onChange: (n) => editor.setWarpSettings((s) => ({ ...s, feather: n / 100 })),
          },
        ]}
      />
      <label className="compact-check">
        <input
          type="checkbox"
          checked={recipe.warp.enabled}
          onChange={(event) =>
            apply(
              { ...recipe, warp: { ...recipe.warp, enabled: event.target.checked } },
              t('切换液化效果'),
              true,
            )
          }
        />
        {t('显示液化效果')}
      </label>
      <MotionDetails className="advanced-disclosure">
        <summary>{t('背景与局部保护')}</summary>
        <div className="advanced-row">
          <button
            className="text-button"
            disabled={!!editor.portrait.progress}
            onClick={() => void protectBackground()}
          >
            <ShieldCheckered size={16} />
            {editor.portrait.progress ? t('正在识别人像') : t('保护人像背景')}
          </button>
          <button
            className="text-button"
            aria-pressed={settings.protecting}
            onClick={() => {
              if (
                !recipe.warp.protection &&
                !apply(
                  { ...recipe, warp: { ...recipe.warp, protection: newMask('brush') } },
                  t('建立液化保护范围'),
                  true,
                )
              )
                return;
              editor.setWarpSettings((s) => ({ ...s, protecting: !s.protecting }));
              editor.setActiveMaskPath([]);
            }}
          >
            {settings.protecting ? t('结束保护范围编辑') : t('涂抹保护范围')}
          </button>
          {recipe.warp.protection && (
            <button
              className="text-button"
              onClick={() => {
                apply(
                  { ...recipe, warp: { ...recipe.warp, protection: null } },
                  t('解除液化保护'),
                  true,
                );
                editor.setWarpSettings((s) => ({ ...s, protecting: false }));
              }}
            >
              {t('清除保护，可撤销')}
            </button>
          )}
        </div>
        <label className="advanced-select">
          {t('从局部复制')}
          <ChoiceSelect
            ariaLabel={t('液化保护来源')}
            size="compact"
            value=""
            onValueChange={(value) => {
              const r = recipe.regionEdits.find((r) => r.id === value);
              if (r) {
                apply(
                  { ...recipe, warp: { ...recipe.warp, protection: structuredClone(r.mask) } },
                  t('复制液化保护范围'),
                  true,
                );
                editor.setActiveMaskPath([]);
              }
            }}
            options={[
              { value: '', label: t('选择范围') },
              ...recipe.regionEdits.map((r) => ({ value: r.id, label: r.name })),
            ]}
          />
        </label>
        {recipe.warp.protection && settings.protecting && (
          <MaskControls
            controller={controller}
            path={editor.activeMaskPath}
            onPath={editor.setActiveMaskPath}
            getMask={() => currentV3(editor).warp.protection!}
            onChange={(protection, commit) => {
              const r = currentV3(editor);
              return apply(
                { ...r, warp: { ...r.warp, protection } },
                t('调整液化保护范围'),
                commit,
              );
            }}
          />
        )}
      </MotionDetails>
      <div className="advanced-row">
        <small>
          {recipe.warp.strokes.length} / {MAX_V3_WARP_STROKES} {t('次变形')}
        </small>
        <button
          className="text-button"
          disabled={!recipe.warp.strokes.length}
          onClick={() =>
            apply(
              { ...recipe, warp: { ...recipe.warp, strokes: recipe.warp.strokes.slice(0, -1) } },
              t('移除最后一次变形'),
              true,
            )
          }
        >
          {t('移除最后一次')}
        </button>
      </div>
    </section>
  );
}

export function ImageLayerControls({ controller }: { controller: InspectorController }) {
  const { editor, apply, report } = controller,
    recipe = currentV3(editor);
  const input = useRef<HTMLInputElement>(null),
    [loading, setLoading] = useState(false),
    [path, setPath] = useState<number[]>([]);
  const layer =
    recipe.imageLayers.find((p) => p.id === editor.activeImageLayerId) ?? recipe.imageLayers.at(-1);
  useEffect(() => {
    if (layer && editor.activeImageLayerId !== layer.id) editor.setActiveImageLayerId(layer.id);
  }, [layer?.id, editor.activeImageLayerId]);
  function patch(patch: Partial<ImageLayerV3>, label: string, commit = true) {
    if (!layer) return false;
    const latest = currentV3(editor);
    return apply(
      {
        ...latest,
        imageLayers: latest.imageLayers.map((item) =>
          item.id === layer.id ? { ...item, ...patch } : item,
        ),
      },
      label,
      commit,
    );
  }
  const controls: ShelfControl[] = layer
    ? (
        [
          ['x', t('位置 X'), -4, 4, 0.0001, ''],
          ['y', t('位置 Y'), -4, 4, 0.0001, ''],
          ['width', t('宽度比例'), 0.000001, 8, 0.0001, ''],
          ['height', t('高度比例'), 0.000001, 8, 0.0001, ''],
          ['rotationDegrees', t('旋转角度'), -180, 180, 0.01, '°'],
          ['opacity', t('透明度'), 0, 1, 0.001, ''],
        ] as const
      ).map(([key, label, min, max, step, unit]) => ({
        id: key,
        label,
        value: layer[key],
        min,
        max,
        step,
        unit,
        onChange: (n: number) => patch({ [key]: n }, '调整合成' + label, false),
      }))
    : [];
  return (
    <section className="advanced-tool-family" data-motion="composite-controls">
      <input
        hidden
        ref={input}
        type="file"
        accept="image/*"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          setLoading(true);
          try {
            await editor.importImageLayer(file);
            report(null);
          } catch (error) {
            report(errorMessage(error));
          } finally {
            setLoading(false);
          }
        }}
      />
      <div className="advanced-row">
        <span>
          {t('合成图层')}
          {recipe.imageLayers.length} / {MAX_V3_IMAGE_LAYERS}
        </span>
        <button
          className="text-button"
          disabled={loading || recipe.imageLayers.length >= MAX_V3_IMAGE_LAYERS}
          onClick={() => input.current?.click()}
        >
          <UploadSimple size={16} />
          {loading ? t('导入中') : t('添加图片')}
        </button>
      </div>
      <p className="control-note">
        {t('每层保留自己的原图、范围、混合与位置。AI 候选也可在结果区明确选择“作为合成图层”。')}
      </p>
      <div className="advanced-object-list" aria-label={t('合成图层')}>
        {recipe.imageLayers.map((item) => (
          <div className="advanced-row" key={item.id} data-selected={layer?.id === item.id}>
            <button
              className="object-name"
              aria-pressed={layer?.id === item.id}
              onClick={() => {
                editor.setActiveImageLayerId(item.id);
                setPath([]);
              }}
            >
              {item.name}
              <small>{t(blendLabels[item.blendMode])}</small>
            </button>
            <IconButton
              label={editorFlowText(item.enabled ? 'hideNamed' : 'showNamed', { name: item.name })}
              onClick={() =>
                apply(
                  {
                    ...recipe,
                    imageLayers: recipe.imageLayers.map((p) =>
                      p.id === item.id ? { ...p, enabled: !p.enabled } : p,
                    ),
                  },
                  t('切换合成图层'),
                  true,
                )
              }
            >
              {item.enabled ? <Eye size={16} /> : <EyeSlash size={16} />}
            </IconButton>
          </div>
        ))}
      </div>
      {layer && (
        <>
          <ParameterShelf
            label={t('合成位置')}
            controls={controls}
            onCommit={(name) => editor.commitCurrent(t('调整合成') + name)}
            onCancel={editor.cancelPreview}
          />
          <div className="tonal-tabs">
            <button
              aria-pressed={layer.flipX}
              onClick={() => patch({ flipX: !layer.flipX }, t('水平镜像合成图层'))}
            >
              {t('水平镜像')}
            </button>
            <button
              aria-pressed={layer.flipY}
              onClick={() => patch({ flipY: !layer.flipY }, t('垂直镜像合成图层'))}
            >
              {t('垂直镜像')}
            </button>
          </div>
          <BlendPicker
            value={layer.blendMode}
            onChange={(blendMode) => patch({ blendMode }, t('切换合成混合模式'))}
          />
          <MotionDetails className="advanced-disclosure">
            <summary>{t('合成范围与羽化')}</summary>
            <div className="tonal-tabs">
              {(['radial', 'linear', 'polygon', 'color-range'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    patch({ mask: newMask(type) }, t('设置合成范围'));
                    setPath([]);
                  }}
                >
                  {
                    {
                      radial: t('径向'),
                      linear: t('渐变'),
                      polygon: t('多边形'),
                      'color-range': t('选色'),
                    }[type]
                  }
                </button>
              ))}
            </div>
            <label className="advanced-select">
              {t('复制局部范围')}
              <ChoiceSelect
                ariaLabel={t('合成蒙版来源')}
                size="compact"
                value=""
                onValueChange={(value) => {
                  const r = recipe.regionEdits.find((p) => p.id === value);
                  if (r) {
                    patch({ mask: structuredClone(r.mask) }, t('复制合成范围'));
                    setPath([]);
                  }
                }}
                options={[
                  { value: '', label: t('选择范围副本') },
                  ...recipe.regionEdits.map((r) => ({ value: r.id, label: r.name })),
                ]}
              />
            </label>
            {layer.mask && (
              <>
                <MaskControls
                  controller={controller}
                  path={path}
                  onPath={setPath}
                  drawsMask={false}
                  getMask={() =>
                    currentV3(editor).imageLayers.find((p) => p.id === layer.id)!.mask!
                  }
                  onChange={(mask, commit) => patch({ mask }, t('调整合成范围'), commit)}
                />
                <button
                  className="text-button"
                  onClick={() => patch({ mask: null }, t('解除合成范围'))}
                >
                  {t('解除范围')}
                </button>
              </>
            )}
          </MotionDetails>
          <MotionDetails className="advanced-disclosure">
            <summary>{t('图层管理')}</summary>
            <label className="advanced-select">
              {t('名称')}
              <input
                aria-label={t('合成图层名称')}
                key={layer.id + ':' + layer.name}
                defaultValue={layer.name}
                maxLength={120}
                onBlur={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (!name || name === layer.name) {
                    event.currentTarget.value = layer.name;
                    return;
                  }
                  patch({ name }, t('重命名合成图层'));
                }}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    event.currentTarget.value = layer.name;
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <div className="advanced-row">
              <IconButton
                label={t('合成图层前移')}
                disabled={recipe.imageLayers[0]?.id === layer.id}
                onClick={() =>
                  apply(
                    {
                      ...recipe,
                      imageLayers: shifted(
                        recipe.imageLayers,
                        recipe.imageLayers.indexOf(layer),
                        -1,
                      ),
                    },
                    t('调整合成顺序'),
                    true,
                  )
                }
              >
                <ArrowUp size={16} />
              </IconButton>
              <IconButton
                label={t('合成图层后移')}
                disabled={recipe.imageLayers.at(-1)?.id === layer.id}
                onClick={() =>
                  apply(
                    {
                      ...recipe,
                      imageLayers: shifted(
                        recipe.imageLayers,
                        recipe.imageLayers.indexOf(layer),
                        1,
                      ),
                    },
                    t('调整合成顺序'),
                    true,
                  )
                }
              >
                <ArrowDown size={16} />
              </IconButton>
              <IconButton
                label={t('复制合成图层')}
                disabled={recipe.imageLayers.length >= MAX_V3_IMAGE_LAYERS}
                onClick={() => {
                  const copy = {
                    ...structuredClone(layer),
                    id: secureUuid(),
                    name: layer.name.slice(0, 112) + t(' 副本'),
                  };
                  if (
                    apply(
                      { ...recipe, imageLayers: [...recipe.imageLayers, copy] },
                      t('复制合成图层'),
                      true,
                    )
                  )
                    editor.setActiveImageLayerId(copy.id);
                }}
              >
                <Copy size={16} />
              </IconButton>
              <IconButton
                label={t('删除合成图层，可撤销')}
                onClick={() => {
                  if (
                    apply(
                      {
                        ...recipe,
                        imageLayers: recipe.imageLayers.filter((p) => p.id !== layer.id),
                      },
                      t('删除合成图层'),
                      true,
                    )
                  )
                    editor.setActiveImageLayerId(null);
                }}
              >
                <Trash size={16} />
              </IconButton>
            </div>
          </MotionDetails>
        </>
      )}
    </section>
  );
}
