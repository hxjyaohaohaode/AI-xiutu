import type { Point } from '@ai-xiutu/editor';

/** Prune disconnected weak components only when at least one face anchors the mask.
 * Large human-class components and strongly identified hair remain eligible. */
export function anchoredSubjectPrior(
  background: Float32Array,
  category: Uint8Array,
  width: number,
  height: number,
  faces: readonly Point[],
) {
  if (
    !faces.length ||
    background.length !== width * height ||
    background.length !== category.length
  )
    return background;
  const seen = new Uint32Array(background.length),
    queue = new Uint32Array(background.length);
  const components: { size: number; human: number; hair: number }[] = [];
  for (let at = 0; at < seen.length; at++) {
    if (seen[at] || !(background[at]! < 0.55)) continue;
    const label = components.length + 1;
    let size = 1,
      human = 0,
      hair = 0;
    queue[0] = at;
    seen[at] = label;
    for (let i = 0; i < size; i++) {
      const index = queue[i]!,
        x = index % width,
        y = Math.floor(index / width),
        c = category[index]!;
      if (c >= 1 && c <= 4 && background[index]! < 0.27) human++;
      if (c === 1 && background[index]! < 0.22) hair++;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const n = yy * width + xx;
          if (seen[n] || !(background[n]! < 0.55)) continue;
          seen[n] = label;
          queue[size++] = n;
        }
      }
    }
    components.push({ size, human, hair });
  }
  const anchors = new Set(
    faces
      .flatMap(({ x, y }) =>
        x >= 0 && x < 1 && y >= 0 && y < 1
          ? [seen[Math.floor(y * height) * width + Math.floor(x * width)]!]
          : [],
      )
      .filter(Boolean),
  );
  if (!anchors.size) return background;
  const area = Math.max(...[...anchors].map((id) => components[id - 1]!.size));
  const remove = components.map(
    ({ size, human, hair }, i) =>
      !anchors.has(i + 1) &&
      hair < 3 &&
      (size < Math.min(24, Math.max(4, area * 0.008)) ? human < size * 0.8 : human < size * 0.18),
  );
  if (!remove.some(Boolean)) return background;
  const result = background.slice();
  for (let i = 0; i < result.length; i++) {
    if (seen[i] && remove[seen[i]! - 1]) result[i] = 1;
  }
  return result;
}
