import { messageBlocks, type MessageBlock } from './message-format.js';

import { delimited, type DataTable } from './table.js';

function dataBlock(
  text: string,
  line: number,
  separator?: string,
  typed = false,
): DataTable | null {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const delimiters = separator ? [separator] : ['\t', ','];
  for (const delimiter of delimiters) {
    if (!separator && !source.split('\n', 1)[0]?.includes(delimiter)) continue;
    const textCells = typed ? new Set<number>() : undefined;
    const values = delimited(source, delimiter, textCells);
    if (values)
      return {
        kind: 'table',
        line,
        headers: values[0]!,
        rows: values.slice(1),
        ...(textCells ? { textCells } : {}),
      };
  }
  return null;
}

export function contentBlocks(body: string, strictTables = false): MessageBlock[] {
  const plainTable = dataBlock(body, 0);
  if (plainTable) return [plainTable];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  return messageBlocks(body, 256).map((block) => {
    if (block.kind === 'heading')
      return { ...block, level: lines[block.line]!.trimStart().match(/^#+/)![0].length };
    if (
      strictTables &&
      block.kind === 'table' &&
      lines[block.line + block.rows.length + 2]?.includes('|')
    )
      throw new Error('数据表存在列数不一致的行，请检查后再导出。');
    if (block.kind === 'code' && /^(?:csv|tsv|sheet-tsv)$/i.test(block.language)) {
      const table = dataBlock(
        block.text,
        block.line,
        block.language.toLowerCase() === 'csv' ? ',' : '\t',
        block.language.toLowerCase() === 'sheet-tsv',
      );
      if (strictTables && !table) throw new Error('数据表存在列数不一致的行，请检查后再导出。');
      return table ?? block;
    }
    return block;
  });
}
