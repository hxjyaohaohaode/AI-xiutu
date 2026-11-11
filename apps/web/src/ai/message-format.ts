/** Deliberately small, non-executable message format. HTML and image embeds stay text. */
export type MessageBlock =
  | { kind: 'paragraph' | 'heading' | 'quote'; text: string; line: number }
  | { kind: 'code'; text: string; language: string; line: number }
  | { kind: 'list'; ordered: boolean; items: { text: string; number?: number }[]; line: number }
  | { kind: 'table'; headers: string[]; rows: string[][]; line: number };

const listItem = (line: string) => /^(?: {0,3})(?:(\d{1,5})[.)]|[-+*])\s+(.+)$/.exec(line);
const fence = (line: string) => /^ {0,3}(`{3,}|~{3,})([\w+-]*)\s*$/.exec(line);
const heading = (line: string) => /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/.exec(line);
const quote = (line: string) => /^ {0,3}>\s?(.*)$/.exec(line);
const tableCells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
const tableRule = (line: string) =>
  line.includes('|') && tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));

export function messageBlocks(text: string): MessageBlock[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const result: MessageBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = index;
    const current = lines[index]!;
    if (!current.trim()) {
      index++;
      continue;
    }
    const code = fence(current);
    if (code) {
      const content: string[] = [];
      index++;
      while (index < lines.length) {
        const closing = lines[index]!.trim();
        if (
          closing.length >= code[1]!.length &&
          [...closing].every((character) => character === code[1]![0])
        ) {
          index++;
          break;
        }
        content.push(lines[index++]!);
      }
      // Unclosed fences are useful while a response is still arriving.
      result.push({ kind: 'code', text: content.join('\n'), language: code[2]!, line });
      continue;
    }
    const title = heading(current);
    if (title) {
      result.push({ kind: 'heading', text: title[1]!, line });
      index++;
      continue;
    }
    if (current.includes('|') && lines[index + 1] && tableRule(lines[index + 1]!)) {
      const headers = tableCells(current);
      if (headers.length <= 12 && tableCells(lines[index + 1]!).length === headers.length) {
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length && lines[index]!.includes('|')) {
          const cells = tableCells(lines[index]!);
          if (cells.length !== headers.length) break;
          rows.push(cells);
          index++;
        }
        result.push({ kind: 'table', headers, rows, line });
        continue;
      }
    }
    const firstItem = listItem(current);
    if (firstItem) {
      const ordered = firstItem[1] !== undefined;
      const items: { text: string; number?: number }[] = [];
      while (index < lines.length) {
        const item = listItem(lines[index]!);
        if (!item || (item[1] !== undefined) !== ordered) break;
        items.push({ text: item[2]!, ...(ordered ? { number: Number(item[1]) } : {}) });
        index++;
      }
      result.push({ kind: 'list', ordered, items, line });
      continue;
    }
    const firstQuote = quote(current);
    if (firstQuote) {
      const content: string[] = [];
      while (index < lines.length) {
        const entry = quote(lines[index]!);
        if (!entry) break;
        content.push(entry[1]!);
        index++;
      }
      result.push({ kind: 'quote', text: content.join('\n'), line });
      continue;
    }
    const content = [current];
    index++;
    while (index < lines.length) {
      const next = lines[index]!;
      if (!next.trim() || fence(next) || heading(next) || listItem(next) || quote(next)) break;
      if (next.includes('|') && lines[index + 1] && tableRule(lines[index + 1]!)) break;
      content.push(next);
      index++;
    }
    result.push({ kind: 'paragraph', text: content.join('\n'), line });
  }
  return result;
}

export function messageLink(value: string): string | null {
  // Never turn supplier text into executable protocols, credentials, or remote media loads.
  if (!/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
