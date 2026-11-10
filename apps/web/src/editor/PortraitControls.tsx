import { useRef, useState } from 'react';
import { Sparkle, PaintBrush, HandPointing, ArrowsClockwise } from '@phosphor-icons/react';
import {
  PORTRAIT_TOOLS,
  portraitValues,
  applyPortraitValues,
  portraitMakeupColors,
  portraitToolAvailability,
  detachPortraitTarget,
} from '@ai-xiutu/portrait';
import { MAX_V3_PAINT_LAYERS, type PaintLayerV3 } from '@ai-xiutu/editor';
import { secureUuid } from '../lib/uuid';
import { errorMessage } from '../lib/api';
import { Busy, InlineError } from '../components/Ui';
import { ColorPicker } from '../components/ColorPicker';
import { ParameterShelf } from './ParameterShelf';
import { currentV3, rgbaHex, hexRgba, type InspectorController } from './advanced-model';
import type { ToolGroup } from './ToolInspector';

export function PortraitControls({
  controller,
  onGroupChange,
}: {
  controller: InspectorController;
  onGroupChange?: (group: ToolGroup) => void;
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
  const kind = category === 'body' ? 'body' : 'face';
  const targets = state.analysis?.targets.filter((target) => target.kind === kind) ?? [];
  const target = targets.find((person) => person.id === state.activeTargetId) ?? targets[0];
  const recipe = currentV3(editor);
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
        '调整' + (PORTRAIT_TOOLS.find((tool) => tool.id === id)?.label ?? '人像'),
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
      <div className="tonal-tabs portrait-categories" aria-label="人像工具类别">
        {(
          [
            ['skin', '美肤'],
            ['features', '面部'],
            ['body', '身形'],
            ['makeup', '美妆'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-pressed={category === id}
            onClick={() => {
              editor.commitCurrent('完成人像调节');
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
          <Sparkle size={16} />
          {state.analysis
            ? '重新识别人物'
            : category === 'body'
              ? '识别身体位置'
              : '识别照片中的人物'}
        </button>
        {state.progress && (
          <button className="text-button" onClick={state.cancel}>
            取消识别
          </button>
        )}
      </div>
      {state.progress && <Busy label={state.progress} />}
      <InlineError message={state.error} />
      {target && (
        <label className="advanced-select">
          当前人物
          <select
            aria-label="选择独立调整的人物"
            value={target.id}
            onChange={(event) => {
              editor.commitCurrent('完成人物调节');
              state.setTarget(event.target.value);
            }}
          >
            {targets.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {target && (
        <>
          {hasLegacyNeck && (
            <div className="portrait-ownership-note" role="status">
              <p className="control-note">
                当前作品仍保留旧颈部效果。这个自动工具已暂停新增调整；清除旧效果后可继续调节其他身形参数，其他人物参数与妆容保持，可撤销。
              </p>
              <button className="text-button" onClick={clearLegacyNeck}>
                清除旧颈部效果
              </button>
            </div>
          )}
          {category === 'makeup' && (
            <div className="tonal-tabs" aria-label="妆容区域">
              {PORTRAIT_TOOLS.filter((tool) => tool.group === 'makeup').map((tool) => (
                <button
                  key={tool.id}
                  aria-pressed={makeupTool === tool.id}
                  onClick={() => {
                    editor.commitCurrent('完成妆容调节');
                    setMakeupTool(tool.id);
                  }}
                >
                  {tool.label}
                </button>
              ))}
            </div>
          )}
          <ParameterShelf
            key={target.id + ':' + category + ':' + (category === 'makeup' ? makeupTool : '')}
            label={category === 'makeup' ? '当前妆容强度' : '人物参数'}
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
                    ? (condition.reason ?? '当前人物条件不足。')
                    : tool.description,
                disabled: condition?.available === false,
                onChange: (value: number) => change(tool.id, value),
                onReset: () => change(tool.id, 0, true),
              };
            })}
            onCommit={(label) => editor.commitCurrent('调整' + label)}
            onCancel={editor.cancelPreview}
          />
          {(hasAutomatic || hasManual) && (
            <div className="portrait-ownership-note">
              {hasAutomatic && (
                <>
                  <p className="control-note">
                    当前自动参数会重建这个人物的自动局部与妆容。手改范围、笔画或形状前，可将整个人物转为独立精修；外观保持不变，可撤销。
                  </p>
                  <button className="text-button" onClick={detach}>
                    当前人物转为独立精修
                  </button>
                </>
              )}
              {hasManual && (
                <p className="control-note">
                  这个人物已有独立精修结果，以下自动参数会在固定结果之上新增一轮效果，不会替换独立精修层。
                </p>
              )}
            </div>
          )}
          {category === 'makeup' && (
            <details className="advanced-disclosure" open>
              <summary>
                <i className="paint-color-chip" style={{ background: rgbaHex(color) }} />
                {PORTRAIT_TOOLS.find((tool) => tool.id === makeupTool)?.label}颜色
              </summary>
              <ColorPicker
                value={rgbaHex(color)}
                label="当前妆容颜色"
                onChange={(value) => {
                  const rgba = hexRgba(value);
                  setDraftColors((previous) => ({ ...previous, [colorKey]: rgba }));
                  if ((values[makeupTool] ?? 0) > 0)
                    change(makeupTool, values[makeupTool]!, false, rgba);
                }}
              />
              <button
                className="text-button"
                onClick={() => editor.commitCurrent('确认当前妆容颜色')}
              >
                确认这个妆容颜色
              </button>
              <p className="control-note">
                只改变当前妆容。其他人物、口红、眉妆与高光等各自保留颜色。
              </p>
            </details>
          )}
          <details className="advanced-disclosure">
            <summary>识别与手动修正说明</summary>
            <p className="control-note">
              自动位置是可编辑的起点。美肤生成局部调色区，美妆生成带范围的绘制层，塑形生成可撤销的液化笔画。先转为独立精修，再到“局部、绘制、液化”修改，避免后续自动调参重建手工细节。
            </p>
            {state.analysis?.warnings.map((warning) => (
              <p key={warning} className="control-note">
                {warning}
              </p>
            ))}
          </details>
        </>
      )}
      {!target && !state.progress && (
        <p className="control-note">
          {category === 'body'
            ? '选择“识别身体位置”后，按可见的肩、手臂、腰胯与腿部锚点分别调整。'
            : '先在本机识别人脸，再选择人物独立调整。没有识别到的内容仍可手动精修。'}
          模型未部署或浏览器不能运行时会显示真实错误，不用虚构的人脸框替代。
        </p>
      )}
      <details className="advanced-disclosure">
        <summary>人物标注与分析接入</summary>
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
              setAnnotationStatus('人物标注已导入，请检查人物和范围后再调节。');
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
            {annotationBusy ? '校验标注中' : '导入人物标注'}
          </button>
          <button
            className="text-button"
            disabled={!state.analysis || annotationBusy || !!state.progress}
            onClick={() => {
              try {
                state.exportAnalysis();
                setAnnotationStatus('人物标注下载已发起。');
              } catch (failure) {
                report(errorMessage(failure));
              }
            }}
          >
            导出人物标注
          </button>
        </div>
        {annotationStatus && (
          <p className="control-note" role="status">
            {annotationStatus}
          </p>
        )}
        <p className="control-note">
          仅接受当前同一张原图的兼容标注，文件需通过来源、尺寸、方向、结构和版本校验。导入是显式提供标注，不代表浏览器自动识别成功；导入后仍需检查并可转为独立精修。
        </p>
      </details>
      <div className="portrait-manual-actions" data-motion="portrait-manual">
        <button
          className="text-button"
          disabled={!onGroupChange}
          onClick={() => openManual('paint')}
        >
          <PaintBrush size={16} />
          {hasAutomatic ? '转为独立涂妆与细修' : '手动涂妆与细修'}
        </button>
        <button
          className="text-button"
          disabled={!onGroupChange}
          onClick={() => openManual('clone')}
        >
          <ArrowsClockwise size={16} />
          瑕疵克隆修补
        </button>
        <button
          className="text-button"
          disabled={!onGroupChange}
          onClick={() => openManual('liquify')}
        >
          <HandPointing size={16} />
          手动塑形与保护
        </button>
      </div>
    </section>
  );
}
