/** All rectangles use CSS pixels relative to the measured workspace body. */
export type Dock = 'floating' | 'left' | 'right' | 'bottom';
export type PanelId = 'inspector' | 'ai';
export type PanelPresentation = 'normal' | 'maximized' | 'collapsed';
export type PanelComposition = 'reflow' | 'overlay';
export type PanelGeometry = {
  dock: Dock;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Presentation never replaces the saved normal rectangle. */
  presentation?: PanelPresentation;
  composition?: PanelComposition;
};
export type Viewport = {
  width: number;
  height: number;
  bucket: 'phone' | 'tablet' | 'desktop';
  /** Optional measured dimensions include status banners and on-screen keyboard changes. */
  workspaceWidth?: number;
  workspaceHeight?: number;
  /** Measured tool shelf includes safe-area padding on touch devices. */
  toolShelfHeight?: number;
};
export type PanelEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export type PanelRectangle = { x: number; y: number; width: number; height: number };
export type CanvasInsets = { left: number; right: number; bottom: number };
const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback);
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
export const PANEL_MARGIN = 8;

/** Leaves the always-reachable tool shelf clear, even while a panel fills the work area. */
export function panelBottomOffset(view: Viewport): number {
  return view.bucket === 'phone'
    ? Math.max(48, finite(view.toolShelfHeight ?? 62, 62))
    : view.height <= 520
      ? 64
      : 84;
}
export function panelHeaderHeight(view: Viewport): number {
  return view.bucket === 'phone' ? 44 : view.height <= 520 ? 40 : 44;
}
export function workspaceSize(view: Viewport): { width: number; height: number } {
  return {
    width: Math.max(0, finite(view.workspaceWidth ?? view.width, 0)),
    height: Math.max(
      0,
      finite(view.workspaceHeight ?? view.height - (view.bucket === 'phone' ? 54 : 60), 0),
    ),
  };
}

/** A queued pointer update belongs to the exact workspace where the gesture began. */
export function panelGestureViewportKey(view: Viewport): string {
  const body = workspaceSize(view);
  return [
    view.bucket,
    view.width,
    view.height,
    body.width,
    body.height,
    panelBottomOffset(view),
  ].join(':');
}
export function panelBounds(view: Viewport, dock: Dock = 'floating', id?: PanelId) {
  const body = workspaceSize(view);
  const attached = view.bucket === 'phone' && dock === 'bottom';
  const maxWidth = Math.max(0, body.width - (attached ? 0 : PANEL_MARGIN * 2));
  const maxHeight = Math.max(
    0,
    body.height - panelBottomOffset(view) - (attached ? PANEL_MARGIN : PANEL_MARGIN * 2),
  );
  return {
    width: body.width,
    height: body.height,
    minWidth: attached ? maxWidth : Math.min(view.bucket === 'phone' ? 224 : 240, maxWidth),
    maxWidth,
    minHeight: Math.min(
      id === 'ai' ? (view.bucket === 'phone' ? 224 : 260) : view.height <= 520 ? 96 : 112,
      maxHeight,
    ),
    maxHeight,
  };
}

/** Bounds are viewport/reachability constraints, not fixed product size presets. */
export function boundPanel(value: PanelGeometry, view: Viewport, id?: PanelId): PanelGeometry {
  const b = panelBounds(view, value.dock, id);
  const width = clamp(finite(value.width, 330), b.minWidth, b.maxWidth);
  const height = clamp(finite(value.height, 300), b.minHeight, b.maxHeight);
  const presentation = ['normal', 'maximized', 'collapsed'].includes(value.presentation ?? '')
    ? value.presentation
    : 'normal';
  const composition = value.composition === 'overlay' ? 'overlay' : 'reflow';
  return {
    dock: ['floating', 'left', 'right', 'bottom'].includes(value.dock) ? value.dock : 'floating',
    width,
    height,
    x: clamp(finite(value.x, PANEL_MARGIN), PANEL_MARGIN, b.width - width - PANEL_MARGIN),
    y: clamp(
      finite(value.y, PANEL_MARGIN),
      PANEL_MARGIN,
      b.height -
        panelBottomOffset(view) -
        (presentation === 'collapsed' ? panelHeaderHeight(view) : height) -
        PANEL_MARGIN,
    ),
    presentation,
    composition,
  };
}

/** Display mode is derived; maximizing/collapsing does not discard the user's rectangle. */
export function panelRectangle(value: PanelGeometry, view: Viewport): PanelRectangle {
  const normal = boundPanel(value, view);
  const b = panelBounds(view, normal.dock);
  const attached = view.bucket === 'phone' && normal.dock === 'bottom';
  if (normal.presentation === 'maximized')
    return {
      x: attached ? 0 : PANEL_MARGIN,
      y: PANEL_MARGIN,
      width: b.maxWidth,
      height: b.maxHeight,
    };
  const height =
    normal.presentation === 'collapsed'
      ? Math.min(panelHeaderHeight(view), b.maxHeight)
      : normal.height;
  return {
    x:
      normal.dock === 'left'
        ? PANEL_MARGIN
        : normal.dock === 'right'
          ? b.width - normal.width - PANEL_MARGIN
          : normal.dock === 'bottom'
            ? (b.width - normal.width) / 2
            : normal.x,
    y:
      normal.dock === 'bottom'
        ? b.height - panelBottomOffset(view) - height - (attached ? 0 : PANEL_MARGIN)
        : normal.dock === 'left' || normal.dock === 'right'
          ? PANEL_MARGIN
          : normal.y,
    width: normal.width,
    height,
  };
}

function canvasNavigationInset(view: Viewport): number {
  return view.bucket === 'phone' ? panelBottomOffset(view) : view.height <= 520 ? 58 : 78;
}

function dockedCanvasInsets(rect: PanelRectangle, dock: Dock, view: Viewport): CanvasInsets {
  return {
    left: dock === 'left' ? rect.width + PANEL_MARGIN * 2 : 0,
    right: dock === 'right' ? rect.width + PANEL_MARGIN * 2 : 0,
    bottom:
      dock === 'bottom'
        ? rect.height +
          panelBottomOffset(view) +
          (view.bucket === 'phone' ? PANEL_MARGIN : PANEL_MARGIN * 2)
        : canvasNavigationInset(view),
  };
}

/**
 * The photo's fit rectangle, not the editor-content box. Keep these chrome insets
 * aligned with workspace.css .content-first.has-image/.image-viewport: short
 * windows override phone/desktop rules. CanvasStage's fit calculation also leaves
 * 12px around each photo edge. Neither toolbar space nor this padding can display
 * image pixels, so both must be deducted when budgeting a docked panel's photo area.
 * The fitted image can be smaller still, depending on its aspect ratio.
 */
export function canvasImageArea(view: Viewport, insets: CanvasInsets) {
  const body = workspaceSize(view);
  const short = view.height <= 520;
  const horizontalChrome = short ? 12 : view.bucket === 'phone' ? 0 : 16;
  const verticalChrome = short ? 54 : view.bucket === 'phone' ? 99 : 108;
  const fitPadding = 24;
  return {
    width: Math.max(0, body.width - insets.left - insets.right - horizontalChrome - fitPadding),
    height: Math.max(0, body.height - insets.bottom - verticalChrome - fitPadding),
  };
}

function minimumImageArea(view: Viewport) {
  const body = workspaceSize(view);
  return {
    width: Math.min(200, body.width * 0.35),
    height: Math.min(160, body.height * 0.35),
  };
}

export function panelOverlayReason(
  value: PanelGeometry,
  view: Viewport,
): 'floating' | 'maximized' | 'collapsed' | 'user' | null {
  if (value.presentation === 'maximized') return 'maximized';
  if (value.dock === 'floating') return 'floating';
  if (value.presentation === 'collapsed' && value.dock !== 'bottom') return 'collapsed';
  if (value.composition === 'overlay') return 'user';
  return null;
}

/**
 * Low room is a reason to offer the existing collapse/restore action, not consent
 * to cover the photo. Only an explicit presentation/composition choice overlays.
 */
export function panelNeedsPhotoSpace(value: PanelGeometry, view: Viewport): boolean {
  if (panelOverlayReason(value, view)) return false;
  const rect = panelRectangle(value, view);
  const available = canvasImageArea(view, dockedCanvasInsets(rect, value.dock, view));
  const minimum = minimumImageArea(view);
  return (
    available.width <= 0 ||
    available.height <= 0 ||
    available.width < minimum.width ||
    available.height < minimum.height
  );
}
export function workspaceCanvasInsets(
  value: PanelGeometry | null,
  view: Viewport,
  focused = false,
): CanvasInsets {
  const bottom = focused ? 0 : canvasNavigationInset(view);
  if (!value || focused || panelOverlayReason(value, view)) return { left: 0, right: 0, bottom };
  // Preserve the complete exclusion rectangle even for a very large docked panel.
  // Fitting a larger photo behind it is not more usable visible photo space.
  return dockedCanvasInsets(panelRectangle(value, view), value.dock, view);
}

/** Convert docking to its visible rectangle before moving, without a pointer-down jump. */
export function floatPanel(value: PanelGeometry, view: Viewport): PanelGeometry {
  const rect = panelRectangle(value, view);
  return boundPanel(
    {
      ...value,
      ...rect,
      dock: 'floating',
      height: value.presentation === 'collapsed' ? value.height : rect.height,
      presentation: value.presentation === 'collapsed' ? 'collapsed' : 'normal',
    },
    view,
  );
}

/** Resize from an edge. The opposite floating edge stays fixed, including at minimum size. */
export function resizePanel(
  value: PanelGeometry,
  edge: PanelEdge,
  dx: number,
  dy: number,
  view: Viewport,
  id?: PanelId,
): PanelGeometry {
  const initial = boundPanel(value, view, id);
  const b = panelBounds(view, initial.dock, id);
  const rect = panelRectangle(initial, view);
  let left = rect.x,
    top = rect.y,
    width = rect.width,
    height = rect.height;
  if (edge.includes('e')) width += finite(dx, 0);
  if (edge.includes('w')) {
    width -= finite(dx, 0);
    left += finite(dx, 0);
  }
  if (edge.includes('s')) height += finite(dy, 0);
  if (edge.includes('n')) {
    height -= finite(dy, 0);
    top += finite(dy, 0);
  }
  width = clamp(width, b.minWidth, b.maxWidth);
  height = clamp(height, b.minHeight, b.maxHeight);
  if (edge.includes('w')) left = rect.x + rect.width - width;
  if (edge.includes('n')) top = rect.y + rect.height - height;
  // Side docks keep the outer viewport edge fixed while their inner edge moves.
  // Bottom sheets keep their base fixed; horizontal resize grows around the center.
  if (initial.dock === 'bottom') {
    const horizontal = edge.includes('w') ? -dx : edge.includes('e') ? dx : 0;
    width = clamp(rect.width + finite(horizontal, 0) * 2, b.minWidth, b.maxWidth);
    if (!edge.includes('n') && !edge.includes('s')) height = rect.height;
    return boundPanel({ ...initial, width, height, presentation: 'normal' }, view, id);
  }
  if (initial.dock === 'floating') {
    // Bounds constrain the moving edge, not the anchored edge. This avoids sliding a
    // panel sideways when its outer resize edge reaches the edge of the screen.
    const right = rect.x + rect.width,
      bottom = rect.y + rect.height;
    if (edge.includes('w')) {
      left = Math.max(PANEL_MARGIN, left);
      width = right - left;
    }
    if (edge.includes('n')) {
      top = Math.max(PANEL_MARGIN, top);
      height = bottom - top;
    }
    if (edge.includes('e')) width = Math.min(width, b.width - left - PANEL_MARGIN);
    if (edge.includes('s'))
      height = Math.min(height, b.height - panelBottomOffset(view) - top - PANEL_MARGIN);
  }
  return boundPanel(
    { ...initial, x: left, y: top, width, height, presentation: 'normal' },
    view,
    id,
  );
}
export function movePanel(
  value: PanelGeometry,
  dx: number,
  dy: number,
  view: Viewport,
): PanelGeometry {
  const initial = floatPanel(value, view);
  return boundPanel(
    { ...initial, x: initial.x + finite(dx, 0), y: initial.y + finite(dy, 0) },
    view,
  );
}

export function defaultPanel(id: PanelId, view: Viewport): PanelGeometry {
  const body = workspaceSize(view),
    phone = view.bucket === 'phone';
  const width = phone ? body.width : id === 'ai' ? 390 : view.bucket === 'tablet' ? 320 : 344;
  const preferredHeight = phone
    ? Math.min(id === 'ai' ? 390 : 340, body.height * (id === 'ai' ? 0.57 : 0.44))
    : Math.min(id === 'ai' ? 680 : 600, body.height - panelBottomOffset(view) - 24);
  // Starting sizes leave usable image pixels, including on a 320px phone. This is
  // a default choice only: manual sizes and saved preferences retain their full
  // viewport bounds. Crowded docked layouts offer explicit collapse/restore and
  // continue excluding the panel rectangle rather than covering the photograph.
  const phonePhotoBudget = canvasImageArea(view, {
    left: 0,
    right: 0,
    bottom: panelBottomOffset(view) + PANEL_MARGIN,
  }).height;
  const height = phone
    ? Math.max(
        id === 'ai' ? Math.min(224, panelBounds(view, 'bottom').maxHeight) : 0,
        Math.min(
          preferredHeight,
          Math.max(0, Math.floor(phonePhotoBudget - minimumImageArea(view).height)),
        ),
      )
    : preferredHeight;
  return boundPanel(
    {
      dock: phone ? 'bottom' : 'right',
      x: Math.max(PANEL_MARGIN, body.width - width - 16),
      y: PANEL_MARGIN,
      width,
      height,
      presentation: 'normal',
      composition: 'reflow',
    },
    view,
    id,
  );
}

/** The phone Edit action restores usable controls and photo space after manual resizing. */
export function restorePanelForEditing(
  value: PanelGeometry,
  view: Viewport,
  id: PanelId,
): PanelGeometry {
  return boundPanel(
    {
      ...value,
      ...(view.bucket === 'phone' && value.dock === 'bottom' && id === 'inspector'
        ? { height: defaultPanel(id, view).height }
        : {}),
      presentation: 'normal',
    },
    view,
    id,
  );
}
