export type ChoiceOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
};

/** Skip unavailable options without changing the controlled value. */
export function moveChoice(options: readonly ChoiceOption[], current: number, direction: 1 | -1) {
  if (!options.length) return -1;
  const start = current < 0 ? (direction === 1 ? -1 : 0) : current;
  for (let step = 1; step <= options.length; step++) {
    const index = (start + direction * step + options.length * 2) % options.length;
    if (!options[index]!.disabled) return index;
  }
  return -1;
}

export function findChoice(options: readonly ChoiceOption[], query: string, after: number) {
  const prefix = query.trim().toLocaleLowerCase();
  if (!prefix) return -1;
  for (let step = 1; step <= options.length; step++) {
    const index = (after + step + options.length) % options.length;
    const option = options[index]!;
    if (!option.disabled && option.label.toLocaleLowerCase().startsWith(prefix)) return index;
  }
  return -1;
}

export function choicePlacement(
  anchor: { left: number; right: number; top: number; bottom: number; width: number },
  viewport: { left: number; top: number; width: number; height: number },
  preferredHeight = 320,
): {
  left: number;
  width: number;
  maxHeight: number;
  top: number | undefined;
  bottom: number | undefined;
  upward: boolean;
} {
  const edge = 8;
  const gap = 6;
  const right = viewport.left + viewport.width;
  const bottom = viewport.top + viewport.height;
  const availableHeight = Math.max(0, viewport.height - edge * 2);
  const below = Math.max(0, bottom - edge - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - viewport.top - edge);
  const upward = below < Math.min(preferredHeight, availableHeight) && above > below;
  const room = upward ? above : below;
  const detached = room < Math.min(44, availableHeight);
  const maxHeight = Math.min(preferredHeight, availableHeight, detached ? availableHeight : room);
  const width = Math.max(0, Math.min(Math.max(anchor.width, 200), viewport.width - edge * 2));
  const left = Math.max(viewport.left + edge, Math.min(anchor.left, right - edge - width));
  return {
    left,
    width,
    maxHeight,
    ...(detached
      ? { top: viewport.top + edge, bottom: undefined }
      : upward
        ? {
            bottom: Math.max(edge, viewport.height + viewport.top - anchor.top + gap),
            top: undefined,
          }
        : { top: Math.max(viewport.top + edge, anchor.bottom + gap), bottom: undefined }),
    upward,
  };
}
