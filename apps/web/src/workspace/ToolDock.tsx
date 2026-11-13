import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StudioGlyph } from '../components/StudioGlyph';
import { toolGroups, type ToolGroup } from '../editor/ToolInspector';
import { t, useI18n } from '../i18n';
import { useKinetic } from '../motion/useKinetic';
import Dock, { type DockItemData } from '../components/react-bits/Dock';
import { adjustmentTools, retouchTools, rootTool, toolFamilyLabels } from '../editor/tool-families';

const primaryTools: readonly ToolGroup[] = ['light', 'crop', 'beauty', 'local', 'repair', 'composite'];

function toolLabel(id: ToolGroup, fallback: string) {
  return t(id === 'light' || id === 'repair' ? toolFamilyLabels[id] : fallback);
}

type ToolDockProps = {
  group: ToolGroup;
  inspectorOpen: boolean;
  aiOpen: boolean;
  compact: boolean;
  theme: 'light' | 'dark';
  onTool: (group: ToolGroup) => void;
  onAI: () => void;
};

export function ToolDock(props: ToolDockProps) {
  const { locale } = useI18n();
  const { group, compact, inspectorOpen, aiOpen, theme, onTool, onAI } = props;
  if (compact) return <TouchToolDock {...props} />;
  const active = rootTool(group);
  const items: DockItemData[] = primaryTools.map((id) => {
    const tool = toolGroups.find((item) => item.id === id)!;
    const siblings = id === 'light' ? adjustmentTools : id === 'repair' ? retouchTools : null;
    return {
      id,
      icon: <StudioGlyph name={id === 'light' ? 'editor' : id} size={23} />,
      label: toolLabel(id, tool.label),
      active: inspectorOpen && active === id,
      onClick: () => onTool(active === id ? group : id),
      menu: siblings?.map((child) => {
        const descriptor = toolGroups.find((item) => item.id === child)!;
        return {
          label: t(descriptor.label),
          icon: descriptor.icon,
          checked: group === child && inspectorOpen,
          onClick: () => { if (!inspectorOpen || group !== child) onTool(child); },
        };
      }),
    };
  });
  items.push({ separator: true }, {
    id: 'ai',
    icon: <StudioGlyph name="ai" size={23} />,
    label: t('AI 助手'),
    active: aiOpen,
    onClick: onAI,
  });
  return (
    <nav aria-label={t('编辑工具')} className="desktop-dock-landmark">
      <Dock
        key={locale}
        ariaLabel={t('编辑工具')}
        className="studio-reference-dock"
        theme={theme}
        items={items}
        baseItemSize={38}
        panelHeight={52}
        magnification={53}
        distance={112}
        gap={7}
        roundness={0.58}
      />
    </nav>
  );
}

function revealPressedTool(rail: HTMLElement) {
  const button = rail.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (!button || !rail.clientWidth) return;
  const viewport = rail.getBoundingClientRect();
  const item = button.getBoundingClientRect();
  if (item.left < viewport.left) rail.scrollLeft += item.left - viewport.left;
  else if (item.right > viewport.right) rail.scrollLeft += item.right - viewport.right;
}

function TouchToolDock({
  group,
  inspectorOpen,
  aiOpen,
  onTool,
  onAI,
}: ToolDockProps) {
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
  const active = rootTool(group);
  const contextOpen = inspectorOpen;
  const [tabStop, setTabStop] = useState<string>(aiOpen ? 'ai' : active);
  const [selection, setSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null,
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
    if (rail) revealPressedTool(rail);
  }, [active, contextOpen, aiOpen, locale]);
  useEffect(() => setTabStop(aiOpen ? 'ai' : active), [active, aiOpen]);
  useLayoutEffect(() => {
    const rail = nav.current;
    const button = rail?.querySelector<HTMLButtonElement>('[aria-pressed="true"]');
    if (!rail || !button || !contextOpen) {
      setSelection(null);
      return;
    }
    const measure = () => {
      const next = {
        x: button.offsetLeft,
        y: button.offsetTop,
        width: button.offsetWidth,
        height: button.offsetHeight,
      };
      setSelection((previous) =>
        previous &&
        previous.x === next.x &&
        previous.y === next.y &&
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
  }, [active, contextOpen, locale]);
  useEffect(() => {
    const rail = nav.current;
    if (!rail) return;
    const measure = () => {
      if (window.innerWidth < 760) {
        const style = getComputedStyle(rail);
        const gap = parseFloat(style.columnGap || '0') || 0;
        const available =
          rail.clientWidth -
          parseFloat(style.paddingLeft || '0') -
          parseFloat(style.paddingRight || '0');
        const minimum = Math.max(
          46,
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
          const slots = Math.min(primaryTools.length, Math.max(1, Math.floor((available + gap) / (minimum + gap))));
          const occupied = available - (slots < primaryTools.length ? peek : 0);
          const width = `${Math.max(minimum, (occupied - gap * (slots - 1)) / slots)}px`;
          if (rail.style.getPropertyValue('--dock-item-width') !== width) {
            rail.style.setProperty('--dock-item-width', width);
            revealPressedTool(rail);
          }
        }
      }
    };
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(rail);
    for (const label of rail.querySelectorAll<HTMLElement>('.dock-label')) observer.observe(label);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [locale]);
  return (
    <nav
      ref={dock}
      className="floating-tool-dock"
      aria-label={t('编辑工具')}
      data-motion="tool-dock"
      data-compact="true"
      data-selection-ready={selection ? 'true' : undefined}
      data-context-open={contextOpen || aiOpen ? 'true' : undefined}
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
      <div className="dock-tool-region">
        <div className="dock-tool-scroll" ref={nav}>
          {selection && (
            <span
              ref={selectionNode}
              className="dock-selection"
              aria-hidden="true"
              style={{
                top: selection.y,
                height: selection.height,
              }}
            />
          )}
          {primaryTools.map((id) => {
            const tool = toolGroups.find((item) => item.id === id)!;
            return (
              <button
                type="button"
                key={tool.id}
                data-dock-tool={tool.id}
                data-motion="tool-item"
                className={active === tool.id && contextOpen ? 'active' : ''}
                aria-pressed={active === tool.id && contextOpen}
                tabIndex={tabStop === tool.id ? 0 : -1}
                onFocus={() => setTabStop(tool.id)}
                onClick={() => onTool(active === tool.id ? group : tool.id)}
              >
                <span className="dock-icon">
                  <StudioGlyph name={tool.id === 'light' ? 'editor' : tool.id} size={20} />
                </span>
                <span className="dock-label">
                  {toolLabel(tool.id, tool.label)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <span className="dock-divider" aria-hidden="true" />
      <button
        type="button"
        className={aiOpen ? 'active ai-tool' : 'ai-tool'}
        data-dock-tool="ai"
        aria-label={t('AI 助手')}
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
