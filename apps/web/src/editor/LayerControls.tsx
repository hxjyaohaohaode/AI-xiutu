import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Copy,
  Eye,
  EyeSlash,
  Plus,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react';
import {
  BLEND_MODES_V3,
  MAX_V3_PAINT_LAYERS,
  MAX_V3_PAINT_STROKES,
  MAX_V3_IMAGE_LAYERS,
  MAX_V3_WARP_STROKES,
  type BlendModeV3,
  type PaintLayerV3,
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

const blendLabels: Record<BlendModeV3, string> = {
  normal: '正常',
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
}: {
  value: BlendModeV3;
  onChange: (value: BlendModeV3) => void;
}) {
  return (
    <label className="advanced-select">
      混合模式
      <select
        aria-label="图层混合模式"
        value={value}
        onChange={(event) => onChange(event.target.value as BlendModeV3)}
      >
        {BLEND_MODES_V3.map((mode) => (
          <option key={mode} value={mode}>
            {blendLabels[mode]}
          </option>
        ))}
      </select>
    </label>
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
  pickedColor,
  onSample,
  sampling,
}: {
  controller: InspectorController;
  pickedColor: string;
  onSample?: () => void;
  sampling?: boolean;
}) {
  const { editor, apply } = controller,
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
        name: '绘制 ' + (latest.paintLayers.length + 1),
        enabled: true,
        opacity: 1,
        blendMode: 'normal',
        mask: null,
        strokes: [],
      };
    if (apply({ ...latest, paintLayers: [...latest.paintLayers, next] }, '新建绘制图层', true))
      editor.setActivePaintLayerId(next.id);
  }
  function stamp() {
    if (!layer || (settings.mode === 'clone' && !settings.source)) return;
    const latest = currentV3(editor),
      current = latest.paintLayers.find((item) => item.id === layer.id);
    if (!current) return;
    const { choosingSource: _state, pressureSensitive: _pressure, ...stroke } = settings;
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
  return (
    <section className="advanced-tool-family" data-motion="paint-controls">
      <div className="advanced-row">
        <span>
          绘制图层 {recipe.paintLayers.length} / {MAX_V3_PAINT_LAYERS}
        </span>
        <button
          className="text-button"
          disabled={recipe.paintLayers.length >= MAX_V3_PAINT_LAYERS}
          onClick={addLayer}
        >
          <Plus size={16} />
          新建
        </button>
      </div>
      <div className="advanced-object-list" aria-label="绘制图层">
        {recipe.paintLayers.map((item, index) => (
          <div key={item.id} className="advanced-row" data-selected={item.id === layer?.id}>
            <button
              className="object-name"
              aria-pressed={item.id === layer?.id}
              onClick={() => {
                editor.setActivePaintLayerId(item.id);
                setPath([]);
              }}
            >
              {item.name}
              <small>
                {item.strokes.length} 笔 · {blendLabels[item.blendMode]}
              </small>
            </button>
            <IconButton
              label={`${item.enabled ? '隐藏' : '显示'}${item.name}`}
              onClick={() =>
                apply(
                  {
                    ...currentV3(editor),
                    paintLayers: currentV3(editor).paintLayers.map((p) =>
                      p.id === item.id ? { ...p, enabled: !p.enabled } : p,
                    ),
                  },
                  '切换绘制图层',
                  true,
                )
              }
            >
              {item.enabled ? <Eye size={16} /> : <EyeSlash size={16} />}
            </IconButton>
          </div>
        ))}
      </div>
      {!layer ? (
        <p className="control-note">
          新建一个图层后，即可在照片上涂画。颜色、混合、范围和笔画分别保留。
        </p>
      ) : (
        <>
          <div className="tonal-tabs" aria-label="绘制模式">
            {(
              [
                ['paint', '画笔'],
                ['erase', '橡皮'],
                ['clone', '克隆'],
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
            label="绘制参数"
            controls={[
              {
                id: 'diameter',
                label: '直径',
                value: settings.radius * short * 2,
                min: 1,
                max: short,
                step: 0.1,
                unit: 'px',
                description: '以原图像素为准；1px 使用精确栅格落点。',
                onChange: (n) => editor.setPaintSettings((s) => ({ ...s, radius: n / short / 2 })),
              },
              {
                id: 'feather',
                label: '柔边',
                value: settings.feather * 100,
                min: 0,
                max: 100,
                step: 0.1,
                unit: '%',
                onChange: (n) => editor.setPaintSettings((s) => ({ ...s, feather: n / 100 })),
              },
              {
                id: 'flow',
                label: '笔触透明度',
                value: settings.opacity * 100,
                min: 0,
                max: 100,
                step: 0.1,
                unit: '%',
                onChange: (n) => editor.setPaintSettings((s) => ({ ...s, opacity: n / 100 })),
              },
              {
                id: 'layer-opacity',
                label: '图层透明度',
                value: layer.opacity * 100,
                min: 0,
                max: 100,
                step: 0.1,
                unit: '%',
                onChange: (n) => patch({ opacity: n / 100 }, '调整图层透明度', false),
              },
            ]}
            onCommit={(name) => editor.commitCurrent('调整' + name)}
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
            数位笔压感与平滑边缘（大于 1 px 的画笔）
          </label>
          {settings.mode === 'paint' && (
            <details className="advanced-disclosure" open>
              <summary>
                <i className="paint-color-chip" style={{ background: rgbaHex(settings.color) }} />
                画笔颜色与 Alpha
              </summary>
              <ColorPicker
                value={rgbaHex(settings.color)}
                onChange={(value) =>
                  editor.setPaintSettings((s) => ({ ...s, color: hexRgba(value) }))
                }
                label="画笔颜色"
              />
              <div className="advanced-row">
                <button className="text-button" onClick={onSample}>
                  {sampling ? '结束取色' : '从原图取色'}
                </button>
                <button
                  className="text-button"
                  onClick={() =>
                    editor.setPaintSettings((s) => ({ ...s, color: hexRgba(pickedColor) }))
                  }
                >
                  使用所取颜色
                </button>
              </div>
            </details>
          )}
          {settings.mode === 'clone' && (
            <>
              <button
                className="text-button"
                aria-pressed={settings.choosingSource}
                onClick={() =>
                  editor.setPaintSettings((s) => ({ ...s, choosingSource: !s.choosingSource }))
                }
              >
                {settings.choosingSource ? '点击照片设定克隆来源' : '在照片选择克隆来源'}
              </button>
              <p className="control-note">
                {settings.source
                  ? `来源约为 (${Math.floor(settings.source.x * width)}, ${Math.floor(settings.source.y * height)})；采样绘制前图像，不累积复制自身。`
                  : '先选择来源，再绘制；也可以在下面按像素坐标设置来源。'}
              </p>
            </>
          )}
          <BlendPicker
            value={layer.blendMode}
            onChange={(blendMode) => patch({ blendMode }, '切换绘制混合模式')}
          />
          <details className="advanced-disclosure">
            <summary>逐像素落点</summary>
            <ParameterShelf
              label="原图像素位置"
              controls={[
                {
                  id: 'x',
                  label: '像素 X',
                  value: Math.min(width - 1, pixelX),
                  min: 0,
                  max: width - 1,
                  step: 1,
                  integer: true,
                  unit: 'px',
                  onChange: setPixelX,
                },
                {
                  id: 'y',
                  label: '像素 Y',
                  value: Math.min(height - 1, pixelY),
                  min: 0,
                  max: height - 1,
                  step: 1,
                  integer: true,
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
                在这个像素落笔
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
                  设为克隆来源
                </button>
              )}
            </div>
          </details>
          <details className="advanced-disclosure">
            <summary>限制绘制范围</summary>
            <label className="advanced-select">
              使用局部选区
              <select
                aria-label="绘制范围来源"
                value=""
                onChange={(event) => {
                  const selected = currentV3(editor).regionEdits.find(
                    (r) => r.id === event.target.value,
                  );
                  if (selected) {
                    patch({ mask: structuredClone(selected.mask) }, '复制绘制范围');
                    setPath([]);
                  }
                }}
              >
                <option value="">选择一个范围副本</option>
                {recipe.regionEdits.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
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
                  onChange={(mask, commit) => patch({ mask }, '修改绘制范围', commit)}
                />
                <button
                  className="text-button"
                  onClick={() => patch({ mask: null }, '解除绘制范围')}
                >
                  解除范围限制
                </button>
              </>
            )}
          </details>
          <details className="advanced-disclosure">
            <summary>图层与笔画管理</summary>
            <label className="advanced-select">
              名称
              <input
                aria-label="绘制图层名称"
                key={layer.id}
                defaultValue={layer.name}
                maxLength={120}
                onBlur={(event) => {
                  if (event.target.value.trim())
                    patch({ name: event.target.value.trim() }, '重命名绘制图层');
                }}
              />
            </label>
            <div className="advanced-row">
              <button
                className="text-button"
                disabled={!layer.strokes.length}
                onClick={() => patch({ strokes: layer.strokes.slice(0, -1) }, '移除最后一笔')}
              >
                移除最后一笔
              </button>
              <IconButton
                label="绘制图层前移"
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
                    '调整绘制图层顺序',
                    true,
                  )
                }
              >
                <ArrowUp size={16} />
              </IconButton>
              <IconButton
                label="绘制图层后移"
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
                    '调整绘制图层顺序',
                    true,
                  )
                }
              >
                <ArrowDown size={16} />
              </IconButton>
              <IconButton
                label="删除绘制图层，可撤销"
                onClick={() => {
                  if (
                    apply(
                      {
                        ...recipe,
                        paintLayers: recipe.paintLayers.filter((p) => p.id !== layer.id),
                      },
                      '删除绘制图层',
                      true,
                    )
                  )
                    editor.setActivePaintLayerId(null);
                }}
              >
                <Trash size={16} />
              </IconButton>
            </div>
          </details>
          <small className="control-note">
            总笔画预算 {recipe.paintLayers.reduce((n, p) => n + p.strokes.length, 0)} /{' '}
            {MAX_V3_PAINT_STROKES}；重置参数不改已绘制的笔画。
          </small>
        </>
      )}
    </section>
  );
}

export function LiquifyControls({ controller }: { controller: InspectorController }) {
  const { editor, apply } = controller,
    recipe = currentV3(editor),
    settings = editor.warpSettings;
  const short = Math.min(editor.dimensions?.width ?? 1, editor.dimensions?.height ?? 1);
  return (
    <section className="advanced-tool-family" data-motion="warp-controls">
      <div className="tonal-tabs" aria-label="液化方式">
        {(
          [
            ['push', '推动'],
            ['pinch', '收缩'],
            ['bulge', '膨胀'],
            ['twirl', '旋转'],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            aria-pressed={settings.mode === mode && !settings.protecting}
            onClick={() => editor.setWarpSettings((s) => ({ ...s, mode, protecting: false }))}
          >
            {label}
          </button>
        ))}
      </div>
      <ParameterShelf
        label="液化画笔"
        controls={[
          {
            id: 'radius',
            label: '作用直径',
            value: settings.radius * short * 2,
            min: 1,
            max: short * 2,
            step: 0.1,
            unit: 'px',
            onChange: (n) => editor.setWarpSettings((s) => ({ ...s, radius: n / short / 2 })),
          },
          {
            id: 'strength',
            label: '双向强度',
            value: settings.strength * 100,
            min: -100,
            max: 100,
            step: 0.1,
            neutral: 0,
            unit: '%',
            description: '负值反向，零不改变画面；笔画提交后可独立撤销。',
            onChange: (n) => editor.setWarpSettings((s) => ({ ...s, strength: n / 100 })),
          },
          {
            id: 'feather',
            label: '边缘过渡',
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
              '切换液化效果',
              true,
            )
          }
        />
        显示液化效果
      </label>
      <details className="advanced-disclosure">
        <summary>背景与局部保护</summary>
        <p className="control-note">
          保护范围保持原来显示像素。可以用画笔涂入，也可以从现有局部复制；边缘羽化决定过渡。
        </p>
        <div className="advanced-row">
          <button
            className="text-button"
            aria-pressed={settings.protecting}
            onClick={() => {
              if (
                !recipe.warp.protection &&
                !apply(
                  { ...recipe, warp: { ...recipe.warp, protection: newMask('brush') } },
                  '建立液化保护范围',
                  true,
                )
              )
                return;
              editor.setWarpSettings((s) => ({ ...s, protecting: !s.protecting }));
              editor.setActiveMaskPath([]);
            }}
          >
            {settings.protecting ? '结束保护范围编辑' : '涂抹保护范围'}
          </button>
          {recipe.warp.protection && (
            <button
              className="text-button"
              onClick={() => {
                apply(
                  { ...recipe, warp: { ...recipe.warp, protection: null } },
                  '解除液化保护',
                  true,
                );
                editor.setWarpSettings((s) => ({ ...s, protecting: false }));
              }}
            >
              清除保护，可撤销
            </button>
          )}
        </div>
        <label className="advanced-select">
          从局部复制
          <select
            aria-label="液化保护来源"
            value=""
            onChange={(event) => {
              const r = recipe.regionEdits.find((r) => r.id === event.target.value);
              if (r) {
                apply(
                  { ...recipe, warp: { ...recipe.warp, protection: structuredClone(r.mask) } },
                  '复制液化保护范围',
                  true,
                );
                editor.setActiveMaskPath([]);
              }
            }}
          >
            <option value="">选择范围</option>
            {recipe.regionEdits.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {recipe.warp.protection && settings.protecting && (
          <MaskControls
            controller={controller}
            path={editor.activeMaskPath}
            onPath={editor.setActiveMaskPath}
            getMask={() => currentV3(editor).warp.protection!}
            onChange={(protection, commit) => {
              const r = currentV3(editor);
              return apply({ ...r, warp: { ...r.warp, protection } }, '调整液化保护范围', commit);
            }}
          />
        )}
      </details>
      <div className="advanced-row">
        <small>
          {recipe.warp.strokes.length} / {MAX_V3_WARP_STROKES} 次变形
        </small>
        <button
          className="text-button"
          disabled={!recipe.warp.strokes.length}
          onClick={() =>
            apply(
              { ...recipe, warp: { ...recipe.warp, strokes: recipe.warp.strokes.slice(0, -1) } },
              '移除最后一次变形',
              true,
            )
          }
        >
          移除最后一次
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
          ['x', '位置 X', -4, 4, 0.0001, ''],
          ['y', '位置 Y', -4, 4, 0.0001, ''],
          ['width', '宽度比例', 0.000001, 8, 0.0001, ''],
          ['height', '高度比例', 0.000001, 8, 0.0001, ''],
          ['rotationDegrees', '旋转角度', -180, 180, 0.01, '°'],
          ['opacity', '透明度', 0, 1, 0.001, ''],
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
          合成图层 {recipe.imageLayers.length} / {MAX_V3_IMAGE_LAYERS}
        </span>
        <button
          className="text-button"
          disabled={loading || recipe.imageLayers.length >= MAX_V3_IMAGE_LAYERS}
          onClick={() => input.current?.click()}
        >
          <UploadSimple size={16} />
          {loading ? '导入中' : '添加图片'}
        </button>
      </div>
      <p className="control-note">
        每层保留自己的原图、范围、混合与位置。AI 候选也可在结果区明确选择“作为合成图层”。
      </p>
      <div className="advanced-object-list" aria-label="合成图层">
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
              <small>{blendLabels[item.blendMode]}</small>
            </button>
            <IconButton
              label={`${item.enabled ? '隐藏' : '显示'}${item.name}`}
              onClick={() =>
                apply(
                  {
                    ...recipe,
                    imageLayers: recipe.imageLayers.map((p) =>
                      p.id === item.id ? { ...p, enabled: !p.enabled } : p,
                    ),
                  },
                  '切换合成图层',
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
            label="合成位置"
            controls={controls}
            onCommit={(name) => editor.commitCurrent('调整合成' + name)}
            onCancel={editor.cancelPreview}
          />
          <div className="tonal-tabs">
            <button
              aria-pressed={layer.flipX}
              onClick={() => patch({ flipX: !layer.flipX }, '水平镜像合成图层')}
            >
              水平镜像
            </button>
            <button
              aria-pressed={layer.flipY}
              onClick={() => patch({ flipY: !layer.flipY }, '垂直镜像合成图层')}
            >
              垂直镜像
            </button>
          </div>
          <BlendPicker
            value={layer.blendMode}
            onChange={(blendMode) => patch({ blendMode }, '切换合成混合模式')}
          />
          <details className="advanced-disclosure">
            <summary>合成范围与羽化</summary>
            <div className="tonal-tabs">
              {(['radial', 'linear', 'polygon', 'color-range'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    patch({ mask: newMask(type) }, '设置合成范围');
                    setPath([]);
                  }}
                >
                  {
                    { radial: '径向', linear: '渐变', polygon: '多边形', 'color-range': '选色' }[
                      type
                    ]
                  }
                </button>
              ))}
            </div>
            <label className="advanced-select">
              复制局部范围
              <select
                aria-label="合成蒙版来源"
                value=""
                onChange={(event) => {
                  const r = recipe.regionEdits.find((p) => p.id === event.target.value);
                  if (r) {
                    patch({ mask: structuredClone(r.mask) }, '复制合成范围');
                    setPath([]);
                  }
                }}
              >
                <option value="">选择范围副本</option>
                {recipe.regionEdits.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
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
                  onChange={(mask, commit) => patch({ mask }, '调整合成范围', commit)}
                />
                <button
                  className="text-button"
                  onClick={() => patch({ mask: null }, '解除合成范围')}
                >
                  解除范围
                </button>
              </>
            )}
          </details>
          <details className="advanced-disclosure">
            <summary>图层管理</summary>
            <label className="advanced-select">
              名称
              <input
                aria-label="合成图层名称"
                key={layer.id}
                defaultValue={layer.name}
                maxLength={120}
                onBlur={(event) => {
                  if (event.target.value.trim())
                    patch({ name: event.target.value.trim() }, '重命名合成图层');
                }}
              />
            </label>
            <div className="advanced-row">
              <IconButton
                label="合成图层前移"
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
                    '调整合成顺序',
                    true,
                  )
                }
              >
                <ArrowUp size={16} />
              </IconButton>
              <IconButton
                label="合成图层后移"
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
                    '调整合成顺序',
                    true,
                  )
                }
              >
                <ArrowDown size={16} />
              </IconButton>
              <IconButton
                label="复制合成图层"
                disabled={recipe.imageLayers.length >= MAX_V3_IMAGE_LAYERS}
                onClick={() => {
                  const copy = {
                    ...structuredClone(layer),
                    id: secureUuid(),
                    name: layer.name.slice(0, 112) + ' 副本',
                  };
                  if (
                    apply(
                      { ...recipe, imageLayers: [...recipe.imageLayers, copy] },
                      '复制合成图层',
                      true,
                    )
                  )
                    editor.setActiveImageLayerId(copy.id);
                }}
              >
                <Copy size={16} />
              </IconButton>
              <IconButton
                label="删除合成图层，可撤销"
                onClick={() => {
                  if (
                    apply(
                      {
                        ...recipe,
                        imageLayers: recipe.imageLayers.filter((p) => p.id !== layer.id),
                      },
                      '删除合成图层',
                      true,
                    )
                  )
                    editor.setActiveImageLayerId(null);
                }}
              >
                <Trash size={16} />
              </IconButton>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
