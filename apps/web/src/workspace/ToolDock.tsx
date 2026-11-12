import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight } from '../components/ControlGlyph';
import { StudioGlyph } from '../components/StudioGlyph';
import { useReducedMotion } from '../motion/usePresence';
import { toolGroups, type ToolGroup } from '../editor/ToolInspector';
import { t, useI18n } from '../i18n';
import { useDockProximity } from './useDockProximity';
import { useKinetic } from '../motion/useKinetic';
import { WarmTooltip } from '../components/control-motion';

export const ADJUSTMENT_GROUPS: ToolGroup[] = ['light', 'color', 'curves', 'detail'];
export function dockTool(group: ToolGroup, compact: boolean): ToolGroup {
  return compact && ADJUSTMENT_GROUPS.includes(group) ? 'light' : group;
}

/** A connected phone category rail; the selected context opens directly above it. */
export function ToolDock({
  group,
  inspectorOpen,
  aiOpen,
  compact,
  onTool,
  onAI,
}: {
  group: ToolGroup;
  inspectorOpen: boolean;
  aiOpen: boolean;
  compact: boolean;
  onTool: (group: ToolGroup) => void;
  onAI: () => void;
}) {
  const { locale } = useI18n();
  const nav = useRef<HTMLDivElement>(null);
  const dock = useRef<HTMLElement>(null);
  const selectionNode = useRef<HTMLSpanElement>(null);
  const selectionBox = useRef({ x: 0, width: 0 });
  const paintSelection = () => {
    if (!selectionNode.current) return;
    selectionNode.current.style.transform = `translate3d(${selectionBox.current.x}px, 0, 0)`;
    selectionNode.current.style.width = `${selectionBox.current.width}px`;
  };
  const selectionX = useKinetic(
    0,
    (value) => {
      selectionBox.current.x = value;
      paintSelection();
    },
    { stiffness: 370, damping: 32 },
  );
  const selectionWidth = useKinetic(
    0,
    (value) => {
      selectionBox.current.width = value;
      paintSelection();
    },
    { stiffness: 420, damping: 35 },
  );
  const selectionReady = useRef(false);
  useDockProximity(dock, compact, locale);
  const reducedMotion = useReducedMotion();
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const active = dockTool(group, compact);
  const [tabStop, setTabStop] = useState<string>(aiOpen ? 'ai' : active);
  const [selection, setSelection] = useState<{ x: number; width: number; height: number } | null>(
    null,
  );
  const choices = toolGroups.filter(
    (tool) => !compact || !['color', 'curves', 'detail'].includes(tool.id),
  );
  useLayoutEffect(() => {
    if (!selection) {
      selectionReady.current = false;
      return;
    }
    if (!selectionReady.current) {
      selectionX.jump(selection.x);
      selectionWidth.jump(selection.width);
      selectionReady.current = true;
    } else {
      selectionX.setTarget(selection.x);
      selectionWidth.setTarget(selection.width);
    }
  }, [selection, selectionX, selectionWidth]);
  useLayoutEffect(() => {
    const rail = nav.current;
    const button = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !button) return;
    const viewport = rail.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    if (item.left < viewport.left) rail.scrollLeft += item.left - viewport.left;
    else if (item.right > viewport.right) rail.scrollLeft += item.right - viewport.right;
  }, [active, inspectorOpen, aiOpen, compact, locale]);
  useEffect(() => setTabStop(aiOpen ? 'ai' : active), [active, aiOpen, compact]);
  useLayoutEffect(() => {
    const rail = nav.current;
    const button = rail?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!rail || !button || !inspectorOpen) {
      setSelection(null);
      return;
    }
    const measure = () => {
      const next = { x: button.offsetLeft, width: button.offsetWidth, height: button.offsetHeight };
      setSelection((previous) =>
        previous &&
        previous.x === next.x &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    observer.observe(button);
    return () => observer.disconnect();
  }, [active, inspectorOpen, compact, locale]);
  useEffect(() => {
    const rail = nav.current;
    if (!rail) return;
    const measure = () => {
      if (compact) {
        const style = getComputedStyle(rail);
        const gap = parseFloat(style.columnGap || '0') || 0;
        const available =
          rail.clientWidth -
          parseFloat(style.paddingLeft || '0') -
          parseFloat(style.paddingRight || '0');
        const minimum = Math.max(
          52,
          ...[...rail.querySelectorAll<HTMLButtonElement>('button')].map((button) => {
            const itemStyle = getComputedStyle(button);
            return Math.ceil(
              (button.querySelector('.dock-label')?.scrollWidth ?? 0) +
                parseFloat(itemStyle.paddingLeft || '0') +
                parseFloat(itemStyle.paddingRight || '0') +
                parseFloat(itemStyle.borderLeftWidth || '0') +
                parseFloat(itemStyle.borderRightWidth || '0'),
            );
          }),
        );
        if (available > 0) {
          const peek = 12;
          const slots = Math.max(1, Math.floor((available - peek + gap) / (minimum + gap)));
          const width = `${Math.max(minimum, (available - peek - gap * (slots - 1)) / slots)}px`;
          if (rail.style.getPropertyValue('--dock-item-width') !== width)
            rail.style.setProperty('--dock-item-width', width);
        }
      }
      const left = rail.scrollLeft > 2;
      const right = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2;
      setOverflow((previous) =>
        previous.left === left && previous.right === right ? previous : { left, right },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    if (compact) {
      for (const label of rail.querySelectorAll<HTMLElement>('.dock-label'))
        observer.observe(label);
    }
    rail.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      rail.removeEventListener('scroll', measure);
    };
  }, [compact, locale]);
  return (
    <nav
      ref={dock}
      className="floating-tool-dock"
      aria-label={t('编辑工具')}
      data-motion="tool-dock"
      data-compact={compact || undefined}
      data-selection-ready={selection ? 'true' : undefined}
      data-context-open={inspectorOpen || aiOpen ? 'true' : undefined}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-dock-tool]'),
        ];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
        const target = buttons[next];
        if (target?.dataset.dockTool) setTabStop(target.dataset.dockTool);
        target?.focus({ preventScroll: true });
        const rail = nav.current;
        if (target && rail?.contains(target)) {
          const item = target.getBoundingClientRect();
          const viewport = rail.getBoundingClientRect();
          if (item.left < viewport.left) rail.scrollLeft += item.left - viewport.left - 20;
          else if (item.right > viewport.right) rail.scrollLeft += item.right - viewport.right + 20;
        }
      }}
    >
      <div
        className="dock-tool-region"
        data-overflow-left={overflow.left || undefined}
        data-overflow-right={overflow.right || undefined}
      >
        {!compact && overflow.left && (
          <button
            type="button"
            className="dock-scroll dock-scroll-left"
            aria-label={t('查看前面的编辑工具')}
            tabIndex={-1}
            onClick={() =>
              nav.current?.scrollBy({ left: -200, behavior: reducedMotion ? 'auto' : 'smooth' })
            }
          >
            <CaretLeft size={14} />
          </button>
        )}
        <div className="dock-tool-scroll" ref={nav}>
          {selection && (
            <span
              ref={selectionNode}
              className="dock-selection"
              aria-hidden="true"
              style={{
                height: selection.height,
              }}
            />
          )}
          {choices.map((tool) => (
            <WarmTooltip key={tool.id} content={t(tool.description)}>
              <button
                type="button"
                key={tool.id}
                data-dock-tool={tool.id}
                data-motion="tool-item"
                className={active === tool.id && inspectorOpen ? 'active' : ''}
                aria-pressed={active === tool.id && inspectorOpen}
                title={t(tool.description)}
                tabIndex={tabStop === tool.id ? 0 : -1}
                onFocus={() => setTabStop(tool.id)}
                onClick={() =>
                  onTool(
                    compact && tool.id === 'light' && ADJUSTMENT_GROUPS.includes(group)
                      ? group
                      : tool.id,
                  )
                }
              >
                <span className="dock-icon">
                  <StudioGlyph name={tool.id} size={20} />
                </span>
                <span className="dock-label">
                  {t(compact && tool.id === 'light' ? '调节' : tool.label)}
                </span>
              </button>
            </WarmTooltip>
          ))}
        </div>
        {!compact && overflow.right && (
          <button
            type="button"
            className="dock-scroll dock-scroll-right"
            aria-label={t('查看更多编辑工具')}
            tabIndex={-1}
            onClick={() =>
              nav.current?.scrollBy({ left: 200, behavior: reducedMotion ? 'auto' : 'smooth' })
            }
          >
            <CaretRight size={14} />
          </button>
        )}
      </div>
      <span className="dock-divider" aria-hidden="true" />
      <button
        type="button"
        className={aiOpen ? 'active ai-tool' : 'ai-tool'}
        data-dock-tool="ai"
        aria-pressed={aiOpen}
        tabIndex={tabStop === 'ai' ? 0 : -1}
        onFocus={() => setTabStop('ai')}
        onClick={onAI}
      >
        <span className="dock-icon">
          <StudioGlyph name="ai" size={20} />
        </span>
        <span className="dock-label">{t('AI 助手')}</span>
      </button>
    </nav>
  );
}
