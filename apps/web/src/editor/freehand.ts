import type { Dimensions, Point } from '@ai-xiutu/editor';

export interface PointerSample {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
}
export interface CoalescedPointer extends PointerSample {
  getCoalescedEvents?: () => readonly PointerSample[];
}

/** Consume actual device samples, never predicted points. The dispatched event
 * can summarize its children, so do not draw both when children are available.
 * https://www.w3.org/TR/pointerevents3/#coalesced-events */
export function pointerPathSamples(event: CoalescedPointer): readonly PointerSample[] {
  let samples: readonly PointerSample[] = [];
  try {
    samples = event.getCoalescedEvents?.() ?? [];
  } catch {
    // Restricted/older event implementations still expose the dispatched point.
  }
  const valid = samples.filter(
    (sample) =>
      sample.pointerId === event.pointerId &&
      Number.isFinite(sample.clientX) &&
      Number.isFinite(sample.clientY),
  );
  return valid.length ? valid : [event];
}

/** One event batch produces one immutable preview. The terminal point bypasses
 * distance thinning so lifting a short stroke cannot silently shorten it. */
export function appendFreehandPoints(
  previous: readonly Point[],
  samples: readonly PointerSample[],
  project: (sample: PointerSample) => Point | null,
  dimensions: Dimensions,
  spacing: number,
  limit: number,
  terminal = false,
): { points: Point[]; changed: boolean; limitReached: boolean } {
  const points = [...previous];
  let limitReached = false;
  for (let i = 0; i < samples.length; i++) {
    const point = project(samples[i]!);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const last = points.at(-1);
    const distance = last
      ? Math.hypot((point.x - last.x) * dimensions.width, (point.y - last.y) * dimensions.height)
      : Infinity;
    if (distance <= 1e-9 || (distance < spacing && !(terminal && i === samples.length - 1)))
      continue;
    if (points.length >= limit) {
      limitReached = true;
      break;
    }
    points.push({ x: point.x, y: point.y });
  }
  return { points, changed: points.length !== previous.length, limitReached };
}
