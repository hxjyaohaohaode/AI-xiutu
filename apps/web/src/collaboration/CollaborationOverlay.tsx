import type { CSSProperties } from 'react';
import type { CollaborationSnapshot } from '@ai-xiutu/contracts';
import type { Point } from '@ai-xiutu/editor';
const memberColor = (id: string) =>
  `hsl(${[...id].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 0)} 65% 42%)`;
export function CollaborationOverlay({
  snapshot,
  sessionId,
  toDisplay,
  toContentDisplay,
  zoom,
}: {
  snapshot: CollaborationSnapshot;
  sessionId: string | null;
  toDisplay: (point: Point) => Point;
  toContentDisplay?: (point: Point) => Point | null;
  zoom: number;
}) {
  const project = (point: Point, content = false): Point | null => {
    try {
      const result = content && toContentDisplay ? toContentDisplay(point) : toDisplay(point);
      return result && Number.isFinite(result.x) && Number.isFinite(result.y) ? result : null;
    } catch {
      // A cropped source point can lie past a homography horizon. It has no
      // visible cursor in this viewport and must not crash the shared canvas.
      return null;
    }
  };
  return (
    <div className="collaboration-overlay" aria-hidden>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ overflow: 'visible', position: 'absolute' }}
      >
        {snapshot.leases
          .filter((lease) => lease.sessionId !== sessionId && lease.bounds)
          .map((lease) => {
            const b = lease.bounds!,
              color = memberColor(lease.userId);
            // Sample each edge because liquid deformation can curve a source-space rectangle.
            const corners = [
              { x: b.x, y: b.y },
              { x: b.x + b.width, y: b.y },
              { x: b.x + b.width, y: b.y + b.height },
              { x: b.x, y: b.y + b.height },
            ];
            const points = corners.flatMap((a, index) =>
              Array.from({ length: 8 }, (_, step) => {
                const z = corners[(index + 1) % 4]!;
                return project(
                  {
                    x: a.x + ((z.x - a.x) * step) / 8,
                    y: a.y + ((z.y - a.y) * step) / 8,
                  },
                  true,
                );
              }),
            );
            if (points.some((point) => point === null)) return null;
            return (
              <polygon
                key={lease.id}
                points={points.map((p) => `${p!.x * 100},${p!.y * 100}`).join(' ')}
                fill={color}
                fillOpacity=".06"
                stroke={color}
                strokeWidth={0.3 / zoom}
                strokeDasharray={`${1 / zoom} ${0.6 / zoom}`}
              />
            );
          })}
      </svg>
      {snapshot.presences
        .filter((member) => member.id !== sessionId && member.cursor)
        .map((member) => {
          const position = project(member.cursor!),
            color = memberColor(member.userId);
          if (!position || position.x < 0 || position.y < 0 || position.x > 1 || position.y > 1)
            return null;
          return (
            <div
              key={member.id}
              className="collaboration-cursor"
              data-motion="collaboration-cursor"
              style={
                {
                  left: `${position.x * 100}%`,
                  top: `${position.y * 100}%`,
                  transform: `scale(${1 / zoom})`,
                  color,
                  '--cursor-color': color,
                } as CSSProperties
              }
            >
              <i />
              <span>{member.displayName}</span>
            </div>
          );
        })}
    </div>
  );
}
