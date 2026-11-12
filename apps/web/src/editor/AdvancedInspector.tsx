import { t } from '../i18n';
import { Activity, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePanelChrome } from '../workspace/PanelChromeContext';
import { RubberSegment } from '../components/control-motion';
import { ArrowCounterClockwise, CaretDown } from '../components/ControlGlyph';
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
import { ColorControls, type AdjustmentFamily } from './ColorControls';
import { GeometryControls } from './GeometryControls';
import { LocalControls } from './LocalControls';
import { PaintControls, LiquifyControls, ImageLayerControls } from './LayerControls';
import { RepairControls } from './RepairControls';
import { PortraitControls } from './PortraitControls';
import { HistoryPanel } from './HistoryPanel';
import './advanced-inspector.css';

export function AdvancedInspector({
  editor,
  target,
  onPortraitTool,
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
  const [portraitTool, setPortraitTool] = useState<ToolGroup | null>(null);
  function openPortraitTool(tool: ToolGroup) {
    const next = tool === 'beauty' ? null : tool;
    setPortraitTool(next);
    onPortraitTool?.(next);
  }
  useEffect(() => { if (group !== 'beauty') setPortraitTool(null); }, [group]);
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
  function resetControls(scope: EditScope) {
    return (
      <IconButton
        className="scope-reset-button"
        label={t('恢复当前范围全部明暗、色彩和细节')}
        onClick={() => controller.apply(
          withScopeColor(currentV3(editor), scope, createColorBlockV3()),
          t('恢复当前范围的中性色彩'),
          true,
        )}
      >
        <ArrowCounterClockwise size={16} />
      </IconButton>
    );
  }
  const familyIds: readonly AdjustmentFamily[] = ['light', 'color', 'curves', 'detail'];
  const scopedFamily = familyIds.includes(group as AdjustmentFamily);
  const familyOptions = familyIds.map((id) => ({
    value: id,
    label: t(toolGroups.find((tool) => tool.id === id)?.label ?? ''),
  }));
  const compactTools =
    chrome?.adjustmentLayoutControl && onGroupChange
      ? {
          layout: chrome.adjustmentLayoutControl,
          options: familyOptions,
          onFamilyChange: onGroupChange,
        }
      : undefined;
  const familyNavigation =
    scopedFamily && onGroupChange && !compactTools ? (
      <RubberSegment
        className="context-adjustment-tabs"
        motionId="context-navigation"
        label={t('调节类别')}
        value={group}
        options={familyOptions}
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
            {scopedFamily && (recipe.regionEdits.length > 0 || recipe.regionGroups.length > 0) && (
              <RubberSegment
                className="scope-selector compact-choice-row"
                label={t('参数作用范围')}
                value={scopeKey(scope)}
                onChange={(value) => {
                  const [kind, id] = value.split(':');
                  chooseScope(kind === 'global' ? { kind: 'global' } : { kind: kind as 'region' | 'group', id: id! });
                }}
                options={[
                  { value: 'global', label: t('整张照片') },
                  ...recipe.regionEdits.map((r) => ({ value: 'region:' + r.id, label: r.name })),
                  ...recipe.regionGroups.map((g) => ({ value: 'group:' + g.id, label: g.name })),
                ]}
              />
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
                          target={group === id ? target : undefined}
                          family={id as AdjustmentFamily}
                          compactTools={group === id ? compactTools : undefined}
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
                      {id === 'crop' && (
                        <GeometryControls
                          controller={controller}
                          layoutControl={group === id ? chrome?.adjustmentLayoutControl : undefined}
                          target={group === id ? target : undefined}
                        />
                      )}
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
                        <>
                          <PortraitControls
                            controller={controller}
                            onGroupChange={openPortraitTool}
                            onCutout={onCutout}
                            headerTarget={id === group ? chrome?.headerTarget : null}
                            onSelectionCreated={(regionId) => {
                              setScopes((current) => ({ ...current, local: { kind: 'region', id: regionId } }));
                              openPortraitTool('local');
                            }}
                          />
                          {portraitTool === 'local' && (
                            <LocalControls
                              controller={controller}
                              scope={scopeFor('local')}
                              onScope={(next) => chooseScope(next, 'local')}
                              pickedColor={pickedColor}
                              onColorChange={onColorChange}
                              onSample={onSample}
                              sampling={sampling}
                            />
                          )}
                          {portraitTool === 'paint' && (
                            <PaintControls controller={controller} pickedColor={pickedColor} onSample={onSample} sampling={sampling} />
                          )}
                          {portraitTool === 'liquify' && <LiquifyControls controller={controller} />}
                        </>
                      )}
                      {id === 'repair' && <RepairControls controller={controller} />}
                      {id === 'paint' && (
                        <PaintControls
                          controller={controller}
                          headerTarget={id === group ? chrome?.headerTarget : null}
                          pickedColor={pickedColor}
                          onSample={onSample}
                          sampling={sampling}
                        />
                      )}
                      {id === 'liquify' && <LiquifyControls controller={controller} />}
                      {id === 'composite' && <ImageLayerControls controller={controller} />}
                      {id === 'history' && <HistoryPanel editor={editor} />}
                      {colorFamily &&
                        (compactTools
                          ? group === id &&
                            chrome?.adjustmentMenuTarget &&
                            createPortal(resetControls(retainedScope), chrome.adjustmentMenuTarget)
                          : resetControls(retainedScope))}
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
