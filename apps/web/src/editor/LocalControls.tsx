import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { useState } from 'react';
import { ArrowUp, ArrowDown, Copy, Eye, EyeSlash, Plus, Trash } from '@phosphor-icons/react';
import {
  createAdjustmentRegionV3,
  createColorBlockV3,
  MAX_V3_REGION_EDITS,
  MAX_V3_REGION_GROUPS,
  type AdjustmentRegionV3,
} from '@ai-xiutu/editor';
import { secureUuid } from '../lib/uuid';
import { IconButton } from '../components/Ui';
import { ColorPicker } from '../components/ColorPicker';
import { rgba, hsv } from '../components/color-model';
import { ParameterShelf } from './ParameterShelf';
import { ColorControls } from './ColorControls';
import { MaskControls, maskLabels } from './MaskControls';
import { currentV3, newMask, type EditScope, type InspectorController } from './advanced-model';

export function LocalControls({
  controller,
  scope,
  onScope,
  pickedColor,
  onColorChange,
  onSample,
  sampling,
}: {
  controller: InspectorController;
  scope: EditScope;
  onScope: (scope: EditScope) => void;
  pickedColor: string;
  onColorChange?: (value: string) => void;
  onSample?: () => void;
  sampling?: boolean;
}) {
  const { editor, apply } = controller,
    recipe = currentV3(editor);
  const [checked, setChecked] = useState<string[]>([]);
  const selectedIds = checked.filter((id) => recipe.regionEdits.some((item) => item.id === id));
  const [family, setFamily] = useState<'light' | 'color' | 'curves' | 'detail'>('light');
  const region = recipe.regionEdits.find((item) => item.id === editor.activeRegionId);
  const group =
    scope.kind === 'group' ? recipe.regionGroups.find((item) => item.id === scope.id) : null;
  function select(id: string) {
    editor.setActiveRegionId(id);
    editor.setActiveMaskPath([]);
    onScope({ kind: 'region', id });
  }
  function add(type: Parameters<typeof newMask>[0]) {
    const latest = currentV3(editor),
      next = createAdjustmentRegionV3({
        id: secureUuid(),
        name: maskLabels[type] + ' ' + (latest.regionEdits.length + 1),
        mask: newMask(type),
      });
    if (
      apply(
        { ...latest, regionEdits: [...latest.regionEdits, next] },
        '新建' + maskLabels[type] + '范围',
        true,
      )
    )
      select(next.id);
  }
  function patch(patch: Partial<AdjustmentRegionV3>, label: string, commit = true) {
    if (!region) return false;
    const latest = currentV3(editor);
    return apply(
      {
        ...latest,
        regionEdits: latest.regionEdits.map((item) =>
          item.id === region.id ? { ...item, ...patch } : item,
        ),
      },
      label,
      commit,
    );
  }
  function shift(direction: number) {
    if (!region) return;
    const latest = currentV3(editor),
      items = [...latest.regionEdits],
      index = items.findIndex((r) => r.id === region.id),
      destination = index + direction;
    if (destination < 0 || destination >= items.length) return;
    [items[index], items[destination]] = [items[destination]!, items[index]!];
    apply({ ...latest, regionEdits: items }, '调整局部叠加顺序', true);
  }
  function makeGroup() {
    const latest = currentV3(editor),
      selected = checked.filter((id) => latest.regionEdits.some((r) => r.id === id));
    if (!selected.length) return;
    const next = {
      id: secureUuid(),
      name: '范围分组 ' + (latest.regionGroups.length + 1),
      enabled: true,
      opacity: 1,
      color: createColorBlockV3(),
    };
    if (
      apply(
        {
          ...latest,
          regionGroups: [...latest.regionGroups, next],
          regionEdits: latest.regionEdits.map((r) =>
            selected.includes(r.id) ? { ...r, groupId: next.id } : r,
          ),
        },
        '将多个局部编组',
        true,
      )
    ) {
      setChecked([]);
      onScope({ kind: 'group', id: next.id });
    }
  }
  const colorScope = group
    ? { kind: 'group' as const, id: group.id }
    : region
      ? { kind: 'region' as const, id: region.id }
      : null;
  return (
    <section className="advanced-tool-family" data-motion="region-controls">
      <div className="tonal-tabs" aria-label={t('添加局部范围')}>
        {(['radial', 'linear', 'brush', 'polygon', 'color-range'] as const).map((type) => (
          <button
            key={type}
            disabled={recipe.regionEdits.length >= MAX_V3_REGION_EDITS}
            onClick={() => add(type)}
          >
            <Plus size={12} />
            {t(maskLabels[type])}
          </button>
        ))}
      </div>
      <small className="control-note">
        {recipe.regionEdits.length} / {MAX_V3_REGION_EDITS} {t('个局部 · 每个局部拥有完整调色参数')}
      </small>
      <div className="advanced-object-list" aria-label={t('独立局部与编组选择')}>
        {recipe.regionEdits.map((item) => (
          <div className="advanced-row" data-selected={item.id === region?.id} key={item.id}>
            <input
              type="checkbox"
              aria-label={t('将') + item.name + t('加入编组选择')}
              checked={checked.includes(item.id)}
              onChange={(event) =>
                setChecked((ids) =>
                  event.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                )
              }
            />
            <button
              className="object-name"
              aria-pressed={item.id === region?.id && !group}
              onClick={() => select(item.id)}
            >
              {item.name}
              <small>
                {t(maskLabels[item.mask.type])}
                {item.groupId ? t(' · 已编组') : ''}
              </small>
            </button>
            <IconButton
              label={t('{v0}{v1}', { v0: item.enabled ? t('隐藏') : t('显示'), v1: item.name })}
              onClick={() => {
                const latest = currentV3(editor);
                apply(
                  {
                    ...latest,
                    regionEdits: latest.regionEdits.map((r) =>
                      r.id === item.id ? { ...r, enabled: !r.enabled } : r,
                    ),
                  },
                  t('切换局部效果'),
                  true,
                );
              }}
            >
              {item.enabled ? <Eye size={15} /> : <EyeSlash size={15} />}
            </IconButton>
          </div>
        ))}
      </div>
      {!!selectedIds.length && (
        <div className="advanced-row">
          <small>
            {t('已选')}
            {selectedIds.length} {t('个局部')}
          </small>
          <button
            className="text-button"
            disabled={recipe.regionGroups.length >= MAX_V3_REGION_GROUPS}
            onClick={makeGroup}
          >
            {t('编为一组统一调整')}
          </button>
        </div>
      )}
      {!!recipe.regionGroups.length && (
        <div className="tonal-tabs" aria-label={t('局部分组')}>
          {recipe.regionGroups.map((item) => (
            <button
              key={item.id}
              aria-pressed={group?.id === item.id}
              onClick={() => onScope({ kind: 'group', id: item.id })}
            >
              {item.name} · {recipe.regionEdits.filter((r) => r.groupId === item.id).length}
            </button>
          ))}
        </div>
      )}
      {group && (
        <>
          <p className="control-note">
            {t(
              '组参数作用于此组有效范围的并集。单独局部的参数仍会保留，可以返回单个局部继续精修。',
            )}
          </p>
          <ParameterShelf
            label={t('分组强度')}
            controls={[
              {
                id: 'opacity',
                label: t('分组透明度'),
                value: group.opacity * 100,
                min: 0,
                max: 100,
                step: 0.1,
                unit: '%',
                onChange: (n) => {
                  const latest = currentV3(editor);
                  apply(
                    {
                      ...latest,
                      regionGroups: latest.regionGroups.map((g) =>
                        g.id === group.id ? { ...g, opacity: n / 100 } : g,
                      ),
                    },
                    t('调整分组透明度'),
                  );
                },
              },
            ]}
            onCommit={(label) => editor.commitCurrent(label)}
            onCancel={editor.cancelPreview}
          />
          <div className="advanced-row">
            <label className="object-title-edit">
              {t('分组名称')}
              <input
                key={group.id + ':' + group.name}
                aria-label={t('分组名称')}
                type="text"
                maxLength={120}
                defaultValue={group.name}
                onBlur={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (!name || name === group.name) {
                    event.currentTarget.value = group.name;
                    return;
                  }
                  const latest = currentV3(editor);
                  apply(
                    {
                      ...latest,
                      regionGroups: latest.regionGroups.map((item) =>
                        item.id === group.id ? { ...item, name } : item,
                      ),
                    },
                    t('重命名局部分组'),
                    true,
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    event.currentTarget.value = group.name;
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          </div>
          <div className="advanced-row">
            <label className="compact-check">
              <input
                type="checkbox"
                checked={group.enabled}
                onChange={(event) => {
                  const latest = currentV3(editor);
                  apply(
                    {
                      ...latest,
                      regionGroups: latest.regionGroups.map((g) =>
                        g.id === group.id ? { ...g, enabled: event.target.checked } : g,
                      ),
                    },
                    t('切换分组'),
                    true,
                  );
                }}
              />
              {t('显示组效果')}
            </label>
            <button
              className="text-button"
              onClick={() => {
                const latest = currentV3(editor);
                if (
                  apply(
                    {
                      ...latest,
                      regionGroups: latest.regionGroups.filter((g) => g.id !== group.id),
                      regionEdits: latest.regionEdits.map((r) =>
                        r.groupId === group.id ? { ...r, groupId: null } : r,
                      ),
                    },
                    t('解除范围编组'),
                    true,
                  )
                )
                  onScope(region ? { kind: 'region', id: region.id } : { kind: 'global' });
              }}
            >
              {t('解组，可撤销')}
            </button>
          </div>
        </>
      )}
      {region && !group && (
        <>
          <div className="advanced-row">
            <IconButton
              label={t('复制当前局部')}
              disabled={recipe.regionEdits.length >= MAX_V3_REGION_EDITS}
              onClick={() => {
                const copy = {
                  ...structuredClone(region),
                  id: secureUuid(),
                  name: region.name.slice(0, 110) + t(' 副本'),
                };
                if (
                  apply(
                    { ...recipe, regionEdits: [...recipe.regionEdits, copy] },
                    t('复制局部范围与参数'),
                    true,
                  )
                )
                  select(copy.id);
              }}
            >
              <Copy size={16} />
            </IconButton>
            <IconButton
              label={t('局部向前')}
              disabled={recipe.regionEdits[0]?.id === region.id}
              onClick={() => shift(-1)}
            >
              <ArrowUp size={16} />
            </IconButton>
            <IconButton
              label={t('局部向后')}
              disabled={recipe.regionEdits.at(-1)?.id === region.id}
              onClick={() => shift(1)}
            >
              <ArrowDown size={16} />
            </IconButton>
            <IconButton
              label={t('删除当前局部，可撤销')}
              onClick={() => {
                if (
                  apply(
                    {
                      ...recipe,
                      regionEdits: recipe.regionEdits.filter((r) => r.id !== region.id),
                    },
                    t('删除局部'),
                    true,
                  )
                ) {
                  const next = recipe.regionEdits.find((r) => r.id !== region.id);
                  if (next) select(next.id);
                  else {
                    editor.setActiveRegionId(null);
                    onScope({ kind: 'global' });
                  }
                }
              }}
            >
              <Trash size={16} />
            </IconButton>
          </div>
          <ParameterShelf
            label={t('局部强度')}
            controls={[
              {
                id: 'opacity',
                label: t('局部透明度'),
                value: region.opacity * 100,
                min: 0,
                max: 100,
                step: 0.1,
                unit: '%',
                onChange: (n) => patch({ opacity: n / 100 }, t('调整局部强度'), false),
              },
            ]}
            onCommit={(label) => editor.commitCurrent(label)}
            onCancel={editor.cancelPreview}
          />
          <MotionDetails className="advanced-disclosure" defaultOpen>
            <summary>{t('范围与过渡')}</summary>
            <MaskControls
              key={region.id}
              controller={controller}
              path={editor.activeMaskPath}
              onPath={editor.setActiveMaskPath}
              getMask={() => currentV3(editor).regionEdits.find((r) => r.id === region.id)!.mask}
              onChange={(mask, commit) => patch({ mask }, t('调整局部范围'), commit)}
            />
            {region.mask.type === 'color-range' && (
              <MotionDetails className="advanced-disclosure">
                <summary>{t('取色与完整色谱')}</summary>
                <ColorPicker
                  value={pickedColor}
                  onChange={(value) => onColorChange?.(value)}
                  label={t('连续选择颜色')}
                />
                <div className="advanced-row">
                  <button className="text-button" onClick={onSample}>
                    {sampling ? t('结束取色') : t('从原图取色')}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      const hue = hsv(rgba(pickedColor)).h;
                      if (region.mask.type === 'color-range')
                        patch({ mask: { ...region.mask, hue } }, t('使用所选色相'));
                    }}
                  >
                    {t('使用所选色相')}
                  </button>
                </div>
              </MotionDetails>
            )}
          </MotionDetails>
          <MotionDetails className="advanced-disclosure">
            <summary>{t('名称与分组')}</summary>
            <label className="advanced-select">
              {t('局部名称')}
              <input
                aria-label={t('局部名称')}
                key={region.id}
                defaultValue={region.name}
                maxLength={120}
                onBlur={(event) => {
                  if (event.target.value.trim())
                    patch({ name: event.target.value.trim() }, t('重命名局部'));
                }}
              />
            </label>
            <label className="advanced-select">
              {t('所在分组')}
              <ChoiceSelect
                ariaLabel={t('局部所在分组')}
                size="compact"
                value={region.groupId ?? ''}
                onValueChange={(value) => patch({ groupId: value || null }, t('移动局部分组'))}
                options={[
                  { value: '', label: t('独立调整') },
                  ...recipe.regionGroups.map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            </label>
          </MotionDetails>
        </>
      )}
      {colorScope && (
        <>
          <div className="tonal-tabs" aria-label={t('局部完整参数类别')}>
            {(
              [
                ['light', t('明暗')],
                ['color', t('色彩')],
                ['curves', t('曲线')],
                ['detail', t('细节')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                aria-pressed={family === id}
                onClick={() => {
                  editor.commitCurrent(t('完成当前局部调节'));
                  setFamily(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <ColorControls
            controller={controller}
            scope={colorScope}
            family={family}
            pickedColor={pickedColor}
            onColorChange={onColorChange}
            onSample={onSample}
            sampling={sampling}
            onScope={onScope}
          />
        </>
      )}
    </section>
  );
}
