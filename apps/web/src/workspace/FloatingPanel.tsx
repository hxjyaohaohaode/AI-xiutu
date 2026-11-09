import {
  useEffect,
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
  CaretDown,
  ArrowUp,
  ArrowDown,
} from '@phosphor-icons/react';
import { IconButton } from '../components/Ui';
import {
  boundPanel,
  panelBottomOffset,
  type Dock,
  type PanelGeometry,
  type Viewport,
} from './useWorkspaceLayout';
import { usePresence } from '../motion/usePresence';
import type { MotionPhase } from '../motion/registry';
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Gesture = {
  kind: 'move' | 'resize';
  edge?: Edge;
  startX: number;
  startY: number;
  original: PanelGeometry;
  initial: PanelGeometry;
  target: HTMLElement;
  pointer: number;
};
const edgeLabels: Record<Edge, string> = {
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
  open?: boolean;
  motionState?: MotionPhase;
}) {
  const panel = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuPresence = usePresence(menu, 'panel-menu');
  const geometryCallback = useRef(onGeometry);
  geometryCallback.current = onGeometry;
  const mobile = viewport.bucket === 'phone';
  const value = boundPanel(geometry, viewport);
  const style: CSSProperties = { width: value.width, height: value.height };
  if (value.dock === 'floating') Object.assign(style, { left: value.x, top: value.y });
  else if (value.dock === 'left') Object.assign(style, { left: 12, top: 12 });
  else if (value.dock === 'right') Object.assign(style, { right: 12, top: 12 });
  else
    Object.assign(style, {
      bottom: panelBottomOffset(viewport),
      left: mobile ? 8 : '50%',
      transform: mobile ? undefined : 'translateX(-50%)',
      width: value.width,
    });
  function currentFloating(): PanelGeometry {
    const box = panel.current?.getBoundingClientRect();
    const parent = panel.current?.parentElement?.getBoundingClientRect();
    return box && parent
      ? { ...value, dock: 'floating', x: box.left - parent.left, y: box.top - parent.top }
      : value;
  }
  function begin(event: PointerEvent<HTMLElement>, kind: Gesture['kind'], edge?: Edge) {
    if (
      !open ||
      gesture.current ||
      event.button !== 0 ||
      (event.target as HTMLElement).closest('button,select,input,a,summary')
    )
      return;
    event.preventDefault();
    let original = value;
    if (
      !mobile &&
      value.dock !== 'floating' &&
      (kind === 'move' ||
        (edge?.includes('n') && value.dock !== 'bottom') ||
        (edge?.includes('w') && value.dock === 'left') ||
        (edge?.includes('e') && value.dock === 'right'))
    )
      original = currentFloating();
    gesture.current = {
      kind,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      original,
      initial: value,
      target: event.currentTarget,
      pointer: event.pointerId,
    };
    setDragging(true);
    setMenu(false);
    onGeometry(original);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      finishGesture(true);
    }
  }
  function resized(g: Gesture, dx: number, dy: number): PanelGeometry {
    if (mobile) return boundPanel({ ...g.original, height: g.original.height - dy }, viewport);
    if (g.kind === 'move')
      return boundPanel({ ...g.original, x: g.original.x + dx, y: g.original.y + dy }, viewport);
    const edge = g.edge ?? 'se',
      original = g.original;
    const horizontal = edge.includes('w') ? -dx : edge.includes('e') ? dx : 0;
    const vertical = edge.includes('n') ? -dy : edge.includes('s') ? dy : 0;
    const next = boundPanel(
      {
        ...original,
        width: original.width + horizontal * (original.dock === 'bottom' ? 2 : 1),
        height: original.height + vertical,
      },
      viewport,
    );
    if (original.dock === 'floating') {
      if (edge.includes('w')) next.x = original.x + original.width - next.width;
      if (edge.includes('n')) next.y = original.y + original.height - next.height;
    }
    return boundPanel(next, viewport);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    if ((event.buttons & 1) === 0) {
      finishGesture(true);
      return;
    }
    onGeometry(resized(g, event.clientX - g.startX, event.clientY - g.startY));
  }
  function finishGesture(cancel: boolean) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setDragging(false);
    if (cancel) geometryCallback.current(g.initial);
    try {
      if (g.target.hasPointerCapture(g.pointer)) g.target.releasePointerCapture(g.pointer);
    } catch {}
  }
  function end(event: PointerEvent<HTMLElement>, cancel = false) {
    if (gesture.current?.pointer !== event.pointerId) return;
    finishGesture(cancel);
  }
  const cancelGesture = useRef(() => finishGesture(true));
  cancelGesture.current = () => finishGesture(true);
  useEffect(() => {
    const blur = () => cancelGesture.current();
    const visibility = () => {
      if (document.visibilityState === 'hidden') blur();
    };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      gesture.current = null;
    };
  }, []);
  useEffect(() => {
    if (!open) {
      cancelGesture.current();
      setMenu(false);
    }
  }, [open]);
  const dock = (next: Dock) => {
    onGeometry(boundPanel({ ...value, dock: next }, viewport));
    setMenu(false);
  };
  const setExtent = (expanded: boolean) => {
    onGeometry(
      boundPanel({ ...value, height: expanded ? viewport.height : mobile ? 180 : 250 }, viewport),
    );
    setMenu(false);
  };
  return (
    <section
      ref={panel}
      className={'floating-panel dock-' + value.dock + (mobile ? ' phone-panel' : '')}
      style={style}
      aria-label={label}
      inert={!open}
      aria-hidden={!open}
      data-motion="panel-frame"
      data-motion-pixels="true"
      data-motion-state={motionState}
      data-gesture={dragging ? 'active' : undefined}
    >
      <div
        className="panel-drag-header"
        data-motion="panel-header"
        onPointerDown={(event) => begin(event, mobile ? 'resize' : 'move', 'n')}
        onPointerMove={move}
        onPointerUp={(event) => end(event)}
        onPointerCancel={(event) => end(event, true)}
        onLostPointerCapture={(event) => end(event, true)}
      >
        <span className="panel-grip" aria-hidden>
          {mobile ? <i /> : <DotsSix size={19} />}
        </span>
        <strong>{title}</strong>
        <span className="panel-drag-hint">{mobile ? '拉动调高低' : '拖动移动'}</span>
        <button
          type="button"
          className="panel-layout-trigger"
          aria-expanded={menu}
          aria-label="面板位置与尺寸"
          onClick={() => setMenu(!menu)}
        >
          布局 <CaretDown size={14} />
        </button>
        <IconButton label={'收起' + title + '，可从工具栏重新打开'} onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {menuPresence.present && (
        <div
          className="panel-layout-menu"
          data-motion="panel-menu"
          data-motion-state={menuPresence.phase}
          inert={!menu}
          aria-hidden={!menu}
        >
          {!mobile && (
            <div className="panel-dock-choices" role="group" aria-label="面板停靠位置">
              <button aria-pressed={value.dock === 'left'} onClick={() => dock('left')}>
                <SidebarSimple size={18} />
                左侧
              </button>
              <button aria-pressed={value.dock === 'right'} onClick={() => dock('right')}>
                <SidebarSimple size={18} style={{ transform: 'rotate(180deg)' }} />
                右侧
              </button>
              <button aria-pressed={value.dock === 'bottom'} onClick={() => dock('bottom')}>
                <Rectangle size={18} />
                底部
              </button>
              <button aria-pressed={value.dock === 'floating'} onClick={() => dock('floating')}>
                <ArrowsOut size={18} />
                浮动
              </button>
            </div>
          )}
          <div className="panel-size-choices">
            <button onClick={() => setExtent(false)}>
              <ArrowDown size={16} />
              紧凑
            </button>
            <button onClick={() => setExtent(true)}>
              <ArrowUp size={16} />
              展开
            </button>
          </div>
          <p>
            {mobile
              ? '拖动顶部横条调整高度，图片会随可用区域适应。'
              : '拖动标题移动，拖动边缘或角落调整大小。右下角也可用方向键调整。'}
          </p>
        </div>
      )}
      <div className="panel-content">{children}</div>
      {(mobile ? ['n'] : ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']).map((item) => {
        const edge = item as Edge;
        return (
          <div
            key={edge}
            className={
              'panel-resize-edge resize-' + edge + (edge === 'se' ? ' panel-resize-handle' : '')
            }
            role="separator"
            aria-label={'从' + edgeLabels[edge] + '调整' + title + '面板，方向键每次20像素'}
            aria-orientation={edge === 'n' || edge === 's' ? 'horizontal' : 'vertical'}
            tabIndex={edge === 'se' || mobile ? 0 : -1}
            onPointerDown={(event) => begin(event, 'resize', edge)}
            onPointerMove={move}
            onPointerUp={(event) => end(event)}
            onPointerCancel={(event) => end(event, true)}
            onLostPointerCapture={(event) => end(event, true)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              const delta = event.shiftKey ? 50 : 20;
              onGeometry(
                boundPanel(
                  {
                    ...value,
                    width:
                      value.width +
                      (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0),
                    height:
                      value.height +
                      (event.key === 'ArrowUp' ? delta : event.key === 'ArrowDown' ? -delta : 0),
                  },
                  viewport,
                ),
              );
            }}
          >
            {edge === 'se' && <CornersOut size={14} />}
          </div>
        );
      })}
    </section>
  );
}
