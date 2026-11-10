import { useEffect, useRef, useState } from 'react';
import { CaretLeft, CaretRight, Sparkle } from '@phosphor-icons/react';
import { toolGroups, type ToolGroup } from '../editor/ToolInspector';

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
  const nav = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });
  const active = dockTool(group, compact);
  const choices = toolGroups.filter(
    (tool) => !compact || !['color', 'curves', 'detail'].includes(tool.id),
  );
  useEffect(() => {
    const rail = nav.current;
    const button = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !button) return;
    const viewport = rail.getBoundingClientRect();
    const item = button.getBoundingClientRect();
    if (item.left < viewport.left) rail.scrollLeft += item.left - viewport.left;
    else if (item.right > viewport.right) rail.scrollLeft += item.right - viewport.right;
  }, [active, inspectorOpen, aiOpen]);
  useEffect(() => {
    const rail = nav.current;
    if (!rail) return;
    const measure = () => {
      const left = rail.scrollLeft > 2;
      const right = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 2;
      setOverflow((previous) =>
        previous.left === left && previous.right === right ? previous : { left, right },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    rail.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      rail.removeEventListener('scroll', measure);
    };
  }, [compact]);
  return (
    <nav
      className="floating-tool-dock"
      aria-label="编辑工具"
      data-motion="tool-dock"
      data-context-open={inspectorOpen || aiOpen ? 'true' : undefined}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(event.target as HTMLButtonElement);
        if (index < 0) return;
        event.preventDefault();
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      <div
        className="dock-tool-region"
        data-overflow-left={overflow.left || undefined}
        data-overflow-right={overflow.right || undefined}
      >
        {overflow.left && (
          <button
            type="button"
            className="dock-scroll dock-scroll-left"
            aria-label="查看前面的编辑工具"
            onClick={() => nav.current?.scrollBy({ left: -200, behavior: 'smooth' })}
          >
            <CaretLeft size={14} />
          </button>
        )}
        <div className="dock-tool-scroll" ref={nav}>
          {choices.map((tool) => (
            <button
              type="button"
              key={tool.id}
              data-motion="tool-item"
              className={active === tool.id && inspectorOpen ? 'active' : ''}
              aria-pressed={active === tool.id && inspectorOpen}
              title={tool.description}
              onClick={() =>
                onTool(
                  compact && tool.id === 'light' && ADJUSTMENT_GROUPS.includes(group)
                    ? group
                    : tool.id,
                )
              }
            >
              {tool.icon}
              <span>{compact && tool.id === 'light' ? '调节' : tool.label}</span>
            </button>
          ))}
        </div>
        {overflow.right && (
          <button
            type="button"
            className="dock-scroll dock-scroll-right"
            aria-label="查看更多编辑工具"
            onClick={() => nav.current?.scrollBy({ left: 200, behavior: 'smooth' })}
          >
            <CaretRight size={14} />
          </button>
        )}
      </div>
      <span className="dock-divider" aria-hidden="true" />
      <button
        type="button"
        className={aiOpen ? 'active ai-tool' : 'ai-tool'}
        aria-pressed={aiOpen}
        onClick={onAI}
      >
        <Sparkle size={22} />
        <span>AI共创</span>
      </button>
    </nav>
  );
}
