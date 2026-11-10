import {
  createHealingOperationV4,
  createRetouchRegionV4,
  migrateRecipeToV4,
  type HealingOperationV4,
  type RetouchRegionV4,
  type SelectionMaskV3,
} from '@ai-xiutu/editor';
import { secureUuid } from '../lib/uuid';
import { ParameterShelf, type ShelfControl } from './ParameterShelf';
import { MaskControls } from './MaskControls';
import { currentV3, newMask, type InspectorController } from './advanced-model';

export function RepairControls({ controller }: { controller: InspectorController }) {
  const { editor, apply, report } = controller,
    recipe = currentV3(editor);
  if (recipe.schemaVersion !== 4)
    return (
      <section className="advanced-tool-family">
        <p className="control-note">局部纹理修复使用第四代配方，升级保留原有调整语义。</p>
        <button
          className="button button-secondary"
          onClick={() => apply(migrateRecipeToV4(recipe), '启用局部修复配方', true)}
        >
          启用局部修复
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
        mask = newMask('brush'),
        current = currentV3(editor);
      if (current.schemaVersion !== 4) return;
      const op =
        mode === 'healing'
          ? createHealingOperationV4({ id, name: '纹理修复 ' + (current.healing.length + 1), mask })
          : createRetouchRegionV4({ id, name: '局部质感 ' + (current.retouch.length + 1), mask });
      if (apply({ ...current, [mode]: [...current[mode], op] }, '新建' + op.name, true)) {
        editor.setActiveRepairId(id);
        editor.setActiveMaskPath([]);
        editor.setRepairProtection(false);
        editor.setRepairChoosingSource(false);
        editor.setBrushSettings((s) => ({
          ...s,
          radius: Math.min(0.012, 12 / short),
          feather: 0.25,
          opacity: 1,
          mode: 'add',
        }));
      }
    } catch (e) {
      report(e instanceof Error ? e.message : '无法新建修复区域。');
    }
  }
  const controls: ShelfControl[] = item
    ? [
        {
          id: 'opacity',
          label: '整体强度',
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
        label: '周边搜索范围',
        value: heal.searchRadius * short,
        min: Math.max(0.001 * short, 0.1),
        max: short * 2,
        step: 0.1,
        unit: 'px',
        onChange: (value) => patch({ searchRadius: value / short }, '调整搜索范围'),
      },
      {
        id: 'iterations',
        label: '边界融合迭代',
        value: heal.iterations,
        min: 1,
        max: 512,
        step: 1,
        integer: true,
        unit: '次',
        onChange: (value) => patch({ iterations: value }, '调整融合迭代'),
      },
      {
        id: 'texture',
        label: '保留供体纹理',
        value: heal.texture * 100,
        min: 0,
        max: 100,
        step: 0.1,
        unit: '%',
        onChange: (value) => patch({ texture: value / 100 }, '调整修复纹理'),
      },
    );
    if (heal.source)
      for (const axis of ['x', 'y'] as const)
        controls.push({
          id: 'donor-' + axis,
          label: '来源 ' + axis.toUpperCase(),
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
      ['smoothing', '保边柔肤'],
      ['texture', '肌理增减'],
      ['uniformity', '肤色均匀'],
      ['shine', '柔化油光'],
      ['speckle', '细小斑点'],
      ['fineLines', '浅细纹理'],
    ] as const)
      controls.push({
        id,
        label,
        value: retouch[id],
        min: id === 'texture' ? -100 : 0,
        max: 100,
        step: 0.1,
        onChange: (value) => patch({ [id]: value }, '调整' + label),
      });
    controls.push({
      id: 'radius',
      label: '处理半径',
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
      <nav className="tonal-tabs" aria-label="修复类别">
        {(['healing', 'retouch'] as const).map((tab) => (
          <button
            key={tab}
            aria-pressed={mode === tab}
            onClick={() => {
              editor.commitCurrent('完成当前修复');
              editor.setRepairMode(tab);
              editor.setActiveRepairId(recipe[tab][0]?.id ?? null);
              editor.setActiveMaskPath([]);
              editor.setRepairProtection(false);
              editor.setRepairChoosingSource(false);
            }}
          >
            {tab === 'healing' ? '纹理修复' : '局部质感'}
          </button>
        ))}
      </nav>
      <div className="advanced-row">
        <select
          aria-label="修复区域"
          value={item?.id ?? ''}
          onChange={(event) => {
            editor.commitCurrent('完成当前修复');
            editor.setActiveRepairId(event.target.value);
            editor.setActiveMaskPath([]);
          }}
        >
          {!item && <option value="">选择或建立区域</option>}
          {recipe[mode].map((op) => (
            <option key={op.id} value={op.id}>
              {op.name}
            </option>
          ))}
        </select>
        <button className="text-button" onClick={add}>
          新区域
        </button>
      </div>
      {!item && (
        <p className="control-note">
          新建后在照片上涂出要处理的小区域。修复通过周边纹理与边界融合完成，不会生成没有来源的五官。
        </p>
      )}
      {item && (
        <>
          <ParameterShelf
            controls={controls}
            label={mode === 'healing' ? '局部修复参数' : '局部质感参数'}
            onCommit={(label) => editor.commitCurrent(label)}
            onCancel={editor.cancelPreview}
          />
          {mode === 'healing' && (
            <>
              <div className="tonal-tabs" aria-label="修复算法">
                {(['patch-poisson', 'diffusion'] as const).map((method) => (
                  <button
                    key={method}
                    aria-pressed={(item as HealingOperationV4).method === method}
                    onClick={() => patch({ method }, '切换修复算法', true)}
                  >
                    {method === 'patch-poisson' ? '纹理融合' : '平滑填补'}
                  </button>
                ))}
              </div>
              <div className="advanced-row">
                <button
                  className="text-button"
                  aria-pressed={editor.repairChoosingSource}
                  onClick={() => editor.setRepairChoosingSource(!editor.repairChoosingSource)}
                >
                  {editor.repairChoosingSource ? '在图上点选来源' : '手动选择来源'}
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    editor.setRepairChoosingSource(false);
                    patch({ source: null }, '自动寻找周边纹理', true);
                  }}
                >
                  自动找周边
                </button>
              </div>
            </>
          )}
          <details>
            <summary>涂抹范围与保护</summary>
            <div className="tonal-tabs">
              <button
                aria-pressed={!editor.repairProtection}
                onClick={() => {
                  editor.setRepairProtection(false);
                  editor.setActiveMaskPath([]);
                }}
              >
                处理范围
              </button>
              <button
                aria-pressed={editor.repairProtection}
                onClick={() => {
                  if (!item.protection)
                    patch({ protection: newMask('brush') }, '新建保护范围', true);
                  editor.setRepairProtection(true);
                  editor.setActiveMaskPath([]);
                }}
              >
                保护范围
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
                  '编辑修复范围',
                  commit,
                )
              }
            />
          </details>
          <div className="advanced-row">
            <button
              className="text-button"
              onClick={() =>
                patch({ enabled: !item.enabled }, item.enabled ? '隐藏此修复' : '显示此修复', true)
              }
            >
              {item.enabled ? '暂时隐藏' : '显示效果'}
            </button>
            <button
              className="text-button"
              onClick={() => {
                const current = currentV3(editor);
                if (
                  current.schemaVersion === 4 &&
                  apply(
                    { ...current, [mode]: current[mode].filter((op) => op.id !== item.id) },
                    '删除修复区域',
                    true,
                  )
                )
                  editor.setActiveRepairId(null);
              }}
            >
              删除此区域
            </button>
          </div>
          <p className="control-note">
            {mode === 'healing'
              ? '修复目标及周边需为不透明像素。每个目标最多 262,144 像素，含周边的工作区最多 1,048,576 像素；过大的范围或迭代会明确拒绝。建议分小区域逐笔处理。'
              : '六项质感控制使用独立的局部算法；不等同于自动识别痘痘、重建发丝或三维遮挡修复。'}
          </p>
        </>
      )}
    </section>
  );
}
