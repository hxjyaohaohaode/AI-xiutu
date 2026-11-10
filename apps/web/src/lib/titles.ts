/** Matches the API's title schema, including its UTF-16 length budget. */
export function boundedTitle(value: string, suffix = ''): string {
  const budget = Math.max(0, 120 - suffix.length);
  const base = value
    .trim()
    .slice(0, budget)
    .replace(/[\uD800-\uDBFF]$/, '')
    .trimEnd();
  return (base || '作品') + suffix;
}
