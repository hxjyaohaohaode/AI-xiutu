import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowCounterClockwise, ArrowClockwise, CaretDown } from '@phosphor-icons/react';
import { createColorBlockV3 } from '@ai-xiutu/editor';
import { IconButton, InlineError } from '../components/Ui';
import type { ToolInspectorProps } from './ToolInspector';
import { toolGroups } from './ToolInspector';
import {
  checkedRecipe,
  currentV3,
  scopeKey,
  withScopeColor,
  type EditScope,
  type InspectorController,
} from './advanced-model';
import { ColorControls } from './ColorControls';
import { GeometryControls } from './GeometryControls';
import { LocalControls } from './LocalControls';
import { PaintControls, LiquifyControls, ImageLayerControls } from './LayerControls';
import { RepairControls } from './RepairControls';
import { PortraitControls } from './PortraitControls';
import './advanced-inspector.css';

export function AdvancedInspector({
  editor,
  group,
  mobileOpen,
  onClose,
  pickedColor = '#34372EFF',
  onColorChange,
  onSample,
  sampling,
  onGroupChange,
  onCutout,
}: ToolInspectorProps) {
  const [scopes, setScopes] = useState<Partial<Record<typeof group, EditScope>>>({});
  const requestedScope: EditScope = scopes[group] ?? { kind: 'global' };
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollOffsets = useRef<Partial<Record<typeof group, number>>>({});
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scrollOffsets.current[group] ?? 0;
  }, [group]);
  const recipe = currentV3(editor),
    descriptor = toolGroups.find((tool) => tool.id === group)!;
  const scope =
    requestedScope.kind === 'global' ||
    (requestedScope.kind === 'region' &&
      recipe.regionEdits.some((r) => r.id === requestedScope.id)) ||
    (requestedScope.kind === 'group' && recipe.regionGroups.some((r) => r.id === requestedScope.id))
      ? requestedScope
      : { kind: 'global' as const };
  const controller: InspectorController = {
    editor,
    report: setError,
    apply(next, label, commit = false) {
      try {
        const valid = checkedRecipe(next, editor.dimensions, editor.pixelBudget);
        if (commit) editor.commit(valid, label);
        else editor.preview(valid);
        setError(null);
        return true;
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : '这组参数暂时不可用，上一个有效状态已保留。',
        );
        return false;
      }
    },
  };
  function chooseScope(next: EditScope) {
    editor.commitCurrent('完成当前作用范围');
    setScopes((current) => ({ ...current, [group]: next }));
    if (next.kind === 'region') {
      editor.setActiveRegionId(next.id);
      editor.setActiveMaskPath([]);
    }
  }
  const scopedFamily = ['light', 'color', 'curves', 'detail'].includes(group);
  return (
    <aside
      className={`inspector refined-inspector advanced-inspector ${mobileOpen ? 'mobile-open' : ''}`}
      aria-label={t('编辑参数')}
    >
      <header className="inspector-heading" data-motion="inspector-header">
        <div>
          <h2>
            {t(descriptor.label)}
            <span className="tiny-dot" />
          </h2>
          <p>{t(descriptor.description)}</p>
        </div>
        <IconButton label={t('收起工具面板')} className="mobile-only" onClick={onClose}>
          <CaretDown size={20} />
        </IconButton>
      </header>
      <div
        ref={scroller}
        className="inspector-scroll advanced-inspector-scroll"
        onScroll={(event) => {
          scrollOffsets.current[group] = event.currentTarget.scrollTop;
        }}
      >
        {scopedFamily && onGroupChange && (
          <nav
            className="context-adjustment-tabs"
            aria-label={t('调节类别')}
            data-motion="context-navigation"
          >
            {(['light', 'color', 'curves', 'detail'] as const).map((id) => (
              <button
                type="button"
                key={id}
                aria-pressed={group === id}
                onClick={() => {
                  editor.commitCurrent(t('完成当前调节'));
                  onGroupChange(id);
                }}
              >
                {t(toolGroups.find((tool) => tool.id === id)?.label ?? '')}
              </button>
            ))}
          </nav>
        )}
        {!editor.file ? (
          <div className="inspector-empty">
            <span>{descriptor.icon}</span>
            <h3>{t('先放入一张照片')}</h3>
            <p>{t('打开后即可调节。图像、工具范围与记录分别保留。')}</p>
          </div>
        ) : (
          <>
            {scopedFamily && (
              <div
                className="scope-selector"
                data-motion="scope-selector"
                data-single-scope={
                  !recipe.regionEdits.length && !recipe.regionGroups.length ? 'true' : undefined
                }
              >
                <label>
                  {t('作用范围')}
                  <ChoiceSelect
                    ariaLabel={t('参数作用范围')}
                    size="compact"
                    value={scopeKey(scope)}
                    onValueChange={(value) => {
                      const [kind, id] = value.split(':');
                      chooseScope(
                        kind === 'global'
                          ? { kind: 'global' }
                          : { kind: kind as 'region' | 'group', id: id! },
                      );
                    }}
                    options={[
                      { value: 'global', label: t('整张照片') },
                      ...recipe.regionEdits.map((r) => ({
                        value: 'region:' + r.id,
                        label: r.name,
                        description: t('单个局部'),
                      })),
                      ...recipe.regionGroups.map((g) => ({
                        value: 'group:' + g.id,
                        label: g.name,
                        description: t('多个局部分组'),
                      })),
                    ]}
                  />
                </label>
                {scope.kind !== 'global' && (
                  <small>{t('仅改变所选范围的完整参数，其他局部保持独立。')}</small>
                )}
              </div>
            )}
            <InlineError message={error} />
            {scopedFamily && (
              <ColorControls
                controller={controller}
                scope={scope}
                family={group as 'light' | 'color' | 'curves' | 'detail'}
                pickedColor={pickedColor}
                onColorChange={onColorChange}
                onSample={onSample}
                sampling={sampling}
                onScope={(next) => {
                  chooseScope(next);
                  onGroupChange?.('local');
                }}
              />
            )}
            {group === 'crop' && <GeometryControls controller={controller} />}
            {group === 'local' && (
              <LocalControls
                controller={controller}
                scope={scope}
                onScope={chooseScope}
                pickedColor={pickedColor}
                onColorChange={onColorChange}
                onSample={onSample}
                sampling={sampling}
              />
            )}
            {group === 'beauty' && (
              <PortraitControls
                controller={controller}
                onGroupChange={onGroupChange}
                onCutout={onCutout}
                onSelectionCreated={(id) => {
                  setRequestedScope({ kind: 'region', id });
                  onGroupChange?.('local');
                }}
              />
            )}
            {group === 'repair' && <RepairControls controller={controller} />}
            {group === 'paint' && (
              <PaintControls
                controller={controller}
                pickedColor={pickedColor}
                onSample={onSample}
                sampling={sampling}
              />
            )}
            {group === 'liquify' && <LiquifyControls controller={controller} />}
            {group === 'composite' && <ImageLayerControls controller={controller} />}
            {group === 'history' && (
              <section className="advanced-tool-family" data-motion="advanced-history">
                <div className="advanced-row">
                  <button className="text-button" disabled={!editor.canUndo} onClick={editor.undo}>
                    <ArrowCounterClockwise size={17} />
                    {t('撤销')}
                  </button>
                  <button className="text-button" disabled={!editor.canRedo} onClick={editor.redo}>
                    <ArrowClockwise size={17} />
                    {t('重做')}
                  </button>
                </div>
                <ol className="advanced-history-list">
                  {editor.history.map((item, index) => (
                    <li key={index} data-selected={index === editor.historyIndex}>
                      <button
                        onClick={() =>
                          editor.commit(item.recipe, t('从本地记录恢复：') + item.label)
                        }
                        disabled={index === editor.historyIndex}
                      >
                        <span>{index + 1}</span>
                        {t(item.label)}
                        {index === editor.historyIndex && <small>{t('当前')}</small>}
                      </button>
                    </li>
                  ))}
                </ol>
                <p className="control-note">
                  {t('本地记录属于当前原图。云端历史在“对比”中，可打开对应原图或恢复为新版本。')}
                </p>
              </section>
            )}
            {scopedFamily && (
              <MotionDetails className="advanced-disclosure">
                <summary>{t('恢复当前作用范围')}</summary>
                <button
                  className="text-button"
                  onClick={() =>
                    controller.apply(
                      withScopeColor(currentV3(editor), scope, createColorBlockV3()),
                      t('恢复当前范围的中性色彩'),
                      true,
                    )
                  }
                >
                  {t('恢复当前范围全部明暗、色彩和细节')}
                </button>
                <p className="control-note">
                  {t('保留选区形状、其他人物、构图和合成图层；该操作可以撤销。')}
                </p>
              </MotionDetails>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
