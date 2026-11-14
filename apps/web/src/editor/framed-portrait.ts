import type { RGBAImage } from '@ai-xiutu/editor';
import type { FaceCandidate } from './yunet';

type Bounds = FaceCandidate['bounds'];
type Edge = { at: number; strength: number };

/** Look for a continuous, higher-contrast enclosure around a small face.
 * A printed portrait can score highly in both face and pose models. The
 * surrounding panel is independent evidence. Test a clipped panel only when
 * two horizontal edges and the opposite vertical edge remain visible. */
export function framedPortrait(image: RGBAImage, face: Bounds): Bounds | undefined {
  const { width, height, data } = image;
  const fw = face.width * width,
    fh = face.height * height;
  if (fw < 10 || fh < 10 || face.width > 0.14 || face.height > 0.135) return;
  const cx = (face.x + face.width * 0.5) * width;
  const cy = (face.y + face.height * 0.5) * height;
  const delta = Math.max(2, Math.min(5, Math.round(Math.min(fw, fh) * 0.085)));
  const step = Math.max(1, Math.min(4, Math.floor(delta * 0.65)));
  const luma = (x: number, y: number) => {
    const at = (Math.round(x) + Math.round(y) * width) * 4;
    if (data[at + 3]! < 224) return NaN;
    return 0.2126 * data[at]! + 0.7152 * data[at + 1]! + 0.0722 * data[at + 2]!;
  };
  const score = (axis: 'x' | 'y', at: number, start: number, end: number) => {
    let positive = 0,
      negative = 0,
      magnitude = 0;
    const count = 24;
    for (let i = 0; i < count; i++) {
      const p = start + ((i + 0.5) / count) * (end - start);
      const gradient =
        axis === 'x'
          ? luma(at + delta, p) - luma(at - delta, p)
          : luma(p, at + delta) - luma(p, at - delta);
      if (gradient >= 17) positive++;
      if (gradient <= -17) negative++;
      if (Number.isFinite(gradient)) magnitude += Math.min(75, Math.abs(gradient));
    }
    return (Math.max(positive, negative) / count) * Math.min(1, magnitude / (count * 32));
  };
  const candidates = (
    axis: 'x' | 'y',
    first: number,
    last: number,
    start: number,
    end: number,
    max: number,
  ) => {
    const matches: Edge[] = [];
    for (
      let at = Math.ceil(Math.max(delta, first));
      at <= Math.min(max - delta - 1, last);
      at += step
    ) {
      const strength = score(axis, at, start, end);
      if (strength >= 0.58) matches.push({ at, strength });
    }
    const picked: Edge[] = [];
    for (const edge of matches.sort((a, b) => b.strength - a.strength)) {
      if (picked.every((other) => Math.abs(edge.at - other.at) >= delta * 2)) picked.push(edge);
      if (picked.length >= 4) break;
    }
    return picked;
  };
  const top = Math.max(0, cy - fh * 0.9);
  const base = Math.min(height - 1, cy + fh * 4.8);
  const sides = [
    candidates('x', cx - fw * 4.8, cx - fw * 0.78, top, base, width),
    candidates('x', cx + fw * 0.78, cx + fw * 4.8, top, base, width),
  ];
  if (cx < fw * 3.2) sides[0]!.push({ at: 0, strength: 0 });
  if (width - cx < fw * 3.2) sides[1]!.push({ at: width - 1, strength: 0 });
  let best: { bounds: Bounds; strength: number } | undefined;
  for (const left of sides[0]!)
    for (const right of sides[1]!) {
      const span = right.at - left.at;
      if (span < fw * 1.85 || span > fw * 8 || (!left.strength && !right.strength)) continue;
      const inset = Math.min(fw * 0.4, span * 0.14);
      const start = left.at + inset,
        end = right.at - inset;
      const tops = candidates('y', cy - fh * 4.6, cy - fh * 1.03, start, end, height);
      const bottoms = candidates('y', cy + fh * 3.4, cy + fh * 14.1, start, end, height);
      for (const up of tops)
        for (const down of bottoms) {
          const length = down.at - up.at;
          if (
            length < span * 1.1 ||
            length > span * 4.8 ||
            (cy - up.at) / length < 0.1 ||
            (cy - up.at) / length > 0.46
          )
            continue;
          const first = up.at + delta * 2,
            last = down.at - delta * 2;
          const a = left.strength ? score('x', left.at, first, last) : null;
          const b = right.strength ? score('x', right.at, first, last) : null;
          if ((a ?? 1) < 0.65 || (b ?? 1) < 0.65) continue;
          const strength = (up.strength + down.strength + (a ?? b!) + (b ?? a!)) / 4;
          if (strength < 0.72 || strength <= (best?.strength ?? 0)) continue;
          best = {
            strength,
            bounds: {
              x: left.at / width,
              y: up.at / height,
              width: span / width,
              height: length / height,
            },
          };
        }
    }
  return best?.bounds;
}
