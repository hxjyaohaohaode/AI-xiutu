import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { MagnifyingGlassMinus, MagnifyingGlassPlus, ArrowsIn, Square } from '@phosphor-icons/react';
import { t } from '../i18n';

/**
 * Pan/zoom surface for images, Photoshop composites and TIFF pages, in the
 * spirit of the Photos apps: pinch or Ctrl/⌘+wheel zooms around the pointer,
 * drag pans once zoomed, double-click toggles between fit and 1:1, and a
 * checkerboard shows transparency. `natural` is the image's pixel size.
 */
export function ZoomStage({
  natural,
  checker,
  children,
  onSwipe,
}: {
  natural: { width: number; height: number };
  checker?: boolean;
  children: ReactNode;
  /** Horizontal swipe while at fit size (navigates between files). */
  onSwipe?: (direction: 1 | -1) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<{ scale: number; x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; scale: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fit = box.width && natural.width ? Math.min(1, (box.width - 32) / natural.width, (box.height - 32) / natural.height) : 1;
  const current = view ?? { scale: fit, x: 0, y: 0 };
  const clamp = (scale: number) => Math.min(32, Math.max(Math.min(fit, 0.05), scale));
  // Keeps the image within reach: it can move until its edge meets the frame's centre.
  const bound = (v: { scale: number; x: number; y: number }) => {
    const maxX = Math.max(0, (natural.width * v.scale - box.width) / 2 + box.width / 2);
    const maxY = Math.max(0, (natural.height * v.scale - box.height) / 2 + box.height / 2);
    return { scale: v.scale, x: Math.max(-maxX, Math.min(maxX, v.x)), y: Math.max(-maxY, Math.min(maxY, v.y)) };
  };
  const zoomAt = (scale: number, clientX?: number, clientY?: number) => {
    const el = frame.current;
    const next = clamp(scale);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (clientX ?? rect.left + rect.width / 2) - rect.left - rect.width / 2;
    const py = (clientY ?? rect.top + rect.height / 2) - rect.top - rect.height / 2;
    const ratio = next / current.scale;
    setView(next <= fit + 1e-6 ? null : bound({ scale: next, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio }));
  };

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) && !view) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) zoomAt(current.scale * Math.exp(-event.deltaY * 0.0022), event.clientX, event.clientY);
      else setView(bound({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const percent = Math.round(current.scale * 100);
  return (
    <div className="fc-zoom">
      <div
        ref={frame}
        className={'fc-zoom-frame' + (checker ? ' fc-checker' : '') + (view ? ' is-zoomed' : '')}
        onDoubleClick={(e) => (view ? setView(null) : zoomAt(Math.max(1, fit * 2), e.clientX, e.clientY))}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const pts = [...pointers.current.values()];
          gesture.current = {
            distance: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : 0,
            scale: current.scale,
            x: current.x,
            y: current.y,
            startX: e.clientX,
            startY: e.clientY,
            moved: false,
          };
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId) || !gesture.current) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const g = gesture.current;
          const pts = [...pointers.current.values()];
          if (pts.length === 2 && g.distance) {
            const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
            zoomAt(g.scale * (d / g.distance), (pts[0]!.x + pts[1]!.x) / 2, (pts[0]!.y + pts[1]!.y) / 2);
            g.moved = true;
            return;
          }
          const dx = e.clientX - g.startX,
            dy = e.clientY - g.startY;
          if (Math.abs(dx) + Math.abs(dy) > 4) g.moved = true;
          if (view) setView(bound({ scale: current.scale, x: g.x + dx, y: g.y + dy }));
        }}
        onPointerUp={(e) => {
          const g = gesture.current;
          pointers.current.delete(e.pointerId);
          if (g && !view && onSwipe && pointers.current.size === 0) {
            const dx = e.clientX - g.startX;
            if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - g.startY) * 1.5) onSwipe(dx < 0 ? 1 : -1);
          }
          if (pointers.current.size === 0) gesture.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          gesture.current = null;
        }}
      >
        <div
          className="fc-zoom-content"
          style={{
            width: natural.width,
            height: natural.height,
            transform: `translate(-50%, -50%) translate(${current.x}px, ${current.y}px) scale(${current.scale})`,
            imageRendering: current.scale >= 2 ? 'pixelated' : undefined,
          }}
        >
          {children}
        </div>
      </div>
      <div className="fc-zoom-bar" role="toolbar" aria-label={t('缩放')}>
        <button type="button" aria-label={t('缩小')} onClick={() => zoomAt(current.scale / 1.5)}>
          <MagnifyingGlassMinus size={16} />
        </button>
        <output aria-live="polite">{percent}%</output>
        <button type="button" aria-label={t('放大')} onClick={() => zoomAt(current.scale * 1.5)}>
          <MagnifyingGlassPlus size={16} />
        </button>
        <span aria-hidden className="fc-zoom-sep" />
        <button type="button" aria-pressed={!view} onClick={() => setView(null)}>
          <ArrowsIn size={16} />
          {t('适应窗口')}
        </button>
        <button type="button" aria-pressed={Math.abs(current.scale - 1) < 0.001} onClick={() => zoomAt(1)}>
          <Square size={16} />
          1:1
        </button>
      </div>
    </div>
  );
}
