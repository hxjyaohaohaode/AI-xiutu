export const headingScales = [1.7, 1.45, 1.28, 1.16, 1.08, 1] as const;
export type FormattedRun = { text: string; bold?: true; italic?: true; code?: true };
/** Non-recursive inline subset. Backticks protect literal content and unpaired markers stay visible. */
export function formattedRuns(text: string): FormattedRun[] {
  const result: FormattedRun[] = [];
  // Exclude nested delimiters from the payload. Every attempted span stops at its next delimiter.
  const spans =
    /`([^`\n]+)`|\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<![\w_])_([^_\n]+)_(?![\w_])/g;
  let end = 0;
  for (const match of text.matchAll(spans)) {
    if (match.index > end) result.push({ text: text.slice(end, match.index) });
    const payload = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]!;
    if (
      (match.index > 0 && text[match.index - 1] === '\\') ||
      (match[1] === undefined && payload.trim() !== payload)
    ) {
      result.push({ text: match[0] });
    } else if (match[1] !== undefined) result.push({ text: match[1], code: true });
    else if (match[2] !== undefined) result.push({ text: match[2], bold: true, italic: true });
    else if (match[3] !== undefined) result.push({ text: match[3], bold: true });
    else result.push({ text: (match[4] ?? match[5])!, italic: true });
    end = match.index + match[0].length;
  }
  if (end < text.length) result.push({ text: text.slice(end) });
  return result;
}

export type FormatCommand = 'bold' | 'italic' | 'heading' | 'list';
export function editSelection(text: string, from: number, to: number, command: FormatCommand) {
  let start = from,
    end = to;
  const lineStart = start > 0 ? text.lastIndexOf('\n', start - 1) + 1 : 0;
  const newline = text.indexOf('\n', end > start && text[end - 1] === '\n' ? end - 1 : end);
  const lineEnd = newline === -1 ? text.length : newline;
  const selected = text.slice(start, end);
  if (command === 'heading' || command === 'list') {
    const prefix = command === 'heading' ? '## ' : '- ';
    const lines = text.slice(lineStart, lineEnd).split('\n');
    const clear = lines.every((line) => line.startsWith(prefix));
    const replaced = lines
      .map((line) =>
        clear
          ? line.slice(prefix.length)
          : prefix +
            line.replace(command === 'heading' ? /^ {0,3}#{1,6}\s+/ : /^ {0,3}[-+*]\s+/, ''),
      )
      .join('\n');
    return {
      text: text.slice(0, lineStart) + replaced + text.slice(lineEnd),
      start: lineStart,
      end: lineStart + replaced.length,
    };
  }
  if (!selected || selected.includes('\n')) return null;
  // Symmetric star markers let bold and italic combine without losing the active selection.
  const before = text.slice(0, start),
    after = text.slice(end);
  const left = before.match(/\*{1,3}$/)?.[0].length ?? 0;
  const right = after.match(/^\*{1,3}/)?.[0].length ?? 0;
  const existing = left === right ? left : 0;
  const width = existing ^ (command === 'bold' ? 2 : 1);
  start -= existing;
  end += existing;
  const marks = '*'.repeat(width);
  return {
    text: text.slice(0, start) + marks + selected + marks + text.slice(end),
    start: start + width,
    end: start + width + selected.length,
  };
}
