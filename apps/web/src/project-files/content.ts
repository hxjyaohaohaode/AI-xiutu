import { messageBlocks, type MessageBlock } from '../ai/message-format';

export type DataTable = Extract<MessageBlock, { kind: 'table' }>;

// Accept rectangular CSV/TSV with a header, including quoted delimiters and newlines.
function delimited(text: string, delimiter: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  for (let i = 0; i <= text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === undefined) return null;
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === delimiter) {
      row.push(field);
      field = '';
      closed = false;
    } else if (char === '\n' || char === undefined) {
      row.push(field);
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      field = '';
      closed = false;
    } else if (closed) return null;
    else if (char === '"' && field === '') quoted = true;
    else if (char === '"') return null;
    else field += char;
  }
  const width = rows[0]?.length ?? 0;
  return rows.length >= 2 &&
    width >= 2 &&
    width <= 256 &&
    rows[0].every((header) => header.trim()) &&
    rows.every((values) => values.length === width)
    ? rows
    : null;
}

function dataBlock(text: string, line: number, separator?: string): DataTable | null {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const delimiters = separator ? [separator] : ['\t', ','];
  for (const delimiter of delimiters) {
    if (!source.split('\n', 1)[0].includes(delimiter)) continue;
    const values = delimited(source, delimiter);
    if (values) return { kind: 'table', line, headers: values[0], rows: values.slice(1) };
  }
  return null;
}

export function contentBlocks(body: string, strictTables = false): MessageBlock[] {
  const plainTable = dataBlock(body, 0);
  if (plainTable) return [plainTable];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  return messageBlocks(body, 256).map((block) => {
    if (
      strictTables &&
      block.kind === 'table' &&
      lines[block.line + block.rows.length + 2]?.includes('|')
    )
      throw new Error('数据表存在列数不一致的行，请检查后再导出。');
    if (block.kind === 'code' && /^(?:csv|tsv)$/i.test(block.language)) {
      const table = dataBlock(
        block.text,
        block.line,
        block.language.toLowerCase() === 'csv' ? ',' : '\t',
      );
      if (strictTables && !table) throw new Error('数据表存在列数不一致的行，请检查后再导出。');
      return table ?? block;
    }
    return block;
  });
}

export function numericCell(source: string): { value: number; percent: boolean } | null {
  // Excel has 15 significant decimal digits. Preserve identifiers and higher precision as text.
  const text = source;
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?%?$/.test(text)) return null;
  const digits = text.replace(/[-.%]/g, '').replace(/^0+/, '');
  if (digits.length > 15) return null;
  const percent = text.endsWith('%');
  const value = Number(percent ? text.slice(0, -1) : text) / (percent ? 100 : 1);
  return Number.isFinite(value) && (value !== 0 || !digits) ? { value, percent } : null;
}

export function chartSeries(table: DataTable) {
  // Each value series gets its own axis so counts and percentages are never mixed.
  if (!table.rows.length) return [];
  return table.headers.slice(1).flatMap((name, index) => {
    const column = index + 1;
    const numbers = table.rows.map((row) => numericCell(row[column]));
    const percent = numbers.find((item) => item !== null)?.percent;
    if (percent === undefined || numbers.some((item) => !item || item.percent !== percent))
      return [];
    return [{ name, column, percent, values: numbers.map((item) => item!.value) }];
  });
}

export function xml(value: string) {
  return value
    .replace(/[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
