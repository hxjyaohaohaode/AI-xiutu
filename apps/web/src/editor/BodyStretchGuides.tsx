import { useRef } from 'react';
import type { Point, RadialMaskV3 } from '@ai-xiutu/editor';
import { t } from '../i18n';
import { projectOverlayPath } from './coordinates';

export type BodyStretchRange = { top: number; bottom: number };
const minimumSpan = 0.04;
const boundaries = ['top', 'bottom'] as const;
type Boundary = (typeof boundaries)[number];

export function moveBodyStretchBoundary(
  range: BodyStretchRange,
  boundary: Boundary,
  value: number,
): BodyStretchRange {
  if (!Number.isFinite(value)) return range;
  const next =
    boundary === 'top'
      ? Math.min(range.bottom - minimumSpan, Math.max(0, value))
      : Math.min(1, Math.max(range.top + minimumSpan, value));
  return next === range[boundary] ? range : { ...range, [boundary]: next };
}

/** Warp guards protect the inverse of the editable band in source coordinates. */
export function bodyStretchGuard({ top, bottom }: BodyStretchRange): RadialMaskV3 {
  return {
    type: 'radial',
    shape: 'rectangle',
    centerX: 0.5,
    centerY: (top + bottom) / 2,
    radiusX: 1,
    radiusY: (bottom - top) / 2,
    feather: 0.16,
    invert: true,
  };
}

export function BodyStretchGuides({
  range,
  zoom,
  toDisplay,
  toSource,
  onChange,
}: {
  range: BodyStretchRange;
  zoom: number;
  toDisplay: (point: Point) => Point | null;
  toSource: (clientX: number, clientY: number) => Point | null;
  onChange: (range: BodyStretchRange) => void;
}) {
  const drag = useRef<{
    pointerId: number;
    initial: BodyStretchRange;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const lines = boundaries.map((boundary) =>
    projectOverlayPath(
      Array.from({ length: 33 }, (_, index) => ({ x: index / 32, y: range[boundary] })),
      toDisplay,
    ),
  );
  const [top, bottom] = lines;
  const vertices = (points: Point[]) => points.map(({ x, y }) => `${x * 100},${y * 100}`).join(' ');
  const toPercent = (value: number) => Number((value * 100).toFixed(2));
  return (
    <div className="body-stretch-guides">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {top && bottom && <polygon points={vertices([...top, ...[...bottom].reverse()])} />}
        {lines.map(
          (line, index) =>
            line && (
              <polyline
                key={boundaries[index]}
                points={vertices(line)}
                vectorEffect="non-scaling-stroke"
              />
            ),
        )}
      </svg>
      {boundaries.map((boundary, index) => {
        const line = lines[index];
        const handle = line
          ?.slice()
          .reverse()
          .find(({ x, y }) => x >= 0.06 && x <= 0.94 && y >= 0 && y <= 1);
        if (!handle) return null;
        return (
          <button
            key={boundary}
            type="button"
            role="slider"
            className="image-handle body-stretch-handle"
            aria-label={t(boundary === 'top' ? '拉伸上边界' : '拉伸下边界')}
            aria-orientation="vertical"
            aria-valuemin={toPercent(boundary === 'top' ? 0 : range.top + minimumSpan)}
            aria-valuemax={toPercent(boundary === 'top' ? range.bottom - minimumSpan : 1)}
            aria-valuenow={toPercent(range[boundary])}
            aria-valuetext={`${toPercent(range[boundary])}%`}
            style={{
              left: `${handle.x * 100}%`,
              top: `${handle.y * 100}%`,
              transform: `translate(-50%, -50%) scale(${1 / zoom})`,
            }}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (event.button !== 0 || !event.isPrimary || drag.current) return;
              const rect = event.currentTarget.getBoundingClientRect();
              drag.current = {
                pointerId: event.pointerId,
                initial: range,
                offsetX: event.clientX - rect.left - rect.width / 2,
                offsetY: event.clientY - rect.top - rect.height / 2,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const active = drag.current;
              if (active?.pointerId !== event.pointerId) return;
              event.stopPropagation();
              const point = toSource(
                event.clientX - active.offsetX,
                event.clientY - active.offsetY,
              );
              if (point) onChange(moveBodyStretchBoundary(range, boundary, point.y));
            }}
            onPointerUp={(event) => {
              if (drag.current?.pointerId !== event.pointerId) return;
              event.stopPropagation();
              drag.current = null;
            }}
            onPointerCancel={(event) => {
              event.stopPropagation();
              if (drag.current?.pointerId !== event.pointerId) return;
              const { initial } = drag.current;
              drag.current = null;
              onChange(initial);
            }}
            onLostPointerCapture={(event) => {
              if (drag.current?.pointerId !== event.pointerId) return;
              const { initial } = drag.current;
              drag.current = null;
              onChange(initial);
            }}
            onKeyDown={(event) => {
              const step = event.altKey ? 0.001 : 0.01;
              let value: number;
              if (event.key === 'ArrowUp') value = range[boundary] - step;
              else if (event.key === 'ArrowDown') value = range[boundary] + step;
              else if (event.key === 'Home') value = 0;
              else if (event.key === 'End') value = 1;
              else return;
              event.preventDefault();
              onChange(moveBodyStretchBoundary(range, boundary, value));
            }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="m4.5 6.5 3.5-3 3.5 3m-7 3 3.5 3 3.5-3"
                stroke="currentColor"
                strokeWidth="1.55"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
