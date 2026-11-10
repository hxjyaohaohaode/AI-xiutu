import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowElbowDownLeft, MagnifyingGlass } from '@phosphor-icons/react';
import { Modal } from '../components/Ui';

export type StudioCommand = {
  id: string;
  label: string;
  description: string;
  keywords?: string;
  section: string;
  icon: ReactNode;
  disabled?: boolean;
  run: () => void;
};

export function CommandMenu({
  commands,
  onClose,
}: {
  commands: StudioCommand[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((command) =>
      terms.every((term) =>
        `${command.label} ${command.description} ${command.keywords ?? ''} ${command.section}`
          .toLocaleLowerCase()
          .includes(term),
      ),
    );
  }, [commands, query]);
  const active = Math.min(index, Math.max(0, matches.length - 1));
  function choose(command: StudioCommand | undefined) {
    if (!command || command.disabled) return;
    onClose();
    command.run();
  }
  return (
    <Modal
      title="找到工具，接着创作"
      subtitle="搜索工具、工作视图或常用操作"
      onClose={onClose}
      className="studio-command-modal"
      initialFocusRef={search}
    >
      <div className="command-search">
        <MagnifyingGlass size={21} />
        <input
          ref={search}
          type="search"
          placeholder="试试「曲线」「局部」或「导出」"
          aria-label="搜索工具与操作"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={matches.length ? `${id}-${active}` : undefined}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && matches.length) {
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? matches.length - 1
                    : (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) %
                      matches.length;
              setIndex(next);
              document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: 'nearest' });
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(matches[active]);
            }
          }}
        />
        <kbd>Esc</kbd>
      </div>
      <div id={`${id}-list`} role="listbox" aria-label="工具与操作" className="command-results">
        {matches.map((command, position) => (
          <div key={command.id}>
            {(position === 0 || matches[position - 1]?.section !== command.section) && (
              <p className="command-section">{command.section}</p>
            )}
            <button
              type="button"
              id={`${id}-${position}`}
              role="option"
              aria-selected={position === active}
              aria-disabled={command.disabled || undefined}
              tabIndex={-1}
              className="command-option"
              onMouseMove={() => setIndex(position)}
              onClick={() => choose(command)}
            >
              <span className="command-icon">{command.icon}</span>
              <span>
                <strong>{command.label}</strong>
                <small>{command.description}</small>
              </span>
              {position === active && <ArrowElbowDownLeft size={17} />}
            </button>
          </div>
        ))}
        {!matches.length && (
          <div className="command-empty">没有找到这个工具。换一个关键词试试。</div>
        )}
      </div>
      <footer className="command-footer">
        <span>↑ ↓ 选择</span>
        <span>Enter 打开</span>
        <span>{matches.length} 个结果</span>
      </footer>
    </Modal>
  );
}
