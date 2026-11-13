import { useEffect } from 'react';
import { t } from '../i18n';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { MotionDetails } from '../motion/Presence';
import {
  HSL_BANDS,
  createAdjustmentRegionV3,
  MAX_V3_REGION_EDITS,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import { ColorPicker } from '../components/ColorPicker';
import { ChoiceSelect, type ChoiceOption } from '../components/ChoiceSelect';
import { rgba, hsv } from '../components/color-model';
import { secureUuid } from '../lib/uuid';
import { CurveEditor } from './CurveEditor';
import { Histogram } from './Histogram';
import { ParameterShelf } from './ParameterShelf';
import { editorFlowText } from './flow-copy';
import {
  NUMERIC_CONTROLS,
  scopeColor,
  withScopeColor,
  currentV3,
  numericAt,
  withNumeric,
  scopeKey,
  newMask,
  type EditScope,
  type InspectorController,
} from './advanced-model';

export type AdjustmentFamily = 'light' | 'color' | 'curves' | 'detail';

export function ColorControls({
  controller,
  target,
  scope,
  family,
  pickedColor,
  onColorChange,
  onSample,
  sampling,
  onScope,
  compact = false,
  canvasOverlay,
  resetScope,
}: {
  controller: InspectorController;
  target?: string;
  scope: EditScope;
  family: AdjustmentFamily;
  compact?: boolean;
  canvasOverlay?: HTMLElement | null;
  resetScope?: ReactNode;
  pickedColor: string;
  onColorChange?: (value: string) => void;
  onSample?: () => void;
  sampling?: boolean;
  onScope?: (scope: EditScope) => void;
}) {
  const { editor, apply, report } = controller,
    recipe = currentV3(editor),
    color = scopeColor(recipe, scope);
  const [lightTab, setLightTab] = useState<'light' | 'levels'>('light');
  const [colorTab, setColorTab] = useState<'global' | 'hsl' | 'grading' | 'palette'>('global');
  const [detailTab, setDetailTab] = useState<
    'detail' | 'optics' | 'vignette' | 'grain' | 'effects'
  >('detail');
  const [band, setBand] = useState('red'),
    [zone, setZone] = useState('midtones');
  useEffect(() => {
    if (!target) return;
    const [kind, variant] = target.split('.');
    if (family === 'light') setLightTab(kind === 'levels' ? 'levels' : 'light');
    if (family === 'color') {
      if (kind === 'hsl') setBand(variant ?? 'red');
      if (kind === 'grading' && variant !== 'balance') setZone(variant ?? 'midtones');
      setColorTab(kind === 'hsl' || kind === 'grading' ? kind : 'global');
    }
    if (family === 'detail')
      setDetailTab(kind === 'optics' ? 'optics' : kind === 'effects'
        ? variant === 'vignette' || variant === 'grain' ? variant : 'effects'
        : 'detail');
  }, [family, target]);
  const lightIds = [
    'exposure',
    'brightness',
    'contrast',
    'highlights',
    'shadows',
    'whites',
    'blacks',
  ];
  const colorIds = ['temperature', 'tint', 'saturation', 'vibrance'];
  const quickDetailPaths = [
    'adjustments.sharpness',
    'adjustments.soften',
    'detail.texture',
    'detail.clarity',
  ];
  const tonePaths = lightIds.map((id) => 'adjustments.' + id);
  const colorPaths = colorIds.map((id) => 'adjustments.' + id);
  const definitions = NUMERIC_CONTROLS.filter((tool) => {
    if (family === 'light')
      return lightTab === 'levels'
        ? tool.path.startsWith('levels.')
        : tonePaths.includes(tool.path);
    if (family === 'color') {
      if (colorTab === 'hsl') return tool.path.startsWith('hsl.' + band + '.');
      if (colorTab === 'grading')
        return tool.path.startsWith('grading.' + zone + '.') || tool.path === 'grading.balance';
      return colorPaths.includes(tool.path);
    }
    if (family === 'detail') {
      if (detailTab === 'detail') return quickDetailPaths.includes(tool.path);
      if (detailTab === 'optics') return tool.path.startsWith('optics.');
      if (detailTab === 'vignette') return tool.path.startsWith('effects.vignette.');
      if (detailTab === 'grain') return tool.path.startsWith('effects.grain.');
      return ['effects.monochrome', 'effects.fade'].includes(tool.path);
    }
    return false;
  });
  const controls = definitions.map((definition) => ({
    id: definition.path,
    ...definition,
    value: numericAt(color, definition.path),
    integer: definition.unit === 'seed',
    gradient:
      definition.path === 'adjustments.temperature'
        ? 'linear-gradient(90deg,#85b8f4,#e3e3db,#f0be67)'
        : definition.path === 'adjustments.tint'
          ? 'linear-gradient(90deg,#6ccb9a,#e3e3db,#d995d2)'
          : definition.path.endsWith('.hue')
            ? 'linear-gradient(90deg,#e35c5c,#e0bd61,#78b87d,#66bac4,#8594d1,#c680b9,#e35c5c)'
            : undefined,
    onChange: (value: number) => {
      try {
        const latest = currentV3(editor);
        apply(
          withScopeColor(latest, scope, withNumeric(scopeColor(latest, scope), definition, value)),
          t('调整{v0}', { v0: t(definition.label) }),
        );
      } catch (error) {
        report(error instanceof Error ? error.message : '参数组合暂时无效。');
      }
    },
    onReset: () => {
      const latest = currentV3(editor);
      apply(
        withScopeColor(
          latest,
          scope,
          withNumeric(scopeColor(latest, scope), definition, definition.neutral),
        ),
        '重置' + definition.label,
        true,
      );
    },
  }));
  function continuousRegion() {
    const latest = currentV3(editor),
      mask = newMask('color-range'),
      region = createAdjustmentRegionV3({
        id: secureUuid(),
        name: t('连续颜色范围 ') + (latest.regionEdits.length + 1),
        mask: mask.type === 'color-range' ? { ...mask, hue: hsv(rgba(pickedColor)).h } : mask,
      });
    if (
      apply({ ...latest, regionEdits: [...latest.regionEdits, region] }, '建立连续颜色范围', true)
    ) {
      editor.setActiveRegionId(region.id);
      editor.setActiveMaskPath([]);
      onScope?.({ kind: 'region', id: region.id });
    }
  }
  function categoryPicker<T extends string>(
    label: string,
    selected: T,
    options: readonly ChoiceOption<T>[],
    select: (value: T) => void,
  ) {
    return compact && (
      <ChoiceSelect
        size="compact"
        className="mobile-adjustment-choice"
        ariaLabel={t(label)}
        displayLabel={t('更多')}
        value={selected}
        options={options}
        onValueChange={select}
      />
    );
  }
  const compactCategory =
    family === 'light'
      ? categoryPicker(
          '明暗类别',
          lightTab,
          [
            { value: 'light', label: t('影调') },
            { value: 'levels', label: t('精确色阶') },
          ],
          (value) => {
            editor.commitCurrent(t('完成当前调整'));
            setLightTab(value);
          },
        )
      : family === 'color'
        ? categoryPicker(
            '色彩类别',
            colorTab,
            [
              { value: 'global', label: t('整体') },
              { value: 'hsl', label: 'HSL' },
              { value: 'grading', label: t('分级') },
              { value: 'palette', label: t('完整色谱') },
            ],
            (value) => {
              editor.commitCurrent(t('完成当前色彩'));
              setColorTab(value);
            },
          )
        : family === 'detail'
          ? categoryPicker(
              '细节类别',
              detailTab,
              [
                { value: 'detail', label: t('质感') },
                { value: 'optics', label: t('光学') },
                { value: 'vignette', label: t('暗角') },
                { value: 'grain', label: t('颗粒') },
                { value: 'effects', label: t('风格') },
              ],
              (value) => {
                editor.commitCurrent(t('完成当前细节'));
                setDetailTab(value);
              },
            )
          : null;
  const compactColorScope = compact && family === 'color' && (
    colorTab === 'hsl' ? (
      <ChoiceSelect
        size="compact"
        className="mobile-adjustment-choice"
        ariaLabel={t('HSL 色段')}
        value={band}
        options={HSL_BANDS.map((item) => ({ value: item.id, label: t(item.label) }))}
        renderOptionLabel={(option) => {
          const hue = HSL_BANDS.find((item) => item.id === option.value)?.center ?? 0;
          return <span className="compact-hsl-band"><i style={{ backgroundColor: `hsl(${hue} 65% 48%)` }} />{option.label}</span>;
        }}
        onValueChange={(value) => {
          editor.commitCurrent(t('完成当前色段'));
          setBand(value);
        }}
      />
    ) : colorTab === 'grading' ? (
      <ChoiceSelect
        size="compact"
        className="mobile-adjustment-choice"
        ariaLabel={t('分级区域')}
        value={zone}
        options={[
          { value: 'shadows', label: t('阴影') },
          { value: 'midtones', label: t('中间调') },
          { value: 'highlights', label: t('高光') },
        ]}
        onValueChange={(value) => {
          editor.commitCurrent(t('完成当前分级'));
          setZone(value);
        }}
      />
    ) : null
  );
  const hasShelf = family !== 'curves' && !(family === 'color' && colorTab === 'palette');
  const histogram = family !== 'detail' && (!compact || family === 'curves' || lightTab === 'levels') && (
    <MotionDetails className="advanced-disclosure histogram-disclosure">
      <summary aria-label={t('查看明度与 RGB 分布')}>{t('直方图')}</summary>
      <Histogram image={editor.rendered} />
    </MotionDetails>
  );
  return (
    <section
      className="color-controls-v3"
      data-motion="color-family"
      data-primary-controls={hasShelf || undefined}
    >
      {compact && !hasShelf && family !== 'curves' && (
        <div className="mobile-adjustment-tools">{compactCategory}{resetScope}</div>
      )}
      {!compact && histogram}
      {family === 'light' && !compact && (
        <div className="tonal-tabs color-family-tabs" aria-label={t('明暗类别')}>
          {(
            [
              ['light', t('影调')],
              ['levels', t('精确色阶')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={lightTab === id}
              onClick={() => {
                editor.commitCurrent(t('完成当前调整'));
                setLightTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {family === 'color' && (
        <>
          {!compact && <div className="tonal-tabs color-family-tabs" aria-label={t('色彩类别')}>
            {(
              [
                ['global', t('整体')],
                ['hsl', 'HSL'],
                ['grading', t('分级')],
                ['palette', t('完整色谱')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={colorTab === id}
                onClick={() => {
                  editor.commitCurrent(t('完成当前色彩'));
                  setColorTab(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>}
          {colorTab === 'hsl' && !compact && (
            <>
              <div className="hsl-range-chips" aria-label={t('HSL 色段')}>
                {HSL_BANDS.map((item) => (
                  <button
                    key={item.id}
                    aria-label={t('{name}色段', { name: t(item.label) })}
                    aria-pressed={band === item.id}
                    style={{ '--hue': item.center } as CSSProperties}
                    onClick={() => {
                      editor.commitCurrent(t('完成当前色段'));
                      setBand(item.id);
                    }}
                  >
                    <i />
                    <span>{t(item.label)}</span>
                  </button>
                ))}
              </div>
              <MotionDetails className="advanced-disclosure control-context-help">
                <summary>{editorFlowText('colorRangeHelp')}</summary>
                <p className="control-note">
                  {t(
                    '这些是重叠混合的色段快捷入口；更细颜色可用连续色相与容差选区，不限于八种颜色。',
                  )}
                </p>
              </MotionDetails>
            </>
          )}
          {colorTab === 'grading' && !compact && (
            <div className="tonal-tabs" aria-label={t('分级区域')}>
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
                  onClick={() => {
                    editor.commitCurrent(t('完成当前分级'));
                    setZone(id);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {colorTab === 'palette' && (
            <>
              <ColorPicker
                value={pickedColor}
                label={t('完整连续色谱')}
                onChange={(value) => onColorChange?.(value)}
              />
              <button className="text-button" onClick={onSample}>
                {sampling ? t('结束原图取色') : t('在原图取色')}
              </button>
              <button
                className="text-button"
                disabled={recipe.regionEdits.length >= MAX_V3_REGION_EDITS}
                onClick={continuousRegion}
              >
                {t('建立连续颜色范围')}
              </button>
              <MotionDetails className="advanced-disclosure control-context-help">
                <summary>{editorFlowText('paletteHelp')}</summary>
                <p className="control-note">
                  {t(
                    '色谱提供 RGBA、HSV、HSL 与透明度；选区使用连续色相、容差、饱和度和明度范围。绘制与美妆可使用任意所选颜色。',
                  )}
                </p>
              </MotionDetails>
            </>
          )}
        </>
      )}
      {family === 'detail' && !compact && (
        <div className="tonal-tabs color-family-tabs" aria-label={t('细节类别')}>
          {(
            [
              ['detail', t('质感')],
              ['optics', t('光学')],
              ['vignette', t('暗角')],
              ['grain', t('颗粒')],
              ['effects', t('风格')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={detailTab === id}
              onClick={() => {
                editor.commitCurrent(t('完成当前细节'));
                setDetailTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {family === 'curves' ? (
        <CurveEditor
          editor={editor}
          compact={compact}
          canvasOverlay={canvasOverlay}
          scope={{
            key: scopeKey(scope),
            label:
              !('id' in scope)
                ? t(scope.kind === 'base' ? '底图' : '整张照片')
                : ((scope.kind === 'region' ? recipe.regionEdits : recipe.regionGroups).find(
                    (entry) => entry.id === scope.id,
                  )?.name ?? t('局部')),
            getCurves: (current) =>
              current.schemaVersion === 3 || current.schemaVersion === 4
                ? scopeColor(current, scope).curves
                : current.curves,
            replaceCurves: (current: EditorRecipe, curves) =>
              current.schemaVersion === 3 || current.schemaVersion === 4
                ? withScopeColor(current, scope, { ...scopeColor(current, scope), curves })
                : { ...current, curves },
          }}
        />
      ) : (
        !(family === 'color' && colorTab === 'palette') && (
          <ParameterShelf
            key={
              scopeKey(scope) +
              ':' +
              family +
              ':' +
              lightTab +
              ':' +
              colorTab +
              ':' +
              band +
              ':' +
              zone +
              ':' +
              detailTab
            }
            label={t('图像参数')}
            controls={controls}
            target={target?.startsWith('adjustments.') ? target.slice('adjustments.'.length) : target}
            headingAccessory={compact && <>{compactColorScope}{compactCategory}</>}
            trailingAction={resetScope}
            onCommit={(label) => editor.commitCurrent(t('调整{v0}', { v0: t(label) }))}
            onCancel={editor.cancelPreview}
          />
        )
      )}
      {compact && histogram && (
        <div className="mobile-adjustment-tools compact-analysis-tools">
          {histogram}
          {family === 'curves' && resetScope}
        </div>
      )}
      {family === 'detail' && detailTab === 'grain' && (
        <div className="advanced-row">
          <label className="compact-check">
            <input
              type="checkbox"
              checked={color.effects.grain.colored}
              onChange={(event) => {
                const current = currentV3(editor),
                  c = scopeColor(current, scope);
                apply(
                  withScopeColor(current, scope, {
                    ...c,
                    effects: {
                      ...c.effects,
                      grain: { ...c.effects.grain, colored: event.target.checked },
                    },
                  }),
                  t('切换颗粒色彩'),
                  true,
                );
              }}
            />
            {t('彩色颗粒')}
          </label>
          <button
            className="text-button"
            onClick={() => {
              const current = currentV3(editor),
                c = scopeColor(current, scope);
              apply(
                withScopeColor(current, scope, {
                  ...c,
                  effects: {
                    ...c.effects,
                    grain: {
                      ...c.effects.grain,
                      seed: crypto.getRandomValues(new Uint32Array(1))[0]!,
                    },
                  },
                }),
                t('更换颗粒分布'),
                true,
              );
            }}
          >
            {t('换一种颗粒分布')}
          </button>
        </div>
      )}
    </section>
  );
}
