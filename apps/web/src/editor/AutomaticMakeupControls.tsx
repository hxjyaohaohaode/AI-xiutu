import { useEffect, useRef, useState } from 'react';
import {
  applyPortraitValues,
  portraitMakeupColors,
  portraitToolAvailability,
  portraitValues,
} from '@ai-xiutu/portrait';
import type { BlendModeV3, PaintMaterialV3 } from '@ai-xiutu/editor';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { ColorPicker } from '../components/ColorPicker';
import { Busy, InlineError } from '../components/Ui';
import { t } from '../i18n';
import { currentV3, hexRgba, rgbaHex, type InspectorController } from './advanced-model';
import {
  MakeupBrushRail,
  MakeupParameterRail,
  MakeupSwatches,
  makeupBrushes,
  makeupFinishLabels,
  type MakeupBrushId,
} from './MakeupBrushRail';
import { makeupPalettes } from './makeup-palettes';
import { portraitTargetDisplayLabel } from './portrait-label';
import { portraitSelectionMatchesSource } from './portrait-selection';
import { PrecisionRange } from './PrecisionRange';

const tools: Record<MakeupBrushId, string> = {
  base: 'foundation',
  shadow: 'eyeshadow',
  liner: 'eyeliner',
  brow: 'browColor',
  blush: 'blush',
  lip: 'lipstick',
  contour: 'contour',
  highlight: 'highlight',
  undereye: 'underEyeMakeup',
};
const parameterLabels = {
  color: '颜色',
  strength: '当前妆容强度',
  opacity: '颜色不透明度',
  saturation: '饱和度',
  finish: '妆效',
  blend: '混合模式',
} as const;
type Parameter = keyof typeof parameterLabels;
type Shade = ReturnType<typeof hexRgba>;
type MakeupValues = { strength: number; color: Shade; material: PaintMaterialV3 };
const blends: [BlendModeV3, string][] = [
  ['normal', '正常混合'],
  ['color', '颜色'],
  ['soft-light', '柔光'],
  ['multiply', '正片叠底'],
  ['screen', '滤色'],
  ['overlay', '叠加'],
  ['luminosity', '明度'],
];

export function AutomaticMakeupControls({ controller }: { controller: InspectorController }) {
  const { editor, apply, report } = controller;
  const state = editor.portrait;
  const [brush, setBrush] = useState<MakeupBrushId>('lip');
  const [parameter, setParameter] = useState<Parameter>('color');
  const [drafts, setDrafts] = useState<Record<string, MakeupValues>>({});
  const attempted = useRef<number | null>(null);
  const identity = editor.getSourceIdentity();
  const analysis = portraitSelectionMatchesSource(state.analysis, editor.getSourceFrame())
    ? state.analysis
    : null;
  const faces = analysis?.targets.filter(({ kind }) => kind === 'face') ?? [];
  const target = faces.find(({ id }) => id === state.activeTargetId) ?? faces[0];
  const tool = tools[brush];
  const recipe = currentV3(editor);
  const condition =
    analysis && target
      ? portraitToolAvailability(analysis, target.id, recipe.schemaVersion).find(
          ({ id }) => id === tool,
        )
      : undefined;
  const key = identity + ':' + (target?.id ?? '') + ':' + brush;
  const preset = makeupBrushes[brush];
  const defaults: MakeupValues = {
    strength: 0,
    color: hexRgba(makeupPalettes[brush][0]!.shades[0]!),
    material: preset.material,
  };
  function readValues(latest: typeof recipe): MakeupValues {
    if (!target) return defaults;
    const strength = portraitValues(latest, target.id)[tool] ?? 0;
    const color = portraitMakeupColors(latest, target.id)[tool];
    const material = latest.paintLayers.find(
      (layer) =>
        ['portrait.basic.v1', 'portrait.basic.v2'].includes(layer.origin?.moduleId ?? '') &&
        layer.origin?.instanceId === target.id &&
        layer.origin.parameterId === tool,
    )?.strokes[0]?.material;
    return {
      strength,
      color: color ?? drafts[key]?.color ?? defaults.color,
      material: material ?? drafts[key]?.material ?? defaults.material,
    };
  }
  const current = readValues(recipe);
  useEffect(() => {
    if (!editor.sourceHash || analysis || state.progress || attempted.current === identity) return;
    attempted.current = identity;
    void state.analyze();
  }, [identity, editor.sourceHash, analysis, state.progress, state.analyze]);

  const commitLabel = () => t('调整{v0}', { v0: t(preset.label) });
  function change(next: Partial<MakeupValues>, commit = false) {
    if (
      !analysis ||
      !target ||
      !condition?.available ||
      state.progress ||
      editor.isLoading() ||
      editor.getSourceIdentity() !== identity
    )
      return;
    try {
      const latest = currentV3(editor);
      const value = { ...readValues(latest), ...next };
      if (!value.strength) setDrafts((previous) => ({ ...previous, [key]: value }));
      if (!value.strength && !portraitValues(latest, target.id)[tool]) return;
      apply(
        applyPortraitValues(
          latest,
          analysis,
          target.id,
          { ...portraitValues(latest, target.id), [tool]: value.strength },
          value.color,
          { makeupColors: { [tool]: value.color }, makeupMaterials: { [tool]: value.material } },
        ),
        commitLabel(),
        commit,
      );
    } catch (reason) {
      report(reason instanceof Error ? reason.message : t('当前人物条件不足。'));
    }
  }
  function setShade(value: string, applyPreset: boolean) {
    const next = hexRgba(value);
    if (applyPreset) next[3] = current.color[3];
    change(
      { color: next, ...(applyPreset && !current.strength ? { strength: 45 } : {}) },
      applyPreset,
    );
  }
  const range = {
    strength: {
      value: current.strength,
      max: 100,
      onChange: (strength: number) => change({ strength }),
    },
    opacity: {
      value: current.color[3] / 2.55,
      max: 100,
      onChange: (opacity: number) =>
        change({
          color: [current.color[0], current.color[1], current.color[2], Math.round(opacity * 2.55)],
        }),
    },
    saturation: {
      value: current.material.saturation * 100,
      max: 200,
      onChange: (saturation: number) =>
        change({ material: { ...current.material, saturation: saturation / 100 } }),
    },
  };
  return (
    <div className="automatic-makeup" data-motion="makeup-controls">
      {state.progress ? (
        <div className="advanced-row">
          <Busy label={state.progress} />
          <button type="button" className="text-button" onClick={state.cancel}>
            {t('取消识别')}
          </button>
        </div>
      ) : !target ? (
        <>
          <InlineError message={state.error || (analysis ? t('未找到可靠的人脸。') : '')} />
          <button
            type="button"
            className="text-button"
            disabled={!editor.sourceHash}
            onClick={() => {
              attempted.current = identity;
              void state.analyze();
            }}
          >
            {t(state.error || analysis ? '重试人物识别' : '识别照片中的人物')}
          </button>
        </>
      ) : (
        <>
          <MakeupBrushRail
            automatic
            value={brush}
            onChange={(id) => {
              if (id) {
                editor.commitCurrent(commitLabel());
                setBrush(id);
              }
            }}
          />
          <div className="makeup-parameter-row">
            <MakeupParameterRail<Parameter>
              label={t('自动妆容参数')}
              labels={parameterLabels}
              value={parameter}
              onChange={(value) => {
                editor.commitCurrent(commitLabel());
                setParameter(value);
              }}
            />
            {faces.length > 1 && (
              <ChoiceSelect
                className="makeup-person-select"
                size="compact"
                ariaLabel={t('选择独立调整的人物')}
                value={target.id}
                onValueChange={(id) => {
                  editor.commitCurrent(commitLabel());
                  state.setTarget(id);
                }}
                options={faces.map((face) => ({
                  value: face.id,
                  label: portraitTargetDisplayLabel(face, analysis),
                }))}
              />
            )}
          </div>
          {!condition?.available ? (
            <InlineError message={t(condition?.reason ?? '当前人物条件不足。')} />
          ) : parameter === 'color' ? (
            <MakeupSwatches
              key={key}
              brush={brush}
              color={rgbaHex(current.color)}
              onColor={(color) => setShade(color, true)}
            >
              <ColorPicker
                value={rgbaHex(current.color)}
                label={t('当前妆容颜色')}
                onChange={(color) => setShade(color, false)}
              />
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  if (current.strength) editor.commitCurrent(commitLabel());
                  else change({ strength: 45 }, true);
                }}
              >
                {t('确认这个妆容颜色')}
              </button>
            </MakeupSwatches>
          ) : parameter === 'finish' ? (
            <ChoiceSelect
              size="compact"
              ariaLabel={t('妆效')}
              value={current.material.finish}
              onValueChange={(finish) =>
                change({ material: { ...current.material, finish } }, true)
              }
              options={(
                Object.entries(makeupFinishLabels) as [PaintMaterialV3['finish'], string][]
              ).map(([value, label]) => ({ value, label: t(label) }))}
            />
          ) : parameter === 'blend' ? (
            <ChoiceSelect
              size="compact"
              ariaLabel={t('混合模式')}
              value={current.material.blendMode}
              onValueChange={(blendMode) =>
                change({ material: { ...current.material, blendMode } }, true)
              }
              options={blends.map(([value, label]) => ({ value, label: t(label) }))}
            />
          ) : (
            <PrecisionRange
              key={key + parameter}
              label={t(parameterLabels[parameter])}
              min={0}
              {...range[parameter]}
              step={parameter === 'opacity' ? 0.5 : 0.1}
              unit="%"
              onCommit={() => editor.commitCurrent(commitLabel())}
              onCancel={editor.cancelPreview}
              primary
            />
          )}
        </>
      )}
    </div>
  );
}
