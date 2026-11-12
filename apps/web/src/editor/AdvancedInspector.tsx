import { t } from '../i18n';
import { MotionDetails } from '../motion/Presence';
import { ChoiceSelect } from '../components/ChoiceSelect';
import { Activity, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePanelChrome } from '../workspace/PanelChromeContext';
import { RubberSegment } from '../components/control-motion';
import { CaretDown } from '../components/ControlGlyph';
import { createColorBlockV3 } from '@ai-xiutu/editor';
import { IconButton, InlineError } from '../components/Ui';
import type { ToolGroup, ToolInspectorProps } from './ToolInspector';
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
import { HistoryPanel } from './HistoryPanel';
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
  const chrome = usePanelChrome();
  const [scopes, setScopes] = useState<Partial<Record<typeof group, EditScope>>>({});
  const [visited, setVisited] = useState<ToolGroup[]>([group]);
  useEffect(() => {
    setVisited((previous) => (previous.includes(group) ? previous : [...previous, group]));
  }, [group]);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollOffsets = useRef<Partial<Record<typeof group, number>>>({});
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scrollOffsets.current[group] ?? 0;
  }, [group]);
  const recipe = currentV3(editor),
    descriptor = toolGroups.find((tool) => tool.id === group)!;
  const scopeFor = (owner: ToolGroup): EditScope => {
    const requested = scopes[owner] ?? { kind: 'global' };
    return requested.kind === 'global' ||
      (requested.kind === 'region' && recipe.regionEdits.some((r) => r.id === requested.id)) ||
      (requested.kind === 'group' && recipe.regionGroups.some((r) => r.id === requested.id))
      ? requested
      : { kind: 'global' };
  };
  const scope = scopeFor(group);
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
  function chooseScope(next: EditScope, owner = group) {
    editor.commitCurrent('完成当前作用范围');
    setScopes((current) => ({ ...current, [owner]: next }));
    if (next.kind === 'region') {
      editor.setActiveRegionId(next.id);
      editor.setActiveMaskPath([]);
    }
  }
  const scopedFamily = ['light', 'color', 'curves', 'detail'].includes(group);
  const familyNavigation =
    scopedFamily && onGroupChange ? (
      <RubberSegment
        className="context-adjustment-tabs"
        motionId="context-navigation"
        label={t('调节类别')}
        value={group}
        options={(['light', 'color', 'curves', 'detail'] as const).map((id) => ({
          value: id,
          label: t(toolGroups.find((tool) => tool.id === id)?.label ?? ''),
        }))}
        onChange={(id) => {
          editor.commitCurrent(t('完成当前调节'));
          onGroupChange(id);
        }}
      />
    ) : null;
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
        {chrome?.headerTarget && familyNavigation
          ? createPortal(familyNavigation, chrome.headerTarget)
          : familyNavigation}
        {!editor.file ? (
          <div className="inspector-empty">
            <span>{descriptor.icon}</span>
            <h3>{t('先放入一张照片')}</h3>
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
              </div>
            )}
            <InlineError message={error} />
            {toolGroups
              .filter(({ id }) => id === group || visited.includes(id))
              .map(({ id }) => {
                const retainedScope = scopeFor(id);
                const colorFamily = ['light', 'color', 'curves', 'detail'].includes(id);
                return (
                  <Activity key={id} mode={group === id ? 'visible' : 'hidden'}>
                    {/* Only visited tools are retained, inside this source-keyed inspector.
                        Activity pauses hidden effects and focus targets while preserving
                        subcategories, selected controls, disclosures and unfinished inputs. */}
                    <div className="inspector-tool-content" data-tool-family={id}>
                      {colorFamily && (
                        <ColorControls
                          controller={controller}
                          scope={retainedScope}
                          family={id as 'light' | 'color' | 'curves' | 'detail'}
                          pickedColor={pickedColor}
                          onColorChange={onColorChange}
                          onSample={onSample}
                          sampling={sampling}
                          onScope={(next) => {
                            chooseScope(next, id);
                            setScopes((current) => ({ ...current, local: next }));
                            onGroupChange?.('local');
                          }}
                        />
                      )}
                      {id === 'crop' && <GeometryControls controller={controller} />}
                      {id === 'local' && (
                        <LocalControls
                          headerTarget={group === id ? chrome?.headerTarget : null}
                          controller={controller}
                          scope={retainedScope}
                          onScope={(next) => chooseScope(next, id)}
                          pickedColor={pickedColor}
                          onColorChange={onColorChange}
                          onSample={onSample}
                          sampling={sampling}
                        />
                      )}
                      {id === 'beauty' && (
                        <PortraitControls
                          controller={controller}
                          onGroupChange={onGroupChange}
                          onCutout={onCutout}
                          headerTarget={id === group ? chrome?.headerTarget : null}
                          onSelectionCreated={(regionId) => {
                            setScopes((current) => ({
                              ...current,
                              local: { kind: 'region', id: regionId },
                            }));
                            onGroupChange?.('local');
                          }}
                        />
                      )}
                      {id === 'repair' && <RepairControls controller={controller} />}
                      {id === 'paint' && (
                        <PaintControls
                          controller={controller}
                          pickedColor={pickedColor}
                          onSample={onSample}
                          sampling={sampling}
                        />
                      )}
                      {id === 'liquify' && <LiquifyControls controller={controller} />}
                      {id === 'composite' && <ImageLayerControls controller={controller} />}
                      {id === 'history' && <HistoryPanel editor={editor} />}
                      {colorFamily && (
                        <MotionDetails className="advanced-disclosure">
                          <summary aria-label={t('恢复当前作用范围')}>{t('重置')}</summary>
                          <button
                            className="text-button"
                            onClick={() =>
                              controller.apply(
                                withScopeColor(
                                  currentV3(editor),
                                  retainedScope,
                                  createColorBlockV3(),
                                ),
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
                    </div>
                  </Activity>
                );
              })}
          </>
        )}
      </div>
    </aside>
  );
}
