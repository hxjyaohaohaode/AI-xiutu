import { useEffect, useRef } from 'react';
import { Sparkle } from '@phosphor-icons/react';
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
  const nav = useRef<HTMLElement>(null);
  const active = dockTool(group, compact);
  const choices = toolGroups.filter(
    (tool) => !compact || !['color', 'curves', 'detail'].includes(tool.id),
  );
  useEffect(() => {
    const rail = nav.current;
    const button = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!rail || !button) return;
    const left = button.offsetLeft,
      right = left + button.offsetWidth;
    if (left < rail.scrollLeft) rail.scrollLeft = left;
    else if (right > rail.scrollLeft + rail.clientWidth) rail.scrollLeft = right - rail.clientWidth;
  }, [active, inspectorOpen, aiOpen]);
  return (
    <nav
      ref={nav}
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
      {choices.map((tool) => (
        <button
          type="button"
          key={tool.id}
          data-motion="tool-item"
          className={active === tool.id && inspectorOpen ? 'active' : ''}
          aria-pressed={active === tool.id && inspectorOpen}
          onClick={() =>
            onTool(
              compact && tool.id === 'light' && ADJUSTMENT_GROUPS.includes(group) ? group : tool.id,
            )
          }
        >
          {tool.icon}
          <span>{compact && tool.id === 'light' ? '调节' : tool.label}</span>
        </button>
      ))}
      {!compact && <span className="dock-divider" />}
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
