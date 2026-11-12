import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowElbowDownLeft, MagnifyingGlass } from '@phosphor-icons/react';
import { Modal } from '../components/Ui';
import { StudioGlyph } from '../components/StudioGlyph';
import { currentCommand, filterCommands, moveCommand } from './command-model';
import { choicePointerMoved } from '../components/choice-model';
import { t, useI18n, formatNumber } from '../i18n';

export type StudioCommand = {
  id: string;
  label: string;
  description: string;
  keywords?: string;
  section: string;
  icon: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  run: () => void;
};

export function CommandMenu({
  commands,
  onClose,
}: {
  commands: StudioCommand[];
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const [query, setQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'keyboard' | 'pointer'>('keyboard');
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<{ y: number; height: number } | null>(null);
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => filterCommands(commands, query), [commands, query]);
  const active = currentCommand(matches, activeId);
  const availableCount = matches.filter((command) => !command.disabled).length;
  const groups: { section: string; start: number; commands: StudioCommand[] }[] = [];
  matches.forEach((command, position) => {
    const last = groups.at(-1);
    if (last?.section === command.section) last.commands.push(command);
    else groups.push({ section: command.section, start: position, commands: [command] });
  });

  function choose(command: StudioCommand | undefined) {
    if (!command || command.disabled) return;
    onClose();
    command.run();
  }

  function clear() {
    setQuery('');
    setActiveId(null);
    setInputMode('keyboard');
    search.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    const list = results.current;
    const option = list?.querySelector<HTMLElement>(`[data-command-index="${active}"]`);
    if (!list || !option) {
      setSelection(null);
      return;
    }
    const clip = list.getBoundingClientRect();
    const row = option.getBoundingClientRect();
    // Move this list only. scrollIntoView can move a containing dialog or canvas.
    if (row.top < clip.top) list.scrollTop += row.top - clip.top;
    else if (row.bottom > clip.bottom) list.scrollTop += row.bottom - clip.bottom;
    const measure = () => {
      const listRect = list.getBoundingClientRect();
      const optionRect = option.getBoundingClientRect();
      const next = { y: optionRect.top - listRect.top + list.scrollTop, height: optionRect.height };
      setSelection((previous) =>
        previous?.y === next.y && previous?.height === next.height ? previous : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    observer.observe(option);
    return () => observer.disconnect();
  }, [active, matches, locale]);

  return (
    <Modal
      title={t('搜索工具与操作')}
      onClose={onClose}
      className="studio-command-modal"
      profile="command"
      initialFocusRef={search}
    >
      <div className="command-search">
        <MagnifyingGlass size={21} aria-hidden />
        <input
          ref={search}
          type="search"
          placeholder={t('搜索曲线、局部、导出…')}
          aria-label={t('搜索工具与操作')}
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-describedby={`${id}-count`}
          aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
          value={query}
          autoComplete="off"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveId(null);
            setInputMode('keyboard');
          }}
          onKeyDown={(event) => {
            if (
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey
            )
              return;
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              setInputMode('keyboard');
              const next =
                event.key === 'Home'
                  ? moveCommand(matches, -1, 1)
                  : event.key === 'End'
                    ? moveCommand(matches, -1, -1)
                    : moveCommand(matches, active, event.key === 'ArrowDown' ? 1 : -1);
              setActiveId(next >= 0 ? matches[next]!.id : null);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(active >= 0 ? matches[active] : undefined);
            }
          }}
        />
        {query && (
          <button
            type="button"
            className="command-clear"
            aria-label={t('清空搜索')}
            onClick={clear}
          >
            <StudioGlyph name="close" size={17} />
          </button>
        )}
        <kbd aria-hidden>Esc</kbd>
      </div>
      <div
        ref={results}
        id={`${id}-list`}
        role="listbox"
        aria-label={t('工具与操作')}
        className="command-results"
        data-selection-ready={selection ? 'true' : undefined}
        data-input-mode={inputMode}
      >
        {selection && (
          <span
            className="command-selection"
            aria-hidden="true"
            style={{ transform: `translateY(${selection.y}px)`, height: selection.height }}
          />
        )}
        {groups.map((group) => (
          <div
            key={`${group.section}-${group.start}`}
            role="group"
            aria-labelledby={`${id}-section-${group.start}`}
          >
            <p id={`${id}-section-${group.start}`} className="command-section">
              {group.section}
            </p>
            {group.commands.map((command, localPosition) => {
              const position = group.start + localPosition;
              return (
                <div
                  key={command.id}
                  id={`${id}-${position}`}
                  role="option"
                  aria-label={command.label}
                  aria-selected={position === active}
                  aria-disabled={command.disabled || undefined}
                  aria-describedby={`${id}-${position}-description`}
                  data-command-index={position}
                  data-action={command.id === 'draw' ? 'open-sketch' : undefined}
                  className="command-option"
                  onPointerMove={(event) => {
                    if (event.pointerType === 'touch' || command.disabled) return;
                    const next = { x: event.clientX, y: event.clientY };
                    const moved = choicePointerMoved(pointer.current, next);
                    pointer.current = next;
                    if (inputMode === 'keyboard' && !moved) return;
                    setInputMode('pointer');
                    setActiveId(command.id);
                  }}
                  onPointerDown={(event) => {
                    if (event.pointerType !== 'touch') event.preventDefault();
                  }}
                  onClick={() => choose(command)}
                >
                  <span className="command-icon" aria-hidden>
                    {command.icon}
                  </span>
                  <span className="command-copy">
                    <strong>{command.label}</strong>
                    <small id={`${id}-${position}-description`}>
                      {command.disabled
                        ? (command.disabledReason ?? `${command.description} · ${t('当前不可用')}`)
                        : command.description}
                    </small>
                  </span>
                  {position === active && <ArrowElbowDownLeft size={17} aria-hidden />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {!matches.length && (
        <div className="command-empty">
          <MagnifyingGlass size={26} aria-hidden />
          <strong>{t('没有找到相关操作')}</strong>
          <p>{t('试试工具名称，或查看全部操作。')}</p>
          <button type="button" onClick={clear}>
            {t('查看全部操作')}
          </button>
        </div>
      )}
      {!!matches.length && !availableCount && (
        <p className="command-unavailable">{t('这些操作当前不可用，可查看上方说明。')}</p>
      )}
      <footer className="command-footer">
        <span className="command-key-hint">
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          {t('选择')}
        </span>
        <span className="command-key-hint">
          <kbd>Enter</kbd>
          {t('打开')}
        </span>
        <span id={`${id}-count`} role="status" aria-live="polite" aria-atomic="true">
          {t('{count} 个结果', { count: formatNumber(matches.length) })}
          {matches.length > availableCount &&
            ` · ${t('{count} 个可用', { count: formatNumber(availableCount) })}`}
        </span>
      </footer>
    </Modal>
  );
}
