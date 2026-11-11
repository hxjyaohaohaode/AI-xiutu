import { t } from '../i18n';
import { studioText } from '../workspace/studio-copy';
import { MotionDetails } from '../motion/Presence';
import { StudioGlyph } from '../components/StudioGlyph';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { useState, type ReactNode } from 'react';
import {
  TOOLS,
  V2_TOOLS,
  HSL_BANDS,
  MAX_ADJUSTMENT_REGIONS,
  createRecipeV2,
  createAdjustmentRegionV2,
  migrateRecipeToV2,
  migrateRecipeToV4,
  neutralAdjustments,
  parseSelectionMask,
  type Adjustments,
  type HslBandId,
  type SelectionMaskV2,
  type AdjustmentRegionV2,
} from '@ai-xiutu/editor';
import {
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowsLeftRight,
  ArrowsDownUp,
  Check,
  CaretDown,
  Trash,
  Eye,
  EyeSlash,
  Copy,
  ArrowUp,
  ArrowDown,
  Circle,
  PaintBrush,
  Polygon,
  Gradient,
  UserFocus,
  Eyedropper,
} from '@phosphor-icons/react';
import { IconButton } from '../components/Ui';
import { CurveEditor } from './CurveEditor';
import type { EditorState } from './useEditor';
import { Histogram } from './Histogram';
import { ColorPicker } from '../components/ColorPicker';
import { PrecisionRange } from './PrecisionRange';
import {
  clamp,
  cropFromPixels,
  duplicateRegionForEditor,
  numericRecipeValue,
  setNumericRecipeValue,
} from './precision';
import './editor-controls.css';
import { AdvancedInspector } from './AdvancedInspector';
import { checkedRecipe } from './advanced-model';

export type ToolGroup =
  | 'beauty'
  | 'light'
  | 'color'
  | 'curves'
  | 'crop'
  | 'local'
  | 'detail'
  | 'paint'
  | 'repair'
  | 'liquify'
  | 'composite'
  | 'history';
export const toolGroups: { id: ToolGroup; label: string; icon: ReactNode; description: string }[] =
  [
    {
      id: 'beauty',
      label: '美颜',
      icon: <StudioGlyph name="beauty" />,
      description: '按人物调节肤质、五官与妆容',
    },
    {
      id: 'light',
      label: '明暗',
      icon: <StudioGlyph name="light" />,
      description: '曝光与明暗层次',
    },
    {
      id: 'color',
      label: '色彩',
      icon: <StudioGlyph name="color" />,
      description: '白平衡、饱和度与分区色彩',
    },
    {
      id: 'curves',
      label: '曲线',
      icon: <StudioGlyph name="curves" />,
      description: '逐点调整亮度与颜色通道',
    },
    {
      id: 'crop',
      label: '构图',
      icon: <StudioGlyph name="crop" />,
      description: '画幅、旋转与透视',
    },
    {
      id: 'local',
      label: '局部',
      icon: <StudioGlyph name="local" />,
      description: '选定范围，独立调整',
    },
    {
      id: 'detail',
      label: '细节',
      icon: <StudioGlyph name="detail" />,
      description: '锐化、柔化与颗粒',
    },
    {
      id: 'repair',
      label: '修复',
      icon: <StudioGlyph name="repair" />,
      description: '纹理修补与肤质处理',
    },
    {
      id: 'paint',
      label: '绘制',
      icon: <StudioGlyph name="paint" />,
      description: '画笔、克隆与混合',
    },
    {
      id: 'liquify',
      label: '液化',
      icon: <StudioGlyph name="liquify" />,
      description: '推移、膨胀与收缩',
    },
    {
      id: 'composite',
      label: '合成',
      icon: <StudioGlyph name="composite" />,
      description: '图层、混合与蒙版',
    },
    {
      id: 'history',
      label: '记录',
      icon: <StudioGlyph name="history" />,
      description: '撤销、重做与编辑记录',
    },
  ];
const groupIds = {
  light: ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'],
  color: ['temperature', 'tint', 'vibrance', 'saturation'],
  detail: ['sharpness', 'soften'],
};
const hueGradient =
  'linear-gradient(90deg,#f05c52,#e9ba32,#79c742,#30bb92,#3fa7dd,#6671e6,#b85ddb,#f05c87,#f05c52)';
const uid = () =>
  `region-${Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => n.toString(16).padStart(2, '0')).join('')}`;
function Section({
  title,
  children,
  open = false,
  suffix,
}: {
  title: string;
  children: ReactNode;
  open?: boolean;
  suffix?: string;
}) {
  return (
    <MotionDetails className="editor-section" defaultOpen={open} data-motion="inspector-section">
      <summary>
        <span>{title}</span>
        {suffix && <small>{suffix}</small>}
        <CaretDown size={14} />
      </summary>
      <div className="editor-section-body">{children}</div>
    </MotionDetails>
  );
}
export type ToolInspectorProps = {
  editor: EditorState;
  group: ToolGroup;
  mobileOpen: boolean;
  onClose: () => void;
  pickedColor?: string;
  onColorChange?: (value: string) => void;
  sampling?: boolean;
  onSample?: () => void;
  onGroupChange?: (group: ToolGroup) => void;
  onCutout?: () => Promise<string>;
};
export function ToolInspector(props: ToolInspectorProps) {
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  if (props.editor.recipe.schemaVersion === 3 || props.editor.recipe.schemaVersion === 4)
    return <AdvancedInspector key={props.editor.getSourceIdentity()} {...props} />;
  if (['paint', 'liquify', 'composite', 'repair'].includes(props.group))
    return (
      <aside className="inspector refined-inspector">
        <div className="inspector-scroll">
          <h2>{t('升级到可扩展编辑配方')}</h2>
          <p className="control-note">
            {t('旧版本会保留原有色彩与局部语义。升级后可使用独立绘制、液化、合成与完整局部调色。')}
          </p>
          <button
            className="button button-secondary"
            onClick={() => {
              try {
                props.editor.commit(
                  checkedRecipe(
                    migrateRecipeToV4(props.editor.getRecipe()),
                    props.editor.dimensions,
                    props.editor.pixelBudget,
                  ),
                  t('升级到第四代编辑配方'),
                );
                setUpgradeError(null);
              } catch (error) {
                setUpgradeError(error instanceof Error ? error.message : t('当前图片无法升级。'));
              }
            }}
          >
            {t('升级当前草稿，可撤销')}
          </button>
          {upgradeError && (
            <p className="parameter-error" role="alert">
              {t(upgradeError)}
            </p>
          )}
        </div>
      </aside>
    );
  return <LegacyToolInspector {...props} />;
}
function LegacyToolInspector({
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
  const [localSub, setLocalSub] = useState<'light' | 'color' | 'detail'>('light');
  const [colorTab, setColorTab] = useState<'global' | 'hsl' | 'grading' | 'palette'>('global');
  const [band, setBand] = useState<HslBandId>('red');
  const [zone, setZone] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const [polygonPoint, setPolygonPoint] = useState(0);
  const [constraintError, setConstraintError] = useState<string | null>(null);
  const [portraitSub, setPortraitSub] = useState<'skin' | 'light' | 'color'>('skin');
  const current = toolGroups.find((item) => item.id === group)!;
  const recipe = editor.recipe;
  const v2 = recipe.schemaVersion === 2 ? recipe : null;
  const region = v2?.regions.find((item) => item.id === editor.activeRegionId);
  const selected = region ?? recipe.local;
  const cancel = () => editor.cancelPreview();
  function patchRegion(patch: Partial<AdjustmentRegionV2>, label: string, commit = true) {
    if (!v2 || !region) return;
    const next = {
      ...v2,
      regions: v2.regions.map((item) => (item.id === region.id ? { ...item, ...patch } : item)),
    };
    if (commit) editor.commit(next, label);
    else editor.preview(next);
  }
  function changeMask(mask: SelectionMaskV2, commit = false) {
    try {
      parseSelectionMask(mask);
      setConstraintError(null);
    } catch {
      setConstraintError(
        '这个形状暂时不能成立：多边形至少保留三个非共线点，渐变两端应分开。原有效选区已保留。',
      );
      return;
    }
    if (region) patchRegion({ mask }, '调整选区', commit);
    else if (mask.type === 'radial') {
      const next = { ...recipe, local: { ...recipe.local, enabled: true, mask } };
      if (commit) editor.commit(next, '调整径向选区');
      else editor.preview(next);
    }
  }
  function sliders(ids: string[], local = false) {
    return ids
      .map((id) => TOOLS.find((tool) => tool.id === id)!)
      .map((tool, index) => {
        const key = tool.id as keyof Adjustments;
        const value = (local ? selected.adjustments : recipe.adjustments)[key];
        function update(value: number, commit = false) {
          let next = recipe;
          if (local && region && v2)
            next = {
              ...v2,
              regions: v2.regions.map((item) =>
                item.id === region.id
                  ? { ...item, adjustments: { ...item.adjustments, [key]: value } }
                  : item,
              ),
            };
          else if (local)
            next = {
              ...recipe,
              local: {
                ...recipe.local,
                adjustments: { ...recipe.local.adjustments, [key]: value },
              },
            };
          else next = { ...recipe, adjustments: { ...recipe.adjustments, [key]: value } };
          if (commit) editor.commit(next, t('调整{v0}', { v0: t(tool.label) }));
          else editor.preview(next);
        }
        return (
          <PrecisionRange
            key={tool.id}
            label={t(tool.label)}
            value={value}
            min={tool.min}
            max={tool.max}
            step={tool.unit === 'EV' ? 0.01 : 0.1}
            neutral={tool.neutral}
            unit={tool.unit === 'EV' ? 'EV' : ''}
            description={tool.description ? t(tool.description) : undefined}
            index={index}
            onChange={update}
            onCommit={() => editor.commitCurrent(t('调整{v0}', { v0: t(tool.label) }))}
            onCancel={cancel}
            onReset={() => update(tool.neutral, true)}
            gradient={
              tool.id === 'temperature'
                ? 'linear-gradient(90deg,#85b8f4,#e3e3db,#f0be67)'
                : tool.id === 'tint'
                  ? 'linear-gradient(90deg,#6ccb9a,#e3e3db,#d995d2)'
                  : undefined
            }
          />
        );
      });
  }
  function advanced(paths: string[]) {
    if (!v2) return null;
    return paths
      .map((path) => V2_TOOLS.find((tool) => tool.path === path)!)
      .filter(Boolean)
      .map((tool, index) => {
        let min = tool.min,
          max = tool.max;
        if (tool.path === 'levels.inputBlack')
          max = Math.min(max, v2.levels.inputWhite - 0.000100001);
        if (tool.path === 'levels.inputWhite')
          min = Math.max(min, v2.levels.inputBlack + 0.000100001);
        if (tool.path === 'levels.outputBlack') max = v2.levels.outputWhite;
        if (tool.path === 'levels.outputWhite') min = v2.levels.outputBlack;
        const percentage = tool.unit === 'ratio' && tool.path !== 'levels.gamma';
        const multiplier = percentage ? 100 : 1;
        const value = numericRecipeValue(v2, tool);
        const update = (number: number, commit = false) => {
          const next = setNumericRecipeValue(
            v2,
            tool,
            clamp(number / multiplier, min, max),
            V2_TOOLS,
          );
          if (commit) editor.commit(next, t('调整{v0}', { v0: t(tool.label) }));
          else editor.preview(next);
        };
        return (
          <PrecisionRange
            key={tool.path}
            integer={tool.unit === 'seed' || tool.path === 'effects.grain.size'}
            label={t(tool.label)}
            value={value * multiplier}
            min={min * multiplier}
            max={max * multiplier}
            step={
              tool.unit === 'seed' || tool.unit === 'px' ? 1 : Math.min(tool.step, 0.1) * multiplier
            }
            neutral={tool.neutral * multiplier}
            unit={
              percentage ? '%' : tool.unit === 'ratio' ? '×' : tool.unit === 'seed' ? '' : tool.unit
            }
            description={tool.description ? t(tool.description) : undefined}
            index={index}
            gradient={
              tool.path.startsWith('grading.') && tool.path.endsWith('.hue')
                ? hueGradient
                : undefined
            }
            onChange={update}
            onCommit={() => editor.commitCurrent(t('调整{v0}', { v0: t(tool.label) }))}
            onCancel={cancel}
            onReset={() => update(clamp(tool.neutral, min, max) * multiplier, true)}
          />
        );
      });
  }
  function resetFields(paths: string[], label: string) {
    if (!v2) return;
    const defaults = createRecipeV2();
    let next = v2;
    for (const path of paths) {
      const tool = V2_TOOLS.find((item) => item.path === path);
      if (tool)
        next = setNumericRecipeValue(next, tool, numericRecipeValue(defaults, tool), V2_TOOLS);
    }
    editor.commit(next, label);
  }
  function upgrade() {
    editor.commit(migrateRecipeToV2(recipe), '启用新版编辑能力');
  }
  const upgradeCard = !v2 && (
    <div className="recipe-upgrade">
      <strong>{t('这是一份 v1 配方')}</strong>
      <p>{t('已有调整按原算法回放。启用 v2 后可使用色阶、分色、分级与多选区；这一步可以撤销。')}</p>
      <button className="button button-secondary" onClick={upgrade}>
        {t('启用扩展控制')}
      </button>
    </div>
  );
  const crop = recipe.geometry.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const dims = editor.dimensions ?? { width: 1, height: 1 };
  const pixelCrop = {
    x: Math.floor(crop.x * dims.width),
    y: Math.floor(crop.y * dims.height),
    width: Math.ceil((crop.x + crop.width) * dims.width) - Math.floor(crop.x * dims.width),
    height: Math.ceil((crop.y + crop.height) * dims.height) - Math.floor(crop.y * dims.height),
  };
  function changeCrop(key: keyof typeof pixelCrop, value: number, commit = false) {
    const next = {
      ...recipe,
      geometry: { ...recipe.geometry, crop: cropFromPixels(dims, { ...pixelCrop, [key]: value }) },
    };
    if (commit) editor.commit(next, '精确裁切');
    else editor.preview(next);
  }
  function cropRatio(ratio: number | null) {
    if (!ratio) {
      editor.commit({ ...recipe, geometry: { ...recipe.geometry, crop: null } }, '恢复完整画幅');
      return;
    }
    const rotated = recipe.geometry.rotation === 90 || recipe.geometry.rotation === 270;
    const target = rotated ? 1 / ratio : ratio;
    const width = Math.max(1, Math.min(dims.width, Math.round(dims.height * target)));
    const height = Math.max(1, Math.min(dims.height, Math.round(dims.width / target)));
    editor.commit(
      {
        ...recipe,
        geometry: {
          ...recipe.geometry,
          crop: cropFromPixels(dims, {
            x: (dims.width - width) / 2,
            y: (dims.height - height) / 2,
            width,
            height,
          }),
        },
      },
      '切换画幅比例',
    );
  }
  function addRegion(
    type: 'radial' | 'linear' | 'brush' | 'polygon' | 'color-range',
    name?: string,
  ) {
    if (!v2 || v2.regions.length >= MAX_ADJUSTMENT_REGIONS) return;
    const labels = {
      radial: '径向',
      linear: '渐变',
      brush: '画笔',
      polygon: '多边形',
      'color-range': '颜色范围',
    };
    const mask: SelectionMaskV2 =
      type === 'radial'
        ? {
            ...recipe.local.mask,
            centerX: 0.5,
            centerY: 0.5,
            radiusX: 0.25,
            radiusY: 0.25,
            invert: false,
          }
        : type === 'linear'
          ? {
              type,
              start: { x: 0.25, y: 0.5 },
              end: { x: 0.75, y: 0.5 },
              invert: false,
              smooth: true,
            }
          : type === 'brush'
            ? { type, strokes: [], invert: false }
            : type === 'color-range'
              ? {
                  type,
                  hue: referenceHue(),
                  hueWidth: 30,
                  saturationMin: 0.08,
                  saturationMax: 1,
                  luminanceMin: 0,
                  luminanceMax: 1,
                  feather: 0.4,
                  invert: false,
                }
              : {
                  type,
                  points: [
                    { x: 0.25, y: 0.25 },
                    { x: 0.75, y: 0.25 },
                    { x: 0.75, y: 0.75 },
                    { x: 0.25, y: 0.75 },
                  ],
                  feather: 0.03,
                  invert: false,
                };
    const next = createAdjustmentRegionV2({
      id: uid(),
      name: name ?? `${labels[type]} ${v2.regions.length + 1}`,
      mask,
    });
    editor.commit(
      { ...v2, regions: [...v2.regions, next] },
      t('新建{name}选区', { name: t(labels[type]) }),
    );
    editor.setActiveRegionId(next.id);
  }
  function referenceHue() {
    const hex = pickedColor.replace('#', '').slice(0, 6),
      r = parseInt(hex.slice(0, 2), 16) / 255,
      g = parseInt(hex.slice(2, 4), 16) / 255,
      b = parseInt(hex.slice(4, 6), 16) / 255,
      max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      d = max - min;
    return d === 0
      ? 0
      : ((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) %
          360;
  }
  const mask = selected.mask;
  function maskSlider(
    label: string,
    value: number,
    min: number,
    max: number,
    update: (value: number) => SelectionMaskV2,
    step = 0.1,
    unit = '%',
  ) {
    return (
      <PrecisionRange
        key={label}
        label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        unit={unit}
        onChange={(n) => changeMask(update(n))}
        onCommit={() => editor.commitCurrent(t('调整{v0}', { v0: label }))}
        onCancel={cancel}
      />
    );
  }
  const selectedEnabled = Boolean(region || recipe.local.enabled);
  return (
    <aside
      className={`inspector refined-inspector ${mobileOpen ? 'mobile-open' : ''}`}
      aria-label={t('编辑参数')}
    >
      <header className="inspector-heading" data-motion="inspector-header">
        <div>
          <h2>
            {t(current.label)}
            <span className="tiny-dot" />
          </h2>
          <p>{t(current.description)}</p>
        </div>
        <IconButton label={t('收起工具面板')} className="mobile-only" onClick={onClose}>
          <CaretDown size={20} />
        </IconButton>
      </header>
      <div className="inspector-scroll" key={group}>
        {!editor.file ? (
          <div className="inspector-empty">
            <span>{current.icon}</span>
            <h3>{t('先放入一张照片')}</h3>
            <p>{t('打开后即可拖动调整。原图始终保留。')}</p>
          </div>
        ) : (
          <>
            {['light', 'color', 'curves'].includes(group) && <Histogram image={editor.rendered} />}
            {group === 'light' && (
              <>
                <div className="control-stack">{sliders(groupIds.light)}</div>
                <Section title={t('精确色阶')} suffix={t('输入 · 伽马 · 输出')}>
                  {upgradeCard}
                  {advanced(
                    V2_TOOLS.filter((tool) => tool.group === 'levels').map((tool) => tool.path),
                  )}
                  {v2 && (
                    <button
                      className="text-button"
                      onClick={() =>
                        resetFields(
                          V2_TOOLS.filter((tool) => tool.group === 'levels').map(
                            (tool) => tool.path,
                          ),
                          t('重置色阶'),
                        )
                      }
                    >
                      <ArrowCounterClockwise size={14} />
                      {t('重置色阶')}
                    </button>
                  )}
                </Section>
              </>
            )}
            {group === 'color' && (
              <>
                <div className="editor-subtabs" role="tablist" aria-label={t('调色方式')}>
                  {(
                    [
                      ['global', t('整体')],
                      ['hsl', t('分色')],
                      ['grading', t('分级')],
                      ['palette', t('色谱')],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      role="tab"
                      aria-selected={colorTab === id}
                      key={id}
                      onClick={() => setColorTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div key={colorTab} className="control-stack" data-motion="inspector-section">
                  {colorTab === 'global' && sliders(groupIds.color)}
                  {colorTab === 'hsl' && (
                    <>
                      {upgradeCard}
                      {v2 && (
                        <>
                          <div className="hsl-band-tabs" role="tablist" aria-label={t('HSL色段')}>
                            {HSL_BANDS.map((item) => (
                              <button
                                key={item.id}
                                role="tab"
                                aria-selected={band === item.id}
                                aria-label={t('{v0}色色段', { v0: t(item.label) })}
                                onClick={() => setBand(item.id)}
                                style={
                                  {
                                    '--band-color': `hsl(${item.center},72%,51%)`,
                                  } as React.CSSProperties
                                }
                              >
                                <i />
                                <span>{t(item.label)}</span>
                              </button>
                            ))}
                          </div>
                          {advanced(
                            ['hue', 'saturation', 'lightness'].map((key) => `hsl.${band}.${key}`),
                          )}
                          <button
                            className="text-button"
                            onClick={() =>
                              resetFields(
                                ['hue', 'saturation', 'lightness'].map(
                                  (key) => `hsl.${band}.${key}`,
                                ),
                                t('重置当前色段'),
                              )
                            }
                          >
                            <ArrowCounterClockwise size={14} />
                            {t('重置这个色段')}
                          </button>
                          <p className="inspector-note">
                            {t('相邻色段平滑混合；红橙色调整不等于自动识别或保护皮肤。')}
                          </p>
                        </>
                      )}
                    </>
                  )}
                  {colorTab === 'grading' && (
                    <>
                      {upgradeCard}
                      {v2 && (
                        <>
                          <div className="editor-subtabs" aria-label={t('色彩分级区域')}>
                            {(
                              [
                                ['shadows', t('阴影')],
                                ['midtones', t('中间调')],
                                ['highlights', t('高光')],
                              ] as const
                            ).map(([id, label]) => (
                              <button
                                key={id}
                                aria-pressed={zone === id}
                                onClick={() => setZone(id)}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                          <div
                            className="grading-orbit"
                            style={
                              {
                                '--grade-hue': v2.grading[zone].hue,
                                '--grade-saturation': `${v2.grading[zone].saturation}%`,
                              } as React.CSSProperties
                            }
                            aria-hidden
                          >
                            <i />
                          </div>
                          {advanced(
                            ['hue', 'saturation', 'luminance'].map(
                              (key) => `grading.${zone}.${key}`,
                            ),
                          )}
                          {advanced(['grading.balance'])}
                          <button
                            className="text-button"
                            onClick={() =>
                              resetFields(
                                ['hue', 'saturation', 'luminance'].map(
                                  (key) => `grading.${zone}.${key}`,
                                ),
                                t('重置分级区域'),
                              )
                            }
                          >
                            <ArrowCounterClockwise size={14} />
                            {t('重置这一区域')}
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {colorTab === 'palette' && onColorChange && (
                    <>
                      {onSample && (
                        <button
                          className={`button button-secondary full-width ${sampling ? 'active' : ''}`}
                          onClick={onSample}
                        >
                          {sampling ? t('取消画面取色') : t('从画面取色')}
                        </button>
                      )}
                      <ColorPicker
                        value={pickedColor}
                        onChange={onColorChange}
                        label={t('参考颜色')}
                      />
                      <p className="inspector-note">
                        {t('参考色用于草图与创作沟通；照片调色在整体、分色和分级中进行。')}
                      </p>
                    </>
                  )}
                </div>
              </>
            )}
            {group === 'curves' && <CurveEditor editor={editor} />}
            {group === 'crop' && (
              <>
                <div className="crop-output-readout">
                  <strong>
                    {pixelCrop.width}
                    <span>×</span>
                    {pixelCrop.height}
                  </strong>
                  <small>{t('原图像素区域 · 方向由下方旋转决定')}</small>
                </div>
                <div className="aspect-chips" aria-label={t('画幅比例')}>
                  {[
                    [t('原始'), null],
                    ['1:1', 1],
                    ['4:3', 4 / 3],
                    ['3:4', 3 / 4],
                    ['3:2', 1.5],
                    ['2:3', 2 / 3],
                    ['16:9', 16 / 9],
                    ['9:16', 9 / 16],
                    ['21:9', 21 / 9],
                    ['5:4', 1.25],
                  ].map(([label, ratio]) => (
                    <button key={String(label)} onClick={() => cropRatio(ratio as number | null)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="control-stack">
                  {(
                    [
                      ['x', t('左边界'), dims.width - 1],
                      ['y', t('上边界'), dims.height - 1],
                      ['width', t('裁切宽度'), dims.width - pixelCrop.x],
                      ['height', t('裁切高度'), dims.height - pixelCrop.y],
                    ] as const
                  ).map(([key, label, max]) => (
                    <PrecisionRange
                      key={key}
                      label={label}
                      value={pixelCrop[key]}
                      min={key === 'width' || key === 'height' ? 1 : 0}
                      max={max}
                      step={1}
                      integer
                      unit="px"
                      onChange={(value) => changeCrop(key, value)}
                      onCommit={() => editor.commitCurrent(t('精确裁切'))}
                      onCancel={cancel}
                    />
                  ))}
                </div>
                <div className="transform-controls" data-motion="crop-transforms">
                  <button
                    onClick={() =>
                      editor.commit(
                        {
                          ...recipe,
                          geometry: {
                            ...recipe.geometry,
                            rotation: ((recipe.geometry.rotation + 270) % 360) as
                              0 | 90 | 180 | 270,
                          },
                        },
                        t('向左旋转'),
                      )
                    }
                  >
                    <ArrowCounterClockwise size={19} />
                    {t('左转')}
                  </button>
                  <button
                    onClick={() =>
                      editor.commit(
                        {
                          ...recipe,
                          geometry: {
                            ...recipe.geometry,
                            rotation: ((recipe.geometry.rotation + 90) % 360) as 0 | 90 | 180 | 270,
                          },
                        },
                        t('向右旋转'),
                      )
                    }
                  >
                    <ArrowClockwise size={19} />
                    {t('右转')}
                  </button>
                  <button
                    aria-pressed={recipe.geometry.flipX}
                    onClick={() =>
                      editor.commit(
                        {
                          ...recipe,
                          geometry: { ...recipe.geometry, flipX: !recipe.geometry.flipX },
                        },
                        t('水平镜像'),
                      )
                    }
                  >
                    <ArrowsLeftRight size={19} />
                    {t('镜像')}
                  </button>
                  <button
                    aria-pressed={recipe.geometry.flipY}
                    onClick={() =>
                      editor.commit(
                        {
                          ...recipe,
                          geometry: { ...recipe.geometry, flipY: !recipe.geometry.flipY },
                        },
                        t('垂直翻转'),
                      )
                    }
                  >
                    <ArrowsDownUp size={19} />
                    {t('翻转')}
                  </button>
                </div>
                <p className="inspector-note">
                  {t('拖动滑条即可构图；点数值可精确到 1 像素。裁切可随时恢复。当前旋转')}{' '}
                  {recipe.geometry.rotation}°。
                </p>
              </>
            )}
            {group === 'detail' && (
              <>
                <div className="control-stack">
                  {sliders(groupIds.detail)}
                  {advanced(['detail.texture', 'detail.clarity'])}
                </div>
                {upgradeCard}
                {v2 && (
                  <>
                    <Section title={t('黑白与褪色')}>
                      {advanced(['effects.monochrome', 'effects.fade'])}
                    </Section>
                    <Section title={t('明暗角')} suffix={t('变暗 / 提亮')}>
                      {advanced(['effects.vignette.amount', 'effects.vignette.feather'])}
                      <Section title={t('位置与形状')}>
                        {advanced([
                          'effects.vignette.centerX',
                          'effects.vignette.centerY',
                          'effects.vignette.radiusX',
                          'effects.vignette.radiusY',
                        ])}
                      </Section>
                    </Section>
                    <Section title={t('颗粒')} suffix={t('确定性纹理')}>
                      {advanced(['effects.grain.amount', 'effects.grain.size'])}
                      <label className="switch-row">
                        <span>{t('彩色颗粒')}</span>
                        <input
                          type="checkbox"
                          checked={v2.effects.grain.colored}
                          onChange={(event) =>
                            editor.commit(
                              {
                                ...v2,
                                effects: {
                                  ...v2.effects,
                                  grain: { ...v2.effects.grain, colored: event.target.checked },
                                },
                              },
                              t('切换颗粒色彩'),
                            )
                          }
                        />
                      </label>
                      <button
                        className="text-button"
                        onClick={() =>
                          editor.commit(
                            {
                              ...v2,
                              effects: {
                                ...v2.effects,
                                grain: {
                                  ...v2.effects.grain,
                                  seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
                                },
                              },
                            },
                            t('更换颗粒分布'),
                          )
                        }
                      >
                        {t('换一种颗粒分布')}
                      </button>
                      <Section title={t('固定种子')}>{advanced(['effects.grain.seed'])}</Section>
                    </Section>
                  </>
                )}
                <p className="inspector-note">
                  {t(
                    '细节与颗粒按输入像素运算，缩小预览仅供参考。全尺寸导出使用原图。柔化不包含自动人脸检测。',
                  )}
                </p>
              </>
            )}
            {(group === 'local' || group === 'beauty') && (
              <div className="selection-controls" data-motion="selection-controls">
                {constraintError && (
                  <p role="alert" className="precision-error">
                    {t(constraintError)}
                  </p>
                )}
                {upgradeCard}
                {group === 'beauty' && (
                  <div className="portrait-intro">
                    <strong>{t('每个人，都可以单独调整。')}</strong>
                    <p>
                      {t('添加人物精修区，再拖到想调整的位置；也可以用画笔细选皮肤、眼部或衣物。')}
                    </p>
                    <button
                      className="button button-secondary"
                      disabled={!v2 || v2.regions.length >= MAX_ADJUSTMENT_REGIONS}
                      onClick={() =>
                        addRegion(
                          'radial',
                          t('人物精修 {v0}', { v0: (v2?.regions.length ?? 0) + 1 }),
                        )
                      }
                    >
                      <UserFocus size={17} />
                      {t('添加人物精修区')}
                    </button>
                    <small>{t('当前为手动选区。自动人脸、肤质识别和五官形变尚未接入。')}</small>
                  </div>
                )}
                {v2 && (
                  <>
                    <div className="selection-create" aria-label={t('添加选区')}>
                      {(
                        [
                          { id: 'radial', label: t('径向'), icon: <Circle size={19} /> },
                          { id: 'linear', label: t('渐变'), icon: <Gradient size={19} /> },
                          { id: 'brush', label: t('画笔'), icon: <PaintBrush size={19} /> },
                          { id: 'polygon', label: t('多边形'), icon: <Polygon size={19} /> },
                          { id: 'color-range', label: t('选色'), icon: <Eyedropper size={19} /> },
                        ] as const
                      ).map((item) => (
                        <button
                          key={item.id}
                          disabled={v2.regions.length >= MAX_ADJUSTMENT_REGIONS}
                          onClick={() => addRegion(item.id)}
                        >
                          {item.icon}
                          <span>{t(item.label)}</span>
                        </button>
                      ))}
                    </div>
                    <small className="selection-count">
                      {v2.regions.length} / {MAX_ADJUSTMENT_REGIONS} {t('个选区 · 按顺序叠加')}
                    </small>
                  </>
                )}
                <div className="region-list" role="list" aria-label={t('局部选区列表')}>
                  {(recipe.local.enabled || !v2) && (
                    <button
                      className={`region-item ${!region ? 'selected' : ''}`}
                      role="listitem"
                      onClick={() => editor.setActiveRegionId(null)}
                    >
                      <Circle size={15} />
                      <span>{t('原配方径向选区')}</span>
                    </button>
                  )}
                  {v2?.regions.map((item, index) => (
                    <div
                      className={`region-row ${item.id === region?.id ? 'selected' : ''}`}
                      key={item.id}
                      role="listitem"
                    >
                      <button
                        className="region-item"
                        aria-pressed={item.id === region?.id}
                        onClick={() => editor.setActiveRegionId(item.id)}
                      >
                        <span className="region-index">{index + 1}</span>
                        <span>{item.name}</span>
                        <small>
                          {item.mask.type === 'radial'
                            ? t('径向')
                            : item.mask.type === 'linear'
                              ? t('渐变')
                              : item.mask.type === 'brush'
                                ? t('画笔')
                                : item.mask.type === 'polygon'
                                  ? t('多边形')
                                  : item.mask.type === 'color-range'
                                    ? t('选色')
                                    : t('栅格')}
                        </small>
                      </button>
                      <IconButton
                        label={t('{v0}{v1}', {
                          v0: item.enabled ? t('隐藏') : t('显示'),
                          v1: item.name,
                        })}
                        onClick={() =>
                          editor.commit(
                            {
                              ...v2,
                              regions: v2.regions.map((r) =>
                                r.id === item.id ? { ...r, enabled: !r.enabled } : r,
                              ),
                            },
                            t('切换选区效果'),
                          )
                        }
                      >
                        {item.enabled ? <Eye size={15} /> : <EyeSlash size={15} />}
                      </IconButton>
                    </div>
                  ))}
                </div>
                {!selectedEnabled && v2 ? (
                  <p className="inspector-note selection-onboarding">
                    {t(
                      '先选择一种选区。径向适合补光，渐变适合天空与地面，画笔适合细部，多边形适合轮廓。添加后在画面直接操作。',
                    )}
                  </p>
                ) : (
                  <>
                    {!region && (
                      <label className="switch-row">
                        <span>{t('启用原配方径向选区')}</span>
                        <input
                          type="checkbox"
                          checked={recipe.local.enabled}
                          onChange={(event) =>
                            editor.commit(
                              {
                                ...recipe,
                                local: { ...recipe.local, enabled: event.target.checked },
                              },
                              t('切换原径向选区'),
                            )
                          }
                        />
                      </label>
                    )}
                    {region && (
                      <div className="region-actions">
                        <IconButton
                          label={t('复制当前选区')}
                          disabled={v2!.regions.length >= MAX_ADJUSTMENT_REGIONS}
                          onClick={() => {
                            const id = uid();
                            try {
                              const candidate = duplicateRegionForEditor(v2!, region.id, id);
                              editor.commit(candidate, t('复制选区'));
                              editor.setActiveRegionId(id);
                              setConstraintError(null);
                            } catch {
                              setConstraintError(
                                t(
                                  '复制将超过选区的总笔触或栅格复杂度预算。现有选区已保留；请先简化不再需要的笔触，或在新的作品版本中继续。',
                                ),
                              );
                            }
                          }}
                        >
                          <Copy size={16} />
                        </IconButton>
                        <IconButton
                          label={t('选区向前一层')}
                          disabled={v2!.regions[0]?.id === region.id}
                          onClick={() => {
                            const next = [...v2!.regions];
                            const i = next.findIndex((r) => r.id === region.id);
                            [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                            editor.commit({ ...v2!, regions: next }, t('调整选区顺序'));
                          }}
                        >
                          <ArrowUp size={16} />
                        </IconButton>
                        <IconButton
                          label={t('选区向后一层')}
                          disabled={v2!.regions.at(-1)?.id === region.id}
                          onClick={() => {
                            const next = [...v2!.regions];
                            const i = next.findIndex((r) => r.id === region.id);
                            [next[i + 1], next[i]] = [next[i]!, next[i + 1]!];
                            editor.commit({ ...v2!, regions: next }, t('调整选区顺序'));
                          }}
                        >
                          <ArrowDown size={16} />
                        </IconButton>
                        <IconButton
                          label={t('删除当前选区，可撤销')}
                          onClick={() => {
                            editor.commit(
                              { ...v2!, regions: v2!.regions.filter((r) => r.id !== region.id) },
                              t('删除选区'),
                            );
                            editor.setActiveRegionId(
                              v2!.regions.find((r) => r.id !== region.id)?.id ?? null,
                            );
                          }}
                        >
                          <Trash size={16} />
                        </IconButton>
                      </div>
                    )}
                    {region && (
                      <PrecisionRange
                        label={t('选区作用强度')}
                        value={region.opacity * 100}
                        min={0}
                        max={100}
                        step={0.1}
                        unit="%"
                        onChange={(value) =>
                          patchRegion({ opacity: value / 100 }, t('调整选区强度'), false)
                        }
                        onCommit={() => editor.commitCurrent(t('调整选区强度'))}
                        onCancel={cancel}
                      />
                    )}
                    <div className="selection-toggles">
                      <label>
                        <input
                          type="checkbox"
                          checked={editor.maskOverlay}
                          onChange={(event) => editor.setMaskOverlay(event.target.checked)}
                        />
                        {studioText('pinMask')}
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={mask.invert}
                          onChange={(event) =>
                            changeMask({ ...mask, invert: event.target.checked }, true)
                          }
                        />
                        {t('反选')}
                      </label>
                    </div>
                    {mask.type === 'color-range' && (
                      <div className="continuous-selection">
                        <div className="selection-footer">
                          <button className="text-button" onClick={onSample}>
                            {sampling ? t('取消原图取色') : t('从原图选色')}
                          </button>
                          <button
                            className="text-button"
                            onClick={() => changeMask({ ...mask, hue: referenceHue() }, true)}
                          >
                            <i className="palette-chip" style={{ background: pickedColor }} />
                            {t('应用所选色相')}
                          </button>
                        </div>
                        {maskSlider(
                          t('目标色相'),
                          mask.hue,
                          0,
                          360,
                          (n) => ({ ...mask, hue: n }),
                          0.1,
                          '°',
                        )}
                        {maskSlider(
                          t('色相半宽'),
                          mask.hueWidth,
                          0,
                          180,
                          (n) => ({ ...mask, hueWidth: n }),
                          0.1,
                          '°',
                        )}
                        {maskSlider(
                          t('色彩过渡'),
                          mask.feather * 100,
                          0,
                          100,
                          (n) => ({ ...mask, feather: n / 100 }),
                          0.1,
                        )}
                        <p className="inspector-note">
                          {t(
                            '从完整色相环连续选色；使用未调整原图确定范围，不随调色结果漂移。可在精确范围中继续限制饱和与亮度。',
                          )}
                        </p>
                      </div>
                    )}
                    {mask.type === 'brush' && (
                      <div className="brush-settings">
                        <div className="editor-subtabs">
                          <button
                            aria-pressed={editor.brushSettings.mode === 'add'}
                            onClick={() =>
                              editor.setBrushSettings({ ...editor.brushSettings, mode: 'add' })
                            }
                          >
                            {t('涂抹添加')}
                          </button>
                          <button
                            aria-pressed={editor.brushSettings.mode === 'subtract'}
                            onClick={() =>
                              editor.setBrushSettings({ ...editor.brushSettings, mode: 'subtract' })
                            }
                          >
                            {t('擦除选区')}
                          </button>
                        </div>
                        <PrecisionRange
                          label={t('笔刷半径')}
                          value={editor.brushSettings.radius * Math.min(dims.width, dims.height)}
                          min={0.5}
                          max={0.5 * Math.min(dims.width, dims.height)}
                          step={0.5}
                          unit="px"
                          onChange={(n) =>
                            editor.setBrushSettings({
                              ...editor.brushSettings,
                              radius: n / Math.min(dims.width, dims.height),
                            })
                          }
                        />
                        <PrecisionRange
                          label={t('笔刷羽化')}
                          value={editor.brushSettings.feather * 100}
                          min={0}
                          max={100}
                          step={0.1}
                          unit="%"
                          onChange={(n) =>
                            editor.setBrushSettings({ ...editor.brushSettings, feather: n / 100 })
                          }
                        />
                        <PrecisionRange
                          label={t('笔刷流量')}
                          value={editor.brushSettings.opacity * 100}
                          min={1}
                          max={100}
                          step={0.1}
                          unit="%"
                          onChange={(n) =>
                            editor.setBrushSettings({ ...editor.brushSettings, opacity: n / 100 })
                          }
                        />
                        <div className="selection-footer">
                          <small>
                            {mask.strokes.length} {t('/ 16 笔')}
                          </small>
                          <button
                            className="text-button"
                            disabled={!mask.strokes.length}
                            onClick={() => changeMask({ ...mask, strokes: [] }, true)}
                          >
                            {t('清空笔触')}
                          </button>
                        </div>
                      </div>
                    )}
                    <Section
                      title={t('精确选区范围')}
                      suffix={
                        mask.type === 'radial'
                          ? t('拖动中心与边缘')
                          : mask.type === 'linear'
                            ? t('拖动渐变端点')
                            : mask.type === 'polygon'
                              ? t('拖动轮廓点')
                              : t('源图坐标')
                      }
                    >
                      {mask.type === 'radial' && (
                        <>
                          {(['centerX', 'centerY', 'radiusX', 'radiusY', 'feather'] as const).map(
                            (key, index) =>
                              maskSlider(
                                [
                                  t('中心 X'),
                                  t('中心 Y'),
                                  t('横向半径'),
                                  t('纵向半径'),
                                  t('边缘羽化'),
                                ][index]!,
                                mask[key] * 100,
                                key.startsWith('radius') ? 0.01 : 0,
                                100,
                                (n) => ({ ...mask, [key]: n / 100 }),
                                0.01,
                              ),
                          )}
                        </>
                      )}
                      {mask.type === 'linear' && (
                        <>
                          {(['start', 'end'] as const).flatMap((key, index) =>
                            (['x', 'y'] as const).map((axis) =>
                              maskSlider(
                                t('{v0} {v1}', {
                                  v0: index ? t('终点') : t('起点'),
                                  v1: axis.toUpperCase(),
                                }),
                                mask[key][axis] * 100,
                                0,
                                100,
                                (n) => {
                                  const next = {
                                    ...mask,
                                    [key]: { ...mask[key], [axis]: n / 100 },
                                  };
                                  return Math.hypot(
                                    next.start.x - next.end.x,
                                    next.start.y - next.end.y,
                                  ) < 0.0001
                                    ? mask
                                    : next;
                                },
                                0.01,
                              ),
                            ),
                          )}
                          <label className="switch-row">
                            <span>{t('平滑渐变')}</span>
                            <input
                              type="checkbox"
                              checked={mask.smooth}
                              onChange={(event) =>
                                changeMask({ ...mask, smooth: event.target.checked }, true)
                              }
                            />
                          </label>
                        </>
                      )}
                      {mask.type === 'polygon' && (
                        <>
                          <label className="inline-select">
                            {t('轮廓控制点')}
                            <ChoiceSelect
                              ariaLabel={t('多边形控制点')}
                              size="compact"
                              value={String(Math.min(polygonPoint, mask.points.length - 1))}
                              onValueChange={(value) => setPolygonPoint(Number(value))}
                              options={mask.points.map((_, index) => ({
                                value: String(index),
                                label: t('点 {v0}', { v0: index + 1 }),
                              }))}
                            />
                          </label>
                          {(['x', 'y'] as const).map((axis) =>
                            maskSlider(
                              t('控制点 {v0}', { v0: axis.toUpperCase() }),
                              mask.points[Math.min(polygonPoint, mask.points.length - 1)]![axis] *
                                100,
                              0,
                              100,
                              (n) => ({
                                ...mask,
                                points: mask.points.map((point, index) =>
                                  index === Math.min(polygonPoint, mask.points.length - 1)
                                    ? { ...point, [axis]: n / 100 }
                                    : point,
                                ),
                              }),
                              0.01,
                            ),
                          )}
                          {maskSlider(
                            t('轮廓羽化'),
                            mask.feather * 100,
                            0,
                            50,
                            (n) => ({ ...mask, feather: n / 100 }),
                            0.01,
                          )}
                          <button
                            className="text-button"
                            disabled={mask.points.length <= 3}
                            onClick={() => {
                              changeMask(
                                {
                                  ...mask,
                                  points: mask.points.filter(
                                    (_, index) =>
                                      index !== Math.min(polygonPoint, mask.points.length - 1),
                                  ),
                                },
                                true,
                              );
                              setPolygonPoint(0);
                            }}
                          >
                            {t('移除当前控制点')}
                          </button>
                          <p className="inspector-note">
                            {t('拖动轮廓点改变形状；双击画面在最近边上添加点。')}
                          </p>
                        </>
                      )}
                      {mask.type === 'brush' && (
                        <p className="inspector-note">
                          {t(
                            '直接在画面涂抹；一次笔触是一条可撤销操作。按住空格可暂时平移画面。画笔只改变选区，不直接涂写图片。',
                          )}
                        </p>
                      )}
                      {mask.type === 'raster' && (
                        <p className="inspector-note">
                          {t('已导入')}
                          {mask.width}×{mask.height}{' '}
                          {t('的固定栅格蒙版，可调强度或反选；当前界面不重写栅格数据。')}
                        </p>
                      )}
                      {mask.type === 'color-range' && (
                        <>
                          {maskSlider(
                            t('最低饱和'),
                            mask.saturationMin * 100,
                            0,
                            mask.saturationMax * 100,
                            (n) => ({ ...mask, saturationMin: n / 100 }),
                            0.1,
                          )}
                          {maskSlider(
                            t('最高饱和'),
                            mask.saturationMax * 100,
                            mask.saturationMin * 100,
                            100,
                            (n) => ({ ...mask, saturationMax: n / 100 }),
                            0.1,
                          )}
                          {maskSlider(
                            t('最低亮度'),
                            mask.luminanceMin * 100,
                            0,
                            mask.luminanceMax * 100,
                            (n) => ({ ...mask, luminanceMin: n / 100 }),
                            0.1,
                          )}
                          {maskSlider(
                            t('最高亮度'),
                            mask.luminanceMax * 100,
                            mask.luminanceMin * 100,
                            100,
                            (n) => ({ ...mask, luminanceMax: n / 100 }),
                            0.1,
                          )}
                        </>
                      )}
                    </Section>
                    {group === 'beauty' ? (
                      <>
                        <div className="editor-subtabs" aria-label={t('人像精修组')}>
                          {(
                            [
                              ['skin', t('肤质')],
                              ['light', t('光影')],
                              ['color', t('肤色')],
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              aria-pressed={portraitSub === id}
                              onClick={() => setPortraitSub(id)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="control-stack" key={portraitSub}>
                          {sliders(
                            portraitSub === 'skin'
                              ? ['soften', 'sharpness']
                              : groupIds[portraitSub],
                            true,
                          )}
                        </div>
                        <p className="inspector-note">
                          {t(
                            '柔化减弱局部纹理，锐化加强细节；两者独立可逆。肤色工具是选区内的相对色彩调整，不预设一种理想肤色。',
                          )}
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="editor-subtabs" aria-label={t('局部调节组')}>
                          {(
                            [
                              ['light', t('明暗')],
                              ['color', t('色彩')],
                              ['detail', t('细节')],
                            ] as const
                          ).map(([id, label]) => (
                            <button
                              key={id}
                              aria-pressed={localSub === id}
                              onClick={() => setLocalSub(id)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="control-stack" key={localSub}>
                          {sliders(groupIds[localSub], true)}
                        </div>
                      </>
                    )}
                    <Section title={t('选区名称')}>
                      {region && (
                        <label className="inline-select">
                          {t('便于区分人物或部位')}
                          <input
                            aria-label={t('当前选区名称')}
                            defaultValue={region.name}
                            key={region.id + ':name'}
                            maxLength={60}
                            onBlur={(event) => {
                              const name = event.target.value.trim();
                              if (name && name !== region.name)
                                patchRegion({ name }, t('重命名选区'));
                            }}
                          />
                        </label>
                      )}
                    </Section>
                    <button
                      className="text-button"
                      onClick={() => {
                        if (region)
                          patchRegion({ adjustments: neutralAdjustments() }, t('重置选区调整'));
                        else
                          editor.commit(
                            {
                              ...recipe,
                              local: { ...recipe.local, adjustments: neutralAdjustments() },
                            },
                            t('重置径向调整'),
                          );
                      }}
                    >
                      <ArrowCounterClockwise size={14} />
                      {t('重置当前选区调整')}
                    </button>
                  </>
                )}
              </div>
            )}
            {group === 'history' && (
              <>
                <p className="inspector-note">
                  {t('按步骤回看；恢复历史只影响本地草稿，不删除云端版本。')}
                </p>
                <div className="history-actions">
                  <button
                    className="button button-secondary"
                    disabled={!editor.canUndo}
                    onClick={editor.undo}
                  >
                    <ArrowCounterClockwise size={16} />
                    {t('撤销')}
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={!editor.canRedo}
                    onClick={editor.redo}
                  >
                    <ArrowClockwise size={16} />
                    {t('重做')}
                  </button>
                </div>
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
                        {t(item.label)}
                        <small>
                          {index === editor.historyIndex
                            ? t('当前状态')
                            : index > editor.historyIndex
                              ? t('已撤销')
                              : t('已记录')}
                        </small>
                      </div>
                    </li>
                  ))}
                </ol>
                <button className="text-button" onClick={editor.exportRecipe}>
                  {t('下载可恢复的编辑配方')}
                </button>
                <button className="text-button" onClick={editor.reset}>
                  {t('恢复原图 · 可撤销')}
                </button>
              </>
            )}
            {['light', 'color'].includes(group) && (group !== 'color' || colorTab === 'global') && (
              <button
                className="text-button reset-group"
                onClick={() => {
                  const adjustments = { ...recipe.adjustments };
                  for (const key of groupIds[group as 'light' | 'color'])
                    adjustments[key as keyof Adjustments] = 0;
                  editor.commit(
                    { ...recipe, adjustments },
                    t('重置{v0}', { v0: t(current.label) }),
                  );
                }}
              >
                <ArrowCounterClockwise size={14} />
                {t('重置这组调整')}
              </button>
            )}
            {['light', 'color', 'detail'].includes(group) && (
              <p className="precision-help">
                {t('拖动调节 · 点数值精确输入 · 双击滑条复位')}
                <br />
                {t('方向键微调，Alt 更细，Shift 加快')}
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
