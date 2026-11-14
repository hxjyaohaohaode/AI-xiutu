import { type Dimensions, type FaceWarpAnchorV3, type Point } from '@ai-xiutu/editor';
import { center, unit } from './geometry.js';
import type { PortraitTarget } from './types.js';

export const bodySectionKeys = [
  'upperTorso',
  'midTorso',
  'waistBand',
  'pelvisBand',
  'upperArmA',
  'forearmA',
  'upperArmB',
  'forearmB',
  'thighA',
  'shinA',
  'thighB',
  'shinB',
] as const;
type SectionKey = (typeof bodySectionKeys)[number];
type Band = { from: Point; minus: Point; plus: Point; index: number };
type Sample = (p: Point) => number;
const span = (a: Point, b: Point, size: Dimensions) =>
  Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height);
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const inside = (p: Point) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
function visible(target: PortraitTarget, index: number) {
  const p = target.landmarks[index];
  return p && (p.visibility ?? 0) >= 0.62 && inside(p) ? p : undefined;
}
function direction(a: Point, b: Point, size: Dimensions) {
  const x = (b.x - a.x) * size.width,
    y = (b.y - a.y) * size.height,
    length = Math.hypot(x, y);
  return length >= 2 ? { x: x / length, y: y / length, length } : undefined;
}
function move(p: Point, dx: number, dy: number, size: Dimensions): Point {
  return { x: p.x + dx / size.width, y: p.y + dy / size.height };
}

/** A section is admissible only if both boundaries are seen on this person's
 * confidence map, with background (or an isolated nearby person) beyond
 * them. Abort at another person's mask or a cropped image edge. */
export function measureBodySections(
  target: PortraitTarget,
  size: Dimensions,
  subject: Sample,
  neighbor: Sample,
  observed = false,
): PortraitTarget['contours'] {
  const contours: PortraitTarget['contours'] = {};
  const point = (i: number) => visible(target, i);
  const left = point(11),
    right = point(12),
    hipA = point(23),
    hipB = point(24);
  const shoulders = left && right ? center([left, right]) : undefined;
  const hips = hipA && hipB ? center([hipA, hipB]) : undefined;
  const shoulderSpan = left && right ? span(left, right, size) : 0;
  function band(
    key: SectionKey | 'neckBand',
    a: Point,
    b: Point,
    positions: number[],
    cap: number,
    min: number,
  ) {
    const axis = direction(a, b, size);
    if (!axis || cap < 3) return;
    const step = Math.max(0.55, cap / 26);
    const sections: Point[] = [];
    for (const t of positions) {
      const from = mix(a, b, t);
      if (subject(from) < 0.59 || neighbor(from) > 0.38) continue;
      const edges: Point[] = [];
      for (const sign of [-1, 1]) {
        let last = 0,
          low = 0;
        for (let d = step; d <= cap; d += step) {
          const sample = move(from, -axis.y * d * sign, axis.x * d * sign, size);
          if (!inside(sample) || neighbor(sample) > 0.41) break;
          const coverage = subject(sample);
          if (coverage >= 0.5) {
            last = d;
            low = 0;
          } else if (coverage <= 0.32 && ++low >= 2) {
            if (last >= min)
              edges.push(
                move(
                  from,
                  -axis.y * (last + step / 2) * sign,
                  axis.x * (last + step / 2) * sign,
                  size,
                ),
              );
            break;
          }
        }
      }
      if (edges.length !== 2) continue;
      const m = span(edges[0]!, from, size),
        p = span(edges[1]!, from, size);
      if (Math.max(m, p) > Math.min(m, p) * (observed ? 2.7 : 2.25)) continue;
      sections.push(from, edges[0]!, edges[1]!);
    }
    if (sections.length) contours[key] = sections;
  }
  if (shoulders && hips && shoulderSpan >= 10) {
    band('upperTorso', shoulders, hips, [0.13, 0.24], shoulderSpan * 0.81, shoulderSpan * 0.21);
    band('midTorso', shoulders, hips, [0.32, 0.44], shoulderSpan * 0.79, shoulderSpan * 0.19);
    band(
      'waistBand',
      shoulders,
      hips,
      observed ? [0.48, 0.58, 0.68, 0.79] : [0.54, 0.66, 0.77],
      shoulderSpan * (observed ? 0.79 : 0.7),
      shoulderSpan * 0.16,
    );
    band(
      'pelvisBand',
      shoulders,
      hips,
      [0.84, 0.96, 1.05],
      shoulderSpan * 0.84,
      shoulderSpan * 0.19,
    );
  }
  for (const [key, i, j] of [
    ['upperArmA', 11, 13],
    ['forearmA', 13, 15],
    ['upperArmB', 12, 14],
    ['forearmB', 14, 16],
    ['thighA', 23, 25],
    ['shinA', 25, 27],
    ['thighB', 24, 26],
    ['shinB', 26, 28],
  ] as const) {
    const a = point(i),
      b = point(j);
    if (!a || !b) continue;
    const length = span(a, b, size);
    if (length < 11) continue;
    const leg = key.startsWith('thigh') || key.startsWith('shin');
    const cap = Math.min(
      length * (leg ? 0.46 : 0.39),
      Math.max(shoulderSpan * (leg ? 0.42 : 0.32), length * 0.25),
    );
    band(key, a, b, [0.22, 0.42, 0.63, 0.81], cap, Math.max(1.35, length * 0.035));
  }
  if (observed && shoulders && point(7) && point(8)) {
    const head = center([point(7)!, point(8)!]);
    if (span(head, shoulders, size) > shoulderSpan * 0.27)
      band('neckBand', head, shoulders, [0.45, 0.58, 0.7], shoulderSpan * 0.6, shoulderSpan * 0.1);
  }
  const pins = (ids: number[], threshold: number) =>
    ids.flatMap((id) => {
      const p = point(id);
      return p && subject(p) > threshold && neighbor(p) < 0.42 ? [{ x: p.x, y: p.y }] : [];
    });
  const tail = pins([27, 28, 29, 30, 31, 32], 0.3);
  const head = pins([0, 7, 8], 0.38);
  if (tail.length === 6) contours.footPins = tail;
  else if (observed) {
    // The toe landmark often lies on the shoe boundary. A recoverable contact
    // needs a visible ankle, a visible heel or toe, and foreground support on both feet.
    const contacts = [
      [27, 29, 31],
      [28, 30, 32],
    ].map(([ankleId, heelId, toeId]) => {
      const ankle = point(ankleId!);
      if (!ankle || subject(ankle) < 0.42 || neighbor(ankle) > 0.38) return [];
      const contacts = [heelId!, toeId!].flatMap((id) => {
        const p = target.landmarks[id];
        if (
          !p ||
          (p.visibility ?? 0) < 0.43 ||
          !inside(p) ||
          neighbor(p) > 0.34 ||
          span(ankle, p, size) < 1.5 ||
          span(ankle, p, size) > Math.max(9, shoulderSpan * 0.54)
        )
          return [];
        const supported = mix(ankle, p, 0.74);
        return subject(supported) >= 0.46 ? [{ x: p.x, y: p.y }] : [];
      });
      return contacts.length ? [{ x: ankle.x, y: ankle.y }, ...contacts] : [];
    });
    if (contacts.every((points) => points.length >= 2)) contours.footPins = contacts.flat();
  }
  if (head.length === 3) contours.headPins = head;
  return contours;
}
function sections(target: PortraitTarget, key: SectionKey | 'neckBand'): Band[] {
  const source = target.contours[key] ?? [];
  const result: Band[] = [];
  if (source.length % 3 !== 0 || source.length > 12) return result;
  for (let i = 0; i < source.length; i += 3)
    result.push({ from: source[i]!, minus: source[i + 1]!, plus: source[i + 2]!, index: i / 3 });
  return result;
}
const ready = (target: PortraitTarget, ...keys: SectionKey[]) =>
  keys.every((key) => sections(target, key).length >= 2);
function fullPose(target: PortraitTarget, size: Dimensions, observed = false) {
  const joints = [11, 12, 23, 24, 25, 26, 27, 28].map((id) => visible(target, id));
  if (joints.some((p) => !p) || (target.contours.footPins?.length ?? 0) < (observed ? 4 : 6))
    return;
  const [s1, s2, h1, h2, k1, k2, a1, a2] = joints as [
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
    Point,
  ];
  const shoulder = center([s1, s2]),
    hip = center([h1, h2]),
    ankle = center([a1, a2]);
  const down = direction(shoulder, hip, size),
    length = span(hip, ankle, size);
  if (!down || length < 25 || Math.abs(down.y) < 0.55) return;
  const projection = (from: Point, to: Point) =>
    (to.x - from.x) * size.width * down.x + (to.y - from.y) * size.height * down.y;
  if (
    [projection(h1, k1), projection(h2, k2), projection(k1, a1), projection(k2, a2)].some(
      (part) => part < length * 0.15,
    )
  )
    return;
  // Full-height tools are conservative for seated, very bent or foreshortened poses.
  if (
    [span(h1, k1, size) + span(k1, a1, size), span(h2, k2, size) + span(k2, a2, size)].some(
      (v) => v > length * 1.48,
    )
  )
    return;
  return { shoulder, hip, down, length };
}

export const bodyPrecisionTools = new Set([
  'shoulders',
  'arms',
  'waist',
  'hips',
  'legs',
  'legLength',
  'height',
]);
export function bodyPrecisionAvailable(
  target: PortraitTarget,
  size: Dimensions,
  tool: string,
  observed = false,
) {
  if (!target.bodyMask || !target.bodySupport) return false;
  switch (tool) {
    case 'neckLength':
    case 'neckWidth':
      return (
        observed &&
        sections(target, 'neckBand').length >= 2 &&
        (target.contours.headPins?.length ?? 0) === 3
      );
    case 'shoulders':
      return ready(target, 'upperTorso') && !!visible(target, 11) && !!visible(target, 12);
    case 'waist':
      return ready(target, 'waistBand');
    case 'hips':
      return ready(target, 'pelvisBand');
    case 'arms':
      return ready(target, 'upperArmA', 'forearmA') || ready(target, 'upperArmB', 'forearmB');
    case 'legs':
      return ready(target, 'thighA', 'shinA') || ready(target, 'thighB', 'shinB');
    case 'legLength':
      return (
        !!fullPose(target, size, observed) &&
        (ready(target, 'thighA', 'shinA', 'thighB', 'shinB') ||
          (observed &&
            ready(target, 'shinA', 'shinB') &&
            sections(target, 'thighA').length > 0 &&
            sections(target, 'thighB').length > 0)) &&
        sections(target, 'pelvisBand').length >= 1
      );
    case 'height':
      return (
        !!fullPose(target, size, observed) &&
        ready(target, 'thighA', 'shinA', 'thighB', 'shinB') &&
        (sections(target, 'midTorso').length >= 1 ||
          (observed &&
            sections(target, 'upperTorso').length >= 2 &&
            sections(target, 'waistBand').length >= 1)) &&
        sections(target, 'pelvisBand').length >= 1 &&
        (target.contours.headPins?.length ?? 0) === 3
      );
    default:
      return false;
  }
}

/** One smooth inverse field per person, with shoulder/hip width resolved at
 * the actual silhouette and leg proportions redistributed from the hips.
 * Foot contact stays fixed for both positive and negative values. */
export function bodyProportionAnchors(
  target: PortraitTarget,
  size: Dimensions,
  value: (id: string) => number,
  observed = false,
  sceneAware = false,
): FaceWarpAnchorV3[] {
  const result: FaceWarpAnchorV3[] = [];
  const short = Math.min(size.width, size.height);
  const widthKeys: Partial<Record<SectionKey, [string, number]>> = {
    upperTorso: ['shoulders', 0.17],
    waistBand: ['waist', 0.2],
    pelvisBand: ['hips', -0.19],
    upperArmA: ['arms', 0.17],
    forearmA: ['arms', 0.16],
    upperArmB: ['arms', 0.17],
    forearmB: ['arms', 0.16],
    thighA: ['legs', 0.17],
    shinA: ['legs', 0.15],
    thighB: ['legs', 0.17],
    shinB: ['legs', 0.15],
  };
  // The caller has already filtered unavailable values on the same analysis.
  const gain = Object.fromEntries([...bodyPrecisionTools].map((id) => [id, value(id)]));
  const widthBalance = sceneAware ? 1 / Math.max(1, 0.70 + 0.26 * Math.hypot(
    ...['shoulders', 'waist', 'hips', 'arms', 'legs', 'height', 'legLength'].map(value))) : 1;
  const pose = gain.height || gain.legLength ? fullPose(target, size, observed) : undefined;
  const shoulderDistance = pose ? span(pose.shoulder, pose.hip, size) : 0;
  const stretchBudget = observed
    ? 1 / Math.max(1, Math.abs(gain.legLength ?? 0) + Math.abs(gain.height ?? 0) * 0.8)
    : 1;
  const lengthGain = pose ? (gain.legLength ?? 0) * 0.037 * pose.length * stretchBudget : 0;
  const heightGain = pose
    ? (gain.height ?? 0) * 0.032 * (pose.length + shoulderDistance) * stretchBudget
    : 0;
  const point = (p: Point) => ({ x: unit(p.x), y: unit(p.y) });
  const push = (p: Point, dx: number, dy: number, radius: number, strength = 1) => {
    if (radius < 2 || Math.hypot(dx, dy) < 0.015) return;
    const to = point(move(p, dx, dy, size));
    result.push({ mode: 'push', from: p, to, radius: Math.min(0.75, radius / short), strength });
  };
  const pin = (p: Point, r: number, strength: number) => {
    if (inside(p)) {
      const position = point(p);
      result.push({
        mode: 'pin',
        from: position,
        to: position,
        radius: Math.min(0.75, r / short),
        strength,
      });
    }
  };
  if (observed && (value('neckWidth') || value('neckLength'))) {
    const first = visible(target, 11),
      second = visible(target, 12);
    const ears = target.contours.headPins ?? [];
    const neck = sections(target, 'neckBand');
    if (first && second && ears.length === 3 && neck.length >= 2) {
      const shoulder = center([first, second]);
      const head = center(ears);
      const axis = direction(shoulder, head, size);
      const across = span(first, second, size);
      if (axis) {
        for (const { from, minus, plus } of neck)
          for (const p of [minus, plus]) {
            const inward = direction(p, from, size);
            if (inward)
              push(
                p,
                inward.x * inward.length * value('neckWidth') * 0.16,
                inward.y * inward.length * value('neckWidth') * 0.16,
                across * 0.15,
              );
          }
        const rise = axis.length * 0.12 * value('neckLength');
        // Move the visible head as a supported unit. Lower neck and both
        // shoulders are pinned to redistribute the change across the neck.
        push(head, axis.x * rise, axis.y * rise, Math.max(axis.length, across * 0.55));
        for (const p of ears) push(p, axis.x * rise, axis.y * rise, across * 0.34);
        pin(shoulder, across * 0.24, 1);
        pin(first, across * 0.18, 1);
        pin(second, across * 0.18, 1);
      }
    }
  }
  for (const key of bodySectionKeys) {
    const band = sections(target, key);
    const setting = widthKeys[key];
    const width = setting ? (gain[setting[0]] ?? 0) * setting[1] * widthBalance : 0;
    const subjectLeg = key.startsWith('thigh') || key.startsWith('shin');
    if (key.endsWith('A') || key.endsWith('B')) {
      if (key.startsWith('upperArm') || key.startsWith('forearm')) {
        const side = key.slice(-1);
        if (!ready(target, ('upperArm' + side) as SectionKey, ('forearm' + side) as SectionKey))
          continue;
      } else if (subjectLeg) {
        const side = key.slice(-1);
        if (
          !ready(target, ('thigh' + side) as SectionKey, ('shin' + side) as SectionKey) &&
          !(observed && pose && band.length)
        )
          continue;
      }
    }
    for (const { from, minus, plus } of band) {
      const across = span(minus, plus, size);
      if (across < 4 || across > short * 0.9) continue;
      if (width && (!observed || !subjectLeg || band.length >= 2))
        for (const p of [minus, plus]) {
          const toward = direction(p, from, size);
          if (toward)
            push(
              p,
              toward.x * toward.length * width,
              toward.y * toward.length * width,
              Math.min(toward.length * 1.28, across * 0.61),
              0.93,
            );
        }
      if (!pose || (!lengthGain && !heightGain) || key.includes('Arm') || key.includes('arm'))
        continue;
      const q =
        (from.x - pose.hip.x) * size.width * pose.down.x +
        (from.y - pose.hip.y) * size.height * pose.down.y;
      const leg = unit(q / pose.length);
      const upper = unit(1 + q / Math.max(1, shoulderDistance));
      const t = subjectLeg ? (1 - leg) ** 1.3 : upper ** 1.22;
      const stretch = subjectLeg ? (1 - leg) ** 1.15 : 0.68 + 0.32 * upper;
      const delta = -(lengthGain * t + heightGain * stretch);
      const radius = Math.min(pose.length * 0.21, Math.max(across * 1.05, pose.length * 0.105));
      push(from, pose.down.x * delta, pose.down.y * delta, radius, 0.96);
    }
  }
  if (heightGain && pose && (target.contours.headPins?.length ?? 0) >= 3) {
    const head = center(target.contours.headPins!);
    push(
      head,
      -pose.down.x * heightGain * 0.72,
      -pose.down.y * heightGain * 0.72,
      shoulderDistance * 0.46,
      0.85,
    );
  }
  if (result.length && pose) {
    const radius = pose.length * 0.085;
    for (const p of target.contours.footPins ?? []) pin(p, radius, 0.94);
    if (!heightGain) for (const p of target.contours.headPins ?? []) pin(p, radius, 0.95);
  }
  if (sceneAware && result.length) {
    // Stop width changes from dragging isolated hands, knees and shoes. A
    // leg-length edit needs the knees to follow its longitudinal request.
    const width = Math.max(8, span(target.landmarks[11]!, target.landmarks[12]!, size));
    for (const index of [15, 16, 27, 28, ...(!lengthGain && !heightGain ? [25, 26] : [])]) {
      const p = visible(target, index);
      if (p) pin(p, width * 0.12, 0.85);
    }
  }
  return result;
}

export function bodyNeighborGuard(target: PortraitTarget, all: PortraitTarget[]) {
  if (!target.bodySupport) return;
  const neighbors = all.filter(
    (person) => person.kind === 'body' && person.id !== target.id && person.bodyMask,
  );
  // Masks are evaluated once per render (same source convention). Refuse an
  // intersecting person instead of guessing which body owns a shared pixel.
  const overlaps = neighbors.filter(
    ({ bounds: b }) =>
      b.x + b.width > target.bounds.x - target.bounds.width * 0.25 &&
      b.x < target.bounds.x + target.bounds.width * 1.25 &&
      b.y + b.height > target.bounds.y &&
      b.y < target.bounds.y + target.bounds.height,
  );
  return [
    { ...target.bodySupport, invert: !target.bodySupport.invert },
    ...overlaps.map((person) => person.bodyMask!),
  ];
}
