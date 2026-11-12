import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import type { PrecisionRegionV3 } from '@ai-xiutu/editor';
import type { TileView } from './tile-layout';
import {
  moveNativeHandle, nativeHandlePoint, nativeSourcePoint,
  type NativeMask, type NativePoint, type NativeRegionHandle, type NativeSourceSize,
} from './native-grade-model';

type Drag = {
  pointerId: number;
  handle: NativeRegionHandle;
  base: NativeMask;
  last: string;
  offset: NativePoint;
  svg: SVGSVGElement;
};
const handleNames: Record<NativeRegionHandle, string> = {
  center: '中心', radiusX: '横向半径', radiusY: '纵向半径', start: '起点', end: '终点',
};

export function NativeRegionOverlay({
  region, source, viewport, view, disabled, onChange,
}: {
  region: PrecisionRegionV3;
  source: NativeSourceSize;
  viewport: NativeSourceSize;
  view: TileView;
  disabled: boolean;
  onChange: (mask: NativeMask) => void;
}) {
  const gesture = useRef<Drag | null>(null);
  const latest = useRef({ mask: region.mask, onChange });
  latest.current = { mask: region.mask, onChange };
  const mask = region.mask;
  const handles: NativeRegionHandle[] = mask.type === 'radial' ? ['center', 'radiusX', 'radiusY'] : ['start', 'end'];
  const screen = (point: NativePoint) => ({
    x: view.x + point.x * source.width * view.zoom,
    y: view.y + point.y * source.height * view.zoom,
  });
  function publish(next: NativeMask) {
    latest.current = { ...latest.current, mask: next };
    latest.current.onChange(next);
  }
  function finish(cancel = false) {
    const drag = gesture.current;
    if (!drag) return;
    gesture.current = null;
    if (cancel && JSON.stringify(latest.current.mask) === drag.last) publish(drag.base);
    try {
      if (drag.svg.hasPointerCapture(drag.pointerId)) drag.svg.releasePointerCapture(drag.pointerId);
    } catch { /* An asset can close during capture. */ }
  }
  const cancel = useRef(() => finish(true));
  cancel.current = () => finish(true);
  useEffect(() => {
    const blur = () => cancel.current();
    const visibility = () => { if (document.visibilityState !== 'visible') blur(); };
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', blur);
      document.removeEventListener('visibilitychange', visibility);
      gesture.current = null;
    };
  }, []);
  useEffect(() => {
    if (disabled) cancel.current();
    else if (gesture.current && JSON.stringify(mask) !== gesture.current.last) finish();
  }, [mask, disabled]);
  function eventPoint(svg: SVGSVGElement, x: number, y: number) {
    const bounds = svg.getBoundingClientRect();
    return nativeSourcePoint({ x: x - bounds.left, y: y - bounds.top }, view, source);
  }
  const center = mask.type === 'radial' ? screen({ x: mask.centerX, y: mask.centerY }) : null;
  const rx = mask.type === 'radial' ? mask.radiusX * source.width * view.zoom : 0;
  const ry = mask.type === 'radial' ? mask.radiusY * source.height * view.zoom : 0;
  const shape = (factor: number, className: string) => {
    if (mask.type !== 'radial' || !center) return null;
    const props = {
      className,
      transform: 'translate(' + center.x + ' ' + center.y + ') rotate(' + (mask.rotationDegrees ?? 0) + ')',
      fill: 'none',
    };
    if (mask.shape === 'rectangle') return <rect {...props} x={-rx * factor} y={-ry * factor} width={rx * factor * 2} height={ry * factor * 2} />;
    if (mask.shape === 'diamond') return <polygon {...props} points={'0,' + -ry * factor + ' ' + rx * factor + ',0 0,' + ry * factor + ' ' + -rx * factor + ',0'} />;
    return <ellipse {...props} rx={rx * factor} ry={ry * factor} />;
  };
  const start = mask.type === 'linear' ? screen(mask.start) : null;
  const end = mask.type === 'linear' ? screen(mask.end) : null;
  return (
    <svg
      className="native-region-overlay"
      viewBox={'0 0 ' + viewport.width + ' ' + viewport.height}
      preserveAspectRatio="none"
      role="group"
      aria-label={t('母版局部范围')}
      data-region-id={region.id}
      data-enabled={region.enabled ? 'true' : 'false'}
      onPointerDown={(event) => {
        const target = (event.target as Element).closest<SVGElement>('[data-native-handle]');
        if (!target || disabled || !event.isPrimary || event.button !== 0 || gesture.current) return;
        event.preventDefault();
        event.stopPropagation();
        target.querySelector<SVGElement>('[role="button"]')?.focus({ preventScroll: true });
        const handle = target.dataset.nativeHandle as NativeRegionHandle;
        const point = eventPoint(event.currentTarget, event.clientX, event.clientY);
        const anchor = nativeHandlePoint(mask, handle, source);
        gesture.current = {
          pointerId: event.pointerId, handle, base: mask, last: JSON.stringify(mask), svg: event.currentTarget,
          offset: { x: anchor.x - point.x, y: anchor.y - point.y },
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = gesture.current;
        if (!drag || drag.pointerId !== event.pointerId || disabled) return;
        event.preventDefault();
        event.stopPropagation();
        const point = eventPoint(event.currentTarget, event.clientX, event.clientY);
        const next = moveNativeHandle(latest.current.mask, drag.handle, {
          x: point.x + drag.offset.x, y: point.y + drag.offset.y,
        }, source);
        drag.last = JSON.stringify(next);
        publish(next);
      }}
      onPointerUp={(event) => {
        if (gesture.current?.pointerId === event.pointerId) { event.stopPropagation(); finish(); }
      }}
      onPointerCancel={(event) => {
        if (gesture.current?.pointerId === event.pointerId) { event.stopPropagation(); finish(true); }
      }}
      onLostPointerCapture={(event) => {
        if (gesture.current?.pointerId === event.pointerId) finish(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); finish(true); }
      }}
    >
      {mask.type === 'radial' ? <>{shape(1, 'native-mask-outline')}{mask.feather > 0 && mask.feather < 1 && shape(1 - mask.feather, 'native-mask-feather')}</> : start && end && (
        <>
          <line className="native-mask-outline" x1={start.x} y1={start.y} x2={end.x} y2={end.y} />
          <text className="native-mask-end-label" x={start.x + 12} y={start.y - 12}>{mask.invert ? 1 : 0}</text>
          <text className="native-mask-end-label" x={end.x + 12} y={end.y - 12}>{mask.invert ? 0 : 1}</text>
        </>
      )}
      {handles.map((handle) => {
        const point = nativeHandlePoint(mask, handle, source);
        const position = screen(point);
        return <g key={handle} data-native-handle={handle}>
          <circle cx={position.x} cy={position.y} r="22" fill="transparent"
            className="native-mask-hit" role="button" tabIndex={disabled ? -1 : 0}
            aria-label={t(handleNames[handle]) + ' · ' + (point.x * 100).toFixed(2) + '%, ' + (point.y * 100).toFixed(2) + '%'}
            aria-disabled={disabled}
            onKeyDown={(event) => {
              if (disabled) return;
              const amount = event.shiftKey ? 10 : 1;
              const moves: Record<string, NativePoint> = {
                ArrowLeft: { x: -amount / source.width, y: 0 }, ArrowRight: { x: amount / source.width, y: 0 },
                ArrowUp: { x: 0, y: -amount / source.height }, ArrowDown: { x: 0, y: amount / source.height },
              };
              const move = moves[event.key];
              if (!move) return;
              event.preventDefault();
              event.stopPropagation();
              publish(moveNativeHandle(mask, handle, { x: point.x + move.x, y: point.y + move.y }, source));
            }}
          />
          <circle className="native-mask-handle" cx={position.x} cy={position.y} r={handle === 'center' ? 5 : 4} />
        </g>;
      })}
    </svg>
  );
}
