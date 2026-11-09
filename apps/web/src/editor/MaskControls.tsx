import { useState } from 'react';
import { Plus, Trash, ArrowUUpLeft } from '@phosphor-icons/react';
import { MAX_POLYGON_POINTS, type SelectionMaskV3 } from '@ai-xiutu/editor';
import { IconButton } from '../components/Ui';
import { ParameterShelf, type ShelfControl } from './ParameterShelf';
import { newMask, type InspectorController } from './advanced-model';
import { maskAtPath, replaceMaskAtPath } from './precision';

export const maskLabels: Record<SelectionMaskV3['type'], string> = {
  radial: '径向',
  linear: '渐变',
  polygon: '多边形',
  brush: '画笔',
  'color-range': '连续选色',
  raster: '识别蒙版',
  compound: '组合范围',
};
export function MaskControls({
  controller,
  getMask,
  path,
  onPath,
  onChange,
  drawsMask = true,
}: {
  controller: InspectorController;
  getMask: () => SelectionMaskV3;
  path: number[];
  onPath: (path: number[]) => void;
  onChange: (mask: SelectionMaskV3, commit?: boolean) => boolean;
  drawsMask?: boolean;
}) {
  const { editor } = controller;
  const [pointIndex, setPointIndex] = useState(0);
  const root = getMask(),
    mask = maskAtPath(root, path);
  const short = Math.min(editor.dimensions?.width ?? 1, editor.dimensions?.height ?? 1);
  const update = (next: SelectionMaskV3, commit = false) => {
    try {
      return onChange(replaceMaskAtPath(getMask(), path, next), commit);
    } catch (failure) {
      controller.report(failure instanceof Error ? failure.message : '此选区已改变，请重新选择。');
      return false;
    }
  };
  const mutate = (mutator: (mask: SelectionMaskV3) => SelectionMaskV3, commit = false) =>
    update(mutator(maskAtPath(getMask(), path)), commit);
  const controls: ShelfControl[] = [];
  function numeric(
    key: string,
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    unit: string,
    change: (mask: SelectionMaskV3, value: number) => SelectionMaskV3,
  ) {
    controls.push({
      id: key,
      label,
      value,
      min,
      max,
      step,
      unit,
      onChange: (n) => mutate((latest) => change(latest, n)),
    });
  }
  const scalar = (
    key: string,
    label: string,
    value: number,
    min: number,
    max: number,
    step = 0.0001,
    unit = '',
  ) =>
    numeric(
      key,
      label,
      value,
      min,
      max,
      step,
      unit,
      (latest, n) => ({ ...latest, [key]: n }) as SelectionMaskV3,
    );
  if (mask.type === 'radial') {
    scalar('centerX', '中心 X', mask.centerX, 0, 1);
    scalar('centerY', '中心 Y', mask.centerY, 0, 1);
    scalar('radiusX', '水平半径', mask.radiusX, 0.0001, 1);
    scalar('radiusY', '垂直半径', mask.radiusY, 0.0001, 1);
    scalar('feather', '羽化', mask.feather, 0, 1);
  } else if (mask.type === 'linear') {
    for (const [key, label] of [
      ['start', '起点'],
      ['end', '终点'],
    ] as const)
      for (const axis of ['x', 'y'] as const)
        numeric(
          key + axis,
          label + ' ' + axis.toUpperCase(),
          mask[key][axis],
          0,
          1,
          0.0001,
          '',
          (latest, n) =>
            latest.type === 'linear' ? { ...latest, [key]: { ...latest[key], [axis]: n } } : latest,
        );
  } else if (mask.type === 'color-range') {
    scalar('hue', '目标色相', mask.hue, 0, 360, 0.01, '°');
    scalar('hueWidth', '色相容差', mask.hueWidth, 0, 180, 0.01, '°');
    scalar('saturationMin', '最低饱和', mask.saturationMin, 0, mask.saturationMax);
    scalar('saturationMax', '最高饱和', mask.saturationMax, mask.saturationMin, 1);
    scalar('luminanceMin', '最低明度', mask.luminanceMin, 0, mask.luminanceMax);
    scalar('luminanceMax', '最高明度', mask.luminanceMax, mask.luminanceMin, 1);
    scalar('feather', '过渡羽化', mask.feather, 0, 1);
  } else if (mask.type === 'polygon') {
    const index = Math.min(pointIndex, mask.points.length - 1),
      point = mask.points[index]!;
    for (const axis of ['x', 'y'] as const)
      numeric(axis, '顶点 ' + axis.toUpperCase(), point[axis], 0, 1, 0.0001, '', (latest, n) =>
        latest.type === 'polygon'
          ? {
              ...latest,
              points: latest.points.map((p, i) => (i === index ? { ...p, [axis]: n } : p)),
            }
          : latest,
      );
    scalar('feather', '边缘羽化', mask.feather, 0, 0.5);
  }
  function append(type: Parameters<typeof newMask>[0]) {
    const selected = maskAtPath(getMask(), path),
      next = newMask(type);
    const combined: SelectionMaskV3 =
      selected.type === 'compound' && selected.masks.length < 8
        ? { ...selected, masks: [...selected.masks, next] }
        : { type: 'compound', operation: 'union', masks: [selected, next], invert: false };
    if (update(combined, true)) onPath([...path, combined.masks.length - 1]);
  }
  return (
    <section className="mask-controls-v3" data-motion="mask-editor">
      {path.length > 0 && (
        <button className="text-button" onClick={() => onPath(path.slice(0, -1))}>
          <ArrowUUpLeft size={15} />
          上一级范围
        </button>
      )}
      <div className="advanced-row">
        <strong>
          {maskLabels[mask.type]}
          {path.length ? ` · 子区 ${path.map((v) => v + 1).join('.')}` : ''}
        </strong>
        <label className="compact-check">
          <input
            type="checkbox"
            checked={mask.invert}
            onChange={(event) =>
              mutate((latest) => ({ ...latest, invert: event.target.checked }), true)
            }
          />
          反选
        </label>
      </div>
      {drawsMask && (
        <label className="compact-check">
          <input
            type="checkbox"
            checked={editor.maskOverlay}
            onChange={(event) => editor.setMaskOverlay(event.target.checked)}
          />
          显示范围覆盖
        </label>
      )}
      {mask.type === 'compound' && (
        <>
          <div className="tonal-tabs" aria-label="范围运算">
            {(
              [
                ['union', '相加'],
                ['intersection', '相交'],
                ['subtract', '相减'],
                ['xor', '互斥'],
              ] as const
            ).map(([operation, label]) => (
              <button
                key={operation}
                aria-pressed={mask.operation === operation}
                onClick={() =>
                  mutate(
                    (latest) => (latest.type === 'compound' ? { ...latest, operation } : latest),
                    true,
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mask-child-list">
            {mask.masks.map((child, index) => (
              <div className="advanced-row" key={index}>
                <button className="text-button" onClick={() => onPath([...path, index])}>
                  范围 {index + 1} · {maskLabels[child.type]}
                </button>
                <IconButton
                  label={'移除范围 ' + (index + 1)}
                  onClick={() =>
                    mutate((latest) => {
                      if (latest.type !== 'compound') return latest;
                      const children = latest.masks.filter((_, i) => i !== index);
                      if (children.length === 1)
                        return { ...children[0]!, invert: latest.invert !== children[0]!.invert };
                      return { ...latest, masks: children };
                    }, true)
                  }
                >
                  <Trash size={15} />
                </IconButton>
              </div>
            ))}
          </div>
        </>
      )}
      {mask.type === 'linear' && (
        <label className="compact-check">
          <input
            type="checkbox"
            checked={mask.smooth}
            onChange={(event) =>
              mutate(
                (latest) =>
                  latest.type === 'linear' ? { ...latest, smooth: event.target.checked } : latest,
                true,
              )
            }
          />
          平滑过渡
        </label>
      )}
      {mask.type === 'polygon' && (
        <div className="advanced-row">
          <label>
            顶点
            <select
              aria-label="多边形顶点"
              value={Math.min(pointIndex, mask.points.length - 1)}
              onChange={(event) => setPointIndex(Number(event.target.value))}
            >
              {mask.points.map((_, index) => (
                <option key={index} value={index}>
                  点 {index + 1}
                </option>
              ))}
            </select>
          </label>
          <IconButton
            label="增加多边形顶点"
            disabled={mask.points.length >= MAX_POLYGON_POINTS}
            onClick={() =>
              mutate((latest) => {
                if (latest.type !== 'polygon') return latest;
                const index = Math.min(pointIndex, latest.points.length - 1),
                  a = latest.points[index]!,
                  b = latest.points[(index + 1) % latest.points.length]!;
                const points = [...latest.points];
                points.splice(index + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                return { ...latest, points };
              }, true)
            }
          >
            <Plus size={15} />
          </IconButton>
          <IconButton
            label="删除多边形顶点"
            disabled={mask.points.length <= 3}
            onClick={() =>
              mutate(
                (latest) =>
                  latest.type === 'polygon'
                    ? {
                        ...latest,
                        points: latest.points.filter(
                          (_, i) => i !== Math.min(pointIndex, latest.points.length - 1),
                        ),
                      }
                    : latest,
                true,
              )
            }
          >
            <Trash size={15} />
          </IconButton>
        </div>
      )}
      {!!controls.length && (
        <ParameterShelf
          key={mask.type + ':' + path.join('.')}
          controls={controls}
          label="选区形状"
          onCommit={(name) => editor.commitCurrent('调整' + name)}
          onCancel={editor.cancelPreview}
        />
      )}
      {mask.type === 'brush' && (
        <>
          {drawsMask ? (
            <>
              <div className="tonal-tabs">
                <button
                  aria-pressed={editor.brushSettings.mode === 'add'}
                  onClick={() => editor.setBrushSettings({ ...editor.brushSettings, mode: 'add' })}
                >
                  涂入范围
                </button>
                <button
                  aria-pressed={editor.brushSettings.mode === 'subtract'}
                  onClick={() =>
                    editor.setBrushSettings({ ...editor.brushSettings, mode: 'subtract' })
                  }
                >
                  擦除范围
                </button>
              </div>
              <ParameterShelf
                label="选区画笔"
                controls={[
                  {
                    id: 'diameter',
                    label: '画笔直径',
                    value: editor.brushSettings.radius * short * 2,
                    min: 1,
                    max: short,
                    step: 0.1,
                    unit: 'px',
                    onChange: (n) =>
                      editor.setBrushSettings({ ...editor.brushSettings, radius: n / short / 2 }),
                  },
                  {
                    id: 'feather',
                    label: '柔边',
                    value: editor.brushSettings.feather * 100,
                    min: 0,
                    max: 100,
                    step: 0.1,
                    unit: '%',
                    onChange: (n) =>
                      editor.setBrushSettings({ ...editor.brushSettings, feather: n / 100 }),
                  },
                  {
                    id: 'opacity',
                    label: '流量',
                    value: editor.brushSettings.opacity * 100,
                    min: 0,
                    max: 100,
                    step: 0.1,
                    unit: '%',
                    onChange: (n) =>
                      editor.setBrushSettings({ ...editor.brushSettings, opacity: n / 100 }),
                  },
                ]}
              />
            </>
          ) : (
            <p className="control-note">此工具模式不会绘制范围；可从局部选区复制已画好的蒙版。</p>
          )}
          <button
            className="text-button"
            disabled={!mask.strokes.length}
            onClick={() =>
              mutate(
                (latest) =>
                  latest.type === 'brush'
                    ? { ...latest, strokes: latest.strokes.slice(0, -1) }
                    : latest,
                true,
              )
            }
          >
            移除最后一笔范围
          </button>
          <small>{mask.strokes.length} 笔，可继续叠加或擦除</small>
        </>
      )}
      {mask.type === 'raster' && (
        <p className="control-note">
          识别蒙版 {mask.width}×{mask.height}
          。可通过添加手动画笔子区修正边缘，自动识别不等同于逐像素准确。
        </p>
      )}
      {mask.type === 'color-range' && (
        <div className="continuous-hue-reference" aria-label="完整色相环" />
      )}
      <details className="advanced-disclosure">
        <summary>
          <Plus size={14} />
          增加或扣除范围
        </summary>
        <div className="tonal-tabs">
          {(
            [
              'radial',
              'linear',
              'polygon',
              ...(drawsMask ? ['brush'] : []),
              'color-range',
            ] as Parameters<typeof newMask>[0][]
          ).map((type) => (
            <button key={type} onClick={() => append(type)}>
              {maskLabels[type]}
            </button>
          ))}
        </div>
        <p className="control-note">
          添加后回到组合范围，可选相加、相交、相减或互斥。每个子区都可独立修改。
        </p>
      </details>
    </section>
  );
}
