import { t } from '../i18n';
import { useState, type CSSProperties } from 'react';
import { MotionDetails } from '../motion/Presence';
import {
  HSL_BANDS,
  createAdjustmentRegionV3,
  MAX_V3_REGION_EDITS,
  type EditorRecipe,
} from '@ai-xiutu/editor';
import { ColorPicker } from '../components/ColorPicker';
import { rgba, hsv } from '../components/color-model';
import { secureUuid } from '../lib/uuid';
import { CurveEditor } from './CurveEditor';
import { Histogram } from './Histogram';
import { ParameterShelf } from './ParameterShelf';
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

export function ColorControls({
  controller,
  scope,
  family,
  pickedColor,
  onColorChange,
  onSample,
  sampling,
  onScope,
}: {
  controller: InspectorController;
  scope: EditScope;
  family: 'light' | 'color' | 'curves' | 'detail';
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
  const definitions = NUMERIC_CONTROLS.filter((tool) => {
    if (family === 'light')
      return lightTab === 'levels'
        ? tool.path.startsWith('levels.')
        : lightIds.some((id) => tool.path === 'adjustments.' + id);
    if (family === 'color') {
      if (colorTab === 'hsl') return tool.path.startsWith('hsl.' + band + '.');
      if (colorTab === 'grading')
        return tool.path.startsWith('grading.' + zone + '.') || tool.path === 'grading.balance';
      return colorIds.some((id) => tool.path === 'adjustments.' + id);
    }
    if (family === 'detail') {
      if (detailTab === 'detail')
        return [
          'adjustments.sharpness',
          'adjustments.soften',
          'detail.texture',
          'detail.clarity',
        ].includes(tool.path);
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
        name: '连续颜色范围 ' + (latest.regionEdits.length + 1),
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
  return (
    <section className="color-controls-v3" data-motion="color-family">
      {family !== 'detail' && (
        <MotionDetails className="advanced-disclosure histogram-disclosure">
          <summary>{t('查看明度与 RGB 分布')}</summary>
          <Histogram image={editor.rendered} />
        </MotionDetails>
      )}
      {family === 'light' && (
        <div className="tonal-tabs" aria-label={t('明暗类别')}>
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
          <div className="tonal-tabs" aria-label={t('色彩类别')}>
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
          </div>
          {colorTab === 'hsl' && (
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
              <p className="control-note">
                {t(
                  '这些是重叠混合的色段快捷入口；更细颜色可用连续色相与容差选区，不限于八种颜色。',
                )}
              </p>
            </>
          )}
          {colorTab === 'grading' && (
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
              <p className="control-note">
                {t(
                  '色谱提供 RGBA、HSV、HSL 与透明度；选区使用连续色相、容差、饱和度和明度范围。绘制与美妆可使用任意所选颜色。',
                )}
              </p>
            </>
          )}
        </>
      )}
      {family === 'detail' && (
        <div className="tonal-tabs" aria-label={t('细节类别')}>
          {(
            [
              ['detail', t('清晰与肌理')],
              ['optics', t('降噪与色散')],
              ['vignette', t('明暗角')],
              ['grain', t('颗粒')],
              ['effects', t('黑白与褪色')],
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
          scope={{
            key: scopeKey(scope),
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
            onCommit={(label) => editor.commitCurrent(t('调整{v0}', { v0: t(label) }))}
            onCancel={editor.cancelPreview}
          />
        )
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
