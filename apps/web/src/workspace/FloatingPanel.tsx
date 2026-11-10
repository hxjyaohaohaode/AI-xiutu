import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  X,
  DotsSix,
  SidebarSimple,
  Rectangle,
  ArrowsOut,
  CornersOut,
  CornersIn,
  SlidersHorizontal,
  CaretDown,
  CaretUp,
  ArrowCounterClockwise,
} from '@phosphor-icons/react';
import { IconButton } from '../components/Ui';
import {
  boundPanel,
  defaultPanel,
  floatPanel,
  movePanel,
  panelBounds,
  panelBottomOffset,
  panelHeaderHeight,
  panelNeedsPhotoSpace,
  panelRectangle,
  resizePanel,
  type Dock,
  type PanelEdge,
  type PanelGeometry,
  type PanelId,
  type Viewport,
} from './useWorkspaceLayout';
import { usePresence } from '../motion/usePresence';
import type { MotionPhase } from '../motion/registry';
import { PanelChromeContext } from './PanelChromeContext';
import './panel.css';

type Gesture = {
  kind: 'move' | 'resize';
  edge?: PanelEdge;
  startX: number;
  startY: number;
  original: PanelGeometry;
  initial: PanelGeometry;
  target: HTMLElement;
  pointer: number;
  panelKey: PanelId;
};
const edges: PanelEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const edgeLabels: Record<PanelEdge, string> = {
  n: '上边',
  s: '下边',
  e: '右边',
  w: '左边',
  ne: '右上角',
  nw: '左上角',
  se: '右下角',
  sw: '左下角',
};

export function FloatingPanel({
  title,
  label,
  geometry,
  viewport,
  onGeometry,
  onClose,
  children,
  navigation,
  panelKey = 'inspector',
  open = true,
  motionState = 'enter',
}: {
  title: string;
  label: string;
  geometry: PanelGeometry;
  viewport: Viewport;
  onGeometry: (value: PanelGeometry) => void;
  onClose: () => void;
  children: ReactNode;
  navigation?: ReactNode;
  panelKey?: PanelId;
  open?: boolean;
  motionState?: MotionPhase;
}) {
  const panel = useRef<HTMLElement>(null);
  const dragHandle = useRef<HTMLDivElement>(null);
  const layoutTrigger = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState(false);
  const [animatingPresentation, setAnimatingPresentation] = useState(false);
  const menuPresence = usePresence(menu, 'panel-menu');
  const contentId = useId(),
    menuId = useId();
  const geometryCallback = useRef(onGeometry);
  geometryCallback.current = onGeometry;
  const currentPanelKey = useRef(panelKey);
  currentPanelKey.current = panelKey;
  const value = boundPanel(geometry, viewport, panelKey);
  const rect = panelRectangle(value, viewport);
  const mobile = viewport.bucket === 'phone';
  const maximized = value.presentation === 'maximized',
    collapsed = value.presentation === 'collapsed';
  const attached = mobile && value.dock === 'bottom';
  const condensed = mobile && panelKey === 'ai' && !collapsed;
  const bounds = panelBounds(viewport, value.dock, panelKey);
  const contentPresence = usePresence(!collapsed && open, 'panel-body');
  const needsPhotoSpace = panelNeedsPhotoSpace(value, viewport);
  const menuBelow =
    bounds.height - panelBottomOffset(viewport) - rect.y - panelHeaderHeight(viewport) - 8;
  const menuAbove = rect.y - 8;
  const menuDirection = menuBelow < 220 && menuAbove > menuBelow ? 'up' : 'down';
  const style = {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    '--panel-header-height': `${condensed ? 16 : panelHeaderHeight(viewport)}px`,
  } as CSSProperties;

  function finishGesture(cancel: boolean) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setDragging(false);
    if (cancel && g.panelKey === currentPanelKey.current) geometryCallback.current(g.initial);
    try {
      if (g.target.hasPointerCapture(g.pointer)) g.target.releasePointerCapture(g.pointer);
    } catch {
      /* Capture may already have been released by a device interruption. */
    }
  }
  function begin(event: PointerEvent<HTMLElement>, kind: Gesture['kind'], edge?: PanelEdge) {
    if (
      !open ||
      gesture.current ||
      event.button !== 0 ||
      !event.isPrimary ||
      (event.target as HTMLElement).closest('button,select,input,a,summary')
    )
      return;
    if (attached && collapsed) return;
    event.preventDefault();
    const outwardDockEdge =
      (value.dock === 'left' && edge?.includes('w')) ||
      (value.dock === 'right' && edge?.includes('e')) ||
      (value.dock === 'bottom' && edge?.includes('s')) ||
      ((value.dock === 'left' || value.dock === 'right') && edge?.includes('n'));
    const original =
      kind === 'move' || maximized || collapsed || outwardDockEdge
        ? floatPanel(value, viewport)
        : { ...value, presentation: 'normal' as const };
    gesture.current = {
      kind,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      original,
      initial: value,
      target: event.currentTarget,
      pointer: event.pointerId,
      panelKey,
    };
    setAnimatingPresentation(false);
    setDragging(true);
    setMenu(false);
    onGeometry(original);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      finishGesture(true);
    }
  }
  function move(event: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      finishGesture(true);
      return;
    }
    const dx = event.clientX - g.startX,
      dy = event.clientY - g.startY;
    onGeometry(
      g.kind === 'move'
        ? movePanel(g.original, dx, dy, viewport)
        : resizePanel(g.original, g.edge ?? 'se', dx, dy, viewport, panelKey),
    );
  }
  function end(event: PointerEvent<HTMLElement>, cancel = false) {
    if (gesture.current?.pointer === event.pointerId) finishGesture(cancel);
  }
  const cancelGesture = useRef(() => finishGesture(true));
  cancelGesture.current = () => finishGesture(true);
  useEffect(() => {
    const cancel = () => cancelGesture.current();
    const visibility = () => {
      if (document.visibilityState === 'hidden') cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
      // Pointer handlers are gone; do not mutate a different panel during unmount.
      const active = gesture.current;
      gesture.current = null;
      if (active)
        try {
          active.target.releasePointerCapture(active.pointer);
        } catch {
          /* detached */
        }
    };
  }, []);
  useEffect(() => {
    cancelGesture.current();
    setMenu(false);
  }, [viewport.width, viewport.height, viewport.workspaceWidth, viewport.workspaceHeight]);
  const previousKey = useRef(panelKey);
  useEffect(() => {
    if (previousKey.current !== panelKey) {
      // The callback now targets the new panel; never roll the old gesture into it.
      const active = gesture.current;
      gesture.current = null;
      if (active)
        try {
          active.target.releasePointerCapture(active.pointer);
        } catch {
          /* detached */
        }
      setDragging(false);
      setMenu(false);
      previousKey.current = panelKey;
    }
  }, [panelKey]);
  useEffect(() => {
    if (!open) {
      cancelGesture.current();
      setMenu(false);
    }
  }, [open]);
  useEffect(() => {
    if (!animatingPresentation) return;
    const timer = setTimeout(() => setAnimatingPresentation(false), 260);
    return () => clearTimeout(timer);
  }, [animatingPresentation, value.presentation]);
  useEffect(() => {
    if (!menu) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [menu]);
  function setPresentation(next: 'normal' | 'maximized' | 'collapsed') {
    finishGesture(false);
    setAnimatingPresentation(true);
    setMenu(false);
    onGeometry({ ...value, presentation: next });
    // Do not leave keyboard focus inside a collapsed or inert content subtree.
    if (next === 'collapsed') dragHandle.current?.focus();
  }
  function dock(next: Dock) {
    finishGesture(false);
    onGeometry(boundPanel({ ...value, dock: next, presentation: 'normal' }, viewport, panelKey));
    setMenu(false);
  }
  function resizeByKeyboard(key: string, shift: boolean, alt: boolean) {
    const delta = alt ? 1 : shift ? 32 : 8;
    const next = { ...value, presentation: 'normal' as const };
    if (key === 'ArrowLeft') next.width -= delta;
    if (key === 'ArrowRight') next.width += delta;
    if (key === 'ArrowUp') next.height += delta;
    if (key === 'ArrowDown') next.height -= delta;
    onGeometry(boundPanel(next, viewport, panelKey));
  }
  return (
    <section
      ref={panel}
      className={`floating-panel free-panel dock-${value.dock}${mobile ? ' phone-panel' : ''}`}
      style={style}
      aria-label={label}
      inert={!open}
      aria-hidden={!open}
      data-motion="panel-frame"
      data-motion-pixels="true"
      data-motion-state={motionState}
      data-gesture={dragging ? 'active' : undefined}
      data-presentation={value.presentation}
      data-size-motion={animatingPresentation ? 'active' : undefined}
      data-panel-width={rect.width < 300 ? 'narrow' : rect.width >= 640 ? 'wide' : 'regular'}
      data-attached={attached ? 'true' : undefined}
      data-composition={value.composition}
      data-device={viewport.bucket}
      data-panel-id={panelKey}
      data-condensed-header={condensed || undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && menu) {
          event.preventDefault();
          event.stopPropagation();
          setMenu(false);
          layoutTrigger.current?.focus();
        }
      }}
    >
      <div className="panel-drag-header" data-motion="panel-header">
        <div
          ref={dragHandle}
          className="panel-title-drag"
          role="button"
          tabIndex={0}
          aria-label={`${title}面板，${attached ? '上下拖动调整高度，方向键调整尺寸' : '拖动和方向键移动'}；Alt加方向键1像素微调，回车${collapsed ? '展开' : '折叠'}`}
          aria-expanded={!collapsed}
          aria-controls={contentId}
          onPointerDown={(event) => begin(event, attached ? 'resize' : 'move', 'n')}
          onPointerMove={move}
          onPointerUp={(event) => end(event)}
          onPointerCancel={(event) => end(event, true)}
          onLostPointerCapture={(event) => end(event, true)}
          onDoubleClick={() => setPresentation(collapsed ? 'normal' : 'collapsed')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setPresentation(collapsed ? 'normal' : 'collapsed');
              return;
            }
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
            event.preventDefault();
            if (attached) {
              resizeByKeyboard(event.key, event.shiftKey, event.altKey);
              return;
            }
            const delta = event.altKey ? 1 : event.shiftKey ? 32 : 8;
            onGeometry(
              movePanel(
                value,
                event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0,
                event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0,
                viewport,
              ),
            );
          }}
        >
          <span className="panel-grip" aria-hidden>
            <DotsSix size={16} />
          </span>
          <strong>{title}</strong>
        </div>
        <div className="panel-presentation-actions" data-motion="panel-actions">
          <IconButton
            className="panel-collapse-action"
            label={
              collapsed
                ? `继续调节：恢复面板到${Math.round(value.height)}像素，保留当前操作`
                : needsPhotoSpace
                  ? `看全图：临时折叠面板，保留当前操作和${Math.round(value.height)}像素高度`
                  : '折叠到标题栏，保留当前操作'
            }
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={() => setPresentation(collapsed ? 'normal' : 'collapsed')}
          >
            {collapsed ? <CaretUp size={17} /> : <CaretDown size={17} />}
          </IconButton>
          <IconButton
            label={
              maximized
                ? '返回常规调节，恢复面板尺寸'
                : mobile
                  ? '展开精调，允许遮挡画面'
                  : '最大化面板'
            }
            aria-pressed={maximized}
            onClick={() => setPresentation(maximized ? 'normal' : 'maximized')}
          >
            {maximized ? <CornersIn size={17} /> : <CornersOut size={17} />}
          </IconButton>
          <button
            ref={layoutTrigger}
            type="button"
            className="panel-layout-trigger"
            title="面板位置与连续尺寸"
            aria-label="面板位置与连续尺寸"
            aria-expanded={menu}
            aria-controls={menuId}
            onClick={() => setMenu(!menu)}
          >
            <SlidersHorizontal size={18} />
          </button>
          <IconButton label={`收起${title}，可从工具栏重新打开`} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </div>
      {menuPresence.present && (
        <div
          id={menuId}
          className="panel-layout-menu"
          data-motion="panel-menu"
          data-motion-state={menuPresence.phase}
          inert={!menu}
          aria-hidden={!menu}
          data-direction={menuDirection}
          style={{ maxHeight: Math.max(44, menuDirection === 'up' ? menuAbove : menuBelow) }}
        >
          <div
            className="panel-dock-choices"
            role="group"
            aria-label="面板停靠位置"
            data-motion="panel-docking"
          >
            <button type="button" aria-pressed={value.dock === 'left'} onClick={() => dock('left')}>
              <SidebarSimple size={17} />
              左侧
            </button>
            <button
              type="button"
              aria-pressed={value.dock === 'right'}
              onClick={() => dock('right')}
            >
              <SidebarSimple size={17} style={{ transform: 'rotate(180deg)' }} />
              右侧
            </button>
            <button
              type="button"
              aria-pressed={value.dock === 'bottom'}
              onClick={() => dock('bottom')}
            >
              <Rectangle size={17} />
              底部
            </button>
            <button
              type="button"
              aria-pressed={value.dock === 'floating'}
              onClick={() => dock('floating')}
            >
              <ArrowsOut size={17} />
              浮动
            </button>
          </div>
          <div className="panel-size-controls" data-motion="panel-sizing">
            {!attached && (
              <label>
                宽度 <output>{Math.round(value.width)} px</output>
                <input
                  type="range"
                  min={bounds.minWidth}
                  max={bounds.maxWidth}
                  step={1}
                  value={value.width}
                  aria-label="面板宽度，像素"
                  onChange={(event) =>
                    onGeometry(
                      boundPanel(
                        { ...value, width: Number(event.target.value), presentation: 'normal' },
                        viewport,
                        panelKey,
                      ),
                    )
                  }
                />
              </label>
            )}
            <label>
              高度 <output>{Math.round(value.height)} px</output>
              <input
                type="range"
                min={bounds.minHeight}
                max={bounds.maxHeight}
                step={1}
                value={value.height}
                aria-label="面板高度，像素"
                onChange={(event) =>
                  onGeometry(
                    boundPanel(
                      { ...value, height: Number(event.target.value), presentation: 'normal' },
                      viewport,
                      panelKey,
                    ),
                  )
                }
              />
            </label>
          </div>
          <div
            className="panel-composition-choices"
            role="group"
            aria-label="图片与面板的关系"
            data-motion="panel-composition"
          >
            <button
              type="button"
              aria-pressed={value.composition !== 'overlay'}
              onClick={() => onGeometry({ ...value, composition: 'reflow' })}
            >
              画面让位
            </button>
            <button
              type="button"
              aria-pressed={value.composition === 'overlay'}
              onClick={() => onGeometry({ ...value, composition: 'overlay' })}
            >
              覆盖画面精调
            </button>
          </div>
          <p>
            {needsPhotoSpace
              ? '画面继续避让面板。点标题栏的“看全图”收起参数；“继续调节”恢复当前尺寸，参数不会丢失。'
              : '拖动边角连续调节尺寸。方向键调8像素，Alt+方向键调1像素。'}
          </p>
          <button
            className="panel-reset-layout"
            type="button"
            onClick={() => {
              onGeometry(defaultPanel(panelKey, viewport));
              setMenu(false);
            }}
          >
            <ArrowCounterClockwise size={15} />
            恢复此面板布局
          </button>
        </div>
      )}
      <div
        id={contentId}
        className="panel-content"
        data-motion="panel-body"
        data-motion-pixels="true"
        data-motion-state={contentPresence.phase}
        inert={collapsed || !open}
        aria-hidden={collapsed || !open}
        hidden={!contentPresence.present}
      >
        {navigation && <div className="panel-context-navigation">{navigation}</div>}
        <PanelChromeContext.Provider
          value={{
            mobile,
            maximized,
            openLayout: () => setMenu(true),
            toggleMaximized: () => setPresentation(maximized ? 'normal' : 'maximized'),
          }}
        >
          {children}
        </PanelChromeContext.Provider>
      </div>
      {!collapsed &&
        !maximized &&
        edges
          .filter((edge) => !attached || edge === 'n')
          .map((edge) => (
            <div
              key={edge}
              className={`panel-resize-edge resize-${edge}${edge === 'se' ? ' panel-resize-handle' : ''}`}
              role="separator"
              aria-label={`从${edgeLabels[edge]}调整${title}面板，Alt加方向键可1像素微调`}
              aria-orientation={edge === 'n' || edge === 's' ? 'horizontal' : 'vertical'}
              aria-valuenow={Math.round(edge === 'n' || edge === 's' ? rect.height : rect.width)}
              aria-valuemin={Math.round(
                edge === 'n' || edge === 's' ? bounds.minHeight : bounds.minWidth,
              )}
              aria-valuemax={Math.round(
                edge === 'n' || edge === 's' ? bounds.maxHeight : bounds.maxWidth,
              )}
              aria-valuetext={`宽 ${Math.round(rect.width)} 像素，高 ${Math.round(rect.height)} 像素`}
              tabIndex={edge === 'se' || (attached && edge === 'n') ? 0 : -1}
              onPointerDown={(event) => begin(event, 'resize', edge)}
              onPointerMove={move}
              onPointerUp={(event) => end(event)}
              onPointerCancel={(event) => end(event, true)}
              onLostPointerCapture={(event) => end(event, true)}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
                  return;
                event.preventDefault();
                resizeByKeyboard(event.key, event.shiftKey, event.altKey);
              }}
            >
              {edge === 'se' && <CornersOut size={12} />}
            </div>
          ))}
    </section>
  );
}
