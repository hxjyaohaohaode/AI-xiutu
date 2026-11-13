import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from '../components/ChoiceSelect';
import {
  migrateRecipeToV4,
  type HealingOperationV4,
  type RetouchRegionV4,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
import { secureUuid } from '../lib/uuid';
import { ParameterShelf, type ShelfControl } from './ParameterShelf';
import { MaskControls } from './MaskControls';
import { currentV3, newMask, type InspectorController } from './advanced-model';
import { appendRepairRegion } from './repair-draft';
import { PaintBrush, Plus } from '@phosphor-icons/react';

export function RepairControls({ controller }: { controller: InspectorController }) {
  const { editor, apply, report } = controller,
    recipe = currentV3(editor);
  if (recipe.schemaVersion !== 4)
    return (
      <section className="advanced-tool-family">
        <p className="control-note">{t('局部纹理修复使用第四代配方，升级保留原有调整语义。')}</p>
        <button
          className="button button-secondary"
          onClick={() => apply(migrateRecipeToV4(recipe), t('启用局部修复配方'), true)}
        >
          {t('启用局部修复')}
        </button>
      </section>
    );
  const mode = editor.repairMode,
    item = recipe[mode].find((op) => op.id === editor.activeRepairId),
    short = Math.min(editor.dimensions?.width ?? 1, editor.dimensions?.height ?? 1);
  function patch(
    patch: Partial<HealingOperationV4 & RetouchRegionV4>,
    label: string,
    commit = false,
  ) {
    const current = currentV3(editor);
    if (current.schemaVersion !== 4 || !item) return false;
    return apply(
      {
        ...current,
        [mode]: current[mode].map((op) => (op.id === item.id ? { ...op, ...patch } : op)),
      },
      label,
      commit,
    );
  }
  function add() {
    try {
      const id = secureUuid(),
        current = currentV3(editor);
      if (current.schemaVersion !== 4) return;
      const next = appendRepairRegion(current, mode, id);
      if (apply(next, '新建' + next[mode].at(-1)!.name, true)) {
        editor.setActiveRepairId(id);
        editor.setActiveMaskPath([]);
        editor.setRepairProtection(false);
        editor.setRepairChoosingSource(false);
        editor.setBrushSettings((s) => ({ ...s, mode: 'add' }));
      }
    } catch (e) {
      report(e instanceof Error ? e.message : '无法新建修复区域。');
    }
  }
  const controls: ShelfControl[] = item
    ? [
        {
          id: 'opacity',
          label: t('整体强度'),
          value: item.opacity * 100,
          min: 0,
          max: 100,
          step: 0.1,
          unit: '%',
          onChange: (value) => patch({ opacity: value / 100 }, '调整修复强度'),
        },
      ]
    : [];
  if (item && mode === 'healing') {
    const heal = item as HealingOperationV4;
    controls.push(
      {
        id: 'searchRadius',
        label: t('周边搜索范围'),
        value: heal.searchRadius * short,
        min: Math.max(0.001 * short, 0.1),
        max: short * 2,
        step: 0.1,
        unit: 'px',
        onChange: (value) => patch({ searchRadius: value / short }, '调整搜索范围'),
      },
      {
        id: 'iterations',
        label: heal.method === 'exemplar-v1' ? '纹理搜索精度' : '边界融合迭代',
        value: heal.iterations,
        min: heal.method === 'exemplar-v1' ? 16 : 1,
        max: 512,
        step: 1,
        integer: true,
        unit: '次',
        onChange: (value) => patch({ iterations: value }, '调整融合迭代'),
      },
      {
        id: 'texture',
        label: t('保留供体纹理'),
        value: heal.texture * 100,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        onChange: (value) => patch({ texture: value / 100 }, '调整修复纹理'),
      },
    );
    if (heal.method === 'exemplar-v1')
      controls.push({
        id: 'patchRadius',
        label: t('纹理补片半径'),
        value: heal.patchRadius ?? 4,
        min: 1,
        max: 8,
        step: 1,
        integer: true,
        unit: 'px',
        onChange: (value) => patch({ patchRadius: value }, '调整纹理补片'),
      });
    if (heal.source)
      for (const axis of ['x', 'y'] as const)
        controls.push({
          id: 'donor-' + axis,
          label: t('来源 {axis}', { axis: axis.toUpperCase() }),
          value:
            heal.source[axis] *
            (axis === 'x' ? editor.dimensions!.width : editor.dimensions!.height),
          min: 0,
          max: axis === 'x' ? editor.dimensions!.width : editor.dimensions!.height,
          step: 0.1,
          unit: 'px',
          onChange: (value) =>
            patch(
              {
                source: {
                  ...heal.source!,
                  [axis]:
                    value / (axis === 'x' ? editor.dimensions!.width : editor.dimensions!.height),
                },
              },
              '微调供体坐标',
            ),
        });
  } else if (item) {
    const retouch = item as RetouchRegionV4;
    for (const [id, label] of [
      ['smoothing', t('保边柔肤')],
      ['texture', t('肌理增减')],
      ['uniformity', t('肤色均匀')],
      ['shine', t('柔化油光')],
      ['speckle', t('细小斑点')],
      ['fineLines', t('浅细纹理')],
    ] as const)
      controls.push({
        id,
        label,
        value: retouch[id],
        min: id === 'texture' ? -100 : 0,
        max: 100,
        step: 0.1,
        onChange: (value) => patch({ [id]: value }, t('调整{v0}', { v0: t(label) })),
      });
    if (retouch.algorithm === 'guided-v4')
      controls.push({
        id: 'chromaSpots',
        label: t('局部色斑'),
        value: retouch.chromaSpots ?? 0,
        min: 0,
        max: 100,
        step: 0.1,
        onChange: (value) => patch({ chromaSpots: value }, '调整局部色斑'),
      });
    controls.push({
      id: 'radius',
      label: t('处理半径'),
      value: retouch.radius * short,
      min: 0.000001 * short,
      max: 0.1 * short,
      step: 0.1,
      unit: 'px',
      onChange: (value) => patch({ radius: value / short }, '调整质感半径'),
    });
  }
  const getMask = (): SelectionMaskV3 => {
    const current = currentV3(editor);
    if (current.schemaVersion !== 4 || !item) return newMask('brush');
    const op = current[mode].find((op) => op.id === item.id);
    return (editor.repairProtection ? op?.protection : op?.mask) ?? newMask('brush');
  };
  return (
    <section className="advanced-tool-family" data-motion="repair-controls">
      <nav className="tonal-tabs" aria-label={t('修复类别')}>
        {(['healing', 'retouch'] as const).map((tab) => (
          <button
            key={tab}
            aria-pressed={mode === tab}
            onClick={() => {
              editor.commitCurrent(t('完成当前修复'));
              editor.setRepairMode(tab);
              editor.setActiveRepairId(recipe[tab][0]?.id ?? null);
              editor.setActiveMaskPath([]);
              editor.setRepairProtection(false);
              editor.setRepairChoosingSource(false);
            }}
          >
            {tab === 'healing' ? t('纹理修复') : t('局部质感')}
          </button>
        ))}
      </nav>
      <div className="advanced-row repair-area-row">
        {recipe[mode].length > 0 ? (
        <ChoiceSelect
          ariaLabel={t('修复区域')}
          size="compact"
          value={item?.id ?? ''}
          onValueChange={(value) => {
            editor.commitCurrent(t('完成当前修复'));
            editor.setActiveRepairId(value);
            editor.setActiveMaskPath([]);
          }}
          options={[
            ...(!item ? [{ value: '', label: t('在照片上涂抹') }] : []),
            ...recipe[mode].map((op) => ({ value: op.id, label: op.name })),
          ]}
        />) : <span><PaintBrush size={16} aria-hidden />{t('在照片上涂抹')}</span>}
        <button className="text-button" onClick={add}>
          <Plus size={15} aria-hidden />{t('新区域')}
        </button>
      </div>
      <ParameterShelf label={t('修复画笔')} controls={[
        { id: 'diameter', label: t('画笔直径'), glyph: 'diameter', value: editor.brushSettings.radius * short * 2,
          min: 1, max: Math.max(1, short * 0.4), step: 0.1, unit: 'px',
          onChange: (value) => editor.setBrushSettings((current) => ({ ...current, radius: value / short / 2 })) },
        { id: 'feather', label: t('柔边'), glyph: 'feather', value: editor.brushSettings.feather * 100,
          min: 0, max: 100, step: 0.1, unit: '%',
          onChange: (value) => editor.setBrushSettings((current) => ({ ...current, feather: value / 100 })) },
      ]} />
      {item && (
        <>
          <ParameterShelf
            controls={controls}
            label={mode === 'healing' ? t('局部修复参数') : t('局部质感参数')}
            onCommit={(label) => editor.commitCurrent(label)}
            onCancel={editor.cancelPreview}
          />
          {mode === 'healing' && (
            <>
              <div className="tonal-tabs" aria-label={t('修复算法')}>
                {(['exemplar-v1', 'patch-poisson', 'diffusion'] as const).map((method) => (
                  <button
                    key={method}
                    aria-pressed={(item as HealingOperationV4).method === method}
                    onClick={() => {
                      const next = recipe.healing.map((op) => {
                        if (op.id !== item.id) return op;
                        const { patchRadius, ...rest } = op;
                        return {
                          ...rest,
                          method,
                          ...(method === 'exemplar-v1'
                            ? {
                                patchRadius: patchRadius ?? 4,
                                iterations: Math.max(16, op.iterations),
                              }
                            : {}),
                        };
                      });
                      apply({ ...recipe, healing: next }, t('切换修复算法'), true);
                    }}
                  >
                    {method === 'exemplar-v1'
                      ? t('纹理重建')
                      : method === 'patch-poisson'
                        ? t('纹理融合')
                        : t('平滑填补')}
                  </button>
                ))}
              </div>
              <div className="advanced-row">
                <button
                  className="text-button"
                  aria-pressed={editor.repairChoosingSource}
                  onClick={() => editor.setRepairChoosingSource(!editor.repairChoosingSource)}
                >
                  {editor.repairChoosingSource ? t('在图上点选来源') : t('手动选择来源')}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    editor.setRepairChoosingSource(false);
                    patch({ source: null }, t('自动寻找周边纹理'), true);
                  }}
                >
                  {t('自动找周边')}
                </button>
              </div>
            </>
          )}
          {mode === 'retouch' && (
            <div className="tonal-tabs" aria-label={t('质感算法')}>
              {(['guided-v4', 'guided-v3', 'guided-v2', 'guided-v1', 'legacy'] as const).map(
                (algorithm) => (
                  <button
                    key={algorithm}
                    aria-pressed={((item as RetouchRegionV4).algorithm ?? 'legacy') === algorithm}
                    onClick={() =>
                      apply(
                        {
                          ...recipe,
                          retouch: recipe.retouch.map((op) => {
                            if (op.id !== item.id) return op;
                            const { algorithm: _old, chromaSpots, ...rest } = op;
                            return {
                              ...rest,
                              ...(algorithm !== 'legacy' ? { algorithm } : {}),
                              ...(algorithm === 'guided-v4' && chromaSpots !== undefined
                                ? { chromaSpots }
                                : {}),
                            };
                          }),
                        },
                        t('切换质感算法'),
                        true,
                      )
                    }
                  >
                    {
                      {
                        'guided-v4': t('纹理与斑点分离'),
                        'guided-v3': t('细纹与反光分离'),
                        'guided-v2': t('选区保边与双尺度纹理'),
                        'guided-v1': t('保边美肤'),
                        legacy: t('原版质感'),
                      }[algorithm]
                    }
                  </button>
                ),
              )}
            </div>
          )}
          <MotionDetails>
            <summary>{t('涂抹范围与保护')}</summary>
            <div className="tonal-tabs">
              <button
                aria-pressed={!editor.repairProtection}
                onClick={() => {
                  editor.setRepairProtection(false);
                  editor.setActiveMaskPath([]);
                }}
              >
                {t('处理范围')}
              </button>
              <button
                aria-pressed={editor.repairProtection}
                onClick={() => {
                  if (!item.protection)
                    patch({ protection: newMask('brush') }, t('新建保护范围'), true);
                  editor.setRepairProtection(true);
                  editor.setActiveMaskPath([]);
                }}
              >
                {t('保护范围')}
              </button>
            </div>
            <MaskControls
              controller={controller}
              getMask={getMask}
              path={editor.activeMaskPath}
              onPath={editor.setActiveMaskPath}
              onChange={(mask, commit) =>
                patch(
                  editor.repairProtection ? { protection: mask } : { mask },
                  t('编辑修复范围'),
                  commit,
                )
              }
            />
          </MotionDetails>
          <div className="advanced-row">
            <button
              className="text-button"
              onClick={() =>
                patch(
                  { enabled: !item.enabled },
                  item.enabled ? t('隐藏此修复') : t('显示此修复'),
                  true,
                )
              }
            >
              {item.enabled ? t('暂时隐藏') : t('显示效果')}
            </button>
            <button
              className="text-button"
              onClick={() => {
                const current = currentV3(editor);
                if (
                  current.schemaVersion === 4 &&
                  apply(
                    { ...current, [mode]: current[mode].filter((op) => op.id !== item.id) },
                    t('删除修复区域'),
                    true,
                  )
                )
                  editor.setActiveRepairId(null);
              }}
            >
              {t('删除此区域')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
