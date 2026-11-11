import { useId, useState, type CSSProperties } from 'react';
import { ArrowUpRight, MagnifyingGlass } from '@phosphor-icons/react';
import { t } from '../i18n';
import { toolGroups, type ToolGroup } from '../editor/ToolInspector';
import { interactionText } from './interaction-copy';

/** React Bits Animated List informed the bounded stagger and keyboard-visible
 * selection. Tool choices keep their normal button semantics and fixed targets. */
export function ToolOverview({
  current,
  onSelect,
}: {
  current: ToolGroup;
  onSelect: (group: ToolGroup) => void;
}) {
  const [query, setQuery] = useState('');
  const id = useId();
  const choices = toolGroups.filter((tool) =>
    `${t(tool.label)} ${t(tool.description)} ${tool.id}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <section className="tool-overview" aria-label={interactionText('toolOverview')}>
      <label className="tool-overview-search" htmlFor={id}>
        <MagnifyingGlass size={17} aria-hidden />
        <input
          id={id}
          type="search"
          placeholder={interactionText('toolSearch')}
          aria-label={interactionText('toolSearch')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div
        className="tool-overview-list"
        onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
          const index = buttons.indexOf(event.target as HTMLButtonElement);
          if (index < 0 || !buttons.length) return;
          event.preventDefault();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : Math.max(
                    0,
                    Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                  );
          buttons[next]?.focus();
        }}
      >
        {choices.map((tool, index) => (
          <button
            type="button"
            key={tool.id}
            aria-pressed={current === tool.id}
            style={{ '--tool-enter-delay': `${Math.min(index * 45, 225)}ms` } as CSSProperties}
            onClick={() => onSelect(tool.id)}
          >
            {tool.icon}
            <span>
              <strong>{t(tool.label)}</strong>
              <small>{t(tool.description)}</small>
            </span>
            <ArrowUpRight size={16} aria-hidden />
          </button>
        ))}
        {!choices.length && <p className="tool-overview-empty">{interactionText('noTools')}</p>}
      </div>
    </section>
  );
}
