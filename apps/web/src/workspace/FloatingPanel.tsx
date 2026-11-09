import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { X, DotsSix, SidebarSimple, Rectangle, ArrowsOut, CornersOut } from '@phosphor-icons/react';
import { IconButton } from '../components/Ui';
import {
  boundPanel,
  panelBottomOffset,
  type Dock,
  type PanelGeometry,
  type Viewport,
} from './useWorkspaceLayout';

type Gesture = {
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  original: PanelGeometry;
  pointer: number;
};
export function FloatingPanel({
  title,
  label,
  geometry,
  viewport,
  onGeometry,
  onClose,
  children,
}: {
  title: string;
  label: string;
  geometry: PanelGeometry;
  viewport: Viewport;
  onGeometry: (value: PanelGeometry) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null);
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
      width: mobile ? value.width : Math.min(Math.max(value.width, 480), viewport.width - 32),
    });

  function begin(event: PointerEvent<HTMLElement>, kind: Gesture['kind']) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,select')) return;
    event.preventDefault();
    let original = value;
    if (kind === 'move' && !mobile && value.dock !== 'floating') {
      const box = panel.current?.getBoundingClientRect();
      const parent = panel.current?.parentElement?.getBoundingClientRect();
      if (box && parent)
        original = {
          ...value,
          dock: 'floating',
          x: box.left - parent.left,
          y: box.top - parent.top,
        };
      onGeometry(original);
    }
    gesture.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      original,
      pointer: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    const next =
      mobile || g.original.dock === 'bottom'
        ? {
            ...g.original,
            height: g.original.height - dy,
            width: g.original.width + (mobile ? 0 : dx),
          }
        : g.kind === 'resize'
          ? {
              ...g.original,
              width: g.original.width + (g.original.dock === 'right' ? -dx : dx),
              height: g.original.height + dy,
            }
          : { ...g.original, x: g.original.x + dx, y: g.original.y + dy };
    onGeometry(boundPanel(next, viewport));
  }
  function end(event: PointerEvent<HTMLElement>) {
    if (gesture.current?.pointer !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  const dock = (next: Dock) => onGeometry(boundPanel({ ...value, dock: next }, viewport));
  return (
    <section
      ref={panel}
      className={`floating-panel dock-${value.dock} ${mobile ? 'phone-panel' : ''}`}
      style={style}
      aria-label={label}
    >
      <div
        className="panel-drag-header"
        onPointerDown={(event) => begin(event, mobile ? 'resize' : 'move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span className="panel-grip" aria-hidden>
          {mobile ? <i /> : <DotsSix size={18} />}
        </span>
        <strong>{title}</strong>
        {!mobile && (
          <div className="panel-dock-controls">
            <IconButton
              label="停靠左侧"
              aria-pressed={value.dock === 'left'}
              onClick={() => dock('left')}
            >
              <SidebarSimple size={15} />
            </IconButton>
            <IconButton
              label="停靠右侧"
              aria-pressed={value.dock === 'right'}
              onClick={() => dock('right')}
            >
              <SidebarSimple size={15} style={{ transform: 'rotate(180deg)' }} />
            </IconButton>
            <IconButton
              label="停靠底部"
              aria-pressed={value.dock === 'bottom'}
              onClick={() => dock('bottom')}
            >
              <Rectangle size={15} />
            </IconButton>
            <IconButton
              label="自由浮动"
              aria-pressed={value.dock === 'floating'}
              onClick={() => dock('floating')}
            >
              <ArrowsOut size={15} />
            </IconButton>
          </div>
        )}
        <IconButton label={`收起${title}`} onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      <div className="panel-content">{children}</div>
      <div
        className="panel-resize-handle"
        role="separator"
        aria-label={`调整${title}面板尺寸，方向键每次调整20像素`}
        aria-orientation={mobile ? 'horizontal' : 'vertical'}
        tabIndex={0}
        onPointerDown={(event) => begin(event, 'resize')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(event) => {
          const delta = event.shiftKey ? 50 : 20;
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
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
        <CornersOut size={13} />
      </div>
    </section>
  );
}
