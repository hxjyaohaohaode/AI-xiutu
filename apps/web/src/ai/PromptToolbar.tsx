import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CaretDown, Check, Plus } from '@phosphor-icons/react';
import { IconButton } from '../components/Ui';

type SourceAction = {
  label: string;
  icon: ReactNode;
  run: () => void;
  disabled?: boolean;
  pressed?: boolean;
};

function highlightSource(popup: HTMLDivElement, target: EventTarget | null) {
  if (!(target instanceof Element)) return;
  const row = target.closest<HTMLButtonElement>('button:not(:disabled)');
  if (!row || !popup.contains(row)) return;
  popup.style.setProperty('--source-row-y', `${row.offsetTop}px`);
  popup.style.setProperty('--source-row-height', `${row.offsetHeight}px`);
  popup.dataset.highlight = 'true';
}

/** Prompt Bar #114 layout. Callers supply the real context, model and request actions. */
export function PromptToolbar({
  attachment,
  model,
  modelLabel,
  openSettings,
  children,
}: {
  attachment?: { label: string; actions: SourceAction[] };
  model: string;
  modelLabel: string;
  openSettings: () => void;
  children: ReactNode;
}) {
  const menuId = useId();
  const add = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const placeMenu = () => {
    const trigger = add.current;
    const popup = menu.current;
    const surface = trigger?.closest('form')?.getBoundingClientRect();
    if (!popup || !trigger || !surface) return;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const left = viewport?.offsetLeft ?? 0;
    const bottom = top + (viewport?.height ?? innerHeight);
    const width = viewport?.width ?? innerWidth;
    const popupWidth = Math.min(400, width - 16, surface.width);
    popup.style.width = `${popupWidth}px`;
    popup.style.left = `${Math.max(left + 8, Math.min(surface.left, left + width - popupWidth - 8))}px`;
    const above = surface.top - top - 12;
    const anchor = trigger.getBoundingClientRect();
    const below = bottom - anchor.bottom - 12;
    popup.dataset.placement = above >= below ? 'above' : 'below';
    popup.style.top = above >= below ? 'auto' : `${anchor.bottom + 6}px`;
    popup.style.bottom = above >= below ? `${innerHeight - surface.top + 8}px` : 'auto';
    popup.style.maxHeight = `${Math.max(48, Math.max(above, below))}px`;
  };
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    window.addEventListener('resize', placeMenu);
    viewport?.addEventListener('resize', placeMenu);
    viewport?.addEventListener('scroll', placeMenu);
    return () => {
      window.removeEventListener('resize', placeMenu);
      viewport?.removeEventListener('resize', placeMenu);
      viewport?.removeEventListener('scroll', placeMenu);
    };
  }, [open]);
  return (
    <div className="ai-composer-toolbar">
      <div className="ai-composer-options">
        {attachment && (
          <IconButton
            ref={add}
            className="ai-add-context"
            label={attachment.label}
            aria-expanded={open}
            aria-controls={menuId}
            popoverTarget={menuId}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown') return;
              event.preventDefault();
              if (!open) {
                placeMenu();
                menu.current?.showPopover();
              }
              menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
            }}
            onClick={placeMenu}
          >
            <Plus size={20} weight="regular" />
          </IconButton>
        )}
        {attachment && (
          <div
            id={menuId}
            ref={menu}
            popover="auto"
            className="ai-prompt-source-menu"
            role="group"
            aria-label={attachment.label}
            onToggle={(event) => {
              const shown = event.newState === 'open';
              if (!shown) delete event.currentTarget.dataset.highlight;
              setOpen(shown);
            }}
            onFocus={(event) => highlightSource(event.currentTarget, event.target)}
            onPointerOver={(event) => {
              if (event.pointerType !== 'touch') highlightSource(event.currentTarget, event.target);
            }}
            onPointerLeave={(event) => {
              if (event.currentTarget.contains(document.activeElement) &&
                document.activeElement?.matches(':focus-visible')) {
                highlightSource(event.currentTarget, document.activeElement);
              } else delete event.currentTarget.dataset.highlight;
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const step = event.key === 'ArrowDown' ? 1 : -1;
              const next = buttons[(index + step + buttons.length) % buttons.length];
              if (next instanceof HTMLButtonElement) {
                event.preventDefault();
                next.focus();
              }
            }}
          >
            {attachment.actions.map(({ label, icon, run, disabled, pressed }) => (
              <button
                key={label}
                type="button"
                disabled={disabled}
                aria-pressed={pressed}
                onClick={() => {
                  menu.current?.hidePopover();
                  run();
                }}
              >
                {icon}
                <span>{label}</span>
                {pressed && <Check size={15} aria-hidden />}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          className="ai-model-trigger"
          aria-label={modelLabel}
          onClick={openSettings}
        >
          <span>{model}</span>
          <CaretDown size={12} />
        </button>
      </div>
      <div className="ai-composer-tools">{children}</div>
    </div>
  );
}
