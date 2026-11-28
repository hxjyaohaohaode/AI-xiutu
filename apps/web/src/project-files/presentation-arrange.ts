import { slideSize, type SlideElement } from '@ai-xiutu/contracts';

/**
 * PowerPoint/Keynote arrange commands. One selected object aligns to the slide;
 * several align to their shared bounding box. Distribution keeps the first and
 * last objects in place and makes every gap between neighbours equal.
 */
export const alignModes = ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const;
export type AlignMode = (typeof alignModes)[number];

const clampBox = <T extends SlideElement>(element: T): T => ({
  ...element,
  x: Math.round(Math.max(0, Math.min(slideSize.width - element.width, element.x))),
  y: Math.round(Math.max(0, Math.min(slideSize.height - element.height, element.y))),
});

export function alignElements(elements: SlideElement[], ids: readonly string[], mode: AlignMode): SlideElement[] {
  const chosen = elements.filter((item) => ids.includes(item.id));
  if (!chosen.length) return elements;
  const box =
    chosen.length === 1
      ? { left: 0, top: 0, right: slideSize.width, bottom: slideSize.height }
      : {
          left: Math.min(...chosen.map((e) => e.x)),
          top: Math.min(...chosen.map((e) => e.y)),
          right: Math.max(...chosen.map((e) => e.x + e.width)),
          bottom: Math.max(...chosen.map((e) => e.y + e.height)),
        };
  return elements.map((item) => {
    if (!ids.includes(item.id)) return item;
    const next = { ...item };
    if (mode === 'left') next.x = box.left;
    if (mode === 'center') next.x = (box.left + box.right) / 2 - item.width / 2;
    if (mode === 'right') next.x = box.right - item.width;
    if (mode === 'top') next.y = box.top;
    if (mode === 'middle') next.y = (box.top + box.bottom) / 2 - item.height / 2;
    if (mode === 'bottom') next.y = box.bottom - item.height;
    return clampBox(next);
  });
}

export function distributeElements(
  elements: SlideElement[],
  ids: readonly string[],
  axis: 'horizontal' | 'vertical',
): SlideElement[] {
  const [pos, size] = axis === 'horizontal' ? (['x', 'width'] as const) : (['y', 'height'] as const);
  const chosen = elements.filter((item) => ids.includes(item.id)).sort((a, b) => a[pos] - b[pos]);
  if (chosen.length < 3) return elements;
  const first = chosen[0]!,
    last = chosen.at(-1)!;
  const span = last[pos] + last[size] - first[pos];
  const gap = (span - chosen.reduce((sum, e) => sum + e[size], 0)) / (chosen.length - 1);
  const placed = new Map<string, number>();
  let cursor = first[pos];
  for (const item of chosen) {
    placed.set(item.id, cursor);
    cursor += item[size] + gap;
  }
  return elements.map((item) =>
    placed.has(item.id) ? clampBox({ ...item, [pos]: placed.get(item.id)! }) : item,
  );
}

/** Makes every selected object match the size of the first selected one. */
export function matchSize(elements: SlideElement[], ids: readonly string[], dimension: 'width' | 'height') {
  const reference = elements.find((item) => item.id === ids[0]);
  if (!reference || ids.length < 2) return elements;
  return elements.map((item) =>
    ids.includes(item.id) && item.id !== reference.id
      ? clampBox({ ...item, [dimension]: reference[dimension] })
      : item,
  );
}
