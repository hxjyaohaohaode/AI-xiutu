import type { DocumentFormat, FormattedRun, TextStyle } from '@ai-xiutu/contracts';
import { formattedRuns } from './formatting';
import type { MessageBlock } from '../ai/message-format';

/** Unstyled gaps are deliberately absent from persistent format ranges. */
export function splitRuns(text: string, ranges: FormattedRun[] = [], from = 0) {
  const out: { text: string; style: TextStyle }[] = [];
  const until = from + text.length;
  let cursor = from;
  for (const r of ranges) {
    if (r.from >= until) break;
    if (r.to <= from) continue;
    const a = Math.max(from, r.from),
      b = Math.min(until, r.to);
    if (a > cursor) out.push({ text: text.slice(cursor - from, a - from), style: {} });
    const { from: _a, to: _b, ...style } = r;
    out.push({ text: text.slice(a - from, b - from), style });
    cursor = b;
  }
  if (cursor < until) out.push({ text: text.slice(cursor - from), style: {} });
  return out;
}

export function officeLayout(body: string, formatting: DocumentFormat) {
  const lines = body.split(/\r\n?|\n/);
  const paragraphs = new Map(formatting.paragraphs.map((p) => [p.line, p]));
  return {
    paragraph(line: number, text: string, offset?: number, literal = false) {
      const p = paragraphs.get(line);
      const from = offset ?? lines[line]?.indexOf(text) ?? -1;
      const ranges = splitRuns(text, from < 0 ? [] : p?.runs, Math.max(0, from));
      const runs = ranges.flatMap((run) =>
        literal || Object.keys(run.style).length
          ? [run]
          : formattedRuns(run.text).map(({ text, bold, italic, code }) => ({
              text,
              style: {
                ...(bold ? { bold } : {}),
                ...(italic ? { italic } : {}),
                ...(code ? { font: 'Courier New' as const } : {}),
              },
            })),
      );
      return {
        align: p?.align,
        after: p?.after,
        runs,
      };
    },
    withBlankLines(blocks: MessageBlock[]): MessageBlock[] {
      const output: MessageBlock[] = [];
      let cursor = 0;
      for (let i = 0; i <= blocks.length; i++) {
        const block = blocks[i];
        const next = block?.line ?? lines.length;
        let start = next;
        while (start > cursor && lines[start - 1] === '') start--;
        for (let j = start; j < next; j++) output.push({ kind: 'paragraph', line: j, text: '' });
        if (block) {
          output.push(block);
          cursor = block.line + 1;
        }
      }
      return output;
    },
  };
}
export type OfficeLayout = ReturnType<typeof officeLayout>;
