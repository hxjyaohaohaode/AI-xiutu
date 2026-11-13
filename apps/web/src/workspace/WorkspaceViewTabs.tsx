import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUpRight } from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import type { View } from '../lib/types';
import { StudioGlyph } from '../components/StudioGlyph';
import { useKinetic } from '../motion/useKinetic';
import { workspaceViews } from './WorkspaceNavigation';
import './navigation.css';

/** Controlled destinations with two measured edges; motion never changes the route.
 * Reference mechanisms: React Bits PillNav #78 and LineSidebar #68. */
const primaryViews = workspaceViews.filter(({ id }) => id === 'editor' || id === 'works');
const cardGroups = [
  { label: '创作', views: primaryViews },
  { label: '项目', views: workspaceViews.filter(({ id }) => id === 'collaborate' || id === 'docs') },
  { label: '账号', views: workspaceViews.filter(({ id }) => id === 'usage') },
];

export function WorkspaceViewTabs({
  value,
  onChange,
  menuEnabled,
}: {
  value: View;
  onChange: (value: View) => void;
  menuEnabled: boolean;
}) {
  const locale = useLocale();
  const menuId = useId();
  const wrapper = useRef<HTMLDivElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const indicator = useRef<HTMLSpanElement>(null);
  const projectTrigger = useRef<HTMLButtonElement>(null);
  const compactTrigger = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const open = menuEnabled && menuOpen;
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const measured = useRef(false);
  const left = useKinetic(
    0,
    (position) => {
      indicator.current?.style.setProperty('--nav-left', `${position}px`);
    },
    { stiffness: 420, damping: 36, precision: 0.03 },
  );
  const right = useKinetic(
    0,
    (position) => {
      indicator.current?.style.setProperty('--nav-right', `${position}px`);
    },
    { stiffness: 540, damping: 39, precision: 0.03 },
  );

  useLayoutEffect(() => {
    const outer = wrapper.current;
    const nav = navigation.current;
    const header = outer?.parentElement;
    if (!outer || !nav || !header) return;
    let live = true;
    const measure = () => {
      if (!live || !header.clientWidth) return;
      const styles = getComputedStyle(header);
      const siblings = Array.from(header.children).filter(
        (node): node is HTMLElement => node instanceof HTMLElement && node !== outer,
      );
      const padding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const gap = parseFloat(styles.columnGap) || 0;
      const available =
        header.clientWidth -
        padding -
        gap * siblings.length -
        siblings.reduce((sum, node) => sum + node.getBoundingClientRect().width, 0);
      // The inert compact copy keeps its intrinsic width, so collapsing cannot
      // make the next measurement incorrectly decide that all tabs fit again.
      const required = nav.scrollWidth;
      const narrow = window.matchMedia('(max-width: 759px)').matches;
      const nextCompact =
        narrow || (compactRef.current ? available < required + 12 : available < required);
      if (nextCompact !== compactRef.current) {
        compactRef.current = nextCompact;
        setCompact(nextCompact);
      }
      const selected = nav.querySelector<HTMLButtonElement>('[aria-current="page"]');
      if (!selected) {
        if (indicator.current) delete indicator.current.dataset.ready;
        return;
      }
      const box = nav.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      const start = item.left - box.left + nav.scrollLeft;
      const end = start + item.width;
      const forward = start >= left.target;
      left.configure({ stiffness: forward ? 420 : 540, damping: forward ? 36 : 39 });
      right.configure({ stiffness: forward ? 540 : 420, damping: forward ? 39 : 36 });
      if (!measured.current || nextCompact) {
        left.jump(start);
        right.jump(end);
      } else {
        left.setTarget(start);
        right.setTarget(end);
      }
      measured.current = true;
      if (indicator.current) indicator.current.dataset.ready = 'true';
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(header);
    observer?.observe(nav);
    for (const child of header.children) if (child !== outer) observer?.observe(child);
    for (const button of nav.querySelectorAll('button')) observer?.observe(button);
    void document.fonts?.ready.then(measure);
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [value, locale, left, right]);

  useEffect(() => {
    setMenuOpen(false);
  }, [menuEnabled, value]);

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !wrapper.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      setMenuOpen(false);
      const trigger = compactRef.current ? compactTrigger.current : projectTrigger.current;
      trigger?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open]);

  function selectView(next: View, fromMenu = false) {
    setMenuOpen(false);
    if (fromMenu) {
      const trigger = compact ? compactTrigger.current : projectTrigger.current;
      trigger?.focus({ preventScroll: true });
    }
    onChange(next);
  }

  function toggleMenu() {
    if (menuEnabled) setMenuOpen((previous) => !previous);
  }

  const current = workspaceViews.find((item) => item.id === value)!;
  const projectActive = value !== 'editor' && value !== 'works';
  return (
    <div ref={wrapper} className="workspace-view-navigation" data-compact={compact}>
      <nav
        ref={navigation}
        className="compact-view-tabs"
        aria-label={t('工作视图')}
        aria-hidden={compact}
        inert={compact}
      >
        <span ref={indicator} className="workspace-view-indicator" aria-hidden="true" />
        {primaryViews.map((item) => (
          <button
            type="button"
            key={item.id}
            data-view={item.id}
            className={value === item.id ? 'active' : ''}
            aria-label={t(item.label)}
            aria-current={value === item.id ? 'page' : undefined}
            onClick={() => selectView(item.id)}
          >
            <StudioGlyph name={item.id} size={15} />
            <span>{t(item.label)}</span>
          </button>
        ))}
        <button
          ref={projectTrigger}
          type="button"
          className={`project-view-trigger${projectActive ? ' active' : ''}`}
          aria-label={t('项目与用量')}
          aria-controls={menuId}
          aria-expanded={open}
          aria-current={projectActive ? 'page' : undefined}
          onClick={toggleMenu}
        >
          <span>{t(projectActive ? current.label : '项目')}</span>
          <StudioGlyph name="chevron" size={12} />
        </button>
      </nav>
      <button
        ref={compactTrigger}
        type="button"
        className="mobile-view-trigger"
        aria-label={t('切换工作视图')}
        title={t(current.label)}
        aria-controls={menuId}
        aria-expanded={open}
        hidden={!compact}
        onClick={toggleMenu}
      >
        <StudioGlyph name={value} size={18} />
        <span>{t(current.label)}</span>
        <StudioGlyph name="chevron" size={12} />
      </button>
      <nav
        id={menuId}
        className="workspace-card-nav"
        aria-label={t('切换工作视图')}
        aria-hidden={!open}
        inert={!open}
        data-open={open || undefined}
      >
        <div className="workspace-card-nav-clip">
          <div className="workspace-card-nav-grid">
            {cardGroups.map(({ label, views }) => (
              <div className="workspace-nav-card" key={label} role="group" aria-label={t(label)}>
                <span className="workspace-nav-card-title" aria-hidden="true">
                  {t(label)}
                </span>
                <div className="workspace-nav-card-links">
                  {views.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      data-view={item.id}
                      aria-current={value === item.id ? 'page' : undefined}
                      onClick={() => selectView(item.id, true)}
                    >
                      <span className="workspace-nav-card-arrow" aria-hidden="true">
                        <ArrowUpRight size={15} />
                        <ArrowUpRight size={15} />
                      </span>
                      <span>{t(item.label)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </nav>
    </div>
  );
}
