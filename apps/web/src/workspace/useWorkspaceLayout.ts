import { useCallback, useEffect, useRef, useState } from 'react';
import {
  boundPanel,
  defaultPanel,
  type PanelGeometry,
  type PanelId,
  type Viewport,
} from './panelGeometry';
export * from './panelGeometry';
export type WorkspaceLayout = { theme: 'light' | 'dark'; panels: Record<PanelId, PanelGeometry> };
export const layoutStorageKey = (view: Viewport) =>
  `image-workspace:v4:${view.bucket}:${view.width > view.height ? 'landscape' : 'portrait'}`;

function viewport(): Viewport {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const body = document.querySelector<HTMLElement>('.workspace-body')?.getBoundingClientRect();
  const visibleBottom = Math.min(
    height,
    (window.visualViewport?.height ?? height) + (window.visualViewport?.offsetTop ?? 0),
  );
  return {
    width,
    height,
    bucket: width < 760 ? 'phone' : width < 1120 ? 'tablet' : 'desktop',
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
    panels: { inspector: defaultPanel('inspector', view), ai: defaultPanel('ai', view) },
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
function read(view: Viewport): WorkspaceLayout {
  try {
    // v3 has no presentation/composition fields; the same validator supplies defaults.
    return parseWorkspaceLayout(
      localStorage.getItem(layoutStorageKey(view)) ??
        localStorage.getItem(`image-workspace:v3:${view.bucket}`),
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
    return { key: layoutStorageKey(v), value: read(v) };
  });
  const [focused, setFocused] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const currentKey = layoutStorageKey(view);
  // A bucket/orientation transition must never render or persist another device's layout.
  const layout = preferences.key === currentKey ? preferences.value : read(view);
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
    const body = document.querySelector<HTMLElement>('.workspace-body');
    if (body) observer.observe(body);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    resize();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);
  useEffect(() => {
    setPreferences((previous) =>
      previous.key === currentKey ? previous : { key: currentKey, value: read(viewRef.current) },
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
  const panel = (id: PanelId) => boundPanel(layout.panels[id], view);
  const updatePanel = useCallback((id: PanelId, value: PanelGeometry) => {
    const v = viewRef.current,
      key = layoutStorageKey(v);
    setPreferences((previous) => {
      const current = previous.key === key ? previous.value : read(v);
      return {
        key,
        value: { ...current, panels: { ...current.panels, [id]: boundPanel(value, v) } },
      };
    });
  }, []);
  const setTheme = useCallback((theme: 'light' | 'dark') => {
    const v = viewRef.current,
      key = layoutStorageKey(v);
    setPreferences((previous) => ({
      key,
      value: {
        ...(previous.key === key ? previous.value : read(v)),
        theme,
      },
    }));
  }, []);
  const reset = useCallback(() => {
    const next = viewport();
    setPreferences({ key: layoutStorageKey(next), value: defaultWorkspaceLayout(next) });
    setFocused(false);
    try {
      localStorage.removeItem(layoutStorageKey(next));
    } catch {
      /* nonessential store */
    }
  }, []);
  return { view, layout, panel, updatePanel, setTheme, focused, setFocused, reset };
}
