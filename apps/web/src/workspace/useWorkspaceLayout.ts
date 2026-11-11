import { useCallback, useEffect, useRef, useState } from 'react';
import {
  boundPanel,
  defaultPanel,
  type PanelGeometry,
  type PanelId,
  type Viewport,
} from './panelGeometry';
export * from './panelGeometry';
export type WorkspaceLayout = {
  theme: 'light' | 'dark';
  panels: Record<PanelId, PanelGeometry>;
  viewport?: { height: number };
};
export type PanelGeometryChange = { record?: boolean; previous?: PanelGeometry };
type LayoutStep = { id: PanelId; geometry: PanelGeometry };
export const layoutStorageKey = (view: Viewport) =>
  `image-workspace:v7:${view.bucket}:${view.width > view.height ? 'landscape' : 'portrait'}`;

function viewport(): Viewport {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const body = document.querySelector<HTMLElement>('.workspace-body')?.getBoundingClientRect();
  const shelf = document.querySelector<HTMLElement>('.floating-tool-dock')?.getBoundingClientRect();
  const visibleBottom = Math.min(
    height,
    (window.visualViewport?.height ?? height) + (window.visualViewport?.offsetTop ?? 0),
  );
  return {
    width,
    height,
    bucket: width < 760 ? 'phone' : width < 1120 ? 'tablet' : 'desktop',
    ...(shelf && shelf.height > 0 ? { toolShelfHeight: shelf.height } : {}),
    ...(body
      ? {
          workspaceWidth: body.width,
          workspaceHeight: Math.max(0, Math.min(body.height, visibleBottom - body.top)),
        }
      : {}),
  };
}
export function defaultWorkspaceLayout(view: Viewport): WorkspaceLayout {
  return {
    theme: 'light',
    viewport: { height: view.height },
    panels: { inspector: defaultPanel('inspector', view), ai: defaultPanel('ai', view) },
  };
}
/** Preserve a manually chosen proportion when the phone window changes height. */
export function adaptWorkspaceLayout(layout: WorkspaceLayout, view: Viewport): WorkspaceLayout {
  const previousHeight = layout.viewport?.height;
  const scale =
    view.bucket === 'phone' && Number.isFinite(previousHeight) && previousHeight! > 54
      ? Math.max(1, view.height - 54) / (previousHeight! - 54)
      : 1;
  const adapt = (id: PanelId, panel: PanelGeometry) =>
    boundPanel(
      {
        ...panel,
        height: panel.dock === 'bottom' ? panel.height * scale : panel.height,
      },
      view,
      id,
    );
  return {
    ...layout,
    viewport: { height: view.height },
    panels: {
      inspector: adapt('inspector', layout.panels.inspector),
      ai: adapt('ai', layout.panels.ai),
    },
  };
}
export function parseWorkspaceLayout(raw: string | null, view: Viewport): WorkspaceLayout {
  const fallback = defaultWorkspaceLayout(view);
  try {
    const parsed = JSON.parse(raw ?? 'null') as WorkspaceLayout | null;
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
    return adaptWorkspaceLayout(
      {
        theme: parsed.theme,
        viewport: parsed.viewport,
        panels: {
          inspector: parsed.panels.inspector,
          ai: parsed.panels.ai,
        },
      },
      view,
    );
  } catch {
    return fallback;
  }
}
function read(view: Viewport): WorkspaceLayout {
  try {
    // Phone starts with the new attached layout. Keep old desktop/tablet user choices.
    return parseWorkspaceLayout(
      localStorage.getItem(layoutStorageKey(view)) ??
        (view.bucket !== 'phone'
          ? (localStorage.getItem(
              `image-workspace:v6:${view.bucket}:${view.width > view.height ? 'landscape' : 'portrait'}`,
            ) ??
            localStorage.getItem(
              `image-workspace:v5:${view.bucket}:${view.width > view.height ? 'landscape' : 'portrait'}`,
            ) ??
            localStorage.getItem(
              `image-workspace:v4:${view.bucket}:${view.width > view.height ? 'landscape' : 'portrait'}`,
            ) ??
            localStorage.getItem(`image-workspace:v3:${view.bucket}`))
          : null),
      view,
    );
  } catch {
    return defaultWorkspaceLayout(view);
  }
}
export function useWorkspaceLayout() {
  const [view, setView] = useState<Viewport>(viewport);
  const [preferences, setPreferences] = useState(() => {
    const v = viewport();
    return { key: layoutStorageKey(v), value: read(v), history: [] as LayoutStep[] };
  });
  const [focused, setFocused] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const currentKey = layoutStorageKey(view);
  // A bucket/orientation transition must never render or persist another device's layout.
  const layout =
    preferences.key === currentKey ? adaptWorkspaceLayout(preferences.value, view) : read(view);
  useEffect(() => {
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = viewport();
        setView((previous) =>
          Object.keys(next).every(
            (key) => previous[key as keyof Viewport] === next[key as keyof Viewport],
          )
            ? previous
            : next,
        );
      });
    };
    const observer = new ResizeObserver(resize);
    let body = document.querySelector<HTMLElement>('.workspace-body');
    if (body) observer.observe(body);
    let shelf = document.querySelector<HTMLElement>('.floating-tool-dock');
    if (shelf) observer.observe(shelf);
    const nodes = new MutationObserver(() => {
      const nextBody = document.querySelector<HTMLElement>('.workspace-body');
      if (nextBody !== body) {
        if (body) observer.unobserve(body);
        body = nextBody;
        if (body) observer.observe(body);
        resize();
      }
      const next = document.querySelector<HTMLElement>('.floating-tool-dock');
      if (next !== shelf) {
        if (shelf) observer.unobserve(shelf);
        shelf = next;
        if (shelf) observer.observe(shelf);
        resize();
      }
    });
    const root = document.getElementById('root');
    if (root ?? body) nodes.observe((root ?? body)!, { childList: true, subtree: true });
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize, { passive: true });
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      nodes.disconnect();
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
    };
  }, []);
  useEffect(() => {
    const currentView = viewRef.current;
    if (layoutStorageKey(currentView) !== currentKey) return;
    setPreferences((previous) =>
      previous.key === currentKey
        ? previous
        : { key: currentKey, value: read(currentView), history: [] },
    );
  }, [currentKey]);
  useEffect(() => {
    if (preferences.key !== currentKey) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(preferences.key, JSON.stringify(preferences.value));
      } catch {
        /* Preferences being unavailable must not block editing. */
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [preferences, currentKey]);
  const panel = (id: PanelId) => boundPanel(layout.panels[id], view, id);
  const updatePanel = useCallback(
    (id: PanelId, value: PanelGeometry, change: PanelGeometryChange = {}) => {
      const v = viewRef.current,
        key = layoutStorageKey(v);
      // Old pointer callbacks cannot save desktop geometry under a new phone key.
      if (key !== currentKey) return;
      setPreferences((previous) => {
        const current = previous.key === key ? adaptWorkspaceLayout(previous.value, v) : read(v);
        const next = boundPanel(value, v, id);
        const old = boundPanel(change.previous ?? current.panels[id], v, id);
        const history = previous.key === key ? previous.history : [];
        const record = change.record !== false && JSON.stringify(old) !== JSON.stringify(next);
        return {
          key,
          value: { ...current, panels: { ...current.panels, [id]: next } },
          history: record ? [...history, { id, geometry: old }].slice(-24) : history,
        };
      });
    },
    [currentKey],
  );
  const setTheme = useCallback((theme: 'light' | 'dark') => {
    const v = viewRef.current,
      key = layoutStorageKey(v);
    setPreferences((previous) => ({
      key,
      history: previous.key === key ? previous.history : [],
      value: {
        ...(previous.key === key ? previous.value : read(v)),
        theme,
      },
    }));
  }, []);
  const reset = useCallback(() => {
    const next = viewport();
    setPreferences((previous) => {
      const key = layoutStorageKey(next),
        value = defaultWorkspaceLayout(next);
      const current =
        previous.key === key ? adaptWorkspaceLayout(previous.value, next) : read(next);
      const history = previous.key === key ? previous.history : [];
      const steps = (['inspector', 'ai'] as const).flatMap((id) =>
        JSON.stringify(current.panels[id]) === JSON.stringify(value.panels[id])
          ? []
          : [{ id, geometry: current.panels[id] }],
      );
      return { key, value, history: [...history, ...steps].slice(-24) };
    });
    setFocused(false);
    try {
      localStorage.removeItem(layoutStorageKey(next));
    } catch {
      /* nonessential store */
    }
  }, []);
  const canUndoPanel = (id: PanelId) =>
    preferences.key === currentKey && preferences.history.some((step) => step.id === id);
  const undoPanel = (id: PanelId) => {
    const view = viewRef.current;
    setPreferences((previous) => {
      if (previous.key !== layoutStorageKey(view)) return previous;
      let index = previous.history.length - 1;
      while (index >= 0 && previous.history[index]!.id !== id) index--;
      if (index < 0) return previous;
      const current = adaptWorkspaceLayout(previous.value, view);
      return {
        ...previous,
        value: {
          ...current,
          panels: {
            ...current.panels,
            [id]: boundPanel(previous.history[index]!.geometry, view, id),
          },
        },
        history: previous.history.filter((_, i) => i !== index),
      };
    });
  };
  return {
    view,
    layout,
    panel,
    updatePanel,
    canUndoPanel,
    undoPanel,
    setTheme,
    focused,
    setFocused,
    reset,
  };
}
