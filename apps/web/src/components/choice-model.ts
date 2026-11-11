export type ChoiceOption<T extends string = string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type ChoiceSearch = { text: string; time: number };

/** A live list may reorder or lose options while its menu is open. Follow values, not indices. */
export function choiceCursor(
  options: readonly ChoiceOption[],
  cursorValue: string | null,
  selectedValue: string,
) {
  const cursor = options.findIndex((option) => option.value === cursorValue && !option.disabled);
  if (cursor >= 0) return cursor;
  const selected = options.findIndex(
    (option) => option.value === selectedValue && !option.disabled,
  );
  return selected >= 0 ? selected : moveChoice(options, -1, 1);
}

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
  const prefix = query.trim().normalize('NFKC').toLocaleLowerCase();
  if (!prefix) return -1;
  for (let step = 1; step <= options.length; step++) {
    const index = (((after + step) % options.length) + options.length) % options.length;
    const option = options[index]!;
    if (!option.disabled && option.label.normalize('NFKC').toLocaleLowerCase().startsWith(prefix))
      return index;
  }
  return -1;
}

export function choiceSearchActive(search: ChoiceSearch, now: number) {
  return Boolean(search.text) && now >= search.time && now - search.time < 700;
}

/** Consecutive letters refine a prefix; repeated letters cycle without admitting disabled options. */
export function advanceChoiceSearch(
  options: readonly ChoiceOption[],
  previous: ChoiceSearch,
  key: string,
  now: number,
  after: number,
) {
  const earlier = choiceSearchActive(previous, now) ? previous.text : '';
  const normalizedKey = key.normalize('NFKC').toLocaleLowerCase();
  const repeated =
    earlier &&
    [...earlier.normalize('NFKC').toLocaleLowerCase()].every((letter) => letter === normalizedKey);
  const text = (repeated ? key : earlier + key).slice(0, 128);
  return {
    search: { text, time: now },
    index: findChoice(options, text, [...text].length === 1 ? after : -1),
  };
}

/** Ignore synthetic hover updates at the same coordinates after keyboard scrolling. */
export function choicePointerMoved(
  previous: { x: number; y: number } | null,
  next: { x: number; y: number },
) {
  return previous !== null && (previous.x !== next.x || previous.y !== next.y);
}

/** Reveal only the active row, using its measured size rather than an assumed line height. */
export function choiceScrollTarget(
  viewport: { scrollTop: number; clientHeight: number; scrollHeight: number; inset: number },
  option: { top: number; height: number },
) {
  const { scrollTop, clientHeight, scrollHeight } = viewport;
  const inset = Math.min(Math.max(0, viewport.inset), clientHeight / 2);
  const top = scrollTop + inset;
  const bottom = scrollTop + clientHeight - inset;
  const next =
    option.top < top || option.height > clientHeight - inset * 2
      ? option.top - inset
      : option.top + option.height > bottom
        ? option.top + option.height - clientHeight + inset
        : scrollTop;
  return Math.max(0, Math.min(next, Math.max(0, scrollHeight - clientHeight)));
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
