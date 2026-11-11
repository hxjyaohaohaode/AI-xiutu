import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from '@phosphor-icons/react';
import { useLocale } from '../i18n';
import { modelCopy } from './model-copy';
import './model-settings.css';

/** A retained page inside the existing AI panel; no dialog, portal or second session. */
export function PanelSettingsPage({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const c = modelCopy(useLocale());
  const heading = useRef<HTMLHeadingElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      previousFocus.current = document.activeElement as HTMLElement | null;
      heading.current?.focus({ preventScroll: true });
    } else if (!open && wasOpen.current) {
      const previous = previousFocus.current;
      if (previous?.isConnected && !previous.closest('[hidden], [inert]'))
        previous.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  }, [open]);
  return (
    <section
      className="ai-settings-page"
      aria-label={title}
      hidden={!open}
      inert={!open}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="ai-settings-page-header">
        <button type="button" onClick={onClose} aria-label={c.back}>
          <ArrowLeft size={18} aria-hidden />
          <span>{c.back}</span>
        </button>
        <h3 ref={heading} tabIndex={-1}>
          {title}
        </h3>
      </header>
      <div className="ai-settings-page-scroll">{children}</div>
    </section>
  );
}
