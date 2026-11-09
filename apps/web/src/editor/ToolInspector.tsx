import { useState, type ReactNode } from 'react';
import { TOOLS, createRecipe, type Adjustments } from '@ai-xiutu/editor';
import {
  SlidersHorizontal,
  Palette,
  BezierCurve,
  Crop,
  Scan,
  DiamondsFour,
  ClockCounterClockwise,
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowsLeftRight,
  ArrowsDownUp,
  X,
  Check,
  CaretDown,
} from '@phosphor-icons/react';
import { IconButton } from '../components/Ui';
import { CurveEditor } from './CurveEditor';
import type { EditorState } from './useEditor';
import { Histogram } from './Histogram';
import { ColorPicker } from '../components/ColorPicker';

export type ToolGroup = 'light' | 'color' | 'curves' | 'crop' | 'local' | 'detail' | 'history';
export const toolGroups: { id: ToolGroup; label: string; icon: ReactNode; description: string }[] =
  [
    {
      id: 'light',
      label: '明暗',
      icon: <SlidersHorizontal size={22} />,
      description: '让光线，恰到好处',
    },
    { id: 'color', label: '色彩', icon: <Palette size={22} />, description: '寻找画面的情绪' },
    {
      id: 'curves',
      label: '曲线',
      icon: <BezierCurve size={22} />,
      description: '精细掌控色调层次',
    },
    { id: 'crop', label: '构图', icon: <Crop size={22} />, description: '为画面找到好比例' },
    { id: 'local', label: '局部', icon: <Scan size={22} />, description: '只调整你选择的区域' },
    {
      id: 'detail',
      label: '细节',
      icon: <DiamondsFour size={22} />,
      description: '清晰与柔和，按你喜欢',
    },
    {
      id: 'history',
      label: '记录',
      icon: <ClockCounterClockwise size={22} />,
      description: '每一步，都能回头',
    },
  ];
const groupIds: Partial<Record<ToolGroup, string[]>> = {
  light: ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  color: ['saturation', 'vibrance', 'temperature', 'tint'],
  detail: ['sharpness', 'soften'],
};
type Tool = (typeof TOOLS)[number];

function RangeControl({
  tool,
  value,
  onChange,
  onCommit,
  onReset,
}: {
  tool: Tool;
  value: number;
  onChange: (value: number) => void;
  onCommit: () => void;
  onReset: () => void;
}) {
  const safe = Number.isFinite(value) ? value : 0;
  return (
    <div className="range-control">
      <div className="range-label">
        <label htmlFor={`range-${tool.id}`}>{tool.label}</label>
        <div>
          <input
            aria-label={`${tool.label}数值`}
            type="number"
            min={tool.min}
            max={tool.max}
            step={tool.step}
            value={safe}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= tool.min && n <= tool.max) onChange(n);
            }}
            onBlur={onCommit}
            onKeyUp={(e) => {
              if (e.key === 'Enter') onCommit();
            }}
          />
          <span>{tool.unit === 'EV' ? 'EV' : ''}</span>
          <button
            type="button"
            className="reset-value"
            aria-label={`重置${tool.label}`}
            title={`重置${tool.label}`}
            disabled={value === tool.neutral}
            onClick={onReset}
          >
            <ArrowCounterClockwise size={13} />
          </button>
        </div>
      </div>
      <input
        id={`range-${tool.id}`}
        aria-label={tool.label}
        className="range"
        type="range"
        min={tool.min}
        max={tool.max}
        step={tool.step}
        value={safe}
        style={
          {
            '--range-position': `${((safe - tool.min) / (tool.max - tool.min)) * 100}%`,
          } as React.CSSProperties
        }
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onPointerCancel={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </div>
  );
}

export function ToolInspector({
  editor,
  group,
  mobileOpen,
  onClose,
  pickedColor = '#34372EFF',
  onColorChange,
  sampling = false,
  onSample,
}: {
  editor: EditorState;
  group: ToolGroup;
  mobileOpen: boolean;
  onClose: () => void;
  pickedColor?: string;
  onColorChange?: (value: string) => void;
  sampling?: boolean;
  onSample?: () => void;
}) {
  const [localSub, setLocalSub] = useState<'light' | 'color'>('light');
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = toolGroups.find((t) => t.id === group)!;
  const setAdjustment = (key: keyof Adjustments, value: number, local = false, commit = false) => {
    const next = local
      ? {
          ...editor.recipe,
          local: {
            ...editor.recipe.local,
            adjustments: { ...editor.recipe.local.adjustments, [key]: value },
          },
        }
      : { ...editor.recipe, adjustments: { ...editor.recipe.adjustments, [key]: value } };
    if (commit) editor.commit(next, `调整${TOOLS.find((t) => t.id === key)?.label ?? key}`);
    else editor.preview(next);
  };
  const sliders = (ids: string[], local = false) =>
    TOOLS.filter((t) => ids.includes(t.id)).map((tool) => (
      <RangeControl
        key={tool.id}
        tool={tool}
        value={
          (local ? editor.recipe.local.adjustments : editor.recipe.adjustments)[
            tool.id as keyof Adjustments
          ]
        }
        onChange={(v) => setAdjustment(tool.id as keyof Adjustments, v, local)}
        onCommit={() => editor.commitCurrent(`调整${tool.label}`)}
        onReset={() => setAdjustment(tool.id as keyof Adjustments, tool.neutral, local, true)}
      />
    ));
  const crop = editor.recipe.geometry.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  function setCropValue(key: 'x' | 'y' | 'width' | 'height', value: number) {
    if (!Number.isFinite(value)) return;
    const next = {
      ...crop,
      [key]: Math.max(key === 'width' || key === 'height' ? 0.01 : 0, Math.min(1, value)),
    };
    next.width = Math.min(next.width, 1 - next.x);
    next.height = Math.min(next.height, 1 - next.y);
    if (next.width < 0.01) {
      next.x = 0.99;
      next.width = 0.01;
    }
    if (next.height < 0.01) {
      next.y = 0.99;
      next.height = 0.01;
    }
    editor.commit(
      { ...editor.recipe, geometry: { ...editor.recipe.geometry, crop: next } },
      '调整裁切区域',
    );
  }
  function cropRatio(ratio: number | null) {
    if (!ratio || !editor.dimensions) {
      editor.commit(
        { ...editor.recipe, geometry: { ...editor.recipe.geometry, crop: null } },
        '恢复裁切',
      );
      return;
    }
    const sourceRatio = editor.dimensions.width / editor.dimensions.height;
    const rotated =
      editor.recipe.geometry.rotation === 90 || editor.recipe.geometry.rotation === 270;
    const sourceTarget = rotated ? 1 / ratio : ratio;
    const width = sourceTarget < sourceRatio ? sourceTarget / sourceRatio : 1;
    const height = sourceTarget > sourceRatio ? sourceRatio / sourceTarget : 1;
    editor.commit(
      {
        ...editor.recipe,
        geometry: {
          ...editor.recipe.geometry,
          crop: { x: (1 - width) / 2, y: (1 - height) / 2, width, height },
        },
      },
      '切换画幅比例',
    );
  }
  return (
    <aside className={`inspector ${mobileOpen ? 'mobile-open' : ''}`} aria-label="编辑参数">
      <div className="sheet-grabber" />
      <header className="inspector-heading">
        <div>
          <h2>
            {current.label}
            <span className="tiny-dot" />
          </h2>
          <p>{current.description}</p>
        </div>
        <IconButton label="收起工具面板" className="mobile-only" onClick={onClose}>
          <CaretDown size={20} />
        </IconButton>
      </header>
      <div className="inspector-scroll">
        {!editor.file ? (
          <div className="inspector-empty">
            <span>{current.icon}</span>
            <h3>先放入一张照片</h3>
            <p>
              工具会随照片准备好。
              <br />
              原件始终保留，不会被覆盖。
            </p>
          </div>
        ) : (
          <>
            {['light', 'color', 'curves'].includes(group) && <Histogram image={editor.rendered} />}
            {group === 'color' && onColorChange && (
              <section className="inspector-palette">
                <div>
                  <button className="text-button" onClick={() => setPickerOpen(!pickerOpen)}>
                    <span className="palette-chip" style={{ background: pickedColor }} />
                    颜色与色值
                  </button>
                  {onSample && (
                    <button
                      className={`text-button ${sampling ? 'active' : ''}`}
                      onClick={onSample}
                    >
                      {sampling ? '取消取色' : '从画面取色'}
                    </button>
                  )}
                </div>
                {pickerOpen && (
                  <>
                    <ColorPicker value={pickedColor} onChange={onColorChange} label="参考颜色" />
                    <p className="inspector-note">
                      参考色可供草图使用。照片的实际调色使用下方调整参数。
                    </p>
                  </>
                )}
              </section>
            )}
            {groupIds[group] && (
              <>
                {sliders(groupIds[group]!)}
                <button
                  className="text-button reset-group"
                  onClick={() => {
                    const adjustment = { ...editor.recipe.adjustments };
                    for (const id of groupIds[group]!) adjustment[id as keyof Adjustments] = 0;
                    editor.commit(
                      { ...editor.recipe, adjustments: adjustment },
                      `重置${current.label}`,
                    );
                  }}
                >
                  <ArrowCounterClockwise size={15} />
                  重置这组调整
                </button>
              </>
            )}
            {group === 'curves' && <CurveEditor editor={editor} />}
            {group === 'crop' && (
              <>
                <div className="section-label">画幅比例</div>
                <div className="ratio-grid">
                  {[
                    ['原始', null],
                    ['1:1', 1],
                    ['4:3', 4 / 3],
                    ['3:4', 3 / 4],
                    ['16:9', 16 / 9],
                    ['9:16', 9 / 16],
                  ].map(([label, ratio]) => (
                    <button key={String(label)} onClick={() => cropRatio(ratio as number | null)}>
                      <span className={`ratio-shape ratio-${String(label).replace(':', '-')}`} />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="section-label">
                  精确裁切 <small>相对原图 %</small>
                </div>
                <div className="field-grid">
                  {(
                    [
                      ['x', '左边距'],
                      ['y', '上边距'],
                      ['width', '宽度'],
                      ['height', '高度'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        step="0.1"
                        min={key === 'width' || key === 'height' ? 1 : 0}
                        max="100"
                        value={Math.round(crop[key] * 1000) / 10}
                        onChange={(e) => setCropValue(key, Number(e.target.value) / 100)}
                      />
                    </label>
                  ))}
                </div>
                <div className="section-label">旋转与镜像</div>
                <div className="transform-controls">
                  <button
                    onClick={() =>
                      editor.commit(
                        {
                          ...editor.recipe,
                          geometry: {
                            ...editor.recipe.geometry,
                            rotation: ((editor.recipe.geometry.rotation + 270) % 360) as
                              0 | 90 | 180 | 270,
                          },
                        },
                        '逆时针旋转',
                      )
                    }
                  >
                    <ArrowCounterClockwise size={20} />
                    左转
                  </button>
                  <button
                    onClick={() =>
                      editor.commit(
                        {
                          ...editor.recipe,
                          geometry: {
                            ...editor.recipe.geometry,
                            rotation: ((editor.recipe.geometry.rotation + 90) % 360) as
                              0 | 90 | 180 | 270,
                          },
                        },
                        '顺时针旋转',
                      )
                    }
                  >
                    <ArrowClockwise size={20} />
                    右转
                  </button>
                  <button
                    aria-pressed={editor.recipe.geometry.flipX}
                    onClick={() =>
                      editor.commit(
                        {
                          ...editor.recipe,
                          geometry: {
                            ...editor.recipe.geometry,
                            flipX: !editor.recipe.geometry.flipX,
                          },
                        },
                        '水平镜像',
                      )
                    }
                  >
                    <ArrowsLeftRight size={20} />
                    水平
                  </button>
                  <button
                    aria-pressed={editor.recipe.geometry.flipY}
                    onClick={() =>
                      editor.commit(
                        {
                          ...editor.recipe,
                          geometry: {
                            ...editor.recipe.geometry,
                            flipY: !editor.recipe.geometry.flipY,
                          },
                        },
                        '垂直镜像',
                      )
                    }
                  >
                    <ArrowsDownUp size={20} />
                    垂直
                  </button>
                </div>
                <p className="inspector-note">
                  裁切只改变可见范围，原图仍然保留。恢复裁切可重新找回画面外的内容。
                </p>
              </>
            )}
            {group === 'local' && (
              <>
                <label className="switch-row">
                  <span>启用径向选区</span>
                  <input
                    type="checkbox"
                    checked={editor.recipe.local.enabled}
                    onChange={(e) =>
                      editor.commit(
                        {
                          ...editor.recipe,
                          local: { ...editor.recipe.local, enabled: e.target.checked },
                        },
                        '切换局部选区',
                      )
                    }
                  />
                </label>
                <p className="inspector-note">
                  在画面上点选中心，或用下面的数值定位。局部调整只作用于这个椭圆区域。
                </p>
                <div className="field-grid">
                  {(
                    [
                      ['centerX', '中心 X'],
                      ['centerY', '中心 Y'],
                      ['radiusX', '横向半径'],
                      ['radiusY', '纵向半径'],
                      ['feather', '羽化'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type="number"
                        min={key.startsWith('radius') ? 1 : 0}
                        max="100"
                        step="1"
                        value={Math.round(editor.recipe.local.mask[key] * 100)}
                        onChange={(e) => {
                          const value = Math.max(
                            key.startsWith('radius') ? 0.01 : 0,
                            Math.min(1, Number(e.target.value) / 100),
                          );
                          editor.commit(
                            {
                              ...editor.recipe,
                              local: {
                                ...editor.recipe.local,
                                enabled: true,
                                mask: { ...editor.recipe.local.mask, [key]: value },
                              },
                            },
                            '调整局部范围',
                          );
                        }}
                      />
                    </label>
                  ))}
                </div>
                <label className="switch-row">
                  <span>反选区域</span>
                  <input
                    type="checkbox"
                    checked={editor.recipe.local.mask.invert}
                    onChange={(e) =>
                      editor.commit(
                        {
                          ...editor.recipe,
                          local: {
                            ...editor.recipe.local,
                            mask: { ...editor.recipe.local.mask, invert: e.target.checked },
                          },
                        },
                        '反选局部区域',
                      )
                    }
                  />
                </label>
                <div className="segmented small">
                  <button
                    className={localSub === 'light' ? 'selected' : ''}
                    onClick={() => setLocalSub('light')}
                  >
                    明暗
                  </button>
                  <button
                    className={localSub === 'color' ? 'selected' : ''}
                    onClick={() => setLocalSub('color')}
                  >
                    色彩
                  </button>
                </div>
                {sliders(groupIds[localSub]!, true)}
              </>
            )}
            {group === 'history' && (
              <>
                <p className="inspector-note">
                  本次编辑的操作记录。撤销只影响你的本地修改，云端版本不会被删除。
                </p>
                <ol className="history-list">
                  {editor.history.map((item, index) => (
                    <li
                      key={index}
                      className={
                        index === editor.historyIndex
                          ? 'current'
                          : index > editor.historyIndex
                            ? 'future'
                            : ''
                      }
                    >
                      <span>{index === editor.historyIndex ? <Check size={13} /> : index + 1}</span>
                      <div>
                        {item.label}
                        <small>
                          {index === editor.historyIndex
                            ? '当前状态'
                            : index > editor.historyIndex
                              ? '已撤销'
                              : '已记录'}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
                <button className="button button-secondary button-full" onClick={editor.reset}>
                  <ArrowCounterClockwise size={16} />
                  恢复原图配方
                </button>
              </>
            )}
          </>
        )}
      </div>
      <footer className="inspector-footer">
        <span className="status-dot" />
        <span>原件保留 · 随时撤销</span>
        <span className="mobile-only">
          <IconButton label="完成调整并收起" onClick={onClose}>
            <Check size={20} />
          </IconButton>
        </span>
      </footer>
    </aside>
  );
}
