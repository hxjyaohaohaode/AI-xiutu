import type { Dimensions, Point } from '@ai-xiutu/editor';

export interface PointerSample {
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pressure?: number;
}
export interface FreehandPathState {
  pressures: number[];
  breaks: number[];
  outside: boolean;
  pressureSensitive: boolean;
  observedPressure: number;
}
export function startFreehandPath(
  sample: PointerSample,
  pressureSensitive: boolean,
): FreehandPathState {
  const inputPressure = sample.pressure;
  const pressure =
    pressureSensitive && inputPressure !== undefined && inputPressure >= 0 && inputPressure <= 1
      ? inputPressure
      : 1;
  return {
    pressures: [pressure],
    breaks: [],
    outside: false,
    pressureSensitive,
    observedPressure: pressure,
  };
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
  previousPath?: FreehandPathState,
): { points: Point[]; changed: boolean; limitReached: boolean; path?: FreehandPathState } {
  const points = [...previous];
  const path = previousPath && {
    ...previousPath,
    pressures: [...previousPath.pressures],
    breaks: [...previousPath.breaks],
  };
  let limitReached = false;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i]!;
    const point = project(sample);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      if (path) path.outside = true;
      continue;
    }
    const lastPressure = path?.pressures.at(-1) ?? 1;
    // pointerup always reports zero. Finish with the last observed pen pressure.
    if (
      path?.pressureSensitive &&
      !terminal &&
      sample.pressure !== undefined &&
      sample.pressure >= 0 &&
      sample.pressure <= 1
    )
      path.observedPressure = sample.pressure;
    const pressure = path?.observedPressure ?? lastPressure;
    const pressureChange = Math.abs(pressure - lastPressure) >= 1 / 128;
    const last = points.at(-1);
    const distance = last
      ? Math.hypot((point.x - last.x) * dimensions.width, (point.y - last.y) * dimensions.height)
      : Infinity;
    if (
      !path?.outside &&
      !pressureChange &&
      (distance <= 1e-9 || (distance < spacing && !(terminal && i === samples.length - 1)))
    )
      continue;
    if (points.length >= limit) {
      limitReached = true;
      break;
    }
    if (path) {
      if (path.outside) path.breaks.push(points.length);
      path.outside = false;
      path.pressures.push(pressure);
    }
    points.push({ x: point.x, y: point.y });
  }
  return {
    points,
    changed: points.length !== previous.length,
    limitReached,
    ...(path ? { path } : {}),
  };
}
