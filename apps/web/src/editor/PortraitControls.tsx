import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { useEffect, useId, useRef, useState } from 'react';
import { Sparkle, PaintBrush, HandPointing, ArrowsClockwise } from '@phosphor-icons/react';
import {
  PORTRAIT_TOOLS,
  portraitValues,
  applyPortraitValues,
  portraitMakeupColors,
  portraitToolAvailability,
  detachPortraitTarget,
} from '@ai-xiutu/portrait';
import { MAX_V3_PAINT_LAYERS, MAX_V3_REGION_EDITS, type PaintLayerV3 } from '@ai-xiutu/editor';
import { secureUuid } from '../lib/uuid';
import { errorMessage } from '../lib/api';
import { Busy, InlineError } from '../components/Ui';
import { StudioGlyph } from '../components/StudioGlyph';
import { ColorPicker } from '../components/ColorPicker';
import { ParameterShelf } from './ParameterShelf';
import { PrecisionRange } from './PrecisionRange';
import { currentV3, rgbaHex, hexRgba, type InspectorController } from './advanced-model';
import type { ToolGroup } from './ToolInspector';
import { portraitTargetDisplayLabel } from './portrait-label';
import { interactionText } from '../workspace/interaction-copy';
import type { PortraitMatteMethod } from './portrait-matte.worker';
import {
  portraitSelectionLabels,
  portraitSelectionMatchesSource,
  preparePortraitSelection,
  type PortraitSelectionKind,
} from './portrait-selection';

export type CutoutGuides = {
  method: PortraitMatteMethod;
  foregroundId: string;
  backgroundId: string;
  radius: number;
  decontaminate: number;
};
const DEFAULT_CUTOUT_GUIDES: CutoutGuides = {
  method: 'standard',
  foregroundId: '',
  backgroundId: '',
  radius: 0.015,
  decontaminate: 0.8,
};

export function PortraitControls({
  controller,
  onGroupChange,
  onSelectionCreated,
  onCutout,
}: {
  controller: InspectorController;
  onGroupChange?: (group: ToolGroup) => void;
  onSelectionCreated?: (id: string) => void;
  onCutout?: (guides: CutoutGuides) => Promise<string>;
}) {
  const { editor, apply, report } = controller,
    state = editor.portrait;
  const [category, setCategory] = useState<'skin' | 'features' | 'body' | 'makeup'>('skin');
  const [makeupTool, setMakeupTool] = useState('lipstick');
  const [draftColors, setDraftColors] = useState<Record<string, [number, number, number, number]>>(
    {},
  );
  const annotationInput = useRef<HTMLInputElement>(null);
  const [annotationBusy, setAnnotationBusy] = useState(false);
  const [annotationStatus, setAnnotationStatus] = useState<string | null>(null);
  const [cutting, setCutting] = useState(false);
  const cutoutLocked = useRef(false);
  const sourceIdentity = editor.getSourceIdentity();
  const pausedCutoutOutcome = useRef<{
    sourceIdentity: number;
    message?: string;
    error?: string;
  } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    // Returning from another tool restores the same owner. A completed cutout
    // must not leave the retained button busy just because its result arrived
    // while this tool's effects were paused.
    setCutting(cutoutLocked.current);
    const outcome = pausedCutoutOutcome.current;
    pausedCutoutOutcome.current = null;
    if (outcome?.sourceIdentity === editor.getSourceIdentity()) {
      if (outcome.message) setAnnotationStatus(outcome.message);
      if (outcome.error) report(outcome.error);
    }
    return () => {
      mounted.current = false;
    };
  }, []);
  const kind = category === 'body' ? 'body' : 'face';
  const targets = state.analysis?.targets.filter((target) => target.kind === kind) ?? [];
  const target = targets.find((person) => person.id === state.activeTargetId) ?? targets[0];
  const recipe = currentV3(editor);
  const selectionHintId = useId();
  const [guides, setGuides] = useState(DEFAULT_CUTOUT_GUIDES);
  const guideSource = useRef(sourceIdentity);
  useEffect(() => {
    if (guideSource.current === sourceIdentity) return;
    guideSource.current = sourceIdentity;
    setGuides(DEFAULT_CUTOUT_GUIDES);
  }, [sourceIdentity]);
  const analysisCurrent = portraitSelectionMatchesSource(state.analysis, editor.getSourceFrame());
  const hasSubject = analysisCurrent && !!state.analysis?.segmentation?.subject;
  const [fineMatteAvailable, setFineMatteAvailable] = useState(false);
  useEffect(() => {
    if (!hasSubject || !navigator.gpu) return;
    let active = true;
    void navigator.gpu
      .requestAdapter()
      .then((adapter) => {
        if (active)
          setFineMatteAvailable(
            !!adapter && !adapter.info.isFallbackAdapter && adapter.features.has('shader-f16'),
          );
      })
      .catch(() => {
        if (active) setFineMatteAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [hasSubject]);
  const guideOptions = [
    { value: '', label: t('无') },
    ...recipe.regionEdits
      .filter((region) => region.enabled)
      .map((region) => ({ value: region.id, label: region.name })),
  ];
  const validGuides =
    (!guides.foregroundId || guides.foregroundId !== guides.backgroundId) &&
    guideOptions.some(({ value }) => value === guides.foregroundId) &&
    guideOptions.some(({ value }) => value === guides.backgroundId);
  const selectionAvailable =
    !!state.analysis?.segmentation &&
    analysisCurrent &&
    !state.progress &&
    recipe.regionEdits.length < MAX_V3_REGION_EDITS;
  const targetOperations = [
    ...recipe.regionEdits,
    ...recipe.paintLayers,
    ...recipe.warp.strokes,
    ...(recipe.schemaVersion === 4 ? [...recipe.retouch, ...recipe.healing] : []),
  ].filter((item) => item.origin?.instanceId === target?.id);
  const hasAutomatic = targetOperations.some(
    (item) =>
      item.origin?.moduleId === 'portrait.basic.v1' ||
      item.origin?.moduleId === 'portrait.basic.v2',
  );
  const hasManual = targetOperations.some((item) => item.origin?.moduleId === 'portrait.manual.v1');
  const values = target ? portraitValues(recipe, target.id) : {};
  const existingColors = target ? portraitMakeupColors(recipe, target.id) : {};
  const availability =
    state.analysis && target
      ? portraitToolAvailability(state.analysis, target.id, recipe.schemaVersion)
      : [];
  const hasLegacyNeck =
    recipe.schemaVersion === 4 && category === 'body' && (values.neckLength ?? 0) !== 0;
  const colorKey = [state.analysis?.frame.contentHash, target?.id, makeupTool].join(':');
  const color = existingColors[makeupTool] ?? draftColors[colorKey] ?? [178, 66, 86, 255];
  async function createCutout() {
    if (cutoutLocked.current || !mounted.current || !onCutout) return;
    if (editor.isLoading() || editor.getSourceIdentity() !== sourceIdentity) {
      report('人物分析与当前原图不一致，请重新识别后提取素材。');
      return;
    }
    if (state.progress || !validGuides || (!hasSubject && !guides.foregroundId)) return;
    cutoutLocked.current = true;
    pausedCutoutOutcome.current = null;
    setCutting(true);
    setAnnotationStatus(null);
    try {
      const message = await onCutout(guides);
      if (editor.getSourceIdentity() === sourceIdentity) {
        if (mounted.current) setAnnotationStatus(message);
        else pausedCutoutOutcome.current = { sourceIdentity, message };
      }
    } catch (failure) {
      if (editor.getSourceIdentity() === sourceIdentity) {
        if (mounted.current) report(errorMessage(failure));
        else pausedCutoutOutcome.current = { sourceIdentity, error: errorMessage(failure) };
      }
    } finally {
      cutoutLocked.current = false;
      if (mounted.current) setCutting(false);
    }
  }
  function createSelection(kind: PortraitSelectionKind) {
    try {
      if (editor.isLoading() || editor.getSourceIdentity() !== sourceIdentity)
        throw new Error('原图已经切换，请重新识别后建立选区。');
      if (state.progress) throw new Error('请等待这次识别完成，再建立选区。');
      const prepared = preparePortraitSelection(
        currentV3(editor),
        state.analysis,
        editor.getSourceFrame(),
        kind,
        secureUuid(),
      );
      if (!apply(prepared.recipe, '建立' + portraitSelectionLabels[kind], true)) return;
      editor.setActiveRegionId(prepared.regionId);
      editor.setActiveMaskPath([]);
      if (onSelectionCreated) onSelectionCreated(prepared.regionId);
      else onGroupChange?.('local');
    } catch (failure) {
      report(errorMessage(failure));
    }
  }
  function detach() {
    if (!target) return;
    const next = detachPortraitTarget(currentV3(editor), target.id);
    if (apply(next, '当前人物转为独立精修', true)) {
      editor.setActiveRegionId(null);
      editor.setActivePaintLayerId(null);
      editor.setActiveMaskPath([]);
    }
  }
  function openManual(mode: 'paint' | 'clone' | 'liquify') {
    try {
      let next = currentV3(editor);
      if (target && hasAutomatic) next = detachPortraitTarget(next, target.id);
      let layerId: string | null = null;
      if (mode !== 'liquify') {
        if (next.paintLayers.length >= MAX_V3_PAINT_LAYERS) {
          report('绘制图层已达当前预算，请先整理图层后再新建手动精修。');
          return;
        }
        const layer: PaintLayerV3 = {
          id: secureUuid(),
          name: (target?.label ?? '图像') + (mode === 'clone' ? ' · 手动修补' : ' · 手动绘制'),
          enabled: true,
          opacity: 1,
          blendMode: 'normal',
          mask: null,
          strokes: [],
        };
        next = { ...next, paintLayers: [...next.paintLayers, layer] };
        layerId = layer.id;
      }
      if (!apply(next, mode === 'liquify' ? '准备独立人物塑形' : '准备独立手动精修', true)) return;
      editor.setActiveRegionId(null);
      editor.setActiveMaskPath([]);
      editor.setActivePaintLayerId(layerId);
      if (mode === 'liquify') onGroupChange?.('liquify');
      else {
        editor.setPaintSettings((settings) => ({
          ...settings,
          mode,
          choosingSource: mode === 'clone',
          ...(mode === 'paint' && category === 'makeup' ? { color } : {}),
        }));
        onGroupChange?.('paint');
      }
    } catch (failure) {
      report(errorMessage(failure));
    }
  }
  function change(
    id: string,
    value: number,
    commit = false,
    selectedColor?: [number, number, number, number],
  ) {
    if (!state.analysis || !target) return;
    try {
      const latest = currentV3(editor);
      const nextValues = { ...portraitValues(latest, target.id), [id]: value };
      const next = applyPortraitValues(
        latest,
        state.analysis,
        target.id,
        nextValues,
        [178, 66, 86, 255],
        category === 'makeup'
          ? {
              makeupColors: {
                [id]:
                  selectedColor ??
                  (id === makeupTool ? color : (existingColors[id] ?? [178, 66, 86, 255])),
              },
            }
          : undefined,
      );
      apply(
        next,
        t('调整{v0}', { v0: t(PORTRAIT_TOOLS.find((tool) => tool.id === id)?.label ?? '人像') }),
        commit,
      );
    } catch (error) {
      report(error instanceof Error ? error.message : '这个人物控制当前无法使用，请检查识别范围。');
    }
  }
  function clearLegacyNeck() {
    if (!state.analysis || !target) return;
    try {
      const latest = currentV3(editor);
      if (latest.schemaVersion !== 4) return;
      apply(
        applyPortraitValues(
          latest,
          state.analysis,
          target.id,
          { ...portraitValues(latest, target.id), neckLength: 0 },
          undefined,
          { makeupColors: portraitMakeupColors(latest, target.id) },
        ),
        '清除旧颈部效果',
        true,
      );
    } catch (failure) {
      report(errorMessage(failure));
    }
  }
  return (
    <section className="advanced-tool-family portrait-controls-v3" data-motion="portrait-controls">
      <div className="tonal-tabs portrait-categories" aria-label={t('人像工具类别')}>
        {(
          [
            ['skin', t('美肤')],
            ['features', t('面部')],
            ['body', t('身形')],
            ['makeup', t('美妆')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={category === id}
            onClick={() => {
              editor.commitCurrent(t('完成人像调节'));
              setCategory(id);
              const next = state.analysis?.targets.find(
                (t) => t.kind === (id === 'body' ? 'body' : 'face'),
              );
              if (next) state.setTarget(next.id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="portrait-analysis-row">
        <button
          className="text-button"
          disabled={!!state.progress || !editor.sourceHash}
          onClick={() => state.analyze(category === 'body')}
        >
          {state.error ? <ArrowsClockwise size={16} /> : <Sparkle size={16} />}
          {state.error
            ? category === 'body'
              ? t('重试身体识别')
              : t('重试人物识别')
            : state.analysis
              ? t('重新识别人物')
              : category === 'body'
                ? t('识别身体位置')
                : t('识别照片中的人物')}
        </button>
        {state.progress && (
          <button className="text-button" onClick={state.cancel}>
            {t('取消识别')}
          </button>
        )}
      </div>
      {state.progress && <Busy label={state.progress} />}
      {onCutout && (hasSubject || guideOptions.length > 1) && (
        <>
          <MotionDetails className="editor-section">
            <summary>{t('精准抠图')}</summary>
            {((hasSubject && fineMatteAvailable) || guides.method === 'fine') && (
              <ChoiceSelect
                ariaLabel={t('抠图模式')}
                value={guides.method}
                disabled={cutting}
                options={[
                  { value: 'standard', label: t('标准抠图') },
                  {
                    value: 'fine',
                    label: t('发丝与边缘'),
                    disabled: !hasSubject || !fineMatteAvailable,
                  },
                ]}
                onValueChange={(value) =>
                  setGuides((prev) => ({ ...prev, method: value === 'fine' ? 'fine' : 'standard' }))
                }
              />
            )}
            {guideOptions.length > 1 && (
              <>
                <ChoiceSelect
                  ariaLabel={t('保留前景选区')}
                  value={guides.foregroundId}
                  disabled={cutting}
                  options={guideOptions}
                  onValueChange={(value) => setGuides((prev) => ({ ...prev, foregroundId: value }))}
                />
                <ChoiceSelect
                  ariaLabel={t('排除遮挡选区')}
                  value={guides.backgroundId}
                  disabled={cutting}
                  options={guideOptions}
                  onValueChange={(value) => setGuides((prev) => ({ ...prev, backgroundId: value }))}
                />
              </>
            )}
            <PrecisionRange
              label={t('抠图边缘范围')}
              min={0}
              max={5}
              step={0.1}
              unit="%"
              value={guides.radius * 100}
              disabled={cutting}
              onChange={(value) => setGuides((prev) => ({ ...prev, radius: value / 100 }))}
            />
            <PrecisionRange
              label={t('消除背景杂色')}
              min={0}
              max={100}
              step={1}
              unit="%"
              value={guides.decontaminate * 100}
              disabled={cutting}
              onChange={(value) => setGuides((prev) => ({ ...prev, decontaminate: value / 100 }))}
            />
          </MotionDetails>
          <button
            type="button"
            className="text-button"
            disabled={
              cutting ||
              !!state.progress ||
              !validGuides ||
              (!hasSubject && !guides.foregroundId) ||
              editor.isLoading()
            }
            onClick={createCutout}
          >
            <StudioGlyph name="select" size={18} />
            {cutting ? t('正在精修透明边缘') : t('从原图提取人物素材')}
          </button>
        </>
      )}
      <InlineError message={state.error} />
      <div className="portrait-selections">
        <div
          className="advanced-row"
          role="group"
          aria-label={t('从识别结果建立局部选区')}
          aria-describedby={selectionHintId}
        >
          <button
            type="button"
            className="text-button"
            disabled={!selectionAvailable}
            onClick={() => createSelection('hair')}
          >
            <StudioGlyph name="hair" size={18} /> {t('头发选区')}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!selectionAvailable}
            onClick={() => createSelection('background')}
          >
            <StudioGlyph name="background" size={18} /> {t('背景选区')}
          </button>
        </div>
        <p
          className={state.analysis ? 'control-note portrait-selection-state' : 'sr-only'}
          id={selectionHintId}
        >
          {recipe.regionEdits.length >= MAX_V3_REGION_EDITS
            ? t('已有 {v0} 个局部，请先整理选区。', { v0: MAX_V3_REGION_EDITS })
            : state.analysis && !analysisCurrent
              ? t('原图已经切换，请重新识别后建立选区。')
              : state.analysis?.segmentation
                ? ''
                : state.analysis
                  ? t('这次分析未提供头发或背景范围，可到“局部”手动选择。')
                  : interactionText('selectAfterAnalysis')}
        </p>
      </div>
      {target && (
        <label className="advanced-select">
          {t('当前人物')}
          <ChoiceSelect
            ariaLabel={t('选择独立调整的人物')}
            size="compact"
            value={target.id}
            onValueChange={(value) => {
              editor.commitCurrent(t('完成人物调节'));
              state.setTarget(value);
            }}
            options={targets.map((item) => ({
              value: item.id,
              label: portraitTargetDisplayLabel(item, state.analysis),
            }))}
          />
        </label>
      )}
      {target && (
        <>
          {hasLegacyNeck && (
            <div className="portrait-ownership-note" role="status">
              <p className="control-note">
                {t(
                  '当前作品仍保留旧颈部效果。这个自动工具已暂停新增调整；清除旧效果后可继续调节其他身形参数，其他人物参数与妆容保持，可撤销。',
                )}
              </p>
              <button className="text-button" onClick={clearLegacyNeck}>
                {t('清除旧颈部效果')}
              </button>
            </div>
          )}
          {category === 'makeup' && (
            <div className="tonal-tabs" aria-label={t('妆容区域')}>
              {PORTRAIT_TOOLS.filter((tool) => tool.group === 'makeup').map((tool) => (
                <button
                  key={tool.id}
                  aria-pressed={makeupTool === tool.id}
                  onClick={() => {
                    editor.commitCurrent(t('完成妆容调节'));
                    setMakeupTool(tool.id);
                  }}
                >
                  {t(tool.label)}
                </button>
              ))}
            </div>
          )}
          <ParameterShelf
            key={target.id + ':' + category + ':' + (category === 'makeup' ? makeupTool : '')}
            label={category === 'makeup' ? t('当前妆容强度') : t('人物参数')}
            controls={PORTRAIT_TOOLS.filter(
              (tool) =>
                tool.group === category && (category !== 'makeup' || tool.id === makeupTool),
            ).map((tool) => {
              const condition = availability.find((item) => item.id === tool.id);
              return {
                id: tool.id,
                label: tool.label,
                value: values[tool.id] ?? 0,
                min: tool.min,
                max: tool.max,
                step: tool.step,
                neutral: 0,
                unit: '%',
                description:
                  condition?.available === false
                    ? (condition.reason ?? t('当前人物条件不足。'))
                    : tool.description,
                disabled: condition?.available === false,
                onChange: (value: number) => change(tool.id, value),
                onReset: () => change(tool.id, 0, true),
              };
            })}
            onCommit={(label) => editor.commitCurrent(t('调整{v0}', { v0: t(label) }))}
            onCancel={editor.cancelPreview}
          />
          {(hasAutomatic || hasManual) && (
            <div className="portrait-ownership-note">
              {hasAutomatic && (
                <>
                  <p className="control-note">
                    {t(
                      '当前自动参数会重建这个人物的自动局部与妆容。手改范围、笔画或形状前，可将整个人物转为独立精修；外观保持不变，可撤销。',
                    )}
                  </p>
                  <button className="text-button" onClick={detach}>
                    {t('当前人物转为独立精修')}
                  </button>
                </>
              )}
              {hasManual && (
                <p className="control-note">
                  {t(
                    '这个人物已有独立精修结果，以下自动参数会在固定结果之上新增一轮效果，不会替换独立精修层。',
                  )}
                </p>
              )}
            </div>
          )}
          {category === 'makeup' && (
            <MotionDetails className="advanced-disclosure" defaultOpen>
              <summary>
                <i className="paint-color-chip" style={{ background: rgbaHex(color) }} />
                {t(PORTRAIT_TOOLS.find((tool) => tool.id === makeupTool)?.label ?? '')}
                {t('颜色')}
              </summary>
              <ColorPicker
                value={rgbaHex(color)}
                label={t('当前妆容颜色')}
                onChange={(value) => {
                  const rgba = hexRgba(value);
                  setDraftColors((previous) => ({ ...previous, [colorKey]: rgba }));
                  if ((values[makeupTool] ?? 0) > 0)
                    change(makeupTool, values[makeupTool]!, false, rgba);
                }}
              />
              <button
                className="text-button"
                onClick={() => editor.commitCurrent(t('确认当前妆容颜色'))}
              >
                {t('确认这个妆容颜色')}
              </button>
              <p className="control-note">
                {t('只改变当前妆容。其他人物、口红、眉妆与高光等各自保留颜色。')}
              </p>
            </MotionDetails>
          )}
          <MotionDetails className="advanced-disclosure">
            <summary>{t('识别与手动修正说明')}</summary>
            <p className="control-note">
              {t(
                '自动位置是可编辑的起点。美肤生成局部调色区，美妆生成带范围的绘制层，塑形生成可撤销的液化笔画。先转为独立精修，再到“局部、绘制、液化”修改，避免后续自动调参重建手工细节。',
              )}
            </p>
            {state.analysis?.warnings.map((warning) => (
              <p key={t(warning)} className="control-note">
                {t(warning)}
              </p>
            ))}
          </MotionDetails>
        </>
      )}
      {!target && !state.progress && (
        <MotionDetails className="advanced-disclosure portrait-context-help">
          <summary>{interactionText('portraitHelp')}</summary>
          <p className="control-note">
            {category === 'body'
              ? t('选择“识别身体位置”后，按可见的肩、手臂、腰胯与腿部锚点分别调整。')
              : t('先在本机识别人脸，再选择人物独立调整。没有识别到的内容仍可手动精修。')}
          </p>
          <p className="control-note">
            {t('识别后可建立头发和背景选区。模型不可用时，可到“局部”手动选择。')}
          </p>
        </MotionDetails>
      )}
      <MotionDetails className="advanced-disclosure">
        <summary>{t('人物标注与分析接入')}</summary>
        <input
          hidden
          ref={annotationInput}
          type="file"
          accept="application/json,.json"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file) return;
            setAnnotationBusy(true);
            setAnnotationStatus(null);
            try {
              await state.importAnalysis(file);
              setAnnotationStatus(t('人物标注已导入，请检查人物和范围后再调节。'));
              report(null);
            } catch (failure) {
              report(errorMessage(failure));
            } finally {
              setAnnotationBusy(false);
            }
          }}
        />
        <div className="advanced-row">
          <button
            className="text-button"
            disabled={annotationBusy || !!state.progress || !editor.sourceHash}
            onClick={() => annotationInput.current?.click()}
          >
            {annotationBusy ? t('校验标注中') : t('导入人物标注')}
          </button>
          <button
            className="text-button"
            disabled={!state.analysis || annotationBusy || !!state.progress}
            onClick={() => {
              try {
                state.exportAnalysis();
                setAnnotationStatus(t('人物标注下载已发起。'));
              } catch (failure) {
                report(errorMessage(failure));
              }
            }}
          >
            {t('导出人物标注')}
          </button>
        </div>
        {annotationStatus && (
          <p className="control-note" role="status">
            {t(annotationStatus)}
          </p>
        )}
        <p className="control-note">
          {t(
            '仅接受当前同一张原图的兼容标注，文件需通过来源、尺寸、方向、结构和版本校验。导入是显式提供标注，不代表浏览器自动识别成功；导入后仍需检查并可转为独立精修。',
          )}
        </p>
      </MotionDetails>
      <div className="portrait-manual-actions" data-motion="portrait-manual">
        <button
          className="text-button"
          disabled={!onGroupChange}
          onClick={() => openManual('paint')}
        >
          <PaintBrush size={16} />
          {hasAutomatic ? t('转为独立涂妆与细修') : t('手动涂妆与细修')}
        </button>
        <button
          className="text-button"
          disabled={!onGroupChange}
          onClick={() => openManual('clone')}
        >
          <ArrowsClockwise size={16} />
          {t('瑕疵克隆修补')}
        </button>
        <button
          className="text-button"
          disabled={!onGroupChange}
          onClick={() => openManual('liquify')}
        >
          <HandPointing size={16} />
          {t('手动塑形与保护')}
        </button>
      </div>
    </section>
  );
}
