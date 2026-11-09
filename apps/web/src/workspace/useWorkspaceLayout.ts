import { useCallback, useEffect, useState } from 'react';

export type Dock = 'floating' | 'left' | 'right' | 'bottom';
export type PanelId = 'inspector' | 'ai';
export type PanelGeometry = { dock: Dock; x: number; y: number; width: number; height: number };
export type WorkspaceLayout = { theme: 'light' | 'dark'; panels: Record<PanelId, PanelGeometry> };
export type Viewport = { width: number; height: number; bucket: 'phone' | 'tablet' | 'desktop' };
const storageKey = (bucket: string) => `image-workspace:v3:${bucket}`;

/** Bottom toolbar plus breathing room; coordinates below are inside the workspace body. */
export function panelBottomOffset(view: Viewport): number {
  return view.bucket === 'phone' ? 70 : view.height <= 520 ? 64 : 84;
}

function viewport(): Viewport {
  const width = window.innerWidth;
  const height = window.innerHeight;
  return { width, height, bucket: width < 760 ? 'phone' : width < 1120 ? 'tablet' : 'desktop' };
}
function defaults(view: Viewport): WorkspaceLayout {
  const mobile = view.bucket === 'phone';
  return {
    theme: 'light',
    panels: {
      inspector: {
        dock: mobile ? 'bottom' : 'right',
        x: Math.max(16, view.width - 370),
        y: 20,
        width: 330,
        height: mobile ? Math.min(330, view.height * 0.43) : Math.min(600, view.height - 160),
      },
      ai: {
        dock: mobile ? 'bottom' : 'right',
        x: Math.max(16, view.width - 430),
        y: 20,
        width: 390,
        height: mobile ? Math.min(440, view.height * 0.56) : Math.min(680, view.height - 130),
      },
    },
  };
}
export function boundPanel(value: PanelGeometry, view: Viewport): PanelGeometry {
  const mobile = view.bucket === 'phone';
  const headerHeight = mobile ? 54 : 60;
  const availableHeight = Math.max(0, view.height - headerHeight - panelBottomOffset(view));
  const maximumHeight = Math.max(0, availableHeight - 12);
  const dockedSide = value.dock === 'left' || value.dock === 'right';
  const maximumWidth = Math.max(
    240,
    view.width - (dockedSide ? Math.min(280, view.width * 0.34) : 24),
  );
  const width = mobile ? view.width - 16 : Math.min(Math.max(260, value.width), maximumWidth);
  const bottomMaximum = Math.min(
    maximumHeight,
    Math.max(Math.min(112, maximumHeight), availableHeight - Math.min(140, availableHeight * 0.5)),
  );
  const mobileMaximum = Math.min(
    maximumHeight,
    Math.max(Math.min(112, maximumHeight), availableHeight - Math.min(180, availableHeight * 0.55)),
  );
  const height = mobile
    ? Math.min(Math.max(Math.min(150, mobileMaximum), value.height), mobileMaximum)
    : value.dock === 'bottom'
      ? Math.min(Math.max(Math.min(112, bottomMaximum), value.height), bottomMaximum)
      : Math.min(Math.max(Math.min(180, maximumHeight), value.height), maximumHeight);
  return {
    ...value,
    dock: mobile ? 'bottom' : value.dock,
    width,
    height,
    x: Math.max(12, Math.min(value.x, view.width - width - 12)),
    y: Math.max(0, Math.min(Math.max(8, value.y), availableHeight - height)),
  };
}
function read(view: Viewport): WorkspaceLayout {
  const fallback = defaults(view);
  try {
    const parsed = JSON.parse(
      localStorage.getItem(storageKey(view.bucket)) ?? 'null',
    ) as WorkspaceLayout | null;
    if (!parsed || !['light', 'dark'].includes(parsed.theme)) return fallback;
    for (const id of ['inspector', 'ai'] as const) {
      const p = parsed.panels?.[id];
      if (
        !p ||
        !['floating', 'left', 'right', 'bottom'].includes(p.dock) ||
        ![p.x, p.y, p.width, p.height].every(Number.isFinite)
      )
        return fallback;
    }
    return {
      theme: parsed.theme,
      panels: {
        inspector: boundPanel(parsed.panels.inspector, view),
        ai: boundPanel(parsed.panels.ai, view),
      },
    };
  } catch {
    return fallback;
  }
}
export function useWorkspaceLayout() {
  const [view, setView] = useState<Viewport>(viewport);
  const [layout, setLayout] = useState<WorkspaceLayout>(() => read(viewport()));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setView(viewport()));
    };
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);
  useEffect(() => {
    setLayout(read(view));
  }, [view.bucket]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(storageKey(view.bucket), JSON.stringify(layout));
      } catch {
        /* An unavailable preference store never blocks editing. */
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [layout, view.bucket]);
  const panel = (id: PanelId) => boundPanel(layout.panels[id], view);
  const updatePanel = useCallback(
    (id: PanelId, value: PanelGeometry) =>
      setLayout((previous) => ({ ...previous, panels: { ...previous.panels, [id]: value } })),
    [],
  );
  const setTheme = useCallback(
    (theme: 'light' | 'dark') => setLayout((previous) => ({ ...previous, theme })),
    [],
  );
  const reset = useCallback(() => {
    const next = viewport();
    setLayout(defaults(next));
    setFocused(false);
    try {
      localStorage.removeItem(storageKey(next.bucket));
    } catch {}
  }, []);
  return { view, layout, panel, updatePanel, setTheme, focused, setFocused, reset };
}
