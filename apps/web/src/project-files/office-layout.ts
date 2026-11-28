import { splitDocumentRuns, type DocumentFormat } from '@ai-xiutu/contracts';
import { formattedRuns } from './formatting';
import type { MessageBlock } from '@ai-xiutu/contracts/office-data';

export function officeLayout(body: string, formatting: DocumentFormat) {
  const lines = body.split(/\r\n?|\n/);
  const paragraphs = new Map(formatting.paragraphs.map((p) => [p.line, p]));
  return {
    paragraph(line: number, text: string, offset?: number, literal = false) {
      const p = paragraphs.get(line);
      const from = offset ?? lines[line]?.indexOf(text) ?? -1;
      const ranges = splitDocumentRuns(text, from < 0 ? [] : p?.runs, Math.max(0, from));
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
        indent: p?.indent,
        spacing: p?.spacing,
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
